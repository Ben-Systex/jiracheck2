<!--
Sync Impact Report — Constitution Update
========================================
Version change: (uninitialized template) → 1.0.0
Bump rationale: 初始批准 (initial ratification);依 SemVer 規則,首次正式定版採 1.0.0。

Modified principles (template placeholder → ratified name):
  - [PRINCIPLE_1_NAME] → I. 程式碼品質 (Code Quality)
  - [PRINCIPLE_2_NAME] → II. 測試標準 (Testing Standards) — NON-NEGOTIABLE
  - [PRINCIPLE_3_NAME] → III. 使用者體驗一致性 (User Experience Consistency)
  - [PRINCIPLE_4_NAME] → IV. 效能要求 (Performance Requirements)
  - [PRINCIPLE_5_NAME] → 已移除 (使用者僅指定 4 大主題)

Added sections:
  - 附加約束與語言標準 (Additional Constraints & Language Standards)
  - 開發流程與品質閘 (Development Workflow & Quality Gates)
  - 治理 (Governance)

Removed sections:
  - 原模板第 5 條 principle(收斂為 4 條)

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check 採動態引用,無須改字
  - ✅ .specify/templates/spec-template.md — 結構未受新原則影響;但生成內容須遵守 zh-TW 規定
  - ⚠ .specify/templates/tasks-template.md — 將「Tests are OPTIONAL」改為依本憲法 Principle II 強制
  - ✅ .specify/templates/checklist-template.md — 無須改字
  - ✅ 暫無 README.md / docs/quickstart.md / 代理導引文件需要同步

Follow-up TODOs: 無
-->

# Jira 小幫手 Constitution

## 核心原則 (Core Principles)

### I. 程式碼品質 (Code Quality)

所有提交至主幹的程式碼 MUST 符合以下標準:

- **統一風格**: 所有原始碼 MUST 通過專案指定的 linter 與 formatter 檢查 (例如 ESLint /
  Prettier / Black / gofmt),CI 失敗即視為不可合併。
- **單一職責與命名**: 函式 / 類別 MUST 具備明確、單一的職責,命名 MUST 為自我說明
  (self-documenting);避免縮寫與含糊代稱。
- **複雜度控管**: 任一函式之循環複雜度 SHOULD ≤ 10;若超過 MUST 在 PR 描述中提出
  重構或拆分計畫,否則必須先重構再合併。
- **Code Review**: 任何寫入主幹的變更 MUST 經過至少一位非作者審查者通過。
- **無懸置標記**: 禁止無歸屬人或無關聯 issue 編號之 `TODO` / `FIXME` / `HACK` 註解;
  既存註解 MUST 在 6 個月內被解決或轉為正式 issue。

**理由**: Jira 小幫手是團隊長期維運的工具型專案,可讀性與一致性會直接影響後續
擴充速度與接手成本。把品質紅線寫死,可以避免「之後再清」的滑坡。

### II. 測試標準 (Testing Standards) — NON-NEGOTIABLE

測試是品質的硬性閘門,不可妥協:

- **TDD 為預設**: 對於新商業邏輯與對外契約,MUST 採用紅 → 綠 → 重構 (Red-Green-Refactor);
  測試 MUST 先撰寫並先失敗,再以最小實作通過。
- **單元測試覆蓋率**: 商業邏輯模組之語句覆蓋率 (statement coverage) MUST ≥ 80%;
  變更 PR 不得降低既有覆蓋率 (no coverage regressions)。
- **整合測試**: 任何涉及 Jira REST API、外部服務或跨模組契約之路徑 MUST 具備
  整合測試,並以契約測試 (contract test) 鎖定外部相依的回應結構。
- **CI 強制**: 所有測試 (單元 + 整合 + 契約) MUST 在 CI 中自動執行;任何 flaky 測試
  MUST 於 48 小時內修復或標記隔離 (quarantine) 並開立 issue。
- **不可繞過**: 跳過、刪除、或在 CI 中略過測試需取得專案維護者書面同意並於
  Sync Impact Report 中留下紀錄。

**理由**: Jira 小幫手會代使用者操作工單,任何邏輯錯誤都會造成資料污染或工作流中斷。
測試紅線提供唯一可信賴的迴歸保障。

### III. 使用者體驗一致性 (User Experience Consistency)

所有面向使用者之介面與訊息 MUST 維持一致的觀感與行為:

- **語言**: 所有 user-facing 文字 (UI 文案、錯誤訊息、通知、文件) MUST 使用
  **繁體中文 (zh-TW) 台灣用語**;技術識別字 (CLI flag、API 欄位、程式碼) 維持英文。
- **設計系統**: UI 元件 MUST 來自統一的 design tokens 與元件庫;不得在頁面層級硬編碼
  顏色、字級、間距。
