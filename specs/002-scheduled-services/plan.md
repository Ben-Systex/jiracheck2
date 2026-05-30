# Implementation Plan: 定時排程服務與服務執行紀錄

**Branch**: `002-scheduled-services` | **Date**: 2026-05-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-scheduled-services/spec.md`

## Summary

於 Jira 小幫手 v1（001-jira-assistant）之上建立「排程容器 + 兩個內建服務」子模組：

- **核心**：使用者於設定頁建立多組排程（cron / 每日 / 每週 / 每月），系統按時點觸發指定服務，並把每次執行寫入 `service_logs` 供事後檢視與稽核（保留 90 天）。
- **服務 1（CHKPROJ）**：依使用者維護的「專案檢查清單」逐專案判斷「延遲」（rule-v1：Sprint 過半 SP<50% 或任一未完成任務 Due Date 逾期 ≥3 天）。
- **服務 2（CHKISSUE）**：盤點所有可見專案的「有任務 / 無任務」分布，連續多次無任務時於備註標警。
- **權限**：ServiceLogs / 設定頁僅限「管理者」角色（v1 透過 `ADMIN_ACCOUNT_IDS` env 注入 accountId 白名單，沿用 001 session middleware）。
- **觀測性**：沿用 001 之 `prom-client` + OTel API；新增 `scheduled_service_total{service,status}` counter 與 `scheduled_service_duration_seconds` histogram。

技術取向：節省第三方依賴，使用 `node-cron`（觸發）+ `cron-parser`（下次時間計算）+ PG advisory lock（同服務互斥）。v1 假設單 backend instance 部署；多 instance 與 leader election 列 v1.1+。

## Technical Context

**Language/Version**: TypeScript 5.7 + Node 20 LTS（沿用 001）  
**Primary Dependencies**: Express 4、PostgreSQL `pg` 8、`@modelcontextprotocol/sdk`（呼叫 mcp-atlassian）、`node-cron` 3、`cron-parser` 4、`zod` 3、`prom-client`、`@opentelemetry/api`。**新增依賴**：`node-cron`（MIT）、`cron-parser`（MIT）、`csv-stringify`（MIT）。  
**Storage**: PostgreSQL 16（沿用 001 instance；新增 3 個 table：`schedule_configs`、`service_logs`、`project_check_lists`；既有 `users` 表新增 `role` 欄位或改以 env 白名單，見 research R-002）  
**Testing**: Vitest（backend）+ Angular Testing Library + Playwright + axe-core（沿用 001；憲法 II coverage ≥ 80%）  
**Target Platform**: Linux container（Docker Compose 沿用 ops/）；Node 20 LTS  
**Project Type**: Web 應用（backend + frontend，沿用 001 stack）  
**Performance Goals**:
- 排程觸發誤差 < 1 分鐘（SC-001）
- ServiceLogs 列表 + 過濾回應 p95 < 2 秒（SC-003 + 憲法 IV）
- CHKPROJ 50 專案於 Jira API 正常時 < 5 分鐘（SC-004）
- CHKISSUE 200 專案於 Jira API 正常時 < 10 分鐘（SC-005）  

**Constraints**:
- `service_logs` 保留 90 天，由 cleanup job 自動刪除（FR-014）
- 同服務 ID 不可併發執行（FR-006，採 pg advisory lock）
- 伺服器時區為唯一基準（FR-008，預設 `Asia/Taipei`）
- v1 不對外通知（無 Email / Slack / Webhook，spec assumption）
- v1 不支援多 backend instance（單 instance + advisory lock；多 instance leader election 列 v1.1+）  

**Scale/Scope**:
- ScheduleConfig 預期 ≤ 50 筆 / instance
- ProjectCheckList 預期 ≤ 50 個 projectKey
- ServiceLog 90 天累積 ~50 排程 × 30 次/日 × 90 天 ≈ 135,000 列 → 一般 PG 順讀無壓力，但 `service_logs` 必須在 `(service_id, started_at DESC)` 建索引

## Constitution Check

*GATE: 設計起始時的初評；Phase 1 完成後再評一次。*

| 原則 | 適用性 | 通過 / 違反 | 對策 |
|------|--------|------------|------|
| I 程式碼品質 | 適用 | ✅ 通過 | 沿用 001 之 ESLint / Prettier；複雜度 ≤ 10；CI lint gate |
| II 測試標準（NON-NEGOTIABLE） | 適用 | ✅ 通過 | 沿用 Vitest + Playwright；對 scheduler / cron 解析 / 服務 runner 均寫 unit + integration test；coverage ≥ 80% |
| III UX 一致性 | 適用 | ✅ 通過 | 沿用 001 的 zh-TW i18n + Tailwind design tokens；新頁面（schedule / service-logs / project-check-lists）採同一元件庫；保有 loading / empty / error 狀態 |
| IV 效能 | 適用 | ✅ 通過 | service_logs 查詢加索引 + 分頁；CHKPROJ / CHKISSUE 對 mcp-atlassian 走批次，沿用 001 之 cache 模組；新增 metrics（scheduled_service_*）對接現有 /metrics endpoint |
| 附加約束（zh-TW / 憑證 / 依賴 / 無障礙） | 適用 | ✅ 通過 | 新增 3 個依賴皆 MIT；ADMIN_ACCOUNT_IDS 走 env；UI 採同一 design system；axe-core gate 沿用 |

**結論**：全部通過，無需 Complexity Tracking 項目。

## Project Structure

### Documentation (this feature)

```text
specs/002-scheduled-services/
├── plan.md              # 本檔
├── research.md          # Phase 0 輸出
├── data-model.md        # Phase 1 輸出
├── quickstart.md        # Phase 1 輸出
├── contracts/
│   └── api.openapi.yaml # Phase 1 輸出
├── checklists/
│   └── requirements.md  # 既存
└── tasks.md             # Phase 2（/speckit.tasks）
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db/migrations/
│   │   ├── 0003_scheduled_services.up.sql   # 新增：schedule_configs / service_logs / project_check_lists
│   │   └── 0003_scheduled_services.down.sql
│   ├── db/repositories/
│   │   ├── schedule-configs.ts              # CRUD + next-run 計算
│   │   ├── service-logs.ts                  # insert / list / detail / prune / export
│   │   └── project-check-lists.ts           # 取 / 設 projectKey 清單
│   ├── jobs/
│   │   ├── scheduler.ts                     # 啟動所有啟用排程 + node-cron registry
│   │   ├── service-runner.ts                # 統一 runner 介面（pg advisory lock + ServiceLog 寫入）
│   │   └── services/
│   │       ├── chkproj.ts                   # CHKPROJ 服務實作 + rule-v1
│   │       └── chkissue.ts                  # CHKISSUE 服務實作
│   ├── routes/
│   │   ├── schedules.ts                     # /schedules CRUD + /trigger
│   │   ├── service-logs.ts                  # /service-logs 列表 / 詳細 / 匯出
│   │   └── project-check-lists.ts           # /project-check-lists CRUD
│   ├── middleware/
│   │   └── require-admin.ts                 # ADMIN_ACCOUNT_IDS 比對
│   └── lib/
│       └── cron-utils.ts                    # frequency → cron expression 轉換
└── tests/
    ├── contract/
    │   ├── schedules.spec.ts
    │   ├── service-logs.spec.ts
    │   └── project-check-lists.spec.ts
    └── integration/
        ├── scheduler.spec.ts
        ├── chkproj.spec.ts
        └── chkissue.spec.ts

