# Research: 定時排程服務與服務執行紀錄

**Feature**: 002-scheduled-services
**Phase**: 0
**Date**: 2026-05-30

本檔記錄 plan.md 中所有「不確定 / 待選」之技術決策，依「Decision / Rationale / Alternatives considered」三段式收斂。

---

## R-001：排程器（cron 觸發機制）

**Decision**: 採用 `node-cron@3`（in-process）+ `cron-parser@4`（下次時間計算）。每筆啟用中的 `schedule_configs` 啟動一個 `node-cron` job；停用 / 編輯 / 刪除時重新註冊。

**Rationale**:
- 業務量 ≤ 50 排程 / instance，記憶體 cron 完全足夠。
- 對 SC-001「誤差 < 1 分鐘」要求，`node-cron` 預設秒級精度 + Node event loop 即可達標。
- `cron-parser` 可解析使用者輸入並回算「下次預定時間」供 UI 顯示（FR-004）。
- 兩個套件皆為 MIT 授權，無相依重災區（`cron-parser` 僅 `luxon` 一個 peer）。
- v1 假設單 backend instance；多 instance leader election 列 v1.1+，以保留升級空間（不影響本期 API）。

**Alternatives considered**:
- `bree`：worker_threads-based，過度設計，且本期不需獨立 worker 隔離；增加複雜度但無對應效益。
- `bullmq`：需 Redis，僅為觸發排程引入新基礎建設不划算。
- PG-based polling（`SELECT FOR UPDATE SKIP LOCKED` 取下一個 due job）：可天然支援多 instance，但對 SC-001 要 < 1 分鐘 polling 間隔，會持續壓 PG；列為 v1.1+ 多 instance 部署時的升級路線。
- OS cron + webhook：失去單一可觀測介面（log / metrics 分散），且 dev 與 prod 行為不對等。

---

## R-002：管理者角色判定（FR-015）

**Decision**: v1 採 **env var `ADMIN_ACCOUNT_IDS`**（逗號分隔 Atlassian accountId 清單）注入；middleware `requireAdmin` 比對 `req.sessionUser.userId` 是否在白名單內。**不**在 `users` 表新增 `role` 欄位。

**Rationale**:
- spec assumption 假設「管理者/PM 角色已存在於主系統」但 001 並未實作 RBAC；補一個 v1 最小可行解。
- env-based 白名單足以表達「只有少數運維帳號可看 ServiceLogs / 設定排程」的需求，無需在 PG 加 schema 變更與管理介面。
- 升級路徑明確：v1.1+ 若要做角色管理介面，再導入 `users.role enum` + 對應 admin UI；對外 API 維持不變（middleware 內部換實作即可）。

**Alternatives considered**:
- `users.role` 欄位 + admin 設定 UI：需多寫一條 migration、一個 route、一個前端頁面，對 v1 收斂時程不利。
- 動態從 Atlassian project lead 推斷：對 SC-001 / FR-015 過嚴，且 Atlassian API call 增加 admin 判定的延遲。

**Env var 範例**：
```bash
ADMIN_ACCOUNT_IDS=5b1...abc,7c9...def
```

---

## R-003：同服務互斥（FR-006）

**Decision**: 使用 **PostgreSQL advisory lock**（`pg_try_advisory_xact_lock(hashtext($1))`），key 為 `service_id` 字串。`service-runner.ts` 在開始執行前嘗試取鎖；取不到即寫入「結果 = skipped、說明 = 上一次尚在執行」紀錄並退出。

**Rationale**:
- advisory lock 是 PG 內建、零額外依賴，且 transaction-scoped 自動釋放，crash-safe。
- 與「同 instance」設計搭配良好；未來上多 instance 時 advisory lock 仍跨 instance 有效（因 PG 端鎖），保留升級空間。
- 相較 in-memory Mutex（如 `async-mutex`），advisory lock 對「process restart 後 stale lock 殘留」零風險。

**Alternatives considered**:
- in-memory `Map<serviceId, Promise>`：簡單但 process crash 無法清理；多 instance 部署失效。
- Redis `SET NX PX`：引入 Redis 為單一目的不划算。

---

## R-004：錯過排程處理（spec Edge case 1）

**Decision**: **不補跑**。系統啟動時，對每筆 enabled schedule 計算「上次預定 vs 啟動時間」，若已逾期但 ≤ 24 小時則寫入一筆「結果 = missed、說明 = 系統暫停期間錯過此次觸發」紀錄；超過 24 小時則靜默（避免大量 missed 紀錄）。

**Rationale**:
- 補跑會打亂 idempotency 假設（CHKPROJ 對同一專案連續兩次跑等同浪費 API 配額；CHKISSUE 同理）。
- 對 SC-002「100% 紀錄」承諾，明確寫入 missed 紀錄即可滿足「可發現」要求，並能向管理者揭露系統曾停機。
- 24 小時門檻為人因設計：超過 24h 已屬於「重大停機事件」，應由運維獨立追蹤而非 ServiceLog noise。

