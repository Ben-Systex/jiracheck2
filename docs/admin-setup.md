# 管理者設定指引（feature 002-scheduled-services）

本文件說明如何為 Jira 小幫手注入「管理者帳號」清單，使其可存取以下管理者專用功能：

- `/schedules` — 定時服務設定
- `/service-logs` — 服務執行紀錄與匯出
- `/project-check-lists` — CHKPROJ 檢查清單維護

v1 採 **環境變數白名單**（`ADMIN_ACCOUNT_IDS`）；v1.1+ 會升級為 `users.role` 表級角色管理。

---

## 1. 取得自己的 accountId

登入後（任何角色皆可）呼叫：

```bash
curl -s http://localhost:8080/api/v1/me \
  -H "Cookie: sid=<your-sid>" | jq '{ accountId, displayName, email, isAdmin }'
```

預期輸出：

```json
{
  "accountId": "5b1afecbf41e3f25a8d35577",
  "displayName": "Ben",
  "email": "ben@example.com",
  "isAdmin": false
}
```

> 也可從瀏覽器開發者工具 → Application → Cookies 取 `sid` 後執行。

---

## 2. 設定 `ADMIN_ACCOUNT_IDS`

編輯 `ops/.env`：

```bash
# 逗號分隔；多個運維帳號可一起加
ADMIN_ACCOUNT_IDS=5b1afecbf41e3f25a8d35577,7c9deeabcd1234567890fghi
```

重啟 backend：

```bash
docker compose -f ops/docker-compose.yml --env-file ops/.env restart backend
```

驗證：

```bash
curl -s http://localhost:8080/api/v1/me -b /tmp/sid-cookie.txt | jq .isAdmin
# 預期 → true
```

非管理者使用者：
- `/api/v1/me.isAdmin` 回 `false`
- 訪問 `/schedules` / `/service-logs` / `/project-check-lists` → 後端 `403 Forbidden`、前端 `AdminGuard` 重導 `/dashboard`

---

## 3. 故障排查

### 3.1 `/me.isAdmin = false` 但我以為自己是 admin

對照以下：

| 檢查 | 命令 |
|------|------|
| env 是否真的注入 | `docker compose -f ops/docker-compose.yml --env-file ops/.env exec backend printenv ADMIN_ACCOUNT_IDS` |
| accountId 大小寫 / 空白 | `/me.accountId` 與 env 內字串 **完全相同**（含大小寫）；複製貼上避免手輸 |
| backend 是否重啟 | `docker compose logs backend --tail 30` 看是否有 `listening` 重新出現 |

### 3.2 訪問 `/schedules` 卻看不到「定時服務」選項

前端側欄項目由 `auth.isAdmin()` signal 控制；若 `/me.isAdmin = true` 但側欄仍無：

1. F5 / 清快取（瀏覽器把舊 `/me` response 緩存）
2. 確認 `frontend` 已重新 build（dev mode 開 `ng serve` 應 hot reload）

### 3.3 CHKPROJ / CHKISSUE 連續失敗排查

若 Prometheus alert `ScheduledServiceFailing` 觸發（24h 內 ≥ 3 次失敗）：

1. **看 ServiceLog 詳細頁**：
   ```
   /service-logs?serviceId=CHKPROJ&result=failure
   ```
   點任一筆查 `notes.errors[]`：常見原因
   - `permission_denied`：mcp-atlassian session 之 admin accountId 對該專案無 read 權限
   - `version_conflict` / `api_error`：Atlassian API 5xx；通常會自動 retry 1 次
   - `acquireSession 未注入`：`ADMIN_ACCOUNT_IDS` env 未設或第一個帳號未登入過

2. **看 backend log**：
   ```bash
   docker compose logs backend --tail 200 | grep -E "scheduler|service|chkproj|chkissue"
   ```

3. **手動觸發測試**：
   ```bash
   curl -X POST http://localhost:8080/api/v1/schedules/<id>/trigger \
     -H "Cookie: sid=<admin-sid>" \
     -H "X-CSRF-Token: <csrf>"
   ```
   立即進 `/service-logs` 看新一筆是否仍失敗、什麼錯誤。

### 3.4 CHKISSUE 反覆對同一專案發 empty_streak 警示

連續無任務專案是「設計上要被注意的訊號」（FR-032）。處理方式：
- 將該專案從可見專案中歸檔（Jira project archive）；CHKISSUE 自然不再掃描
- 或維持現狀，視為「定期提醒管理者該專案應歸檔」
- 不要把專案加進 `project_check_lists`（那是 CHKPROJ 用的，與 CHKISSUE 無關）

---

## 4. 安全考量

- `ADMIN_ACCOUNT_IDS` **不應入版本控制**——僅在 `ops/.env`（已 gitignored）/ 雲端 secret manager / k8s Secret 中存在
- 任意新增 admin 應在內部變更紀錄登錄
- 對外暴露 `/api/v1/metrics` 時務必設 `METRICS_TOKEN`（見 [001 quickstart](../specs/001-jira-assistant/quickstart.md) 第 0 步）
- v1.1+ 計畫升級為 `users.role` + admin 設定 UI，env 注入會變成「啟動 bootstrap」用途

---

## 5. 相關文件

- [001-jira-assistant/quickstart.md](../specs/001-jira-assistant/quickstart.md) — 基礎環境設定
- [002-scheduled-services/quickstart.md](../specs/002-scheduled-services/quickstart.md) — 排程服務 12 步驗證
- [002-scheduled-services/research.md R-002](../specs/002-scheduled-services/research.md#r-002管理者角色判定fr-015) — 角色判定設計決策
- [ops/prometheus/alerts.example.yml](../ops/prometheus/alerts.example.yml) — 連續失敗告警樣板
