# Quickstart 實地驗證 Checklist（T100）

**對象**：PM / 內部試用者
**前置**：[`quickstart.md`](../quickstart.md) 步驟 1–3 完成（OAuth 憑證、`.env`、`docker compose up` 三件齊備）
**目的**：在真實 Atlassian 帳號 + 真實 Docker 環境跑一次完整 5-step user story；蒐集問題交回開發團隊。

> ⏱ 預估耗時：20–30 分鐘（首次 docker build 約 2–4 分鐘）。

---

## 0. 環境前置檢查（可由開發者代跑）

- [ ] `ops/.env` 已存在且填妥 `ATLASSIAN_OAUTH_CLIENT_ID` / `ATLASSIAN_OAUTH_CLIENT_SECRET` / `ANTHROPIC_API_KEY` / `TOKEN_ENC_KEY`
- [ ] `docker compose -f ops/docker-compose.yml -f ops/docker-compose.dev.yml --env-file ops/.env config` 無錯誤
- [ ] `docker compose -f ops/docker-compose.yml --env-file ops/.env ps` 顯示 4 個 service（`postgres` / `mcp-atlassian` / `backend` / `frontend`）`Up`
- [ ] `curl -s http://localhost:8080/api/v1/healthz` 回 `{"ok":true,"ts":"..."}`
- [ ] 瀏覽器訪問 `http://localhost:4200` 看到品牌名「Jira 小幫手」與「以 Atlassian 登入」按鈕

---

## 1. 登入流程（FR-001 + Atlassian OAuth 2.0 3LO）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 1.1 | 點「以 Atlassian 登入」 | 跳轉到 `https://auth.atlassian.com/authorize?...` 並可看到自己的 client_id 在 URL | [ ] |
| 1.2 | 同意授權 | 回到 `http://localhost:4200/`，右上角顯示自己的 Atlassian 顯示名稱與頭像 | [ ] |
| 1.3 | DB 驗證 | 下方 SQL 各回 ≥ 1 row | [ ] |

```bash
docker compose -f ops/docker-compose.yml --env-file ops/.env exec postgres \
  psql -U jiracheck -d jiracheck -c \
  "SELECT atlassian_account_id, display_name, email FROM users;"

docker compose -f ops/docker-compose.yml --env-file ops/.env exec postgres \
  psql -U jiracheck -d jiracheck -c \
  "SELECT count(*) FROM sessions WHERE expires_at > now();"

docker compose -f ops/docker-compose.yml --env-file ops/.env exec postgres \
  psql -U jiracheck -d jiracheck -c \
  "SELECT count(*) FROM user_tokens;"
```

**失敗時排查**：
- 401 `auth_oauth_state_mismatch` → 第三方 cookie / sameSite 問題，確認瀏覽器未阻擋 `localhost` cookie
- 500 `internal` → `docker compose logs backend` 看 OAuth client_id / client_secret 是否載入

---

## 2. US1 — 專案儀表板（FR-002 ~ FR-008）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 2.1 | 進入 `/dashboard` | 看到「最近 5 個專案」標題；首次登入應顯示「請使用搜尋找到您要的專案」 | [ ] |
| 2.2 | 在搜尋框輸入專案 key 前 2 字（例 `PR`） | 250ms debounce 後顯示搜尋結果卡片 | [ ] |
| 2.3 | 點任一卡片 | 進入專案詳細頁，看到 openIssueCount、sprintProgress、topAssignees Top 5 | [ ] |
| 2.4 | 回到 `/dashboard` | 該卡片在「最近 5 個」最上方 | [ ] |
| 2.5 | dataFreshness | 卡片右下角顯示「資料來源：即時 / 經由快取」與 ISO 時間戳 | [ ] |

**失敗時排查**：
- 搜尋無結果 → `docker compose logs mcp-atlassian` 看 SSE 連線狀態
- 502 `upstream_jira_unavailable` → Atlassian OAuth scope 不足，確認 `read:jira-work` 在 console 已勾選

---

## 3. US2 — 自然語言查詢（FR-021 ~ FR-029）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 3.1 | 進入 `/nlq` | 看到輸入框（max 1000 字元）、提示「您可以這樣問：…」 | [ ] |
| 3.2 | 輸入：「給我看上週狀態為 Done 的所有任務」 | 1–6 秒內顯示「我這樣理解你的問題：…時間=上週、狀態=Done」 + 結果清單 | [ ] |
| 3.3 | 輸入無關問句（例「今天天氣如何」） | 顯示 `clarification_needed` 並列出 1–3 個追問 | [ ] |
| 3.4 | 輸入 1500 字長度 | 顯示「問句長度需在 1 – 1000 字元之間」並擋住送出 | [ ] |
| 3.5 | DB 驗證 | `query_history` 每次送出 +1 row（含失敗 / clarification） | [ ] |

```bash
docker compose -f ops/docker-compose.yml --env-file ops/.env exec postgres \
  psql -U jiracheck -d jiracheck -c \
  "SELECT original_question, status, result_count, latency_ms
     FROM query_history ORDER BY created_at DESC LIMIT 5;"
```

