# 002-scheduled-services Quickstart 實地驗證 Checklist（T078）

**對象**：PM / 內部管理者 / 運維
**前置**：001-jira-assistant 已合入 main + [`002 quickstart.md`](../quickstart.md) 步驟 1–4 完成（admin env / migration / 專案檢查清單 / 至少一筆排程）
**目的**：在真實 Atlassian + Docker 環境驗證 4 個 user story（US1–US4）+ metrics + 觀測性 alert 樣板

> ⏱ 預估耗時：30–45 分鐘（首次包含等待 cron 觸發的 5–10 分鐘）

---

## 0. 環境前置檢查

- [ ] 完成 [`001 quickstart-validation`](../../001-jira-assistant/checklists/quickstart-validation.md) 之附錄 B
- [ ] `docker compose exec backend printenv ADMIN_ACCOUNT_IDS` 印出至少一個 accountId
- [ ] `curl -s http://localhost:8080/api/v1/me -b /tmp/sid-cookie.txt | jq .isAdmin` 對 admin 帳號回 `true`
- [ ] `docker compose exec postgres psql -U jiracheck -d jiracheck -c "\dt schedule_configs service_logs project_check_lists project_issue_snapshots"` 顯示 4 表都存在
- [ ] backend 啟動 log 含「[scheduler] started」與「[cleanup]」訊息（前者必要、後者預定 03:00 才實際 run）

---

## 1. US1 — 排程設定 / 自動觸發 / 手動執行 / 互斥

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 1.1 | 進入 `/schedules` | 看到「定時服務設定」標題；側欄含「定時服務」 | [ ] |
| 1.2 | 點「新增排程」→ CHKPROJ + cron `* * * * *` + 啟用 | 列表新增；下次預定時間 ≤ 1 分鐘後 | [ ] |
| 1.3 | 等待 70 秒 | `/service-logs` 出現新一筆 CHKPROJ、`triggered_by=schedule` | [ ] |
| 1.4 | 點該排程「立即執行」 | toast「已排入執行」+ `/service-logs` 新一筆 `triggered_by=manual` | [ ] |
| 1.5 | 連續快速點 2 次「立即執行」 | 第二筆 `result=skipped` + summary「上一次仍在執行」 | [ ] |
| 1.6 | 編輯該排程 → 改為「每日 09:00」儲存 | 列表更新；下次預定為 9 點（隔日或當天視當前時間） | [ ] |
| 1.7 | 切換啟用 → 停用 | scheduler 不再觸發；歷史紀錄保留 | [ ] |
| 1.8 | 刪除該排程 | 列表移除；既有 `service_logs.schedule_id` 設 NULL 但保留紀錄 | [ ] |

**失敗時排查**：
- 1.3 沒觸發 → 看 backend log `[scheduler] registered` 訊息；確認 SERVER_TZ
- 1.5 第二筆 result 不是 skipped → 可能 mcp call 太快結束；改用 cron `*/30 * * * * *`（每 30 秒）並讓 service 有 sleep

---

## 2. US2 — ServiceLogs 檢視 / 過濾 / 詳細頁 / 匯出

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 2.1 | 進入 `/service-logs` | 預設顯示「最近 7 天」紀錄、依時間 DESC | [ ] |
| 2.2 | 套用「服務 = CHKPROJ、結果 = 失敗」過濾 | 表格僅顯示符合的子集；空集合時顯示 empty state | [ ] |
| 2.3 | 套用「最近 1 小時」時間範圍 | 列表立即過濾 | [ ] |
| 2.4 | 點任一筆「詳細」 | 詳細頁顯示完整 summary（不被截斷）+ notes JSON pretty-print + ruleVersion（若為 CHKPROJ） | [ ] |
| 2.5 | CHKPROJ 紀錄 → 詳細頁 | 含「延遲專案明細」友善表格（projectKey 連到 /dashboard） | [ ] |
| 2.6 | CHKPROJ partial_failure 紀錄 → 詳細頁 | 含「錯誤明細」rose 警示框 | [ ] |
| 2.7 | 列表頁按「匯出 CSV」 | 下載檔名 `service-logs-{ts}.csv`，Excel 開無亂碼，欄位順序符合 | [ ] |
| 2.8 | 紀錄超過一頁時點「載入更多」 | cursor 接續、items 累積、無重複 | [ ] |

