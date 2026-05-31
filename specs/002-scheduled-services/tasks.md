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

- [ ] T034 [US2] 擴充 `backend/src/db/repositories/service-logs.ts`：新增 `list({ serviceId?, result?, from?, to?, cursor?, pageSize? })` keyset 分頁 + `getById(id)` + `streamForExport({ filters }): AsyncIterable<row>`。
- [ ] T035 [P] [US2] 補 spec `backend/src/db/repositories/service-logs.spec.ts`：list filter 組合 + cursor / pageSize / streamForExport iteration；6 cases。
- [ ] T036 [US2] 實作 `backend/src/routes/service-logs.ts`：3 endpoints `GET /service-logs` / `GET /service-logs/:id` / `GET /service-logs/export`；用 `csv-stringify` 流式輸出 + UTF-8 BOM；全 endpoints requireAdmin。
- [ ] T037 [P] [US2] Contract spec `backend/tests/contract/service-logs.spec.ts`：list 各 filter 組合 / detail / export header 與 content-type / 401 / 403 共 10–12 cases。
- [ ] T038 [P] [US2] Integration spec `backend/tests/integration/service-logs-export.spec.ts`：build mini app + insert 5 筆假紀錄 + 觸發 export → 驗 CSV 行數、欄位順序、BOM；3 cases。

### 前端 — feature

- [ ] T039 [P] [US2] 實作 `frontend/src/app/features/service-logs/service-logs-api.service.ts`：list / get / export 三方法；list 回 cursor。
- [ ] T040 [US2] 實作 `frontend/src/app/features/service-logs/service-logs.page.ts`：過濾列（serviceId chip / result chip / 日期區間 picker）+ 表格（含 result 色碼徽章）+ 載入更多按鈕（cursor）+ 匯出按鈕（觸發 `window.open(export URL with current filters)`）+ 預設「最近 7 天」。
- [ ] T041 [P] [US2] 實作 `frontend/src/app/features/service-logs/service-log-detail.page.ts`：完整 summary、notes JSON pretty-print（區分 errors[] / delayed[] / with_issues[] 等常見鍵的中文 label）+ 「相關專案」如有則提供跳轉連結（FR-024）。
- [ ] T042 [US2] 更新 `frontend/src/app/app.routes.ts` 加 `/service-logs` 與 `/service-logs/:id` + AdminGuard；shell 側欄加項目（`nav_service_logs`）。
- [ ] T043 [P] [US2] Unit spec `frontend/src/app/features/service-logs/service-logs.page.spec.ts`：過濾觸發 reload / 「載入更多」用 cursor / 空態；5 cases。

### E2E

- [ ] T044 [P] [US2] E2E spec `frontend/e2e/specs/us2-service-logs.spec.ts`：admin 登入後查列表 / 套過濾 / 進詳細頁 / 匯出 CSV 並驗下載；含 axe a11y。

**Checkpoint**: US2 完整可演示——紀錄頁 + 詳細頁 + 匯出 + admin-only。

---

## Phase 5: User Story 3 - CHKPROJ 依專案檢查清單檢查專案是否延遲 (Priority: P2)

**Goal**: 「專案檢查清單」可由管理者維護；CHKPROJ 服務依清單逐專案執行 rule-v1 判定（A: Sprint 過半且 SP<50% / B: 任一未完成 Due Date 逾期 ≥3 天）；寫入 ServiceLog 含 rule_version + delayed[] 明細。

**Independent Test**: 設「專案檢查清單」=[PROJ-A, PROJ-B, PROJ-C]；人為造 PROJ-B 有 5 筆逾期 task；手動觸發 CHKPROJ；ServiceLog 顯示「3 個專案、其中 1 個延遲」+ 詳細 notes.delayed[0] 含 `{ projectKey: 'PROJ-B', conditions: ['B'], overdueCount: 5, maxOverdueDays: ... }`。

### 後端 — repository / route

- [ ] T045 [P] [US3] 實作 `backend/src/db/repositories/project-check-lists.ts`：interface + `list` / `add(projectKey, addedBy, note?)` / `remove(id)` / `getByProjectKey(key)`。
- [ ] T046 [P] [US3] Contract spec 同目錄 `.spec.ts`：CRUD round-trip + UNIQUE 衝突；4 cases。
- [ ] T047 [US3] 實作 `backend/src/routes/project-check-lists.ts`：`GET` / `POST` / `DELETE`；POST 對既存 projectKey 回 409 `messageKey=project_check_list_conflict`。
- [ ] T048 [P] [US3] Contract spec `backend/tests/contract/project-check-lists.spec.ts`：4 endpoints × happy + error；含 admin guard、CSRF（POST/DELETE）共 8 cases。

### 後端 — CHKPROJ 實作

- [ ] T049 [US3] 實作 `backend/src/jobs/services/chkproj.ts`：export `chkproj({ session, repos }): RegisteredService`；流程：
   1. 讀 `project-check-lists` → projects
   2. 若空 → 寫 `result=skipped, summary=專案檢查清單為空` + 退出（FR-023）
   3. for each projectKey（concurrency ≤ 5）：用既有 `services/jira/projects.getProject` / `searchIssues` 取得 sprint info + open overdue issues
   4. 走純函式 `evaluateDelay(input)` → 取得 `DelayEvaluation`
   5. 對個別專案失敗（404 / 403）走 1 次 retry（30s）；最終仍失敗則記在 `notes.errors[]`，整體 result 升級為 `partial_failure`
   6. summary 中文呈現「N 個專案，X 個延遲、Y 個正常、Z 個錯誤」；notes 含 `rule_version='rule-v1'` + `delayed[]` + `errors[]`
