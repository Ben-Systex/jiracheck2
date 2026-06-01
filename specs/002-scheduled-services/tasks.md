---

description: "002-scheduled-services 任務清單（依使用者故事拆分；憲法 II 測試 NON-NEGOTIABLE）"
---

# Tasks: 定時排程服務與服務執行紀錄

**Input**: 設計文件來自 `/specs/002-scheduled-services/`
**Prerequisites**: plan.md ✅、spec.md ✅、research.md ✅、data-model.md ✅、contracts/api.openapi.yaml ✅、quickstart.md ✅

**Tests**: 依本專案憲法 Principle II「測試標準」為 NON-NEGOTIABLE：所有商業邏輯 MUST 有 unit test、所有外部依賴（mcp-atlassian / PG）MUST 有契約或整合測試。本檔測試任務 MUST 保留並落實。

**Organization**: 任務依 user story 分組（依 spec.md 之 P1 / P2 / P3 優先順）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（檔案不同、無前後依賴）
- **[Story]**: US1 / US2 / US3 / US4（US1 = P1、US2 = P2 ServiceLogs、US3 = P2 CHKPROJ、US4 = P3 CHKISSUE）
- 含確切檔案路徑

## Path Conventions

沿用 001-jira-assistant：`backend/src/`、`backend/tests/`、`frontend/src/app/`、`frontend/e2e/`、`ops/`。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 安裝新依賴、建立 migration、env 注入。

- [X] T001 新增 backend 依賴 `node-cron@^4`、`cron-parser@^5`、`csv-stringify@^6`（實裝版本較 spec 略新；皆 MIT）：`cd backend && npm install --save node-cron cron-parser csv-stringify && npm install --save-dev @types/node-cron`。
- [X] T002 [P] migration `backend/src/db/migrations/0003_scheduled_services.up.sql` + `.down.sql`：建 4 表 + 8 索引。
- [X] T003 [P] 更新 `ops/.env.example` 加入 `ADMIN_ACCOUNT_IDS` / `SERVER_TZ` / `CHKISSUE_EMPTY_STREAK_THRESHOLD`；同步更新 `ops/docker-compose.yml`。
- [X] T004 [P] 更新 `specs/001-jira-assistant/checklists/quickstart-validation.md` 附錄 B 加註 002 啟用後追加項。

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: admin 判定 middleware + /me.isAdmin 擴充 + 共用 cron utils；後續所有 user story 都依賴本階段完成。

**⚠️ CRITICAL**: Phase 3+ 任何任務皆不可在本階段未完成前開始。

- [X] T005 require-admin middleware（含 getAdminAccountIds / isAdminByUserId / requireAdmin）。
- [X] T006 [P] require-admin.spec.ts（13 cases：env 解析 / isAdminByUserId / middleware 各分支）。
- [X] T007 [P] /me 加 isAdmin 欄位。
- [X] T008 [P] meta.spec.ts 補 admin / 非 admin 兩 case。
- [X] T009 cron-utils.ts（toCronExpression / computeNextRunAt / validateFrequency / FrequencyError）。
- [X] T010 [P] cron-utils.spec.ts（18 cases）。
- [X] T011 [P] backend i18n keys（8 keys）。
- [X] T012 [P] frontend i18n keys（schedules / service_logs / project_check_lists ~80 keys）。
- [X] T013 metrics 4 個新 metric（scheduledServiceTotal / Duration / ActiveCount / ScheduleConfigsEnabledCount）。
- [X] T014 [P] metrics.spec.ts 補 4 個新 metric 驗證 case。

**Checkpoint**: 基礎齊備——admin 判定、/me 擴充、cron utils、metrics 接好；US1 可開始。

---

## Phase 3: User Story 1 - 設定多組定時服務並按時自動執行 (Priority: P1) 🎯 MVP