- **錯誤訊息**: 錯誤訊息 MUST 同時告訴使用者「發生什麼」、「為何發生」與「下一步可做什麼」;
  禁止只回拋 stack trace 或英文錯誤碼。
- **狀態完整性**: 任何需等待之動作 MUST 有 loading 狀態、空集合 MUST 有 empty state、
  失敗 MUST 有可重試的 error state。
- **可達性**: 互動元件 MUST 可用鍵盤操作;互動標籤 MUST 提供 `aria-*` 或對等屬性。

**理由**: 工具被信任的前提是「可預期」。一致性決定了學習曲線與內部推廣速度。

### IV. 效能要求 (Performance Requirements)

效能是可被量測的功能,必須以數字管理:

- **回應時間**: 主要查詢操作 (列表、搜尋、看板載入) 之伺服端 p95 延遲 MUST < 2 秒;
  寫入操作 p95 MUST < 3 秒。
- **首屏渲染**: 前端核心頁面 Largest Contentful Paint MUST < 3 秒 (典型網路條件下)。
- **外部呼叫**: 對 Jira API 之呼叫 MUST 採取快取 (短期 TTL) 或批次化 (batch);
  禁止在迴圈中對同一端點發出 N+1 請求。
- **資料量擴展**: 任何顯示工單清單之畫面 MUST 支援分頁、虛擬滾動或漸進載入;
  禁止一次性渲染超過 200 列。
- **可觀測性**: MUST 對關鍵路徑 (登入、查詢、轉換、發送) 暴露延遲與錯誤率指標,
  並設定告警門檻。

**理由**: 工具型產品的留存高度依賴「快」;以可觀測指標反向約束實作決策,
才能避免效能在迭代中被悄悄犧牲。

## 附加約束與語言標準 (Additional Constraints & Language Standards)

- **文件語言**: 所有 specifications、plans、tasks 與 user-facing 文件 MUST 以
  **繁體中文 (zh-TW) 台灣用語**撰寫;內部開發者註解可使用繁體中文或英文,
  但同一檔案內 MUST 保持一致。
- **Jira API**: MUST 以 Jira Cloud REST API v3 或更新版本為目標;若需呼叫舊版
  endpoint MUST 在 plan.md 註記理由與退場時程。
- **憑證管理**: API token、OAuth secret、user credentials MUST NOT 被提交至版本控制;
  本機開發 MUST 透過環境變數或 secret manager 注入。
- **相依性**: 新增第三方套件 MUST 在 PR 中說明用途、授權 (license) 與替代方案評估。
- **無障礙基線**: 介面 MUST 至少符合 WCAG 2.1 AA 等級對比與鍵盤導覽要求。

## 開發流程與品質閘 (Development Workflow & Quality Gates)

- **規格驅動**: 任何新功能 MUST 走完整 SpecKit 流程:
  `/speckit.specify` → `/speckit.clarify` (必要時) → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`。
- **Constitution Check**: `/speckit.plan` 產出之 plan.md MUST 於設計起始與設計完成
  兩個時點各執行一次 Constitution Check;任何違反 MUST 於 Complexity Tracking 區段
  提出「為何需要」與「為何更簡方案不可行」之雙重論述。
- **跨工件一致性**: spec.md、plan.md、tasks.md 之關鍵詞 (FR-IDs、user story 編號、
  entity 命名) MUST 保持對齊;`/speckit.analyze` 可作為自動檢查工具。
- **合併條件**: PR MUST 通過:linter、所有測試、Constitution Check、Code Review;
  缺一不得合併。
- **變更紀錄**: 對使用者可見之行為變更 MUST 於 CHANGELOG (或 release notes) 以
  繁體中文記錄。

## 治理 (Governance)

- **位階**: 本 Constitution 凌駕於其他內部慣例;若 README、CLAUDE.md 或代理導引
  與本檔衝突,以本檔為準,並 MUST 同步更新衝突文件。
- **修訂程序**: 任何修訂 MUST 透過 PR 提出,內含:
  1. 變更原則或章節差異 (diff);
  2. 理由與影響評估;
  3. 受影響模板 / 文件之同步更新;
  4. Sync Impact Report (附於本檔頂端 HTML comment)。
- **版本規則** (Semantic Versioning):
  - **MAJOR**: 移除或不相容地重新定義既有原則 / 治理機制。
  - **MINOR**: 新增原則 / 章節,或實質擴充既有條款之指引。
  - **PATCH**: 文字釐清、錯字、不影響語意之精煉。
- **合規審查**: 每季 (每 3 個月) MUST 進行一次合規回顧,確認近期 PR 是否
  違反本文件;違反項目 MUST 開立補救 issue。
- **執行時導引**: 日常開發決策之導引請參照本檔與 `CLAUDE.md`;若有抵觸,
  以本檔為準。

**Version**: 1.0.0 | **Ratified**: 2026-05-21 | **Last Amended**: 2026-05-21
