# Phase 1 Data Model: Jira 小幫手

**Feature**: 001-jira-assistant
**Date**: 2026-05-22
**範圍**: 由 spec.md「Key Entities」推出，加上本系統需要的內部表（OAuth session、token、稽核）。

> 命名規則：表名 snake_case 複數；欄位 snake_case；時間欄位以 `_at` 結尾，型別 `timestamptz`，UTC 儲存。所有表皆有 `id`（UUID v7）/ `created_at` / `updated_at`。

---

## 來源於 Jira（不在本系統 DB 中持久化）

下列實體屬於「使用時即透過 mcp-atlassian 拉取」，本系統僅在記憶體 / 短期 cache 中保留：

- **Project** — Jira 專案：`key`、`name`、`avatarUrl`、`lead`（accountId / displayName）。
- **Issue** — Jira issue：`key`、`fields.summary`、`fields.status`、`fields.assignee`、`fields.priority`、`fields.labels`、`fields.duedate`、`fields.customfield_story_points`、`fields.customfield_actual_story_points`、`fields.sprint`、`fields.project.key`。
- **User** — Jira 帳號：`accountId`、`displayName`、`emailAddress`、`avatarUrls`。

> 「Actual Story Points」與 Sprint 為自訂欄位；在 backend 將 customField ID 抽象化為符號名稱，由設定檔注入（環境變數 `JIRA_FIELD_STORY_POINTS`、`JIRA_FIELD_ACTUAL_STORY_POINTS`、`JIRA_FIELD_SPRINT`）。

---

## 本系統 PostgreSQL Schema（v1）

### `users`

代表「曾經登入過本工具」的 Jira 使用者。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | uuid | PK | 內部 ID |
| atlassian_account_id | text | UNIQUE NOT NULL | Atlassian accountId |
| display_name | text | NOT NULL | 顯示名稱（最近一次登入時的） |
| email | text | NULL | 可能 PII，依使用者於 Atlassian 的可見性設定 |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL |

索引：`UNIQUE(atlassian_account_id)`。

### `user_tokens`

加密儲存使用者 OAuth refresh token（access token 只在記憶體保留）。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| user_id | uuid | PK / FK → users.id | 一對一 |
| encrypted_refresh_token | bytea | NOT NULL | AES-256-GCM ciphertext |
| token_nonce | bytea | NOT NULL | 12-byte nonce |
| token_tag | bytea | NOT NULL | 16-byte auth tag |
| scope | text | NOT NULL | 授權範圍字串 |
| issued_at | timestamptz | NOT NULL |
| expires_at | timestamptz | NULL | refresh token 失效時間（若已知） |
| updated_at | timestamptz | NOT NULL |

### `sessions`

server-side session（對應前端 `sid` cookie）。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| sid | text | PK | session id（隨機 256-bit） |
| user_id | uuid | FK → users.id NOT NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| expires_at | timestamptz | NOT NULL | 滑動式 7 天，每次活動延期 |
| last_seen_at | timestamptz | NOT NULL |
| user_agent | text | NULL |
| ip_inet | inet | NULL |

索引：`expires_at`（清掃用）。

### `recent_project_access`

drive 首頁「最近 5 個」（US1）。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| user_id | uuid | FK → users.id |
| project_key | text | NOT NULL | Jira project key |
| last_accessed_at | timestamptz | NOT NULL |
| access_count | int | NOT NULL DEFAULT 0 |
| PRIMARY KEY (user_id, project_key) |

索引：`(user_id, last_accessed_at DESC)`。

**狀態轉移**：使用者點擊任一專案卡片時 upsert：`last_accessed_at = now()`, `access_count += 1`。

### `query_history`

US2 自然語言查詢的歷史紀錄（保留 90 天）。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | uuid | PK |
| user_id | uuid | FK → users.id |
| original_question | text | NOT NULL | 使用者原始問句 |
| query_plan | jsonb | NOT NULL | LLM 產出的結構化 QueryPlan |
| explanation_zh | text | NOT NULL | 給使用者看的「我這樣理解」摘要 |
| result_count | int | NOT NULL | 主結果筆數 |
| latency_ms | int | NOT NULL | 端對端延遲 |
| status | text | NOT NULL | `ok` / `partial_permission` / `clarification_needed` / `error` |
| created_at | timestamptz | NOT NULL DEFAULT now() |

