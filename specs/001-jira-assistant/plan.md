# Implementation Plan: Jira 小幫手

**Branch**: `001-jira-assistant` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-jira-assistant/spec.md`

## Summary

Jira 小幫手是一支「以使用者視角」操作 Jira Cloud 的工具型 Web App，提供 4 個核心能力：(1) 專案儀表板與最近存取，(2) 自然語言查詢（含基本統計），(3) 人員工作狀況（跨專案任務 + Story Points 統計），(4) 整批 issue 更新（含預覽與審計）。

技術走向：前端 Angular 19 (standalone) + Tailwind + ng2-charts；後端 Express + TypeScript，透過 `@modelcontextprotocol/sdk` 走 SSE 連到一個獨立 container 的 `ghcr.io/sooperset/mcp-atlassian` MCP server，避免自己重寫 Jira REST 包裝；前後端以 REST API 對接，整體用 Docker Compose 打包。LLM 用於自然語言查詢解析 (US2)，採 Anthropic Claude（與既有開發環境一致）；持久化使用 PostgreSQL（最近存取紀錄、查詢歷史、批次更新審計、排程設定為未來 002 預留）。

## Technical Context

**Language/Version**:
- Frontend：TypeScript 5.4+ / Angular 19（standalone components；無 NgModule）
- Backend：TypeScript 5.4+ / Node 20 LTS / Express 4.x

**Primary Dependencies**:
- Frontend：Angular 19、Tailwind CSS 3、ng2-charts 6（Chart.js 4）、Angular Router、RxJS、`@angular/forms`、`@auth0/angular-jwt` 或自管 token（見 research）
- Backend：Express、`@modelcontextprotocol/sdk`（client 端，SSE transport）、`@anthropic-ai/sdk`（LLM）、`pg`（PostgreSQL）、`zod`（輸入驗證）、`pino`（log）、`helmet`、`cors`、`cookie-parser`、`express-session`（OAuth flow）
- MCP Server（外部 container）：`ghcr.io/sooperset/mcp-atlassian`（不直接 import；以 SSE 端點連接）
- Lint/Format：ESLint + Prettier（前後端共用設定，分別載入 plugin）

**Storage**:
- PostgreSQL 16（持久化使用者最近存取紀錄、查詢歷史、批次更新審計記錄、OAuth refresh token 加密儲存）
- Redis 7（可選，v1.1 加入；v1 先以 PostgreSQL + 應用層 LRU 滿足 Jira 元資料短期快取）

**Testing**:
- Backend：Vitest（unit + integration）+ supertest（HTTP 契約）+ Pact 或自寫契約測試（針對 MCP server 回應結構）
- Frontend：Vitest + Angular Testing Library（取代 Karma）+ Playwright（E2E，每個 user story 一條黃金路徑）

**Target Platform**:
- 部署：Docker Compose（3 個服務：`frontend`、`backend`、`mcp-atlassian`、加 `postgres`），目標 Linux x86_64 / arm64 容器執行
- 使用端：桌面瀏覽器（Chrome / Edge / Firefox 最新兩版）

**Project Type**: Web application（前後端分離 + 外部 MCP server）

**Performance Goals**（對齊 Constitution Principle IV 與 spec SC）：
- 首頁載入完成（LCP）≤ 3 秒；最近 5 個專案儀表板渲染 ≤ 2 秒（spec SC-001）
- 查詢 API p95 ≤ 3 秒（含 MCP server 來回）
- 寫入 / 批次更新 API p95 ≤ 3 秒（不含預覽 → 套用之 between time）
- 自然語言查詢端對端 ≤ 6 秒（含 LLM）；其中 LLM 部分目標 ≤ 3 秒

**Constraints**:
- 同一使用者的所有 Jira 呼叫一律走「該使用者的 OAuth 2.0 token」（憲法 III + spec SC-007）
- 任何 Jira 列表畫面 MUST 分頁或虛擬滾動，禁止單次渲染 > 200 列（憲法 IV）
- 批次更新單次 ≤ 200 筆（FR-046）；超過分批
- 自然語言查詢一律唯讀（FR-025）；寫入只能走 US4 預覽 + 確認流程
- 所有 user-facing 文字 zh-TW（憲法 III）

**Scale/Scope**:
- 同時在線使用者：初期 ≤ 50；峰值估計 200（中型企業內部）
- 每使用者可見專案：5–200
- 批次更新最大 200 筆 / 次
- ServiceLogs 與審計紀錄保留期限：批次更新審計 ≥ 1 年（v1，未來可調），查詢歷史 90 天

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I — 程式碼品質

| 條款 | 狀態 | 落實方式 |
|------|------|----------|
| 統一風格 / Lint 與 Format | ✅ 通過 | 前後端皆採 ESLint + Prettier；CI 強制 |
| 單一職責與命名 | ✅ 通過 | Backend 分層：`routes/`、`services/`、`mcp/`、`db/`；Angular 標準 feature folder |
| 複雜度 ≤ 10 | ✅ 通過 | ESLint rule `complexity: ["error", 10]` 強制；超過於 PR 描述提出 |
| Code Review | ✅ 通過 | 內部流程，由 PR template 提醒 |
| 無懸置 TODO | ✅ 通過 | ESLint rule `no-warning-comments`（warn → CI 報告） |

### Principle II — 測試標準（NON-NEGOTIABLE）

| 條款 | 狀態 | 落實方式 |
|------|------|----------|
| TDD 紅綠重構 | ✅ 通過 | tasks.md 一律先生成測試任務；契約測試先於 MCP 串接實作 |
| 覆蓋率 ≥ 80% | ✅ 通過 | Vitest c8 報告；CI 在覆蓋率回退時 fail |
| 整合測試 + 契約測試 | ✅ 通過 | MCP server 用 contract test 鎖定回應結構；REST 端點以 supertest 跑整合 |
| CI 強制 | ✅ 通過 | GitHub Actions / 自架 CI 皆強制 |
| 不可繞過 | ✅ 通過 | PR template 內含「是否略過測試？」勾選欄 |

### Principle III — 使用者體驗一致性

| 條款 | 狀態 | 落實方式 |
|------|------|----------|
| zh-TW user-facing 文字 | ✅ 通過 | Angular i18n 走單一 locale `zh-Hant-TW`；後端錯誤訊息走 i18n key |
| Design system | ✅ 通過 | Tailwind + 自建 `ui/` 元件庫；無頁面層級硬編碼樣式 |
| 錯誤訊息「發生 / 為何 / 下一步」 | ✅ 通過 | 後端統一 `ProblemDetails`（RFC 7807）+ 中文摘要 |
| Loading / Empty / Error 三態 | ✅ 通過 | Angular `<ng-template>` pattern；全站元件 lint 規則 |
| 可達性（鍵盤 + ARIA） | ✅ 通過 | E2E 中含 axe-core 自動掃描 |

### Principle IV — 效能要求

| 條款 | 狀態 | 落實方式 |
|------|------|----------|
| 查詢 p95 < 2 秒（讀） | ⚠ 部分 | 自然語言查詢走 LLM 會超過 2 秒；目標 6 秒 → 列入 Complexity Tracking 並說明 |
| 寫入 p95 < 3 秒 | ✅ 通過 | 批次預覽 ≤ 1 秒；套用採 streamed progress |
| LCP < 3 秒 | ✅ 通過 | Angular 19 SSR 或 hybrid（v1 先採 CSR + 預取 critical CSS） |
| Jira 呼叫快取 / 批次 | ✅ 通過 | MCP 結果加 LRU 快取（TTL 60 秒），列表預先 batch |
| 列表 ≤ 200 列 / 分頁 | ✅ 通過 | 所有列表元件採 Angular CDK virtual-scroll |
| 可觀測性 | ✅ 通過 | pino + OpenTelemetry traces 暴露 metrics endpoint `/metrics` |

### 附加約束

- ✅ Jira API v3：由 mcp-atlassian 預設使用
- ✅ 憑證管理：OAuth 2.0 client_id/secret 從環境變數注入；refresh token 在 PostgreSQL 用 AES-256-GCM 加密儲存
- ✅ 新增第三方套件：PR template 列出
- ✅ WCAG 2.1 AA：由 axe-core 自動掃描

**結論**：Phase 0 之前無阻擋性違反；唯一需於 Complexity Tracking 記錄的是「自然語言查詢 LLM 來回會超過 Principle IV 的 2 秒讀取目標」，已於 spec 中以 SC-002 + 「在頁面標示思考中」的 UX 策略補強，但仍須留檔。

## Project Structure

### Documentation (this feature)

```text
specs/001-jira-assistant/
├── plan.md              # 本檔（/speckit.plan 產出）
├── research.md          # Phase 0 產出
├── data-model.md        # Phase 1 產出
├── quickstart.md        # Phase 1 產出
├── contracts/           # Phase 1 產出（OpenAPI）
│   └── api.openapi.yaml
├── checklists/
│   └── requirements.md  # 由 /speckit.specify 產出，已通過
└── tasks.md             # /speckit.tasks 產出（尚未建立）
```

### Source Code (repository root)

```text
backend/                          # Express + TypeScript（REST API + MCP client）
├── src/
│   ├── routes/
│   │   ├── auth.ts               # OAuth 2.0 callback / refresh
│   │   ├── projects.ts           # US1 專案儀表板 / 搜尋
│   │   ├── nlq.ts                # US2 自然語言查詢
│   │   ├── people.ts             # US3 人員工作狀況
│   │   ├── bulk.ts               # US4 批次更新（預覽 + 套用）
│   │   └── healthz.ts
│   ├── services/
│   │   ├── jira/                 # 對 MCP server 的呼叫封裝
│   │   ├── nlq/                  # LLM 解析 + 規則化
│   │   ├── bulk/                 # 批次更新編排（預覽 / 確認 / 寫入）
│   │   ├── auth/                 # OAuth flow + refresh token 加解密
│   │   └── audit/                # 審計紀錄寫入
│   ├── mcp/
│   │   └── client.ts             # @modelcontextprotocol/sdk SSE client
│   ├── db/
│   │   ├── migrations/
│   │   └── repositories/
│   ├── lib/
│   │   ├── i18n/                 # 錯誤訊息 zh-TW
│   │   ├── logger.ts             # pino
│   │   └── problem.ts            # RFC 7807
│   └── app.ts
├── tests/
│   ├── contract/                 # 對 MCP 與 OpenAPI 之契約測試
│   ├── integration/              # 跑 supertest + Testcontainers(PG)
│   └── unit/
├── Dockerfile
├── package.json
└── tsconfig.json