**Alternatives considered**:
- 不寫入 missed → 違反 SC-002「不見的紀錄被視為嚴重缺陷」。
- 補跑：增加複雜度 + 可能讓 Jira API 在恢復後被一次 burst；亦可能與 admin 期望的「未來時點才執行」相違。

---

## R-005：服務失敗重試（spec Edge case 9）

**Decision**: 對 **service-level 整體失敗**不做自動重試（v1）；對 **per-issue / per-project 子步驟**走 1 次重試（30 秒後）。`service_logs.result = partial_failure` 標記在仍有部分子步驟最終失敗時生效。

**Rationale**:
- service-level 整體 retry 易在 Jira API 連續 5xx 時造成 cascade；管理者透過 ServiceLogs 介入更安全。
- per-step retry 對「單一專案 API 暫時 503」這類常見抖動有顯著效果，且 30 秒延遲不影響 SC-004 / SC-005 的整體上限（CHKPROJ 50 專案 × 1 次重試 = 最多 +25 分鐘極端情況需告警，但平均 retry 比例 < 5% 故實際影響可忽略）。
- 重試次數 / 間隔均寫入該筆 `service_logs.notes`，留下審計痕跡。

**Alternatives considered**:
- 多次指數退避：複雜度上升、debug 難度高，且 v1 屬「被動觀察」階段，先以最小重試上線。
- 不重試：對偶發 503 / network 抖動敏感度過高，會推高 partial_failure 比例。

---

## R-006：cron 字串驗證與時區（FR-003 / FR-008）

**Decision**: 儲存前以 `cron-parser.parseExpression(str, { tz: 'Asia/Taipei' })` 驗證；任何 throw 即回 400 problem with `messageKey = 'schedule_cron_invalid'`。所有 `schedule_configs.next_run_at` / `service_logs.started_at` 均以 UTC 存於 PG（PG `timestamptz`），UI 顯示時用 `Asia/Taipei` 渲染並標示「（伺服器時區）」。

**Rationale**:
- `Asia/Taipei` 固定為 v1 唯一時區（spec FR-008），由 env var `SERVER_TZ` 可配置（預設 `Asia/Taipei`）。
- `timestamptz` + UTC 是最佳實踐，避免 DST / 區域改變導致歷史紀錄漂移。
- cron-parser 同時也是計算 next_run_at 的引擎，邊驗證邊算下次時間，一石二鳥。

**Alternatives considered**:
- 各使用者個別時區：超出 v1 範圍（spec assumption 已切割至 v1.1+）。
- 在 Node 端用 `Date` 字串解析：易因 locale / DST 出錯，不選。

---

## R-007：ServiceLogs 匯出（FR-013）

**Decision**: 採 `csv-stringify` 流式匯出，HTTP response stream + `Content-Disposition: attachment; filename=service-logs-{ts}.csv`。預設 UTF-8 BOM，欄位順序：`started_at, ended_at, service_id, triggered_by, result, summary, notes`。

**Rationale**:
- 已過濾結果可能達 90 天 × 50 排程 ≈ 數千列，stream 比一次 buffer 安全。
- UTF-8 BOM 讓 Excel 直接打開不亂碼。
- `csv-stringify` 是 `csv-parse` 同一作者、MIT、廣為使用。

**Alternatives considered**:
- 自訂 CSV escape：易踩 quote / newline 邊界 bug，不選。
- JSON 匯出：spec FR-013 明確指定「至少 CSV」；可在 v1.1 再加 JSON 選項。

---

## R-008：CHKPROJ rule-v1 規則寫死位置

**Decision**: rule 邏輯封裝在 `backend/src/jobs/services/chkproj.ts` 內的 `evaluateDelay(project, sprintInfo, openIssues): DelayEvaluation` 純函式；rule-v1 寫死為 `RULE_VERSION = 'rule-v1'` 常數。每次執行寫入 `service_logs.summary` 時固定附上「依規則 rule-v1 判斷」。`DelayEvaluation` 結構需揭露「觸發了條件 A、B 還是兩者」與「實際數據」（FR-021）。

**Rationale**:
- 純函式可被 unit test 100% 覆蓋分支（A only / B only / A∩B / 都不符合 / 邊界值）。
- 將 `RULE_VERSION` 常數注入紀錄，v1.1 切換到可配置規則時，舊紀錄仍可被回溯解讀。
- 未來 v1.1 改成 `rules` 表 + dynamic loader，本層 API 不變。

**Alternatives considered**:
- 直接在 service-runner 內 inline 規則：違反單一職責，且 test 難覆蓋。
- v1 即配置化：spec assumption 明示 v1 rule-v1 寫死；不過度設計。

---

## R-009：CHKISSUE 連續 N 次無任務的偵測（FR-032）