**Goal**: 使用者於設定頁建立 / 編輯 / 停用 / 啟用 / 刪除 / 手動觸發排程；scheduler 在時點到達時自動觸發 stub 服務（先回固定字串）並把結果寫入 `service_logs`。

**Independent Test**: 即使 CHKPROJ / CHKISSUE 是 stub 服務（回固定字串），只要：
1. 使用者能新建一筆每分鐘排程
2. 1 分鐘內 service_logs 出現對應紀錄
3. 設定頁能停用該排程 + scheduler 不再觸發
4. 手動觸發產生 `triggered_by='manual'` 紀錄
5. 同一服務 ID 併發時第二次 result=skipped
即代表 US1 通過。

### 後端 — repository / runner / scheduler

- [X] T015 [P] [US1] schedule_configs repository（CRUD + listAll/listEnabled + updateNext/LastRun + countEnabled）。
- [X] T016 [P] [US1] schedule-configs.spec.ts（15 cases）。
- [X] T017 [US1] service_logs repository（start/finalize/insertImmediate/getById/list with keyset cursor/pruneOlderThanDays/countOpenForService）。
- [X] T018 [P] [US1] service-logs.spec.ts（14 cases）。
- [X] T019 [US1] service-runner.ts：pg session-level advisory lock + 統一流程 + traceSpan + metrics 觀測。
- [X] T020 [P] [US1] service-runner integration spec（7 cases，含 success / failure / skipped / not_registered / SYSTEM_CLEANUP / acquireSession 缺）。
- [X] T021 [US1] Scheduler class：start/stop/registerSchedule/unregisterSchedule/refreshAll/registeredCount + missed 啟動補登（≤ 24h）。
- [X] T022 [P] [US1] scheduler.spec.ts（10 cases，含 SC-001 觸發誤差 ≤ 60s case）。
- [X] T023 [US1] server.ts 註冊 Scheduler + stub CHKPROJ / CHKISSUE + SIGTERM/SIGINT 優雅關閉。

### 後端 — routes

- [X] T024 [US1] routes/schedules.ts（7 endpoints + requireAdmin + verifyCsrfToken）。
- [X] T025 [P] [US1] Contract spec schedules.spec.ts（16 cases，含 admin guard / cron 驗證 / 404 / disabled→nextRunAt=null）。

### 前端 — feature

- [X] T026 [P] [US1] schedules-api.service.ts（list/get/create/update/delete/trigger）。
- [X] T027 [US1] schedules.page.ts（列表 + 新建 / 編輯 / 立即執行 / 刪除確認 + toast + 載入 / 空 / 錯誤態）。
- [X] T028 [P] [US1] schedule-form.component.ts（4 種 frequencyType 子表單 + 時區字樣 `schedule_form_tz_hint`）。
- [X] T029 [P] [US1] admin.guard.ts（含 i18n toast 訊息；非 admin → 重導 /dashboard）。
- [X] T030 [US1] app.routes.ts 加 /schedules + adminGuard；shell.component.ts 側欄加「定時服務」（僅 admin 顯示）。
- [X] T031 [P] [US1] schedule-form.component.spec.ts（6 cases，4 種 frequencyType + initial setter 兩種）。
- [X] T032 [P] [US1] schedules.page.spec.ts（5 cases，load / error / onNew / onEdit / onSubmitted）。

### E2E

- [ ] T033 [P] [US1] E2E spec us1-schedule-crud.spec.ts（延後到 Phase 7 收尾統一加；單元 + contract spec 已涵蓋 admin guard / cron 驗證 / CRUD round-trip）。

**Checkpoint**: US1 完整可演示 — 排程設定 CRUD + 自動觸發 stub 服務 + 紀錄寫入。

---

## Phase 4: User Story 2 - 服務執行紀錄 (ServiceLogs) 檢視與查詢 (Priority: P2)

**Goal**: 管理者進入 `/service-logs` 可看最近 7 天紀錄、依 serviceId / result / 時間區間過濾、看詳細 notes、匯出 CSV。