frontend/                         # Angular 19 standalone
├── src/
│   ├── app/
│   │   ├── features/
│   │   │   ├── dashboard/        # US1
│   │   │   ├── nlq/              # US2
│   │   │   ├── people/           # US3
│   │   │   └── bulk-update/      # US4（含預覽元件）
│   │   ├── ui/                   # 設計系統元件（button、card、table、chart-wrapper）
│   │   ├── core/                 # interceptor、auth guard、http service
│   │   ├── shared/               # pipes、directives
│   │   └── app.routes.ts
│   ├── styles/
│   │   └── tailwind.css
│   └── main.ts
├── e2e/                          # Playwright
├── Dockerfile
├── tailwind.config.js
├── angular.json
└── package.json

ops/
├── docker-compose.yml            # 4 services: frontend / backend / postgres / mcp-atlassian
├── docker-compose.dev.yml        # 開發 overlay（掛載 volume + hot reload）
└── .env.example                  # 範例環境變數（OAUTH_*, MCP_URL, DB_URL, ANTHROPIC_API_KEY）

.github/workflows/                # CI（lint、test、build、docker）
└── ci.yml
```

**Structure Decision**: 採 **Option 2: Web application** 變體，並加上獨立的 `ops/` 目錄管理 Docker Compose 與環境變數模板。MCP server 不在本 repo 內建構，直接以 image tag 引用。前後端各自為一個 Dockerfile/build target，避免單體 image 過大且利於水平擴展。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| 自然語言查詢端對端目標 6 秒（Principle IV 讀取目標 2 秒） | LLM（Claude）解析自然語言為查詢計畫的最低成本 P50 約 1.5–3 秒；加 MCP 來回 + 渲染後 6 秒已是樂觀目標 | 不用 LLM 改寫成關鍵字解析會大幅降低 US2 的覆蓋率與「自然語言」價值；採 LLM 是 spec 的核心承諾 |
| 引入獨立 MCP server（`mcp-atlassian`）作為第三服務 | 直接以 MCP 協定操作 Jira 可避免自己維護 Jira REST 包裝、權限轉送、版本相容 | 自寫 Jira API client 雖更簡，但維護 v3 API、認證、欄位差異成本 > 採用既有 MCP image |
| Backend 引入 PostgreSQL（非純 stateless） | 最近存取紀錄、批次更新審計、查詢歷史、refresh token 加密儲存皆需可查、可稽核的持久層 | 純 in-memory / 檔案儲存會在容器重啟後遺失，且無法多副本擴展；SQLite 在多 worker 寫入時存在鎖競爭，故選 PostgreSQL |