**Decision**: 新增 `project_issue_snapshots` 表，每次 CHKISSUE 把每個 projectKey 的「有任務 / 無任務」flag 寫入一列（含 `service_log_id` 外鍵）。判斷「連續 N 次」時，從最近 N 筆 snapshot 連續性比對；N 預設 4，可由 env `CHKISSUE_EMPTY_STREAK_THRESHOLD` 調整。

**Rationale**:
- 把「連續性」事實化為儲存資料，比每次走完整 `service_logs.notes` 解析更可靠、可審計。
- 保留 90 天 snapshot（與 service_logs 同步剪枝），對 200 專案 × 30 次/月 = 6,000 列/月、保留 18,000 列；無壓力。
- env 化的 threshold 讓不同團隊可調，符合「健檢類」服務的彈性。

**Alternatives considered**:
- 從 service_logs.notes JSON 內聚合：解析成本與 NULL 安全性較差，不選。
- 不保留歷史 / 不偵測連續性：違反 FR-032。

---

## R-010：Frontend 路由與權限導引

**Decision**:
- 新增 3 條路由：`/schedules`、`/service-logs`、`/project-check-lists`，全部走 `AuthGuard` + 新增的 `AdminGuard`（前端走 `auth.me` 回傳的 `isAdmin` flag 判斷）。
- 後端 `/api/v1/me` 回傳新增 `isAdmin: boolean` 欄位（由同一份 `ADMIN_ACCOUNT_IDS` 推導）。
- 非管理者進入 admin-only 頁面 → 重導 `/dashboard` 並顯示 toast「需要管理者權限」。

**Rationale**:
- 前端 guard + 後端 middleware 雙保險（前端為 UX，後端為硬閘）。
- `isAdmin` flag 由 `/me` 提供，避免前端硬編碼帳號清單。
- 沿用 001 的 i18n toast / problem 處理，零新元件。

**Alternatives considered**:
- 前端硬編 admin 清單：違反「憑證 / 配置不入版本」原則。
- 用 OAuth scope 區分：本期 OAuth scope 取自 Atlassian，且 Atlassian 沒有對應「Jira 小幫手管理者」的 scope；不選。

---

## R-011：觀測性指標補強

**Decision**: 在 `backend/src/lib/metrics.ts` 新增：
- `scheduled_service_total{service_id, result}` Counter
- `scheduled_service_duration_seconds{service_id}` Histogram（buckets: 0.5, 1, 5, 10, 30, 60, 300, 600）
- `scheduled_service_active_count` Gauge（目前正在執行的服務數量）
- `schedule_configs_enabled_count` Gauge（啟用中排程數量；每次 CRUD 觸發更新）

同時於 `service-runner.ts` 用 `traceSpan('scheduled.service.run', ...)` 包執行；attributes：`service.id`、`schedule.id`（若由排程觸發）、`triggered_by`、`result`。

**Rationale**:
- 對應憲法 IV「對關鍵路徑暴露延遲與錯誤率指標」要求。
- 沿用 001 既有 `/metrics` endpoint，零新增 route。
- Histogram bucket 對應 SC-004 / SC-005 的 5 分鐘 / 10 分鐘上限，便於後續設告警閾值。

**Alternatives considered**:
- 不加 metrics 只看 ServiceLogs：違反憲法 IV；且 ServiceLogs 對「告警閾值」較不友善（需 SQL aggregate 不適合 ms 級告警）。

---

## R-012：刪除策略 / cleanup job 串接（FR-014）

**Decision**: 沿用 001 的 `backend/src/jobs/cleanup.ts`，新增兩段：
- `service_logs.started_at < now() - interval '90 days'` DELETE
- `project_issue_snapshots.snapshot_at < now() - interval '90 days'` DELETE

時點仍走 03:00 那次例行；本身亦寫一筆 ServiceLog（service_id = `SYSTEM_CLEANUP`，summary 含刪除筆數）以滿足 FR-014「刪除動作本身亦需在系統內部留下可稽核紀錄」。

**Rationale**:
- 沿用既有 cron job，零新增 scheduler。
- 把 cleanup 本身視為一個內建 service，避免「日誌的日誌」分散在另一張表 → 統一檢視。

**Alternatives considered**:
- 獨立 PG `pgcron` extension：增加運維負擔，且我們的 ops 已有 Node-based cleanup job 在跑。

---

## Open follow-ups（v1.1+）

- 多 backend instance 部署 + leader election（pg advisory session lock）
- 自訂規則配置介面（CHKPROJ rule-v2+）
- Email / Slack / Webhook 異常通知
- 使用者個人時區呈現
- 服務 ID 動態擴充 / Plugin 機制
- ServiceLogs 對 PM 角色開放（v1 僅 admin）

以上不在 v1 範圍，但於 plan.md / spec.md 已留下對應 hook 點（rule_version 欄位、`ADMIN_ACCOUNT_IDS` env、`SERVER_TZ` env）。
