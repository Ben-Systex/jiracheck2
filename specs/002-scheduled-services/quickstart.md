# Quickstart: 定時排程服務（002-scheduled-services）

**對象**：第一次在本機跑此 feature 的開發者；目標 15 分鐘內驗證一筆排程能準時觸發、把結果寫進 `service_logs`、並可由前端「服務執行紀錄」頁查看。

> 本文件假設你已完成 001-jira-assistant 的 quickstart（OAuth + Docker compose + DB 跑起來）。若還沒，請先看 [001-jira-assistant/quickstart.md](../001-jira-assistant/quickstart.md)。

---

## 0. 前置需求

| 依賴 | 來源 |
|------|------|
| 完成 001-jira-assistant quickstart 全部 | OAuth、`.env`、4 services running |
| 已知一個有效的 Atlassian accountId（你的） | 登入後可在 `/api/v1/me` 取得 |
| Docker compose 服務 ≥ Backend / Postgres 兩個 | 沿用 |

---

## 1. 設定管理者 accountId

把你（或運維帳號）的 accountId 加到 `ops/.env`：

```bash
# 逗號分隔；多個運維帳號可一起加
ADMIN_ACCOUNT_IDS=5b1afecbf41e3f25a8d35577

# v1 預設伺服器時區（不需動）
SERVER_TZ=Asia/Taipei

# CHKISSUE 連續 N 次無任務的警示門檻（預設 4）
CHKISSUE_EMPTY_STREAK_THRESHOLD=4
```

重啟 backend：

```bash
docker compose -f ops/docker-compose.yml --env-file ops/.env restart backend
```

驗證自己是 admin：

```bash
curl -s http://localhost:8080/api/v1/me -b /tmp/sid-cookie.txt | jq .isAdmin
# 預期 → true
```

> 若 `isAdmin = false`：你填的 accountId 與 `/me.accountId` 不一致，請以後者為準重新填 env。

---

## 2. 跑 migration

```bash
docker compose -f ops/docker-compose.yml --env-file ops/.env exec backend \
  npm run db:migrate
```

預期看到 `0003_scheduled_services` migration 套用成功。驗證表已建：

```bash
docker compose -f ops/docker-compose.yml --env-file ops/.env exec postgres \
  psql -U jiracheck -d jiracheck -c \
  "\dt schedule_configs service_logs project_check_lists project_issue_snapshots"
```

預期 4 個 table 都出現。

---

## 3. 維護「專案檢查清單」（CHKPROJ 輸入）

進入 `http://localhost:4200/project-check-lists`（須為管理者）：

1. 點「新增專案」→ 填一個你有讀權的 projectKey（例 `PROJ`）
2. **預期**：列表新增一筆；CHKPROJ 下次跑會掃到此專案
3. 後端驗證：

```bash
curl -s http://localhost:8080/api/v1/project-check-lists -b /tmp/sid-cookie.txt | jq
```

---

## 4. 建立一筆排程（CHKPROJ 每分鐘跑一次）

> ⚠️ 每分鐘觸發僅供驗證；正式環境請改回每日。

進入 `http://localhost:4200/schedules` → 點「新增排程」：

| 欄位 | 值 |
|------|------|
| 服務 ID | CHKPROJ |
| 頻率類型 | cron |
| cron 表達式 | `* * * * *`（每分鐘） |
| 啟用 | ✅ |

按儲存。**預期**：
- 列表新增一筆 enabled 排程
- 「下次預定時間」顯示 1 分鐘內的下一個整分
- 後端 log（`docker compose logs backend`）出現 `[scheduler] registered schedule {id} cron=* * * * *`

---

## 5. 等待自動觸發 + 驗證 ServiceLog

等 1–2 分鐘，進入 `http://localhost:4200/service-logs`：

預期：
- 列表新增一筆 CHKPROJ 紀錄、result = `success` 或 `partial_failure`
- 「說明」中包含「3 個專案、其中 1 個延遲」或類似總結
- 「備註」中可看到 `rule_version: rule-v1` 與延遲明細

後端驗證：

```bash
curl -s http://localhost:8080/api/v1/service-logs -b /tmp/sid-cookie.txt | jq '.items[0]'

docker compose -f ops/docker-compose.yml --env-file ops/.env exec postgres \
  psql -U jiracheck -d jiracheck -c \
  "SELECT service_id, result, summary, rule_version, started_at, ended_at
     FROM service_logs ORDER BY started_at DESC LIMIT 5;"
```

