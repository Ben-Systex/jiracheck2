// 全站 user-facing 文字一律走此處的 i18n key（憲法 III）
// v1 僅 zh-Hant-TW；英文 v1.1+ 再加（spec Assumptions）

export const messages = {
  // 通用
  common_loading: '載入中…',
  common_empty: '沒有資料',
  common_retry: '重試',
  common_refresh: '重新整理',
  common_cancel: '取消',
  common_confirm: '確認',
  common_close: '關閉',
  common_back: '返回',
  common_more: '更多',

  // 錯誤狀態
  error_generic_title: '發生錯誤',
  error_generic_description: '請稍後再試，或按下方「重試」。',
  error_unauthorized_title: '尚未登入',
  error_unauthorized_description: '請先以 Atlassian 帳號登入後再使用此功能。',

  // Freshness bar
  freshness_live: '即時',
  freshness_cache: '快取',
  freshness_relative_just_now: '剛剛',
  freshness_relative_minutes_ago: '{n} 分鐘前',
  freshness_relative_hours_ago: '{n} 小時前',
  freshness_aria_refresh: '重新整理資料',

  // 登入
  login_button: '以 Atlassian 登入',
  login_title: '歡迎使用 Jira 小幫手',
  login_subtitle: '使用您的 Atlassian 帳號登入即可開始查詢專案與任務。',

  // Shell
  nav_dashboard: '專案儀表板',
  nav_nlq: '自然語言查詢',
  nav_people: '人員工作狀況',
  nav_bulk_update: '整批更新',
  shell_logout: '登出',

  // Dashboard（US1）
  dashboard_title: '專案儀表板',
  dashboard_subtitle: '最近存取的 5 個專案；找不到請使用搜尋。',
  dashboard_recent_heading: '最近存取',
  dashboard_search_placeholder: '搜尋專案（名稱或 key）',
  dashboard_search_aria: '搜尋專案',
  dashboard_no_recent_title: '尚未存取任何專案',
  dashboard_no_recent_description: '請使用上方搜尋找到您要的專案。',
  dashboard_search_no_result_title: '找不到符合的專案',
  dashboard_search_no_result_description: '請嘗試其他關鍵字，或檢查您的權限。',
  dashboard_search_hint: '輸入至少 1 個字元開始搜尋',
  dashboard_search_results_heading: '搜尋結果',
  dashboard_card_open_issues: '未完成 {n}',
  dashboard_card_sprint_progress: 'Sprint 進度 {done} / {total}',
  dashboard_card_sprint_none: '無進行中 Sprint',
  dashboard_card_last_accessed: '上次存取：{when}',
  dashboard_card_open_aria: '開啟專案 {name}',
} as const;

export type MessageKey = keyof typeof messages;
