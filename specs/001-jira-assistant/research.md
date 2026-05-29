# Phase 0 Research: Jira 小幫手

**Feature**: 001-jira-assistant
**Date**: 2026-05-22
**目的**: 釐清 plan.md「Technical Context」中所有未明確的技術決策，留下決策依據與替代方案紀錄，作為 Phase 1 設計依據。

---

## R-001 MCP server 與 backend 的傳輸方式

**問題**: `ghcr.io/sooperset/mcp-atlassian` 支援 stdio 與 SSE 兩種 transport，我們的 Express backend 應採何種？

**Decision**: 採 **SSE transport**，由 backend 以 `@modelcontextprotocol/sdk` 的 `SSEClientTransport` 連到 mcp-atlassian 暴露在 docker-compose 內部網路的 `http://mcp-atlassian:9000/sse`。

**Rationale**:
1. SSE 可跨容器邊界（stdio 必須父子行程綁定，與 docker-compose 拆服務的目標相左）。
2. SSE 是 HTTP 之上的單向串流，可被 reverse proxy 觀測 / 限流 / 加 mTLS。
3. backend 可重啟而 mcp-atlassian 不必跟著重啟。

**Alternatives considered**:
- **stdio + spawn 子行程**：把 mcp-atlassian 當 backend 的子行程啟動；簡單但失去獨立部署、無法平行多 backend、難於觀測。
- **HTTP polling 自寫包裝**：放棄 MCP，直接打 mcp-atlassian 的內部 REST；違反採用 MCP 的初衷。

---

## R-002 OAuth 2.0 與 mcp-atlassian 的關係

**問題**: spec 規定一律以「使用者本人 OAuth token」呼叫 Jira；mcp-atlassian 本身是否能逐請求帶 user token？

**Decision**: 採 **每使用者一個 MCP session**（per-user SSE connection），由 backend 在使用者登入後，**動態啟動 / 重用**一條帶該使用者 OAuth access token 的 SSE 連線；token 從 backend 環境傳入透過 mcp-atlassian 支援的環境變數或 init handshake。

**Rationale**:
- 滿足憲法 III 與 spec SC-007「100% 僅顯示使用者有權限的資料」。
- 與 spec FR-001、FR-024 一致。

**Alternatives considered**:
- **共用一條 admin token 的 MCP 連線、由 backend 自行做權限過濾**：失敗模式風險高（任何 bug 都會洩漏跨權限資料），明確違反憲法，拒絕。
- **由前端直接連 mcp-atlassian**：mcp-atlassian 不適合直接面向瀏覽器（CORS、token 安全），拒絕。

**Operational note**: 每位使用者的 MCP session 在 backend 進程內以「pool + LRU + idle timeout 15 分鐘」管理，避免常駐連線過多。

---

## R-003 LLM 供應商（自然語言查詢）

**問題**: spec FR-020、SC-002 要求自然語言解析；該選哪一家 LLM 服務？

**Decision**: 採 **Anthropic Claude（`claude-sonnet-4-6` 為預設、`claude-haiku-4-5-20251001` 為輕量備援）**，透過官方 `@anthropic-ai/sdk` 呼叫。

**Rationale**:
1. 對複雜中文語意解析（spec US2 的「列出小明這個月完成的任務」這類問句）表現穩定。
2. 與既有的開發工具鏈（Claude Code）一致，便於離線測試與 prompt 開發。
3. 提供 prompt caching，降低重複 system prompt 的成本與延遲。
4. Sonnet 4.6 即可滿足 P50 1.5–3s 的延遲目標。

**Alternatives considered**:
- **OpenAI GPT-4 系列**：能力相近，但團隊 prompt 慣用 Claude，成本與延遲皆相近。可作為 v1.1 的二供。
- **Azure OpenAI（私有部署）**：合規最強但部署門檻高，列為企業客戶 v2 選項。
- **自行 fine-tune 本地模型**：成本與效益不成比例，否決。

**Constraint**: 任何送到 LLM 的內容 MUST 經 backend `services/nlq/redactor.ts` 移除疑似敏感字串（email、accountId 以外的內部 id），並僅傳送「結構化問句」+「使用者可見的專案 / 人員清單」。

---

## R-004 自然語言查詢的可解釋性

**問題**: spec FR-021 要求每次查詢需呈現「系統如何解讀您的問題」。要怎麼做到？

**Decision**: 採「LLM → 結構化查詢計畫（JSON）→ 呈現給使用者的中文摘要 → 真正執行」的 **兩階段流程**：
1. LLM 不直接寫 JQL，只輸出一份 **QueryPlan**（純 JSON，schema 見 `contracts/api.openapi.yaml`）。
2. backend 把 QueryPlan 翻成 (a) 可讀的中文「我這樣理解」摘要，(b) 對 mcp-atlassian 的工具呼叫（如 `searchIssues`）。
3. 兩者一起回傳給前端，前端先展示「我這樣理解」+ 取消按鈕，使用者確認後（或快進模式自動 1 秒後）再進入結果頁。

**Rationale**: 把「LLM」這個非決定性的元件鎖在 `QueryPlan` schema 之內，下游與測試都可以對結構化資料做 assertion；同時滿足可解釋性與審計需求。

**Alternatives considered**:
- **直接讓 LLM 產生 JQL**：JQL 隨 Jira 版本與自訂欄位變化大、容易產生注入或拒絕；也難對「不解讀」做 assertion。
- **僅做關鍵字 → 規則匹配**：覆蓋率太低，違反 spec SC-002 90% 命中目標。