**失敗時排查**：
- 429 `rate_limit_exceeded` → 預設 6 req/min/user，等 1 分鐘
- 502 `upstream_llm_unavailable` → `ANTHROPIC_API_KEY` 額度或無效；確認 `docker compose logs backend | grep anthropic`
- 結果為空但無錯 → JQL 翻譯不到任何 issue，將實際問句 + plan JSON 回報

---

## 4. US3 — 人員工作狀況（FR-030 ~ FR-038）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 4.1 | 進入 `/people` | 看到搜尋框（最少 2 字）+ 最近查詢 5 人 | [ ] |
| 4.2 | 搜尋「ben」（或任一同事名） | < 1 秒回結果，顯示頭像 + displayName | [ ] |
| 4.3 | 點任一人 | 預設顯示其「目前未完成」清單，依到期日 ASC 排序、NULL 在最後 | [ ] |
| 4.4 | 切時間區間「上個月」 | 出現 4 張統計卡片：完成數、Story Points、Actual Story Points、估準度（比值，3 位小數） | [ ] |
| 4.5 | byProject 表格 | 顯示每個專案的完成數 / SP / aSP，依完成數 DESC | [ ] |

**失敗時排查**：
- 估準度為 `—` / `null` → aSP 為 0；正常行為（FR-032 註）
- partialPermission flag → 某些跨專案資料因權限被過濾，顯示提示橫幅；正常行為（FR-036）

---

## 5. US4 — 批次更新預覽（FR-040 ~ FR-048；**僅預覽，不套用**）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 5.1 | 進入 `/bulk` | 看到「選擇專案 → 篩選條件 → 目標欄位」步驟條 | [ ] |
| 5.2 | 選一個你有編輯權的專案 + 設 `Status=To Do` | 篩選器即時更新 | [ ] |
| 5.3 | 目標欄位選「assignee」+ 預覽 | 顯示「影響 N 筆」、表格列出 issueKey / summary / currentValue / proposedValue / editableByUser | [ ] |
| 5.4 | 若超過 200 筆 | 顯示 400 並提示「請再限縮條件，目前命中 X 筆超過 200 上限」 | [ ] |
| 5.5 | 任一 row 「editableByUser=false」 | 該 row 標示「無編輯權限」（FR-042） | [ ] |
| 5.6 | **不要按下「確認套用」** | quickstart 僅驗證預覽 | [ ] |

**失敗時排查**：
- previewToken 顯示在 dev tools network → 正常（HMAC 簽名；30 分鐘 TTL）
- CSRF 403 → `csrf` cookie 未帶；hard refresh

---

## 6. 觀測性 / 度量驗證（T092）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 6.1 | `curl -s http://localhost:8080/api/v1/metrics` | 回 Prometheus 文字格式，含 `http_request_duration_seconds_bucket` / `jira_mcp_call_duration_seconds_count` / `nlq_query_duration_seconds_count` | [ ] |
| 6.2 | 跑完 US1–US4 後再 curl 一次 | counter / histogram 數值有增加 | [ ] |
| 6.3 | 看 `bulk_operation_total{status="..."}` | 因 quickstart 只跑預覽不套用，應為 0 | [ ] |

> ⚠️ 若你設了 `METRICS_TOKEN=xxx` 環境變數，curl 須帶 `-H "Authorization: Bearer xxx"`。

---

## 7. 跑測試（可選）

| # | 動作 | 預期 | ✅ |
|---|------|------|---|
| 7.1 | `docker compose run --rm backend npm test` | 全綠（≥ 200 tests） | [ ] |
| 7.2 | `docker compose run --rm backend npm run test:coverage` | statements ≥ 80% / branches ≥ 70% / functions ≥ 80% / lines ≥ 80% | [ ] |
| 7.3 | `cd frontend && npm test` | Karma 全綠 | [ ] |

---

## 8. 停止與清理

```bash
# 保留資料
docker compose -f ops/docker-compose.yml --env-file ops/.env down

# 連同 volume 全清（DB 重置；下次重新登入）
docker compose -f ops/docker-compose.yml --env-file ops/.env down -v
```

---

## 9. 回報問題

請填以下格式給開發團隊：

```
[ ] 階段：步驟 X.Y
[ ] 預期：…
[ ] 實際：…
[ ] 截圖：…
[ ] backend log：docker compose logs --tail 100 backend > backend.log
```

---

## 附錄 A：靜態驗證結果（由開發團隊在發佈本 checklist 前完成）

- [x] `ops/docker-compose.yml` + `ops/docker-compose.dev.yml` `config` 解析無錯
- [x] `backend/Dockerfile` 含 `dev` / `build` / `prod` 3 stage
- [x] `frontend/Dockerfile` 含 `dev` / `build` / `prod` 3 stage
- [x] `ops/.env.example` keys 與 `docker-compose.yml` `environment:` 區段一致
- [x] migration 0001/0002 提供 `users` / `sessions` / `user_tokens` / `query_history` / `bulk_update_operations` / `recent_project_access` 欄位
- [x] OpenAPI 包含 14 endpoints（auth / me / projects×3 / nlq / people×3 / bulk×4）
- [x] frontend `app.routes.ts` 含 `/dashboard` `/nlq` `/people` `/bulk` `/bulk/history`
- [x] backend `/healthz` + `/metrics` route 註冊
