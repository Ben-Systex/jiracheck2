# Jira 小幫手 (jiracheck2)

以自然語言查 Jira、看儀表板、查人員工作狀況、整批更新 issue、**並定期自動檢查專案延遲**的內部工具。
所有 user-facing 文字為繁體中文（台灣用語）。

## 功能

- **001 — 主功能**：登入、專案儀表板、自然語言查詢、人員工作狀況、批次更新 issue
- **002 — 定時排程服務**（admin only）：
  - **排程設定**：cron / 每日 / 每週 / 每月，可手動觸發，scheduler 自動執行
  - **CHKPROJ**：定期檢查「專案檢查清單」中的專案是否延遲（rule-v1：Sprint 過半 SP<50% 或任一未完成任務 Due Date 逾期 ≥ 3 天）
  - **CHKISSUE**：盤點所有可見專案的「有任務 / 無任務」分布，連續 N 次無任務時警示
  - **ServiceLogs**：所有執行紀錄保留 90 天，可過濾 / 詳細頁 / CSV 匯出

## 子系統

| 子系統 | 路徑 | 技術 |
|--------|------|------|
| Frontend | `frontend/` | Angular 19 (standalone) + Tailwind CSS 3 + ng2-charts 6 |
| Backend | `backend/` | Express 4 + TypeScript 5.7（Node 20+） |
| Scheduler (002) | `backend/src/jobs/` | node-cron 4 + cron-parser 5 + PG advisory lock |
| MCP Server | external | `ghcr.io/sooperset/mcp-atlassian`（SSE transport） |
| LLM | external | Anthropic Claude（sonnet-4-6 / haiku-4-5 fallback） |
| Storage | `ops/docker-compose.yml` | PostgreSQL 16 |
| Observability | — | Prometheus `/api/v1/metrics` + OpenTelemetry trace API |
| Deploy | `ops/` | Docker Compose |

## 架構

```
+----------+    REST     +----------+   SSE/MCP   +------------+
| Frontend |  --------▶  | Backend  |  --------▶  | mcp-atlassi
| (Angular)|             | (Express)|             | an         |
+----------+             +----------+             +------------+
                              |
                              ▼
                         +----------+
                         | Postgres |
                         |   16     |
                         +----------+
                              |
                              ▼
                         +----------+
                         | Anthropic|
                         |  Claude  |
                         +----------+
```

- 前端透過 `/api/v1/*` REST 端點與後端互動，session 以 `sid` cookie 維持。
- 後端對每位使用者建立一條獨立的 MCP SSE 連線（LRU + idle timeout）。
- 自然語言查詢以兩階段方式進行：先回 `plan + explanationZh`，再執行（FR-022 / FR-023）。
- 批次更新以 `previewToken`（HMAC, 30 分 TTL）保護「預覽 → 套用」流程；確認字串以 `^確認更新\s*(\d+)\s*筆$` 嚴格三方比對。

## 快速開始

詳見 [`specs/001-jira-assistant/quickstart.md`](specs/001-jira-assistant/quickstart.md)。
最短路徑：

```bash
# 1. 設定環境
cp ops/.env.example ops/.env   # 填 ATLASSIAN_OAUTH_* / ANTHROPIC_API_KEY / TOKEN_ENC_KEY

# 2. 啟動依賴
docker compose -f ops/docker-compose.yml up -d postgres mcp-atlassian

# 3. 套用 migration
docker exec -i ops-postgres-1 psql -U jiracheck -d jiracheck \
  < backend/src/db/migrations/0001_init.up.sql
docker exec -i ops-postgres-1 psql -U jiracheck -d jiracheck \
  < backend/src/db/migrations/0002_features.up.sql

# 4. backend dev
cd backend && npm install && npm run dev

# 5. frontend dev
cd frontend && npm install && npm start
```

## 開發守則

- 憲法 v1.0.0 — `.specify/memory/constitution.md`
  - I. 一致性與可讀性（complexity ≤ 10、無懸置 TODO）
  - II. 測試 NON-NEGOTIABLE（coverage ≥ 80% / branches ≥ 70%）
  - III. user-facing 文字 MUST 繁中台灣用語、Loading/Empty/Error 三態、WCAG 2.1 AA
  - IV. 效能與資料新鮮度（dataFreshness envelope + freshness-bar）
- spec：`specs/001-jira-assistant/`
- 任務追蹤：`specs/001-jira-assistant/tasks.md`

## 相關文件

- [`docs/oauth-setup.md`](docs/oauth-setup.md) — Atlassian OAuth 2.0 註冊步驟（建立 token）
- [`docs/anthropic-setup.md`](docs/anthropic-setup.md) — Anthropic API key 取得與 NLQ 啟用
- [`docs/admin-setup.md`](docs/admin-setup.md) — 設定 `ADMIN_ACCOUNT_IDS` 啟用 002 排程服務功能
- [`ops/prometheus/alerts.example.yml`](ops/prometheus/alerts.example.yml) — Prometheus alert rule 樣板（SC-007）
- `specs/001-jira-assistant/contracts/api.openapi.yaml` — REST API 契約（001）
- `specs/002-scheduled-services/contracts/api.openapi.yaml` — 排程服務 REST API 契約（002）
- [`specs/002-scheduled-services/quickstart.md`](specs/002-scheduled-services/quickstart.md) — 排程服務 12 步驗證流程

## 安全

- 所有 OAuth refresh token 以 AES-256-GCM 加密儲存（金鑰由 `TOKEN_ENC_KEY` 提供）
- 寫入端點（`/auth/logout`、`/bulk/preview`、`/bulk/apply`）強制 CSRF double-submit cookie
- `/nlq/query` 6 req/min、`/bulk/apply` 4 req/min（per user）rate limit

## 授權

內部使用；尚未對外發佈。