**Independent Test**: ServiceLogs 中已有 50 筆，套 「最近 7 天 + CHKPROJ + failure」過濾後正確顯示子集；點任一筆進詳細頁可看完整 notes 與不被截斷的 summary；按匯出取得 CSV 並能在 Excel 開啟。

### 後端 — repository / route

- [X] T034 [US2] service-logs.ts 擴充 streamForExport（AsyncGenerator + 100/頁 cursor 串接）；list 已在 T017 完成。
- [X] T035 [P] [US2] service-logs.spec.ts 補 streamForExport 2 cases（共 16 cases）。
- [X] T036 [US2] routes/service-logs.ts: GET /service-logs（list 預設 7 天）+ /:id + /export（csv-stringify stream + UTF-8 BOM）；全 admin-only。
- [X] T037 [P] [US2] service-logs contract spec（10 cases，含 admin guard / 詳細 / export header / 壞 query）。
- [X] T038 [P] [US2] service-logs-export integration spec（3 cases：header / BOM / Content-Disposition）。

### 前端 — feature

- [X] T039 [P] [US2] service-logs-api.service.ts（list / get / exportUrl 三方法）。
- [X] T040 [US2] service-logs.page.ts（過濾列 + 色碼徽章表格 + 載入更多 cursor + 匯出 a tag + 預設「最近 7 天」）。
- [X] T041 [P] [US2] service-log-detail.page.ts（完整 summary + notes JSON pretty-print + ruleVersion 顯示 + 404 狀態）。
- [X] T042 [US2] app.routes.ts 加 /service-logs + /service-logs/:id + adminGuard；shell.component 側欄加項目。
- [X] T043 [P] [US2] service-logs.page.spec.ts（5 cases：load / error / filter / load more / exportHref）。

### E2E

- [ ] T044 [P] [US2] E2E spec us2-service-logs.spec.ts（延後至 Phase 7 統一處理 E2E）。

**Checkpoint**: US2 完整可演示——紀錄頁 + 詳細頁 + 匯出 + admin-only。

---

## Phase 5: User Story 3 - CHKPROJ 依專案檢查清單檢查專案是否延遲 (Priority: P2)

**Goal**: 「專案檢查清單」可由管理者維護；CHKPROJ 服務依清單逐專案執行 rule-v1 判定（A: Sprint 過半且 SP<50% / B: 任一未完成 Due Date 逾期 ≥3 天）；寫入 ServiceLog 含 rule_version + delayed[] 明細。

**Independent Test**: 設「專案檢查清單」=[PROJ-A, PROJ-B, PROJ-C]；人為造 PROJ-B 有 5 筆逾期 task；手動觸發 CHKPROJ；ServiceLog 顯示「3 個專案、其中 1 個延遲」+ 詳細 notes.delayed[0] 含 `{ projectKey: 'PROJ-B', conditions: ['B'], overdueCount: 5, maxOverdueDays: ... }`。

### 後端 — repository / route

- [X] T045 [P] [US3] project-check-lists repo（list/add/remove/getByProjectKey/listProjectKeys）。
- [X] T046 [P] [US3] project-check-lists.spec.ts（10 cases）。
- [X] T047 [US3] routes/project-check-lists.ts: GET / POST（409 conflict） / DELETE；全 admin-only + CSRF。
- [X] T048 [P] [US3] project-check-lists contract spec（9 cases，含 admin guard / 409 / 壞 projectKey）。

### 後端 — CHKPROJ 實作

- [X] T049 [US3] services/chkproj.ts: rule-v1 純函式 evaluateDelay（A or B）+ runService 整合（concurrency 5 + retry 1 次 30s）+ DelayedNoteEntry / ErrorNoteEntry types。
- [X] T050 [P] [US3] chkproj.spec.ts unit: 15 cases（rule-v1 各邊界 + service 全成功 / 部分失敗 / 50 projects SC-004 timing）。
- [X] T051 [P] [US3] chkproj integration spec: 4 cases（空清單 / 1 延遲 + metrics / 部分失敗 / SC-004 50 projects < 5 min）。
- [X] T052 [US3] server.ts 註冊 createChkprojService 取代 stub；新增 services/jira/chkproj-fetcher.ts 對 mcp-atlassian。