- [ ] T050 [P] [US3] Unit spec `backend/src/jobs/services/chkproj.spec.ts` 對純函式 `evaluateDelay`：A only / B only / A∩B / 都不符 / 邊界（Sprint 剛過半 / SP 剛好 50% / Due Date 剛逾期 3 天）/ 空 issues / 無 sprint；10 cases。
- [ ] T051 [P] [US3] Integration spec `backend/tests/integration/chkproj.spec.ts`：mock mcp-atlassian session + in-memory repos；驗整批執行 / 部分失敗 / 清單為空 / retry；**加 SC-004 案例：50 個 mock projects + 各 search_issues 立即回 mock issues，斷言整批 `runService` 完成時間 < 5 分鐘（用 `Date.now()` diff，mock 模式下實際應 < 1 秒）**；7 cases。
- [ ] T052 [US3] 將 `chkproj` 註冊到 `server.ts` service registry 中取代 stub。

### 前端 — feature

- [ ] T053 [P] [US3] 實作 `frontend/src/app/features/project-check-lists/project-check-lists-api.service.ts`：list / add / remove。
- [ ] T054 [US3] 實作 `frontend/src/app/features/project-check-lists/project-check-lists.page.ts`：表格 + 新增 input（projectKey + 可選 note）+ 移除按鈕（含確認對話框）+ 載入 / 空 / 錯誤狀態。
- [ ] T055 [US3] 更新 `frontend/src/app/app.routes.ts` 加 `/project-check-lists` + AdminGuard；shell 側欄加項目（`nav_project_check_lists`）。
- [ ] T056 [P] [US3] 擴充 `frontend/src/app/features/service-logs/service-log-detail.page.ts`：對 CHKPROJ 結果，把 `notes.delayed[]` 以友善表格呈現（projectKey 連結到 `/dashboard/projects/{key}`、conditions chip、實際數據如 sprint progress / overdue count / max days）；對 CHKISSUE 結果則處理 with_issues / without_issues / empty_streak。
- [ ] T057 [P] [US3] Unit spec `frontend/src/app/features/project-check-lists/project-check-lists.page.spec.ts`：新增 + 重複錯誤訊息 + 移除確認；5 cases。

### E2E

- [ ] T058 [P] [US3] E2E spec `frontend/e2e/specs/us3-chkproj.spec.ts`：
   1. admin 登入；新增清單 [PROJ-A, PROJ-B]
   2. 在 `/schedules` 建立 CHKPROJ 每分鐘排程 → 等 70s → 進 `/service-logs` 找到一筆
   3. 點進詳細頁驗 `rule_version=rule-v1` 與 delayed[] 內容
   4. 含 axe a11y

**Checkpoint**: US3 完整可演示——清單維護 + CHKPROJ 自動 / 手動觸發 + ServiceLog 有實質內容。

---

## Phase 6: User Story 4 - CHKISSUE 統計有任務 / 無任務專案清單 (Priority: P3)

**Goal**: CHKISSUE 服務盤點所有可見專案 → 寫入「總數 / 有任務 / 無任務」+ 兩組清單；連續 N 次無任務於備註標警示。

**Independent Test**: Jira 環境 10 個可見專案、其中 3 個無 issue；手動觸發 CHKISSUE；ServiceLog summary = 「總數 10、有任務 7、無任務 3」+ notes.without_issues 列出 3 個 projectKey；連跑 4 次後出現 `empty_streak[{projectKey, streak: 4}]` 警示。

### 後端

- [ ] T059 [P] [US4] 實作 `backend/src/db/repositories/project-issue-snapshots.ts`：`insertBatch({ serviceLogId, snapshots })` / `getStreakAt(projectKey, asOf, maxN): number`（從 snapshot 表往回數連續 false 的次數）/ `pruneOlderThanDays(days)`。
- [ ] T060 [P] [US4] Contract spec 同 `.spec.ts`：insertBatch + getStreakAt 含邊界（剛好 N、N+1、被 has_issues=true 打斷）；6 cases。
- [ ] T061 [US4] 實作 `backend/src/jobs/services/chkissue.ts`：
   1. 透過 mcp `list_projects` 取所有可見專案（concurrency ≤ 5）
   2. 對每專案以 `search_issues` JQL `project = {key}` maxResults=1 判斷 issue_count > 0
   3. 寫入 snapshots
   4. 對每無 issue 的專案查 `getStreakAt` ≥ `CHKISSUE_EMPTY_STREAK_THRESHOLD` → 加入 `notes.empty_streak[]`
   5. summary：「總 N 個、有任務 X、無任務 Y、其中 Z 個已連續 K 次無任務」
   6. 處理單一專案 API 失敗 → retry 1 次 → 失敗則 partial_failure（FR-033）
- [ ] T062 [P] [US4] Integration spec `backend/tests/integration/chkissue.spec.ts`：mock 5 projects（3 有 issue / 2 無）+ 4 次 snapshot 連續 false 觸發 empty_streak；含 partial_failure 路徑；**加 SC-005 案例：200 mock projects 整批掃描完成時間 < 10 分鐘**；6 cases。
- [ ] T063 [US4] 將 `chkissue` 註冊到 `server.ts` service registry 中取代 stub。

### E2E

- [ ] T064 [P] [US4] E2E spec `frontend/e2e/specs/us4-chkissue.spec.ts`：admin 登入 → 建立 CHKISSUE 每分鐘排程 → 等 70s → 進詳細頁驗 with_issues[] / without_issues[]；含 axe a11y。

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