索引：`(user_id, created_at DESC)`、`GIN (query_plan jsonb_path_ops)`。

保留策略：每日由排程刪除 `created_at < now() - interval '90 days'` 的紀錄。

### `bulk_update_operations`

US4 批次更新的審計紀錄；保留 ≥ 1 年。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | uuid | PK |
| user_id | uuid | FK → users.id |
| project_key | text | NOT NULL |
| filter_dsl | jsonb | NOT NULL | 預覽當下的條件（前端結構化送來） |
| target_field | text | NOT NULL | `assignee` / `due_date` / `label` / `priority` / `sprint` |
| target_value_json | jsonb | NOT NULL | 新值（多型，按欄位定義） |
| total_count | int | NOT NULL | 預覽當下命中筆數 |
| confirmed_at | timestamptz | NOT NULL | 使用者送出確認的時間 |
| completed_at | timestamptz | NULL | 全部執行完成的時間 |
| status | text | NOT NULL | `running` / `success` / `partial_failure` / `failure` / `cancelled` |
| success_count | int | NOT NULL DEFAULT 0 |
| failure_count | int | NOT NULL DEFAULT 0 |

**狀態轉移**：

```
[building] → [previewed] → [confirmed] → [running] → [success | partial_failure | failure | cancelled]
```

> `building` / `previewed` 階段只存在前端與 backend 記憶體，不入庫；入庫時點為「使用者於確認對話框輸入受影響筆數並按下確認」。

### `bulk_update_items`

`bulk_update_operations` 的每筆 issue 結果。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| operation_id | uuid | FK → bulk_update_operations.id |
| issue_key | text | NOT NULL |
| previous_value_json | jsonb | NULL | 變更前的值（用於對賬 / 復原計畫） |
| new_value_json | jsonb | NOT NULL |
| result | text | NOT NULL | `success` / `permission_denied` / `version_conflict` / `api_error` |
| error_message | text | NULL |
| applied_at | timestamptz | NULL |
| PRIMARY KEY (operation_id, issue_key) |

索引：`(operation_id, result)`。

---

## 驗證規則（applies in backend `zod` schemas）

- `bulk_update_operations.total_count` ≤ 200（FR-046）。
- `target_field` 必在白名單：`{assignee, due_date, label, priority, sprint}`（FR-047）。
- `query_history.original_question` 長度 ≤ 1000 字元。
- `recent_project_access` 一個 `user_id` 最多保留 100 筆（超過 LRU 清除最舊），首頁僅取前 5 筆。

---

## 資料保留 / 清理

| 表 | 保留期 | 清理方式 |
|----|--------|----------|
| `query_history` | 90 天 | 每日 03:00 排程 DELETE |
| `bulk_update_operations` + `bulk_update_items` | 12 個月 | 每日 03:30 排程移到 `archive` schema；`GET /bulk/operations` 列表僅查詢 `bulk_update_operations`（即近 12 個月內可見），歷史快照不需呈現於 UI |
| `sessions` | 過期即刪 | 每小時清掃 `expires_at < now()` |
| `recent_project_access` | 每使用者保留 100 筆 | upsert 時觸發 |
| `user_tokens` | 隨 `users` | 使用者主動登出時或一年未活動時，呼叫 Atlassian revoke 並刪除 |

---

## ER 概念圖（文字版）

```
users (1) ── (1) user_tokens
users (1) ── (N) sessions
users (1) ── (N) recent_project_access
users (1) ── (N) query_history
users (1) ── (N) bulk_update_operations (1) ── (N) bulk_update_items
```

---

## 對應 spec 的「Key Entities」

| spec Entity | 落實在 |
|-------------|--------|
| Project | 來自 Jira（不持久化）+ `recent_project_access` 記錄訪問 |
| Issue | 來自 Jira（不持久化） |
| User | 來自 Jira + 本地 `users` 表（最後一次登入快照） |
| QueryHistory | `query_history` |
| BulkUpdateOperation | `bulk_update_operations` + `bulk_update_items` |
| RecentAccessLog | `recent_project_access` |