### 前端 — feature

- [X] T053 [P] [US3] project-check-lists-api.service.ts。
- [X] T054 [US3] project-check-lists.page.ts（表格 + 新增 form + 移除確認 + 409 衝突提示 + 載入/空/錯誤態）。
- [X] T055 [US3] app.routes.ts + shell.component 加 /project-check-lists（admin only）。
- [X] T056 [P] [US3] service-log-detail.page 擴充對 CHKPROJ notes.delayed[] 友善表格 + errors[] rose 警示框；project 連結到 /dashboard。
- [X] T057 [P] [US3] project-check-lists.page.spec.ts（5 cases：load / add / 409 / error / 空 key）。

### E2E

- [ ] T058 [P] [US3] E2E spec us3-chkproj.spec.ts（延後至 Phase 7 統一處理）。

**Checkpoint**: US3 完整可演示——清單維護 + CHKPROJ 自動 / 手動觸發 + ServiceLog 有實質內容。

---

## Phase 6: User Story 4 - CHKISSUE 統計有任務 / 無任務專案清單 (Priority: P3)

**Goal**: CHKISSUE 服務盤點所有可見專案 → 寫入「總數 / 有任務 / 無任務」+ 兩組清單；連續 N 次無任務於備註標警示。

**Independent Test**: Jira 環境 10 個可見專案、其中 3 個無 issue；手動觸發 CHKISSUE；ServiceLog summary = 「總數 10、有任務 7、無任務 3」+ notes.without_issues 列出 3 個 projectKey；連跑 4 次後出現 `empty_streak[{projectKey, streak: 4}]` 警示。

### 後端

- [X] T059 [P] [US4] project-issue-snapshots repo（insertBatch / getStreakAt / pruneOlderThanDays）。
- [X] T060 [P] [US4] project-issue-snapshots.spec.ts（10 cases，含 streak 邊界 / maxN clamp / 空 snapshots batch）。
- [X] T061 [US4] services/chkissue.ts: listProjects → countIssues per project (concurrency 5 + retry 1 次) → snapshots.insertBatch → getStreakAt → notes.empty_streak[]；threshold 從 env CHKISSUE_EMPTY_STREAK_THRESHOLD 取（預設 4）。
- [X] T062 [P] [US4] chkissue integration spec（5 cases：分組 / streak 觸發 / partial_failure / 空可見專案 / SC-005 200 projects < 10 min）。
- [X] T063 [US4] server.ts 註冊 createChkissueService 取代 stub；刪除 stub.ts 死碼。

### E2E

- [ ] T064 [P] [US4] E2E spec us4-chkissue.spec.ts（延後至 Phase 7 統一處理）。

**Checkpoint**: US4 完整可演示——CHKISSUE 統計 + empty_streak 警示。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 收尾與全功能驗收；對應憲法 II（coverage）/ IV（perf）/ III（a11y / i18n）。

### Cleanup / Observability

