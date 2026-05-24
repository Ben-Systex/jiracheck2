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
} as const;

export type MessageKey = keyof typeof messages;