frontend/src/app/
├── features/
│   ├── schedules/
│   │   ├── schedules.page.ts                # 設定頁（CRUD + 啟停 + 立即執行）
│   │   ├── schedule-form/                   # 頻率 / cron / 時間表單
│   │   └── schedules-api.service.ts
│   ├── service-logs/
│   │   ├── service-logs.page.ts             # 列表 + 過濾 + 匯出
│   │   ├── service-log-detail.page.ts       # 詳細頁
│   │   └── service-logs-api.service.ts
│   └── project-check-lists/
│       ├── project-check-lists.page.ts      # 維護介面
│       └── project-check-lists-api.service.ts
└── e2e/specs/
    ├── us1-schedule-crud.spec.ts
    ├── us2-service-logs.spec.ts
    ├── us3-chkproj.spec.ts
    └── us4-chkissue.spec.ts
```

**Structure Decision**: 沿用 001 既有的 Web 應用（backend + frontend）目錄結構，本 feature 僅以「新增 feature 模組」方式擴展；不引入第二個微服務或 monorepo workspace。理由：

1. 排程器以 in-process `node-cron` 即可滿足 SC-001（誤差 < 1 分鐘）需求，無需獨立 worker。
2. 沿用同一 PG instance、同一 session middleware、同一 i18n / design system，可最大化重用 001 既有資產（cache / rate-limit / problem helper / metrics）。
3. mcp-atlassian session 已由 001 的 `McpSessionPool` 管理；CHKPROJ / CHKISSUE 直接以「管理者 accountId」走相同 pool，無需另起連線。

## Complexity Tracking

> 無違反項目；保留空表。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