---

## R-005 持久化選擇：PostgreSQL vs SQLite

**問題**: 要不要在 backend 額外起 PostgreSQL？

**Decision**: 採 **PostgreSQL 16**（在 docker-compose 中與 backend 同一網路）。

**Rationale**:
1. 批次更新審計（FR-045、SC-004）需可查詢、可加索引、支援交易，並可能延展為多 worker。
2. OAuth refresh token 加密儲存需被多副本 backend 共享。
3. 查詢歷史需可分頁、可篩選、可保留 90 天滾動視窗。

**Alternatives considered**:
- **SQLite**：單檔輕量，但無法支援多 backend 副本同時寫入；批次審計每分鐘可能多筆 insert，鎖競爭風險偏高。
- **直接寫檔案 JSON line**：操作快、但查詢與保留期限管理不便。

---

## R-006 認證 / Session 管理

**問題**: 使用者完成 Atlassian OAuth 後，前後端如何維持 session？

**Decision**: 採 **HTTP-only secure cookie + server-side session store（PostgreSQL `sessions` 表）**：
- Atlassian access token 不放在前端；只在 backend 內以記憶體 + DB 加密保管。
- 前端只看得到 `sid` cookie；所有 API 透過 `sid` 對應到 backend 內的使用者身份與 token。
- Refresh token 用 AES-256-GCM 加密後存 DB；解密金鑰來自環境變數 `TOKEN_ENC_KEY`（CI 與 prod 不同）。

**Rationale**: 滿足憲法附加約束「憑證不存版控、不暴露在前端」；對 XSS 攻擊面最小化。

**Alternatives considered**:
- **JWT 內含 access token**：access token 進入瀏覽器即為高風險；拒絕。
- **localStorage 存 token**：同上，且 XSS 一旦觸發即外洩。

---

## R-007 前端狀態管理

**問題**: Angular 19 standalone 下，是否需要 NgRx / Redux？

**Decision**: 不引入全域 store；採 **Angular Signals + Service-as-store** 模式，僅在跨多 feature 共用（例如 `currentUser`、`recentProjects`）才提取為 root-provided service；其餘以 component-local signal 處理。

**Rationale**: 此產品的核心是 server-driven 資料（Jira 來源），多數狀態存於 server；過早引入 NgRx 會放大樣板代碼且不符合「Angular 19 標準推薦」。

**Alternatives considered**:
- **NgRx**：可選但 over-engineering；列入 v1.1 重新評估。
- **RxJS BehaviorSubject 寫到底**：與 Signals 重複，混用易出錯。

---

## R-008 圖表（ng2-charts）使用範圍

**問題**: 哪些畫面需要圖表？

**Decision**: v1 使用 ng2-charts 的場景僅限：
1. 專案儀表板卡片內的迷你「進度條」（doughnut，Story Points 完成率）。
2. 人員工作狀況頁的「計畫 vs. 實際 Story Points 折線圖 + 完成數柱狀圖」。

其餘清單、表格皆使用純 HTML + Tailwind，避免 Chart.js 預載成本。

**Rationale**: 將 Chart.js bundle 集中於兩個 feature module，採 **lazy load**。

---

## R-009 測試策略：契約測試對象

**問題**: 憲法 II 要求對外部相依做契約測試。我們的外部相依是 `mcp-atlassian`，怎麼做？

**Decision**:
1. 在 `backend/tests/contract/mcp/` 中以「錄製 → 比對」方式：第一次手動驗證後把 mcp-atlassian 對每個工具呼叫（list_projects / search_issues / bulk_edit）的回應 schema **固定為 JSON Schema** 放在 `backend/tests/contract/mcp/schemas/`。
2. CI 中以一個 docker-compose test profile 起 mcp-atlassian + 模擬 Jira（用 `mockoon` 或 wiremock），跑 contract test 確認回應仍符合 schema。
3. 升版 mcp-atlassian 前 MUST 跑此測試。

**Rationale**: mcp-atlassian 是上游維護的 image，我們需要對「升級時 break 的回應變動」可被測試發現。

**Alternatives considered**:
- **錄製 / 重播真實 Jira**：受限於資料隱私與測試帳號管理，不適合 CI。
- **單純 mock**：失去契約測試的意義。

---

## R-010 部署環境變數一覽

**Decision**: 建立 `ops/.env.example`，至少包含：

```
# Atlassian OAuth
ATLASSIAN_OAUTH_CLIENT_ID=
ATLASSIAN_OAUTH_CLIENT_SECRET=
ATLASSIAN_OAUTH_REDIRECT_URI=

# MCP server
MCP_ATLASSIAN_URL=http://mcp-atlassian:9000/sse

# LLM
ANTHROPIC_API_KEY=

# PostgreSQL
POSTGRES_USER=jiracheck
POSTGRES_PASSWORD=
POSTGRES_DB=jiracheck
DATABASE_URL=postgres://jiracheck:***@postgres:5432/jiracheck

# Token encryption
TOKEN_ENC_KEY=  # 32 bytes base64

# Logging
LOG_LEVEL=info
```

**Rationale**: 一致的環境變數命名讓多人開發 / CI / prod 三段環境可以共用文件；secret 一律不入庫。

---

## 結論

所有 plan.md 中標示為「NEEDS CLARIFICATION」之技術項目皆已解決，沒有遺留問題。可進入 Phase 1（資料模型 / API 契約 / quickstart）。
