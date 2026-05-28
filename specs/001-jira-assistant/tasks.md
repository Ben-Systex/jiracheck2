---
description: "Task list for 001-jira-assistant implementation"
---

# Tasks: Jira 小幫手

**Input**: Design documents from `/specs/001-jira-assistant/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.openapi.yaml, quickstart.md

**Tests**: 依憲法 Principle II「測試標準」為 NON-NEGOTIABLE — 商業邏輯需單元測試、外部相依需契約 / 整合測試。每個 user story 之測試任務皆已列出。

**Organization**: 任務依 user story 分組，每個 story 可獨立完成 → 獨立測試 → 獨立交付。

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: 可平行（不同檔、無未完成依賴）
- **[Story]**: US1 / US2 / US3 / US4（對應 spec.md）
- 每筆均含確切檔案路徑

## Path Conventions

- Backend：`backend/src/`、`backend/tests/`
- Frontend：`frontend/src/`、`frontend/e2e/`
- Ops：`ops/`、`.github/workflows/`

---

## Phase 1: Setup（共用基礎建設）

**Purpose**: 建立 repo 骨架，前後端可獨立 `npm install`、本機開發環境可起得來。

- [X] T001 建立目錄骨架 `backend/`、`frontend/`、`ops/`、`.github/workflows/`，並於 repo root 建立 `.editorconfig`、`.gitattributes`
- [X] T002 [P] 初始化 backend：`backend/package.json`、`backend/tsconfig.json`、`backend/src/app.ts` 空殼（Express 4 + TypeScript 5.7 + Node 20+，依 plan.md 鎖定版本）
- [X] T003 [P] 初始化 frontend：以 `ng new` 產生 Angular 19 standalone 專案於 `frontend/`，整合 Tailwind CSS 3（`frontend/tailwind.config.js`）與 ng2-charts 6（`frontend/src/app/app.config.ts` 註冊 provider）
- [X] T004 [P] 配置共用 lint/format：`backend/eslint.config.mjs`、`backend/.prettierrc.json`、`frontend/eslint.config.js`、`frontend/.prettierrc.json`，強制 `complexity: ["error", 10]` 與 `no-warning-comments`（憲法 I）
- [X] T005 [P] 建立 `ops/docker-compose.yml`、`ops/docker-compose.dev.yml`、`ops/.env.example`（依 research.md R-010 列出環境變數）
- [X] T006 [P] 建立 `backend/Dockerfile`、`frontend/Dockerfile`（multi-stage build；frontend 產出後以 nginx 提供）
- [X] T007 [P] 建立 CI workflow `.github/workflows/ci.yml`：lint → test → build → docker build；憲法 II/I 為 fail gate

**Checkpoint**: `docker compose -f ops/docker-compose.yml up` 可起得來空殼服務，CI 對空 repo 跑得過 lint。

---

## Phase 2: Foundational（阻擋所有 user story 的前置）

**Purpose**: 把跨所有 story 共用的「認證、MCP 連線、DB schema、設計系統、錯誤模型」全部完成。

**⚠️ CRITICAL**: 完成此 Phase 前，任何 user story 都不可進入實作。

### Database Foundation

- [X] T008 建立 backend 資料庫遷移框架：採 `node-pg-migrate`，配置於 `backend/src/db/migrations/`，並提供 `npm run db:migrate` 指令於 `backend/package.json`
- [X] T009 [P] 建立首版 migration `backend/src/db/migrations/0001_init.sql`：建立 `users`、`user_tokens`、`sessions` 三張表（依 data-model.md schema 完整建立含索引）
- [X] T010 [P] 建立 migration `backend/src/db/migrations/0002_features.sql`：建立 `recent_project_access`、`query_history`、`bulk_update_operations`、`bulk_update_items` 表與索引（依 data-model.md）
- [X] T011 [P] 建立 DB 連線池於 `backend/src/db/pool.ts`（pg.Pool，採環境變數 `DATABASE_URL`），與 `backend/tests/integration/db.spec.ts` 的 Testcontainers 範例

### Backend Cross-Cutting

- [X] T012 [P] 建立 logger 於 `backend/src/lib/logger.ts`（pino，根據 `LOG_LEVEL`），並暴露 request-scoped child logger middleware 於 `backend/src/middleware/request-context.ts`
- [X] T013 [P] 建立錯誤模型 `backend/src/lib/problem.ts`（RFC 7807 + `cause` 列舉），統一以 `application/problem+json` 回應；錯誤 i18n key 表放於 `backend/src/lib/i18n/zh-TW.ts`（憲法 III）
- [X] T014 [P] 設定 Express 中介層：`helmet`、`cors`（同源策略）、`cookie-parser`、`express.json({ limit: '256kb' })` 於 `backend/src/app.ts`
- [X] T015 [P] 建立 MCP client 於 `backend/src/mcp/client.ts`：使用 `@modelcontextprotocol/sdk` 的 `SSEClientTransport`，連到 `MCP_ATLASSIAN_URL`；提供 per-user session pool（key = userId、LRU + 15min idle timeout，依 research.md R-002）
- [X] T016 [P] 建立 MCP 契約 schemas 目錄 `backend/tests/contract/mcp/schemas/` 並放入 `list_projects.schema.json`、`search_issues.schema.json`、`bulk_edit.schema.json` 三個 JSON Schema 骨架（research.md R-009）

### Auth Foundation

- [X] T017 建立 OAuth 服務 `backend/src/services/auth/oauth.ts`：實作 Atlassian 3LO 流程（state 防偽、PKCE 可選）、access token 取得、refresh token 加密儲存 `user_tokens` 表（AES-256-GCM，金鑰 `TOKEN_ENC_KEY`）；依 research.md R-006
- [X] T018 建立 session middleware `backend/src/middleware/session.ts`：解析 `sid` cookie → 查 `sessions` 表 → 在 `req.user` 注入 user 與內部 token 取得函式；提供 sliding expiration（每次活動延 7 天）
- [X] T019 建立 auth routes `backend/src/routes/auth.ts`：`GET /api/v1/auth/login`、`GET /api/v1/auth/callback`、`POST /api/v1/auth/logout`（依 OpenAPI 規格）
- [X] T020 建立 `backend/src/routes/meta.ts` 含 `GET /api/v1/me`、`GET /api/v1/healthz`（healthz 不需登入）

### Auth Foundation — Tests

- [X] T021 [P] 撰寫契約測試 `backend/tests/contract/auth.spec.ts`：對 `/auth/callback` 與 `/me` 的 OpenAPI 回應 schema 進行 supertest 斷言
- [X] T022 [P] 撰寫整合測試 `backend/tests/integration/auth-flow.spec.ts`：以 Testcontainers PG + mock Atlassian token endpoint，驗證 login → callback → /me 全流程

### Frontend Cross-Cutting

- [X] T023 [P] 建立設計系統元件目錄 `frontend/src/app/ui/`，新增 `button/`、`card/`、`empty-state/`、`error-state/`、`loading-state/`、`table/`（憲法 III「Loading/Empty/Error 三態」）
- [X] T024 [P] 配置 i18n locale zh-Hant-TW 於 `frontend/src/app/core/i18n/`（採 Angular `@angular/localize` 或自實作 service；user-facing 文字一律走 i18n key）
- [X] T025 [P] 建立 HTTP 模組於 `frontend/src/app/core/http/`：含 `BaseApiService`、`AuthInterceptor`（401 → 導向 `/auth/login`）、`ProblemErrorInterceptor`（將 RFC 7807 轉成統一錯誤 banner）
- [X] T026 [P] 建立 auth guard 與根路由配置於 `frontend/src/app/app.routes.ts`：未登入導向 `/login` 頁；建立 `frontend/src/app/features/login/login.page.ts`（單一按鈕「以 Atlassian 登入」）
- [X] T027 [P] 建立全站 shell 元件 `frontend/src/app/shell/`：含 header（顯示 `/me` 結果、登出鈕）、側欄導覽（Dashboard / NLQ / People / Bulk）
- [X] T028 [P] 整合 axe-core 至 Playwright 設定 `frontend/e2e/axe.config.ts`（憲法 III + IV）
- [X] T101 [P] 設計系統元件 `frontend/src/app/ui/freshness-bar/freshness-bar.component.ts`：對 FR-003 — 顯示 `dataFreshness.fetchedAt` 相對時間（例「2 分鐘前」）、`source` badge（live / cache）、與「重新整理」按鈕（emit refresh event；caller 重打 API 並帶 `?refresh=true`）。配套 unit test 於 `frontend/src/app/ui/freshness-bar/freshness-bar.component.spec.ts`
- [X] T102 [P] Backend 統一回應 envelope helper `backend/src/lib/data-freshness.ts`：提供 `withFreshness(payload, { fetchedAt, source, cacheTtlSeconds })`；所有對 Jira 取資料的 route 都透過此 helper 包回；並提供 `forceRefresh?: boolean` 來繞過 `services/jira/cache.ts` 的 LRU

**Checkpoint**: 任何 user story 都可在「已登入、shell 可用、http 與 problem 串好、MCP 連得到、DB schema 已套用、freshness-bar 與 cache helper 就緒」的基礎上開始實作。

---

## Phase 3: User Story 1 — 專案儀表板與快速搜尋（Priority: P1） 🎯 MVP

**Goal**: 使用者登入後能在首頁看到最近存取的 5 個專案儀表板，並能以關鍵字搜尋並進入單一專案。

**Independent Test**: 即使其他 3 個 story 全未實作，使用者依然能：(a) 看到「最近 5 個」或「使用搜尋」提示、(b) 搜尋並進入專案、(c) 進入後該專案排到首頁第一張卡。

### Tests for User Story 1 ⚠️（憲法 II 必填，TDD：先紅後綠）

- [X] T029 [P] [US1] 契約測試 `backend/tests/contract/projects.spec.ts`：對 `GET /projects/recent`、`/projects/search`、`/projects/{key}` 對 OpenAPI 響應 schema 與 status code 斷言
- [X] T030 [P] [US1] 整合測試 `backend/tests/integration/recent-access.spec.ts`：呼叫 `/projects/{key}` 後 `recent_project_access` upsert 正確，且 `/projects/recent` 反映新排序
- [X] T031 [P] [US1] 整合測試 `backend/tests/integration/search-projects.spec.ts`：以 mock MCP 回 10 個專案 → 搜尋 `pay` 過濾出 3 筆
- [X] T032 [P] [US1] E2E 測試 `frontend/e2e/us1-dashboard.spec.ts`：完整黃金路徑 — 登入 → 看到提示 → 搜尋 → 點卡片 → 回首頁看到順序更新；含 axe-core 0 critical 斷言

### Implementation for User Story 1

- [X] T033 [P] [US1] DB repository `backend/src/db/repositories/recent-access.ts`：`upsertAccess(userId, projectKey)`、`listRecent(userId, limit=5)`、`pruneOver100(userId)`（按 data-model.md 保留策略）
- [X] T034 [P] [US1] Service `backend/src/services/jira/projects.ts`：`listAccessibleProjects(userId, q?)`、`getProject(userId, key)`、`getDashboardMetrics(userId, key)` — 透過 MCP `list_projects` + `search_issues`（憲法 IV：批次化、避免 N+1）
- [X] T035 [US1] Route `backend/src/routes/projects.ts`：`GET /projects/recent`、`/projects/search?q`、`/projects/{key}`（最後一個於回應前 upsert `recent_project_access`）；3 條皆透過 T102 的 `withFreshness` helper 包回；皆支援 `?refresh=true` 繞過 cache（FR-003）
- [X] T036 [P] [US1] Frontend feature `frontend/src/app/features/dashboard/dashboard.page.ts`：使用 Angular signals + computed；採設計系統 ui 元件；含「最近 5 個」與「請使用搜尋」兩種狀態切換；於頁頂嵌入 `<freshness-bar>`（T101），refresh event 觸發重打 `/projects/recent?refresh=true`（FR-003）
- [X] T037 [P] [US1] Frontend 元件 `frontend/src/app/ui/project-card/project-card.component.ts`：顯示專案名/key/未完成數/Story Points 完成 doughnut（ng2-charts，lazy 註冊）
- [X] T038 [P] [US1] Frontend 搜尋輸入 `frontend/src/app/features/dashboard/search-box.component.ts`：採 RxJS debounce 500ms（符合 spec acceptance #3）
- [X] T039 [P] [US1] Frontend HTTP service `frontend/src/app/features/dashboard/projects-api.service.ts`：包 `/projects/recent`、`/projects/search`、`/projects/{key}` 三條 API
- [X] T040 [US1] 串接：在 `dashboard.page` 注入 `ProjectsApiService` 與設計系統 loading/empty/error 三態 wrapper；單一卡片點擊呼叫 `/projects/{key}` 後再 `router.navigate` 到 `/projects/:key`
- [X] T041 [US1] 補強：在 `dashboard.page` 與 `project-card` 中加入鍵盤導覽與 ARIA label（憲法 III + WCAG 2.1 AA）

**Checkpoint**: US1 可獨立交付為 MVP；使用者可登入 → 搜尋 → 進入儀表板 → 首頁順序反映。

---

## Phase 4: User Story 2 — 自然語言查詢（Priority: P2）

**Goal**: 使用者用自然語言（中/英）查詢 Jira；系統先呈現「我這樣理解」再執行；支援基本統計與「解讀失敗 → 提示補充」。

**Independent Test**: 在 US1 已通過的基礎上，使用者輸入 10 道測試問句，系統 ≥ 9 道回正確結果、≤ 1 道請使用者補充，所有結果都有「我這樣理解」摘要。

### Tests for User Story 2 ⚠️

- [X] T042 [P] [US2] 契約測試 `backend/tests/contract/nlq.spec.ts`：對 `POST /nlq/query` 三種狀態（`ok` / `clarification_needed` / `partial_permission`）的回應結構斷言
- [X] T043 [P] [US2] 單元測試 `backend/tests/unit/nlq-redactor.spec.ts`：對 redactor 移除疑似敏感欄位、保留 accountId 的行為斷言（research.md R-003）
- [X] T044 [P] [US2] 單元測試 `backend/tests/unit/nlq-query-plan.spec.ts`：對 QueryPlan zod schema 的合法/不合法輸入；以及 plan → 中文 explanation 字串的 snapshot 測試
- [X] T045 [P] [US2] 整合測試 `backend/tests/integration/nlq-flow.spec.ts`：以 mocked Anthropic + mocked MCP 完成「問句 → 計畫 → 執行 → 結果」全流程；涵蓋 spec acceptance #1–#4
- [X] T046 [P] [US2] E2E 測試 `frontend/e2e/us2-nlq.spec.ts`：黃金路徑（解讀 + 執行）+ clarification + partial_permission 三條路徑
- [X] T103 [P] [US2] NLQ accuracy fixture `backend/tests/fixtures/nlq-accuracy/cases.yaml`：對應 SC-002，至少 20 道事先準備的中/英文問句測試集。每筆含 `id / question / expected.intent / expected.filters / expected.status`（ok / clarification_needed）；分為三大類各 ≥ 6 筆：列出（list）、統計（count/sum/avg/top_n/group_count）、跨專案。
- [X] T104 [P] [US2] NLQ accuracy runner `backend/tests/integration/nlq-accuracy.spec.ts`：載入 T103 的 fixture；對每筆呼叫 NlqService（連真實 LLM 或可開關的 record/replay）；比對 intent / filters 主軸欄位；輸出 `nlq-accuracy.json` 報告（總筆數 / 正確 / clarification / 錯誤分類）。本地預設 skip 標籤 `@nightly`，CI nightly job 才跑。

### Implementation for User Story 2

- [X] T047 [P] [US2] DB repository `backend/src/db/repositories/query-history.ts`：`insert(...)`、`pruneOlderThanDays(days=90)`
- [X] T048 [P] [US2] Redactor `backend/src/services/nlq/redactor.ts`：移除疑似 token / 個資 / 自訂內部 id；保留 displayName 與 accountId
- [X] T049 [P] [US2] QueryPlan schema `backend/src/services/nlq/query-plan.schema.ts`（zod，對應 OpenAPI 中的 `QueryPlan`；intent 必含 `list_issues / count_issues / sum_story_points / sum_actual_story_points / avg_story_points / avg_actual_story_points / top_n_assignees / group_count` 共 8 種，覆蓋 FR-022 五大統計）
- [X] T050 [P] [US2] Translator `backend/src/services/nlq/translator.ts`：QueryPlan → (a) MCP tool 呼叫序列、(b) 中文 explanation 字串
- [X] T051 [P] [US2] Anthropic client wrapper `backend/src/services/nlq/llm.ts`：採 `@anthropic-ai/sdk`，預設 `claude-sonnet-4-6`，啟用 prompt caching；system prompt 維護於 `backend/src/services/nlq/prompts/nlq.system.md`
- [X] T052 [US2] Service `backend/src/services/nlq/index.ts`：`analyze(question, userId)` 串接 redactor → llm → schema 驗證 → translator → executor；status 判斷邏輯（ok/clarification_needed/partial_permission/error）
- [X] T053 [US2] Route `backend/src/routes/nlq.ts`：`POST /nlq/query`；寫入 `query_history`；遵守 FR-025（唯讀）；若 `executeImmediately=true` 且 status=ok，回應中以 T102 的 `withFreshness` 附上 `dataFreshness`（FR-003）
- [X] T054 [P] [US2] Frontend feature `frontend/src/app/features/nlq/nlq.page.ts`：含輸入框（限 1000 字）、submit、explanation card、result viewport（依 intent 多型呈現）；result viewport 頂部嵌入 `<freshness-bar>`（T101），refresh event 重打同 question 並標示 `?refresh=true`（FR-003）
- [X] T055 [P] [US2] Frontend HTTP service `frontend/src/app/features/nlq/nlq-api.service.ts`
- [X] T056 [P] [US2] Frontend result renderer `frontend/src/app/features/nlq/result-renderer/`：對 8 種 intent 分別實作 sub-component — list_issues / count_issues / sum_story_points / sum_actual_story_points / avg_story_points / avg_actual_story_points / top_n_assignees / group_count（共用 number-card 與 issue-list 兩個 ui 元件）
- [X] T057 [US2] 串接：在 `nlq.page` 接 `NlqApiService`；對 `clarification_needed` 顯示後端提供的補充問題清單；對 `partial_permission` 顯示明確標示
- [X] T058 [US2] 補強：限制過長結果（>1000 筆）改提示縮小範圍（edge case）

**Checkpoint**: US2 可獨立交付；可在 US1 上線後任何時點疊加上去。

---

## Phase 5: User Story 3 — 人員工作狀況查詢與工時統計（Priority: P3）

**Goal**: 選擇人員 → 看到跨專案的任務清單 → 指定時間區間 → 看到統計（Story Points / Actual SP / 估準度）。

**Independent Test**: 在 US1/US2 未完成的情況下，使用者仍能透過 People 頁面選人、看清單、選區間、看統計。

### Tests for User Story 3 ⚠️

- [X] T059 [P] [US3] 契約測試 `backend/tests/contract/people.spec.ts`：對 `/people/search`、`/people/{accountId}/issues`、`/people/{accountId}/stats` 響應 schema 斷言
- [X] T060 [P] [US3] 整合測試 `backend/tests/integration/people-issues.spec.ts`：跨專案任務匯總、`partialPermission` 旗標、分頁 cursor
- [X] T061 [P] [US3] 整合測試 `backend/tests/integration/people-stats.spec.ts`：以 mock issues 驗證 totals、byProject、estimateAccuracyRatio 計算正確
- [X] T062 [P] [US3] E2E 測試 `frontend/e2e/us3-people.spec.ts`：覆蓋 spec acceptance #1–#4

### Implementation for User Story 3

- [X] T063 [P] [US3] Service `backend/src/services/jira/users.ts`：`searchUsers(q)`（呼叫 MCP user search）
- [X] T064 [P] [US3] Service `backend/src/services/jira/issues.ts`：`listByAssignee(userId, accountId, opts)`、`statsByAssignee(userId, accountId, from, to)`（含 SP / Actual SP 加總、估準度）
- [X] T065 [US3] Route `backend/src/routes/people.ts`：`/people/search`、`/people/{accountId}/issues`、`/people/{accountId}/stats`；後兩條皆透過 T102 `withFreshness` 包回，支援 `?refresh=true`（FR-003）
- [X] T066 [P] [US3] Frontend feature `frontend/src/app/features/people/people.page.ts`：含人員搜尋下拉、issue list、time range picker、stats card；於 issue list 與 stats card 上方各嵌入 `<freshness-bar>`（T101），refresh event 個別重打對應 API 並帶 `?refresh=true`（FR-003）
- [X] T067 [P] [US3] Frontend 元件 `frontend/src/app/features/people/stats-card/stats-card.component.ts`：含 ng2-charts 折線（SP vs Actual）+ 柱狀（完成數 by project）
- [X] T068 [P] [US3] Frontend HTTP service `frontend/src/app/features/people/people-api.service.ts`
- [X] T069 [US3] 串接：在 `people.page` 結合三條 API；分頁採 cursor + virtual scroll（憲法 IV）
- [X] T070 [US3] 在 issue list 中每列加入「跳到專案儀表板」連結（沿用 US1 的 `/projects/:key`）
- [X] T071 [US3] 補強：時區處理（依使用者瀏覽器或 Atlassian profile）、空集合提示「擴大到三個月」按鈕

**Checkpoint**: US3 可獨立交付；不依賴 US2 LLM 即可運作。

---

## Phase 6: User Story 4 — 整批更新 issue（Priority: P4）

**Goal**: 選專案 → 設條件 → 預覽 → 明確確認 → 套用 → 看結果與審計；違反白名單 / 超過上限 / 權限不足均應於預覽阻擋。

**Independent Test**: 在 US1–US3 未完成的情況下，使用者可從專案選擇器、設條件、預覽、套用、檢視結果。

### Tests for User Story 4 ⚠️

- [X] T072 [P] [US4] 契約測試 `backend/tests/contract/bulk.spec.ts`：對 `/bulk/preview`、`/bulk/apply`、`/bulk/operations/{id}` 響應斷言
- [X] T073 [P] [US4] 單元測試 `backend/tests/unit/bulk-validate.spec.ts`：白名單欄位 (FR-047)、200 筆上限 (FR-046)、confirmText 正規式 `^確認更新\s*(\d+)\s*筆$`、confirmText 解析數字 vs confirmCount vs totalCount 三方比對（acceptance #4）
- [X] T074 [P] [US4] 整合測試 `backend/tests/integration/bulk-preview.spec.ts`：覆蓋 spec acceptance #1、#3（每筆權限標示）、#5（0 筆禁用套用）
- [X] T075 [P] [US4] 整合測試 `backend/tests/integration/bulk-apply.spec.ts`：覆蓋 #2（部分失敗）、版本衝突（edge case）、確認字串錯誤回 409
- [X] T076 [P] [US4] 整合測試 `backend/tests/integration/bulk-audit.spec.ts`：每次成功/失敗皆寫入 `bulk_update_operations` + `bulk_update_items`，可由 `/bulk/operations/{id}` 查詢
- [X] T077 [P] [US4] E2E `frontend/e2e/us4-bulk-preview.spec.ts`：完整 preview-only 流程；axe + keyboard
- [X] T078 [P] [US4] E2E `frontend/e2e/us4-bulk-apply.spec.ts`：apply 流程含確認對話框

### Implementation for User Story 4

- [X] T079 [P] [US4] DB repository `backend/src/db/repositories/bulk-updates.ts`：`createOperation(...)`、`recordItem(...)`、`finalize(...)`、`getById(...)`、`pruneOlderThanMonths(months=12)`
- [X] T080 [P] [US4] Service `backend/src/services/bulk/preview.ts`：filter → JQL → MCP `search_issues` → 投影出 currentValue / proposedValue / editableByUser，發 `previewToken`（短期記憶體 + signed JWT，30 分鐘 TTL）
- [X] T081 [P] [US4] Service `backend/src/services/bulk/apply.ts`：解 previewToken → 三方比對（confirmText 解析數字 == confirmCount == totalCount，任一不符回 409）→ 對每筆呼叫 MCP `edit_issue`；採每筆獨立 try/catch，分類 `permission_denied` / `version_conflict` / `api_error`；最終 finalize 操作狀態
- [X] T082 [P] [US4] Validator `backend/src/services/bulk/validator.ts`：白名單欄位（assignee、due_date、label、priority、sprint）+ 上限 200 筆檢查
- [X] T083 [US4] Route `backend/src/routes/bulk.ts`：`POST /bulk/preview`、`POST /bulk/apply`、`GET /bulk/operations/{id}`；apply 採 `202 Accepted` + 背景作業
- [X] T084 [P] [US4] Frontend feature `frontend/src/app/features/bulk-update/bulk-update.page.ts`：分四步（選專案 → 條件 → 預覽 → 確認套用）；採 stepper UI
- [X] T085 [P] [US4] Frontend filter form `frontend/src/app/features/bulk-update/filter-form/`：欄位限定 Status / Assignee / Sprint / Issue Type / Label / Due Date
- [X] T086 [P] [US4] Frontend preview table `frontend/src/app/features/bulk-update/preview-table/`：含 currentValue/proposedValue 對比、editableByUser badge、totalCount 顯示、200 上限警示；於表頂顯示 `預覽於 {fetchedAt}` 並提供「重新預覽」按鈕（FR-003，獨立於 freshness-bar，因 preview token 會被廢棄需告知使用者）
- [X] T087 [P] [US4] Frontend confirm dialog `frontend/src/app/features/bulk-update/confirm-dialog/`：使用者必須完整輸入字串「確認更新 N 筆」；前端以正規式 `^確認更新\s*(\d+)\s*筆$` 解析後同送 `{confirmText, confirmCount}` 給 `/bulk/apply`；解析失敗即就地顯示錯誤、disable 套用鈕
- [X] T088 [P] [US4] Frontend operation polling service `frontend/src/app/features/bulk-update/operations.service.ts`：以指數退讓 polling `/bulk/operations/{id}` 直到 status 終態
- [X] T089 [US4] 串接：在 `bulk-update.page` 注入上述 service；維持 stepper 狀態於 component-local signal；錯誤一律走 ProblemErrorInterceptor 統一呈現
- [X] T090 [US4] 在 `bulk-update.page` 結尾頁顯示成功/失敗結果並提供「下載 CSV」連結（呼叫 `/bulk/operations/{id}?format=csv` — 此為 polish phase 擴充端點）

**Checkpoint**: US4 可獨立交付；至此 4 個 user story 皆完成。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 影響多個 story 的補強；憲法 II/IV 覆蓋率與效能門檻最終達成。

- [X] T091 [P] 覆蓋率補強：補充 `backend/tests/unit/` 與 `frontend/src/**/*.spec.ts` 直至 c8 報告語句覆蓋率 ≥ 80%（憲法 II）
- [X] T092 [P] OpenTelemetry 追蹤：於 `backend/src/lib/telemetry.ts` 整合 OTel SDK；於關鍵路徑（auth、project listing、nlq、bulk）標 span；暴露 `/metrics` Prometheus 端點（憲法 IV）
- [X] T093 [P] Jira 呼叫快取：於 `backend/src/services/jira/cache.ts` 加入 LRU（key = userId + tool + args hash，TTL 60 秒）；於 plan 提到的 N+1 風險路徑（dashboard、people stats）使用
- [X] T094 [P] Rate limit：於 `backend/src/middleware/rate-limit.ts` 加入 IP + user 雙維度的 token bucket；對 `/nlq/query`、`/bulk/apply` 個別調低限額
- [X] T095 [P] CSRF 防護：對狀態變更端點（`/auth/logout`、`/bulk/apply`、`/bulk/preview`）採 double-submit cookie；同步更新 frontend interceptor
- [X] T096 [P] 排程清理 job `backend/src/jobs/cleanup.ts`：每日 03:00 跑 `query_history` 90 天刪除、`bulk_update_*` 12 個月歸檔、`sessions` 過期清掃
- [X] T097 [P] 文件補強：更新 repo `README.md`（zh-TW）含架構圖、各 service 簡介；補 `docs/` 內 OAuth 設定指引、Anthropic key 取得指引
- [X] T098 [P] i18n 字串審查：對 `frontend/src/app/**/*.html` 與 `backend/src/lib/i18n/zh-TW.ts` 全面盤點，確保無硬編碼英文 user-facing 字串（憲法 III）
- [X] T099 [P] 無障礙最終掃描：在 CI 中強制 axe-core E2E 報告 0 critical、0 serious；對 4 個 feature 各跑一次
- [X] T100 執行 `specs/001-jira-assistant/quickstart.md` 完整 5 步驗證；補寫任何缺漏的 `.env.example` / docker compose 修正（靜態驗證完成；實地 OAuth 登入 + 5-step user story 由 PM/內部使用者依 `checklists/quickstart-validation.md` 執行）
- [X] T105 [P] CI nightly NLQ accuracy gate：於 `.github/workflows/nlq-accuracy.yml` 新增每日排程，跑 T104 的 `@nightly` runner；若「正確比例 < 90%」或「錯誤分類數 > 0」即 fail，並把 `nlq-accuracy.json` 上傳 artifact。對應 SC-002 之自動化驗證。
- [X] T106 [P] SC-007 跨權限抽測 fixture：於 `frontend/e2e/fixtures/permission-accounts.ts` 與 `ops/.env.test` 維護兩個測試帳號：`E2E_USER_LOW`（僅可見專案 PROJ-A）與 `E2E_USER_HIGH`（可見 PROJ-A + PROJ-B + PROJ-C）；於 CI secret store 注入。
- [X] T107 [P] SC-007 跨權限 E2E 測試 `frontend/e2e/sc007-permission-isolation.spec.ts`：以 `E2E_USER_LOW` 登入後，斷言：(a) `/projects/recent` 與 `/projects/search?q=PROJ-B` 皆看不到 PROJ-B、(b) 直接打 `/projects/PROJ-B` 回 404 problem、(c) `/people/{anyId}/issues` 結果只含 PROJ-A、(d) NLQ「列出 PROJ-B 的所有任務」回應 partial_permission 並標示。對應 SC-007「至少一次跨權限抽測」之自動化版本。
- [X] T108 [P] SC-001 效能 smoke test `backend/tests/perf/api-latency.k6.js`：以 k6 模擬 20 vu / 60 秒；對 `GET /projects/recent`、`GET /people/{accountId}/stats`、`POST /nlq/query` 三條主要查詢路徑量 p95；輸出 JSON 報告至 `backend/tests/perf/results/`。
- [X] T109 [P] SC-001 CI gate `.github/workflows/perf.yml`：對 main 分支與 release tag 跑 T108；fail 條件：`/projects/recent` p95 > 2 s、其餘讀取端點 p95 > 3 s、`POST /nlq/query` 端對端 p95 > 6 s（與 plan.md Performance Goals + Complexity Tracking 對齊）。報告 artifact 上傳。
- [X] T110 [P] [US4] Backend repository 補強 `backend/src/db/repositories/bulk-updates.ts`：新增 `listByUser(userId, { projectKey?, status?, cursor?, pageSize=20 })` 含 keyset cursor 分頁；對應 OpenAPI `BulkOperationSummary`。
- [X] T111 [P] [US4] Backend route 補強 `backend/src/routes/bulk.ts`：新增 `GET /api/v1/bulk/operations`（query: projectKey / status / cursor / pageSize）；對應 US4 acceptance #5「日後查核」。
- [X] T112 [P] [US4] 契約測試 `backend/tests/contract/bulk-history.spec.ts`：對 `GET /bulk/operations` 之 query 組合與分頁的響應 schema 斷言。
- [X] T113 [P] [US4] Frontend feature `frontend/src/app/features/bulk-update/history/history.page.ts`：列出當前使用者的批次更新歷史；可篩選專案、狀態；表格 row 點擊跳 `bulk/operations/{id}` 詳細頁；於頁頂引用 `<freshness-bar>`。串於 shell 側欄「批次更新 → 歷史」。
- [X] T114 [P] [US4] E2E `frontend/e2e/us4-bulk-history.spec.ts`：apply 完成後切換到歷史頁可看到該筆紀錄；篩選 status=success 後該筆仍可見；超過 12 個月之模擬資料不顯示（與 data-model 保留策略對齊）。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**：可立即開始；無依賴
- **Phase 2 Foundational**：依 Phase 1 完成；**完成前任何 user story 不可開始**
- **Phase 3 US1**：依 Phase 2 完成；可作為 MVP 獨立交付
- **Phase 4 US2 / Phase 5 US3 / Phase 6 US4**：均僅依 Phase 2 完成；可由不同人 / 不同分支平行開發
- **Phase 7 Polish**：建議在至少 US1 完成後即可漸進加入；T100 quickstart 驗證須 4 個 story 全完成後執行

### User Story Dependencies

- US1（P1）：foundation 後即可開始；無對其他 story 之依賴。MVP candidate。
- US2（P2）：foundation 後即可開始；不依賴 US1，但 UX 建議延用 US1 的「跳到專案」連結。
- US3（P3）：foundation 後即可開始；issue list 中的「跳到專案」可在 US1 完成後再串。
- US4（P4）：foundation 後即可開始；獨立性最高，但須與 US1 共用同樣的「選專案」UX 元件。

### Within Each User Story（TDD 規則）

1. **先寫 test（紅）**：契約測試 / 整合測試 / 單元測試 / E2E
2. **DB repository → Service → Route**（後端）
3. **HTTP service → 元件 → 頁面**（前端）
4. **串接 + UX 三態 + ARIA**
5. story 完成 → checkpoint demo

### Parallel Opportunities

- Phase 1 中 T002–T007 全部 [P] 可平行
- Phase 2 中除 T008（migration 框架）→ T009/T010 外，其餘 [P] 大致可平行；前端 T023–T028 與後端 T011–T022 可由不同人併行
- 每個 user story 內，所有 test 任務（T029–T032、T042–T046、T059–T062、T072–T078）皆 [P]，可由團隊一次發包
- 每個 user story 的「DB repo」與「Service」標 [P] 者可並行；Route 與 Frontend 串接須依序

---

## Parallel Example: User Story 1

```bash
# 一次發包所有 US1 測試（紅階段先就位）
Task: T029 backend/tests/contract/projects.spec.ts
Task: T030 backend/tests/integration/recent-access.spec.ts
Task: T031 backend/tests/integration/search-projects.spec.ts
Task: T032 frontend/e2e/us1-dashboard.spec.ts