---

## 3. US3 — CHKPROJ 專案檢查清單 + rule-v1

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 3.1 | 進入 `/project-check-lists` | 「專案檢查清單」頁面 | [ ] |
| 3.2 | 新增專案 `PROJ-A` + note「主要產品線」 | 列表新增一筆 | [ ] |
| 3.3 | 再次新增 `PROJ-A` | 顯示「此專案代號已存在於檢查清單中」錯誤訊息 | [ ] |
| 3.4 | 新增「壞格式」如 `proj` 或 `invalid-lowercase` | 後端 400 + 前端錯誤訊息 | [ ] |
| 3.5 | 至少加 3 個專案（其中 1 個故意製造延遲：未完成任務有 Due Date 逾期 ≥ 3 天） | 列表共 3 筆 | [ ] |
| 3.6 | 在 `/schedules` 對 CHKPROJ 點「立即執行」 | `/service-logs` 新一筆 | [ ] |
| 3.7 | 進該筆詳細頁 | summary：「3 個專案，1 個延遲、2 個正常、0 個錯誤（依規則 rule-v1）」 | [ ] |
| 3.8 | 詳細頁「延遲專案明細」表格 | 含 `PROJ-延遲那個`，conditions = `B`（如僅有 Due Date 逾期）或 `A+B` | [ ] |
| 3.9 | 移除清單某項 | 列表減一；下次 CHKPROJ 不再檢查該專案 | [ ] |

**rule-v1 條件參考**：
- A：當前 Sprint 已過半（時間進度 > 50%）且 SP 完成率 < 50%
- B：任一未完成任務 Due Date 已逾期 ≥ 3 天

---

## 4. US4 — CHKISSUE 任務統計 + empty_streak 警示

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 4.1 | 在 `/schedules` 新增 CHKISSUE + cron `* * * * *` 啟用 | scheduler 註冊 | [ ] |
| 4.2 | 等待 70 秒 | `/service-logs` 新一筆 CHKISSUE、summary 含「總 N 個專案、有任務 X、無任務 Y」 | [ ] |
| 4.3 | 進詳細頁 → `notes.with_issues[]` / `notes.without_issues[]` 兩組清單 | 各列出對應 projectKey | [ ] |
| 4.4 | DB 驗證 | `SELECT project_key, has_issues, issue_count FROM project_issue_snapshots ORDER BY snapshot_at DESC LIMIT 10` 各專案有對應 row | [ ] |
| 4.5 | 連續觸發 4 次（手動執行 4 次，預期間隔 ≥ 數秒） | 對「持續無任務」的某專案 → 第 4 次的 `notes.empty_streak[]` 含 `{projectKey, streak: 4}` | [ ] |
| 4.6 | 該專案被歸檔（Jira 端）或新增 issue | 下次 CHKISSUE 該專案 `has_issues=true` 或從可見專案中消失 | [ ] |
| 4.7 | 修改 env `CHKISSUE_EMPTY_STREAK_THRESHOLD=2` + 重啟 backend | 對「連續 2 次無任務」的專案即觸發 empty_streak 警示 | [ ] |

---

## 5. 觀測性 metrics + 告警樣板

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 5.1 | 跑完 step 1–4 後 | `curl /api/v1/metrics` 含 `scheduled_service_total{service_id="CHKPROJ",result="success"}` ≥ 1 與 `service_id="CHKISSUE"` ≥ 1 | [ ] |
| 5.2 | `scheduled_service_duration_seconds_count` 對 CHKPROJ / CHKISSUE 各 ≥ 1 | | [ ] |
| 5.3 | `schedule_configs_enabled_count` ≥ 2（CHKPROJ + CHKISSUE 各一筆）| | [ ] |
| 5.4 | `ops/prometheus/alerts.example.yml` 4 條規則語法檢查 | `promtool check rules ops/prometheus/alerts.example.yml` 通過 | [ ] |
| 5.5 | 模擬連續失敗：故意把 admin OAuth refresh 設無效 + 跑 3 次 CHKPROJ | `scheduled_service_total{result="failure"} ≥ 3`；Prometheus alert `ScheduledServiceFailing` 觸發（若有 Alertmanager 配置） | [ ] |

