# Quickstart: Jira 小幫手（001-jira-assistant）

**對象**: 第一次拉到本 repo 的開發者；目標 30 分鐘內把整套服務跑在本機並完成一次「以使用者身份登入 → 開啟儀表板 → 跑一次自然語言查詢 → 預覽一次（不套用）批次更新」。

> 本文件描述「為何 / 怎麼起 / 如何驗證」，不涵蓋設計細節（請見 `plan.md` 與 `research.md`）。

---

## 0. 前置需求

| 依賴 | 版本 | 說明 |
|------|------|------|
| Docker | 24+ | 必須 |
| Docker Compose | v2 | 必須 |
| Node.js | 20 LTS | 僅在本機跑 unit test / 開發 hot reload 時需要 |
| Atlassian 帳號 | — | 至少對一個 Jira Cloud 站台有讀寫權 |
| Anthropic API Key | — | 用於 US2 自然語言查詢 |

---

## 1. 取得 Atlassian OAuth 2.0 憑證

1. 進入 [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/) 建立一個 **OAuth 2.0 (3LO) integration**。
2. 加入 scopes（v1 所需最小集合）：
   - `read:jira-work`
   - `read:jira-user`
   - `write:jira-work`（批次更新需要）
   - `offline_access`（取得 refresh token）
3. 設定 callback URL：`http://localhost:8080/api/v1/auth/callback`（本機開發；prod 替換為對外網域）。
4. 將取得的 client id / secret 填入 `ops/.env`（見步驟 2）。

---

## 2. 環境變數

複製範例：

```bash
cp ops/.env.example ops/.env
```

依需求修改：

```bash
# Atlassian OAuth
ATLASSIAN_OAUTH_CLIENT_ID=...
ATLASSIAN_OAUTH_CLIENT_SECRET=...
ATLASSIAN_OAUTH_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback

# MCP
MCP_ATLASSIAN_URL=http://mcp-atlassian:9000/sse

# LLM
ANTHROPIC_API_KEY=sk-ant-...

# PostgreSQL
POSTGRES_PASSWORD=devpass
DATABASE_URL=postgres://jiracheck:devpass@postgres:5432/jiracheck

# Token 加密金鑰（32 bytes base64；切勿在 prod 重用）
TOKEN_ENC_KEY=$(openssl rand -base64 32)

LOG_LEVEL=info
```

> `TOKEN_ENC_KEY` 變更會使所有舊的 refresh token 解不開，等同強制所有使用者重新登入。請僅在意外洩漏時更換。

---

## 3. 啟動全部服務

```bash
docker compose -f ops/docker-compose.yml -f ops/docker-compose.dev.yml up --build
```

啟動完成後（首次約 2–4 分鐘），應有 4 個 service running：

| Service | 內部 port | 對外 port |
|---------|-----------|-----------|
| `frontend` (Angular) | 4200 | 4200 |
| `backend` (Express) | 8080 | 8080 |
| `postgres` | 5432 | — |
| `mcp-atlassian` | 9000 | — |

打開瀏覽器 `http://localhost:4200`。

---

## 4. 驗證流程：跑一次完整 user story

### 步驟 1 — 登入

1. 進入 `http://localhost:4200`，按「以 Atlassian 登入」。
2. 完成 OAuth 授權後會被導回首頁。
3. **預期**：右上角顯示你的顯示名稱與頭像；DB 內 `users` / `user_tokens` / `sessions` 各新增一筆。

```bash
docker compose exec postgres psql -U jiracheck -c \
  "SELECT atlassian_account_id, display_name FROM users;"
```

### 步驟 2 — US1 專案儀表板

1. 首次登入時「最近 5 個」會是空的，會顯示「請使用搜尋找到您要的專案」。
2. 在搜尋框輸入 1–2 個字（例如 `pay`），按 Enter。
3. 點任一張卡片進入專案頁。
4. 回到首頁，**預期**該卡片現在出現在「最近 5 個」最上方。

### 步驟 3 — US2 自然語言查詢

1. 切換到「自然語言查詢」頁面。
2. 輸入：「給我看上週狀態為 Done 的所有任務」。
3. **預期**：
   - 系統先顯示「我這樣理解你的問題」：時間 = 上週、狀態 = Done。
   - 1–6 秒後顯示結果清單。
   - DB `query_history` 新增一筆。

```bash
docker compose exec postgres psql -U jiracheck -c \
  "SELECT original_question, status, result_count, latency_ms FROM query_history ORDER BY created_at DESC LIMIT 3;"
```

### 步驟 4 — US3 人員工作狀況

1. 切換到「人員」頁面，選擇一位常用同事。
2. 預設顯示其「目前未完成」清單，含跨專案標示。
3. 將時間區間設為「上個月」，**預期**統計卡片出現：完成數、Story Points、Actual Story Points、估準度（比值）。

### 步驟 5 — US4 批次更新（僅預覽，不套用）

1. 切換到「批次更新」頁面，選擇一個你有編輯權的專案。
2. 設定條件：`Status = To Do`、`Sprint = <當前 sprint>`。
3. 按「預覽」。
4. **預期**：清單顯示影響筆數，受限於 200 筆上限；若有任一 issue 顯示「無編輯權限」即代表 FR-042 工作正常。
5. **不要按下套用**（quickstart 僅驗證預覽）。

---

## 5. 跑測試

```bash
# Backend 單元 + 整合（會自動起 Testcontainers 的 PG + mock mcp-atlassian）
docker compose run --rm backend npm test

# Frontend 單元
docker compose run --rm frontend npm test

# E2E（會起整套後再跑 Playwright）
docker compose -f ops/docker-compose.yml -f ops/docker-compose.e2e.yml up --abort-on-container-exit
```

CI 失敗時的常見原因：
- `TOKEN_ENC_KEY` 未設定 → backend 啟動失敗。
- Anthropic key 額度耗盡 → US2 整合測試會 fail，請改用 `ANTHROPIC_API_KEY=fake-e2e`（CI 預設走 mock）。

---

## 6. 停止與清理

```bash
docker compose -f ops/docker-compose.yml down            # 保留資料
docker compose -f ops/docker-compose.yml down -v         # 連同 volume 一起刪除（DB 重置）
```

---

## 7. 進入「實作」前的 checklist

- [ ] OAuth callback 走通且 DB 寫得進去
- [ ] `/projects/recent` 在「最近存取」有資料後回得正確
- [ ] `/nlq/query` 對 3 句不同類型問句皆能回 `ok` 或 `clarification_needed`
- [ ] `/bulk/preview` 對 200+ 筆條件回 400 並提示分批
- [ ] axe-core 對首頁掃描 0 critical

完成上述即可進入 `/speckit.tasks`。