---

## 6. 手動觸發（FR-007）

回到排程列表，對 CHKPROJ 排程點「立即執行」：

預期：
- 回 202 + `serviceLogId`
- ServiceLog 列表新增一筆 `triggered_by = 'manual'`、`triggered_by_user_id = <你>`

---

## 7. 觀察互斥（FR-006）

立刻再點一次「立即執行」（前一次還沒跑完）：

預期：
- 新增一筆 `result = 'skipped'`、summary = `上一次尚在執行，本次略過`
- 對應前端 toast 警示

---

## 8. CHKISSUE 驗證（US4）

新增第二筆排程：

| 欄位 | 值 |
|------|------|
| 服務 ID | CHKISSUE |
| 頻率類型 | cron |
| cron 表達式 | `* * * * *` |
| 啟用 | ✅ |

等 1 分鐘。預期 ServiceLog 新增一筆 CHKISSUE：
- summary 含「總專案數 N、有任務 X、無任務 Y」
- 詳細頁 notes 含 `with_issues[]` / `without_issues[]` 兩組 projectKey
- DB `project_issue_snapshots` 對每個專案各新增一列

---

## 9. ServiceLog 過濾 + 匯出（FR-011 + FR-013）

於 `/service-logs` 頁面：
- 套用「服務 ID = CHKPROJ、結果 = 失敗、最近 1 小時」過濾
  - **預期**：表格顯示符合條件的子集；空集合時顯示 empty state
- 按「匯出 CSV」
  - **預期**：下載 `service-logs-{ts}.csv`，Excel 可直接打開無亂碼（UTF-8 BOM）
  - 欄位順序：`started_at, ended_at, service_id, triggered_by, result, summary, notes`

---

## 10. 觀測性 metrics 驗證

```bash
# 若 METRICS_TOKEN 已設，需帶 Bearer
curl -s http://localhost:8080/api/v1/metrics | grep -E "scheduled_service|schedule_configs"

# 或：
curl -s -H "Authorization: Bearer $METRICS_TOKEN" \
  http://localhost:8080/api/v1/metrics | grep -E "scheduled_service|schedule_configs"
```

預期出現：
- `scheduled_service_total{service_id="CHKPROJ",result="success"} N`
- `scheduled_service_total{service_id="CHKISSUE",result="success"} N`
- `scheduled_service_duration_seconds_count{service_id="CHKPROJ"} N`
- `scheduled_service_duration_seconds_bucket{service_id="CHKPROJ",le="..."} N`
- `schedule_configs_enabled_count N`
- `scheduled_service_active_count`（執行中為 ≥ 1，閒置為 0）

> Prometheus alert rule 樣板見 [`ops/prometheus/alerts.example.yml`](../../ops/prometheus/alerts.example.yml)（含「連續 3 次失敗」「6h 內無觸發」「p95 延遲 > 5 分鐘」等）。

---

## 11. 收尾

把驗證用的「每分鐘」排程改回正常頻率（每日 09:00）或刪除：

```bash
# 或在 UI 上刪
curl -X DELETE http://localhost:8080/api/v1/schedules/{id} \
  -b /tmp/sid-cookie.txt -H "X-CSRF-Token: <csrf>"
```

---

## 12. 進入「實作」前的 checklist

- [ ] migration `0003_scheduled_services` 套用成功
- [ ] `/me.isAdmin` 對白名單帳號回 `true`、非白名單回 `false`
- [ ] 一筆 cron 排程能在 1 分鐘誤差內觸發
- [ ] ServiceLog 對 `success / partial_failure / skipped / missed` 全部至少各出現一次
- [ ] CHKPROJ 對「不存在的 projectKey」回 `partial_failure` 並把錯誤記在 notes
- [ ] CHKISSUE 對「無 issue 專案」連續 4 次標警示
- [ ] `/metrics` 含 `scheduled_service_*` 系列指標
- [ ] cleanup job 對 90 天前的 service_logs 能正確刪除（測試用：手動把 started_at 改成 100 天前 + 觸發 cleanup）
- [ ] 非管理者訪問 `/schedules` → 後端 403、前端 toast + 重導 `/dashboard`
- [ ] axe-core 對 3 個新頁面掃描 0 critical

完成上述即可 `/speckit.tasks` 進入 Phase 2 任務拆解。