- [ ] T065 擴充 `backend/src/jobs/cleanup.ts`：加 `service_logs` + `project_issue_snapshots` 90 天清理；清理本身也走 `runService({ serviceId: 'SYSTEM_CLEANUP', triggeredBy: 'system' })` 寫一筆 ServiceLog（含刪除筆數 notes.cleanup_deleted）（FR-014 + [research R-012](./research.md#r-012刪除策略--cleanup-job-串接fr-014)）。
- [ ] T066 [P] 補 `backend/src/jobs/cleanup.runner.spec.ts`：新增「service_logs 90 天清理」「snapshots 90 天清理」「SYSTEM_CLEANUP ServiceLog 寫入」3 案。
- [ ] T067 [P] 補 `backend/src/lib/metrics.spec.ts`：對 `schedule_configs_enabled_count` gauge 在 CRUD 後值更新驗證；2 案。

### 觀測性、Quickstart 與 docs

- [ ] T068 [P] 更新 `backend/src/routes/metrics.spec.ts`：跑完一輪 CHKPROJ + CHKISSUE 後驗 `scheduled_service_total{service_id="CHKPROJ"}` ≥ 1（end-to-end with in-memory）；2 案。
- [ ] T069 [P] 補強 `specs/002-scheduled-services/quickstart.md` 之 step 10 metrics 驗證範例為實際 reachable URL（含 `METRICS_TOKEN` Bearer 範例）。
- [ ] T070 [P] 新增 `docs/admin-setup.md`：說明如何取得自己的 accountId（呼叫 `/me`）+ 設定 `ADMIN_ACCOUNT_IDS`；範例 + 故障排查。
- [ ] T071 [P] 更新 repo `README.md`：在「功能」段加上「定時排程服務」一節（含 4 個 US 摘要 + 截圖佔位 + 連結到 002 quickstart）。

### Test gates / coverage / a11y

- [ ] T072 跑 `cd backend && npm run test:coverage` 驗本 feature 加入後仍 ≥ 80/70/80/80 threshold；若有檔案低於閾值，補對應 spec（憲法 II）。
- [ ] T073 [P] 跑 `cd frontend && ng test --code-coverage`；對本 feature 新增 3 個 feature module 各補 spec 直到語句覆蓋 ≥ 80%（憲法 II）。
- [ ] T074 [P] 對 `/schedules`、`/service-logs`、`/project-check-lists` 3 頁各擴 axe-core 規則 0 critical / 0 serious；補 `frontend/e2e/specs/us1-us4.a11y.spec.ts` 統一掃。
- [ ] T075 [P] 更新 `backend/tests/perf/api-latency.k6.js` 加入 `GET /service-logs` 端點 p95 < 2s 門檻；對應 SC-003。

### CI / 文件最終

- [ ] T076 [P] 更新 `.github/workflows/ci.yml` 確保新 e2e specs（us1-us4） 都被 playwright 跑到；無需新 workflow。
- [ ] T077 [P] 更新 `specs/001-jira-assistant/checklists/quickstart-validation.md` 附錄 A 加註：「002-scheduled-services 啟用後，附錄 6 metrics 驗證項應額外含 `scheduled_service_total` 計數」。
- [ ] T078 跑 `quickstart.md` 12 步完整驗證（與 PM / 管理者協作；產出新 `specs/002-scheduled-services/checklists/quickstart-validation.md` 給未來部署參考）。
- [ ] T079 [P] 新增 `ops/prometheus/alerts.example.yml` Prometheus alert rule 範例：對 `increase(scheduled_service_total{result="failure"}[1d]) >= 3` 觸發 `ScheduledServiceFailing` 告警（severity=warning，含 `summary` 與 `runbook_url`）；對應 SC-007「連續 3 次失敗於當週介入」。在 README + docs/admin-setup.md 註明本檔為範例，prod 需由 Prometheus Operator / Alertmanager 自行載入。

---

## Dependencies

```
Phase 1 (Setup) ─┬─ T001 npm install
                 ├─ T002 migration  ────────────────┐
                 └─ T003 env / T004 docs            │ all needed before any DB code in Phase 2+
                                                    │
Phase 2 (Foundational) [all parallel; blocks 3+]    │
  T005 admin middleware ─ T006 spec                 │
  T007 /me.isAdmin       ─ T008 spec                │
  T009 cron-utils        ─ T010 spec                │
  T011 backend i18n  / T012 frontend i18n           │
  T013 metrics       / T014 spec                    │
                                                    │
Phase 3 US1 [P1] ←─ blocks Phase 4–6 only via       │
  T015–T032（repo / runner / scheduler / routes /   │
            frontend / unit / E2E）                  │
                                                    │
Phase 4 US2 [P2] ─ 用 T015 repo + T034 擴充 service-logs.list；
  T034–T044   無依賴於 US3 / US4

Phase 5 US3 [P2] ─ 用 T015 repo + T024 routes + T049 chkproj 替代 stub
  T045–T058   依賴 Phase 3 完成

Phase 6 US4 [P3] ─ 用 T059–T064 + 取代 stub；獨立於 US3
  T059–T064

Phase 7 Polish ─ 在 US1–US4 完成後串
  T065–T078
```

**MVP** = Phase 1 + 2 + 3（US1 完整 with stub service）→ 即可端對端 demo。

---

## Parallel Execution Examples

### Phase 1
T002 / T003 / T004 可同時開（不同檔案）；T001 必須先完成（其他可能引用新 deps）。

### Phase 2
T005 / T007 / T009 / T011 / T012 / T013 全部 [P]（不同檔案）；對應 spec T006 / T008 / T010 / T014 在各自實作完成後並行寫。

### Phase 3 US1
- 平行批 A：T015（repo）/ T017（repo）/ T026（frontend api）— 都各做一個檔案
- 平行批 B：T021（scheduler）/ T028（schedule-form）— 不同檔案
- 平行批 C：T020 / T022 / T025 / T031 / T032 / T033 — 全部 spec

### Phase 7
T066 / T067 / T068 / T069 / T070 / T071 / T073 / T074 / T075 / T076 / T077 全部 [P]（不同檔案）。

---

## Implementation Strategy

### MVP（Minimum Viable Product）

完成 Phase 1 + Phase 2 + Phase 3（US1）：

- 一個管理者可設排程
- 排程能在時點自動觸發 stub 服務
- ServiceLog 寫入 + 可由前端列表看到（前端列表為 US2 範圍，MVP demo 可暫用 backend curl 或 PG psql 驗證）

→ 是「整個 feature 的端到端 backbone」，可即早交付給管理者試用、收回饋。

### Incremental Delivery

| Sprint | 範圍 | 端對端 demo |
|--------|------|------|
| Sprint 1 | Phase 1 + 2 | 基礎設施齊備（不可 demo，內部驗證） |
| Sprint 2 | Phase 3（US1） | MVP demo（stub 服務）|
| Sprint 3 | Phase 4（US2）+ Phase 5（US3） | 完整 CHKPROJ 可用 + ServiceLogs 可看 |
| Sprint 4 | Phase 6（US4）+ Phase 7 收尾 | v1 release |

### 平行開發建議

- Phase 3 US1 完成後，US2 / US3 可由不同人並行（共享 schedule_configs / service_logs 介面，但 frontend / 各自 service 邏輯獨立）。
- US4 完全獨立於 US3，可並行。
- Polish 階段大量 [P] 任務，建議用 2–3 人收尾。

---

## Validation

- ✅ 所有任務皆採 `- [ ] TNNN [P?] [USx?] 描述 + 檔案路徑` 格式
- ✅ Setup / Foundational 任務無 [Story] label
- ✅ User Story 任務含 [US1] / [US2] / [US3] / [US4] label
- ✅ Polish 任務無 [Story] label
- ✅ 每個 user story 都有獨立 Independent Test 標準
- ✅ 測試任務皆與對應實作任務在同 Phase
- ✅ 對應 contracts/api.openapi.yaml 之 14 endpoints 全部被某 Phase 涵蓋
- ✅ data-model.md 中 4 個新表全部被 T002 migration + 對應 repo task 覆蓋
- ✅ research.md 12 個決策對應的實作細節皆寫進對應 task 描述（如 T019 引 R-003、T021 引 R-004、T049 引 R-005 + R-008、T061 引 R-009、T065 引 R-012）