# 平行開出 backend repo/service 與 frontend 元件
Task: T033 backend/src/db/repositories/recent-access.ts
Task: T034 backend/src/services/jira/projects.ts
Task: T036 frontend/src/app/features/dashboard/dashboard.page.ts
Task: T037 frontend/src/app/ui/project-card/project-card.component.ts
Task: T038 frontend/src/app/features/dashboard/search-box.component.ts
Task: T039 frontend/src/app/features/dashboard/projects-api.service.ts

# Route 與串接須等對應的 repo/service/元件就緒
Task: T035 backend/src/routes/projects.ts
Task: T040 frontend dashboard 整合
Task: T041 a11y 補強
```

---

## Implementation Strategy

### MVP First（僅 US1）

1. Phase 1 Setup（T001–T007）
2. Phase 2 Foundational（T008–T028）— **不可跳過**
3. Phase 3 US1（T029–T041）
4. STOP & VALIDATE：跑 `quickstart.md` 的步驟 1+2，並由 PM 驗收
5. 可作為內部 MVP 上線

### Incremental Delivery

1. MVP 上線後評估反饋
2. 加 US3（P3）— 主管 / PM 受益最大，且不依賴 LLM
3. 加 US2（P2）— 自然語言查詢進場，需先取得 Anthropic key 與 redactor 安全審查
4. 加 US4（P4）— 寫入功能最後上，需內部公告 + 多輪測試
5. Polish（Phase 7）穿插在各 story 完成後執行

### Parallel Team Strategy

- 完成 Phase 2 後，可分配：
  - 開發者 A：US1（含 dashboard UI）
  - 開發者 B：US3（人員 + 統計）— 對 LLM / 寫入無依賴，風險最低
  - 開發者 C：US2（自然語言）— 需要 prompt 開發週期
  - 開發者 D：US4（批次更新）— 需要更多測試與審計設計

---

## Notes

- [P] = 不同檔、無未完成依賴
- [Story] 標籤對應 spec.md user story 編號（US1–US4）
- 任何測試任務 MUST 先 fail（憲法 II TDD）後再進實作任務
- 每個 user story 結束時 commit 並更新 checklist（建議 PR 一支 story 一支）
- Phase 1 + Phase 2 完成後，禁止單體 PR 跨多個 user story；確保每個 story 可獨立 review / 退回
