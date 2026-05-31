// 後端對外訊息一律走 i18n key，由此檔提供 zh-Hant-TW 字串
// （憲法 III：user-facing 訊息一律繁中台灣用語）

export const messages = {
  // ----- 通用錯誤 -----
  error_internal: '系統發生未預期的錯誤，請稍後再試。',
  error_validation: '請求參數驗證失敗，請檢查輸入。',
  error_rate_limited: '操作過於頻繁，請稍後再試。',

  // ----- Auth -----
  auth_unauthorized: '請先登入後再執行此操作。',
  auth_session_expired: '登入狀態已過期，請重新登入。',
  auth_oauth_state_mismatch: '授權回應已過期或無效，請重新登入。',
  auth_forbidden: '您沒有執行此操作的權限。',

  // ----- Jira / MCP -----
  upstream_jira_unavailable: 'Jira 服務暫時無法連線，請稍後再試。',
  upstream_jira_rate_limited: 'Jira API 配額已達上限，請稍後再試。',
  partial_permission_filtered: '部分結果因權限限制未顯示。',

  // ----- 專案 -----
  project_not_found: '找不到該專案，或您沒有存取權限。',
  project_search_too_short: '搜尋關鍵字需至少 1 個字元。',

  // ----- NLQ -----
  nlq_clarification_needed: '查詢無法解讀，請補充必要資訊。',
  nlq_too_many_results: '結果筆數過多，請加上更精確的條件。',
  nlq_question_too_long: '問句長度超過上限（1000 字元）。',

  // ----- Bulk update -----
  bulk_target_field_not_allowed: '此欄位不允許批次更新，請改選白名單欄位。',
  bulk_too_many_items: '單次批次更新筆數超過上限（200 筆），請分批執行。',
  bulk_confirm_text_invalid: '請依「確認更新 N 筆」之格式輸入確認字串。',
  bulk_confirm_count_mismatch: '確認筆數與預覽筆數不一致，請重新輸入。',
  bulk_no_permission_items: '您對下列 issue 沒有編輯權限，請調整選取範圍。',

  // ----- Scheduled services (002-scheduled-services) -----
  auth_forbidden_admin_only: '此功能僅限管理者使用。',
  schedule_cron_invalid: 'cron 字串格式無效，請參考說明範例。',
  schedule_frequency_invalid: '頻率設定無效，請檢查時間格式（HH:MM 或 cron）。',
  schedule_not_found: '找不到指定的排程，或您沒有檢視權限。',
  schedule_conflict_concurrent: '上一次仍在執行中，本次略過。',
  service_log_not_found: '找不到指定的執行紀錄，或您沒有檢視權限。',
  project_check_list_conflict: '此專案代號已存在於檢查清單中。',
  project_check_list_not_found: '找不到指定的檢查清單項目。',
} as const;

export type MessageKey = keyof typeof messages;

export function t(key: MessageKey): string {
  return messages[key];
}
