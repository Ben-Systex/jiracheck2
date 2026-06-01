# Data Model: 定時排程服務與服務執行紀錄

**Feature**: 002-scheduled-services
**Phase**: 1
**Date**: 2026-05-30
**Migration**: `backend/src/db/migrations/0003_scheduled_services.up.sql`

---

## 概覽

新增 4 個表 + 1 個既有表的擴充：

| 表 | 用途 | 來源 spec 實體 |
|----|------|---------------|
| `schedule_configs` | 一筆排程的配置（服務 ID、頻率、啟用狀態、下次預定時間） | ScheduleConfig |
| `service_logs` | 每次服務執行的紀錄（保留 90 天） | ServiceLog |
| `project_check_lists` | CHKPROJ 要檢查的 projectKey 清單 | ProjectCheckList |
| `project_issue_snapshots` | CHKISSUE 每次的「有任務 / 無任務」快照（保留 90 天） | ProjectIssueSnapshot |

**不**新增 `users.role` 欄位（依 [research R-002](./research.md#r-002管理者角色判定fr-015)，v1 走 `ADMIN_ACCOUNT_IDS` env 白名單）。

---

## 1. `schedule_configs`

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| `id` | `uuid` | PK, DEFAULT `gen_random_uuid()` | 排程 ID |
| `service_id` | `text` | NOT NULL, CHECK `service_id IN ('CHKPROJ','CHKISSUE')` | v1 固定服務集合 |
| `frequency_type` | `text` | NOT NULL, CHECK `IN ('daily','weekly','monthly','cron')` | 頻率類型 |
| `frequency_value` | `text` | NOT NULL | daily/weekly/monthly 為 `HH:MM[:dow|:dom]`；cron 為原始 expression |
| `enabled` | `boolean` | NOT NULL, DEFAULT `true` | 啟用狀態（FR-001） |
| `next_run_at` | `timestamptz` | — | 下次預定時間（UTC；每次儲存 / 觸發後重算） |
| `last_run_at` | `timestamptz` | — | 上次實際觸發時間 |
| `created_by` | `uuid` | NOT NULL, FK → `users(id)` | 建立者 |
| `updated_by` | `uuid` | NOT NULL, FK → `users(id)` | 最後更新者（spec FR-002 + Edge case「多人編輯」） |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |

**索引**：
- `idx_schedule_configs_enabled_next ON (enabled, next_run_at)` — scheduler 啟動掃 due 排程用
- `idx_schedule_configs_service ON (service_id)` — 篩選用

**驗證規則**（service 層而非 DB 層）：
- `frequency_value` 必須能被 `cron-parser` 解析（research R-006）。
- 同 `service_id + frequency_value + frequency_type` 重複建立 → 警示但允許（業務考量：管理者可能想跑多時段相同檢查）。

---

## 2. `service_logs`

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| `id` | `uuid` | PK, DEFAULT `gen_random_uuid()` | |
| `schedule_id` | `uuid` | FK → `schedule_configs(id)` ON DELETE SET NULL | 由排程觸發時帶入；手動觸發 / cleanup 為 NULL |
| `service_id` | `text` | NOT NULL | `CHKPROJ` / `CHKISSUE` / `SYSTEM_CLEANUP`（後者由 cleanup job 寫入，R-012） |
| `triggered_by` | `text` | NOT NULL, CHECK `IN ('schedule','manual','system')` | 觸發來源 |
| `triggered_by_user_id` | `uuid` | FK → `users(id)` | 手動觸發時的使用者；schedule / system 為 NULL |
| `started_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |
| `ended_at` | `timestamptz` | — | 執行完成後寫入；NULL 表示仍在跑 |
| `result` | `text` | NOT NULL, CHECK `IN ('success','partial_failure','failure','skipped','missed')` | FR-010 + missed（R-004） |
| `summary` | `text` | NOT NULL | 人類可讀中文總結（FR-010） |
| `notes` | `jsonb` | NOT NULL, DEFAULT `'{}'::jsonb` | 結構化備註（rule_version, retry_count, errors[], project_count, delayed[] 等）|
| `rule_version` | `text` | — | CHKPROJ 才填，例如 `rule-v1`（R-008） |

**索引**：
- `idx_service_logs_started ON (started_at DESC)` — 列表預設排序
- `idx_service_logs_service_started ON (service_id, started_at DESC)` — 過濾用（SC-003 < 2s）
- `idx_service_logs_result ON (result)` — 過濾用
- `idx_service_logs_schedule ON (schedule_id, started_at DESC)` — 看單一排程的歷史

**生命週期**：
- INSERT 在執行開始即寫入（含 `ended_at = NULL`、`result = 'failure'` 預設）
- 結束時 UPDATE `ended_at` / `result` / `summary` / `notes`
- 90 天後由 cleanup job DELETE（FR-014 + R-012）

---

## 3. `project_check_lists`

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| `id` | `uuid` | PK, DEFAULT `gen_random_uuid()` | |
| `project_key` | `text` | NOT NULL | Jira project key |
| `added_by` | `uuid` | NOT NULL, FK → `users(id)` | 加入者 |
| `added_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |
| `note` | `text` | — | 自由備註（為何要檢查此專案） |

**約束**：
- `UNIQUE (project_key)` — 同一專案不可重複加入

**索引**：自動由 unique 約束建立。

---

## 4. `project_issue_snapshots`

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| `id` | `uuid` | PK, DEFAULT `gen_random_uuid()` | |
| `service_log_id` | `uuid` | NOT NULL, FK → `service_logs(id)` ON DELETE CASCADE | 隸屬於某次 CHKISSUE 執行 |
| `project_key` | `text` | NOT NULL | |
| `has_issues` | `boolean` | NOT NULL | `true` = 有任務、`false` = 無任務 |
| `issue_count` | `integer` | NOT NULL, DEFAULT 0 | 實際 issue 數（FR-030 採 > 0 / = 0 判斷） |
| `snapshot_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | |

**索引**：
- `idx_pis_project_snapshot ON (project_key, snapshot_at DESC)` — 「連續 N 次無任務」判斷（FR-032 + R-009）
- `idx_pis_service_log ON (service_log_id)` — 看某次 CHKISSUE 完整快照

**生命週期**：90 天後由 cleanup job DELETE（R-012）。

---

## 實體關係圖

```
users (既有)
   │
   │ created_by / updated_by
   ▼
schedule_configs ────┐
                     │ schedule_id
                     ▼
                  service_logs ──┐
                                 │ service_log_id
                                 ▼
                          project_issue_snapshots

project_check_lists ─────► CHKPROJ 服務讀取（無外鍵；專案 key 純文字）
```

---

## State Machine

### `service_logs.result` 轉換

```
                      ┌─→ success
                      │
running (ended_at NULL)→ partial_failure
                      │
                      ├─→ failure
                      │
                      ├─→ skipped     (上一次仍在執行 / 清單為空 / 系統未有可見專案)
                      │
                      └─→ missed      (系統重啟後 ≤ 24h 內補登；R-004)
```

- **running → success**：所有子步驟成功
- **running → partial_failure**：≥ 1 個子步驟失敗，且 ≥ 1 個成功
- **running → failure**：全部子步驟失敗 / 系統異常
- **running → skipped**：advisory lock 取不到（FR-006）或清單為空（FR-023 / FR-030）
- **(system startup) → missed**：scheduler 啟動時偵測到上次預定時間已過 ≤ 24h 但無對應 service_log

### `schedule_configs.enabled` 轉換

```
true  ──(管理者切換)──→ false  (FR-001 + acceptance #4：保留歷史不刪)
false ──(管理者切換)──→ true   (scheduler 重新註冊 cron job)
true  ──(管理者刪除)──→ DELETE (CASCADE：service_logs.schedule_id SET NULL)
```

---

## Validation Rules（service 層）

| 來源 FR | 規則 | 實作位置 |
|---------|------|----------|
| FR-002 | 必填欄位完整 | `routes/schedules.ts` zod schema |
| FR-003 | `frequency_value` 可被 cron-parser 解析 | `lib/cron-utils.ts::validateFrequency` |
| FR-004 | 儲存後立即重算 `next_run_at` | `repositories/schedule-configs.ts::upsert` |
| FR-006 | 同服務 ID 不可併發 | `jobs/service-runner.ts` advisory lock |
| FR-014 | service_logs 保留 90 天 | `jobs/cleanup.ts` （沿用 001） |
| FR-015 | ServiceLogs 僅管理者可見 | `middleware/require-admin.ts` |

---

## 對 001 既有表的關係

| 既有表 | 關係 | 是否變更 |
|--------|------|---------|
| `users` | 1:N → `schedule_configs.created_by` / `updated_by`、`service_logs.triggered_by_user_id`、`project_check_lists.added_by` | **不變更**（v1 管理者走 env 白名單） |
| `sessions` | 用 sessionMiddleware 拿 `userId` | **不變更** |
| `query_history` | 無關 | — |
| `bulk_update_operations` | 無關 | — |
| `recent_project_access` | 無關 | — |