---

## 6. cleanup job 驗證

> ⚠️ cleanup 預定 03:00 觸發；以下手動驗證需 PG 直接操作

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 6.1 | 故意建 1 筆 100 天前的 service_log | `INSERT INTO service_logs (started_at, ended_at, service_id, triggered_by, result, summary) VALUES (now() - interval '100 days', now() - interval '100 days', 'CHKPROJ', 'system', 'success', 'old')` | [ ] |
| 6.2 | 手動觸發 cleanup（需透過 backend 內呼叫） | 該 row 被 DELETE | [ ] |
| 6.3 | 同時 service_logs 新增一筆 `service_id=SYSTEM_CLEANUP`、`notes.cleanup_deleted.service_logs ≥ 1` | | [ ] |

**運維提示**：若需在不等 03:00 的情況下手動觸發 cleanup，可透過：
```bash
docker compose exec backend node -e "
  const { getPool } = require('./dist/db/pool');
  const { runCleanup } = require('./dist/jobs/cleanup');
  runCleanup({ pool: getPool() }).then(r => console.log(r));
"
```

---

## 7. 權限隔離（非 admin 拒絕）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 7.1 | 以非 admin 帳號登入 | `/me.isAdmin = false` | [ ] |
| 7.2 | 該帳號訪問 `/schedules` | AdminGuard 重導 `/dashboard` + console warn | [ ] |
| 7.3 | 該帳號 curl `GET /api/v1/schedules` | 403 + `cause: forbidden` | [ ] |
| 7.4 | 該帳號 curl `POST /api/v1/project-check-lists` | 403 | [ ] |
| 7.5 | 側欄不顯示「定時服務 / 服務執行紀錄 / 專案檢查清單」三項 | | [ ] |

---

## 8. 收尾與清理

- [ ] 把 step 1.2 / 4.1 的「每分鐘」測試排程改回正常頻率（每日 09:00）或刪除
- [ ] 若有故意製造的失敗（step 5.5），復原 OAuth refresh
- [ ] step 6.1 若手動 INSERT 過舊資料，已被 cleanup 清掉
- [ ] 把 `CHKISSUE_EMPTY_STREAK_THRESHOLD` 改回正式值（預設 4）

---

## 9. 回報問題

請填以下格式給開發團隊：

```
[ ] 階段：步驟 X.Y
[ ] 預期：…
[ ] 實際：…
[ ] 截圖：…
[ ] backend log：docker compose logs --tail 100 backend > backend.log
[ ] ServiceLog notes（如有）：截 detail page 內 notes JSON 區段
```

---

## 附錄 A：靜態驗證（開發團隊在發佈本 checklist 前完成）

- [x] migration 0003 schema 與 data-model.md 對齊
- [x] OpenAPI contract 11 endpoints 全部實作（含 admin guard）
- [x] CHKPROJ rule-v1 純函式 unit test 覆蓋 A/B/A∩B/各邊界
- [x] CHKISSUE getStreakAt 邊界 unit test 通過
- [x] CHKPROJ 50 projects / CHKISSUE 200 projects mock 模式 < 1s（SC-004/005 timing buffer 充足）
- [x] scheduler 觸發誤差 < 60s（cron-parser 計算驗證；SC-001）
- [x] /metrics 含 4 個新指標
- [x] Prometheus alerts.example.yml 4 條規則
- [x] frontend 3 個新頁面（schedules / service-logs / project-check-lists）+ adminGuard 全部就位
- [x] cleanup 擴充 service_logs + snapshots + SYSTEM_CLEANUP ServiceLog
