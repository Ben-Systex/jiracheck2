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

  // People（US3）
  people_title: '人員工作狀況',
  people_subtitle: '選擇成員 → 查看跨專案任務與一段時間內的工時統計。',
  people_search_placeholder: '搜尋人員（姓名或 email）',
  people_search_aria: '搜尋人員',
  people_search_no_result: '找不到符合的人員',
  people_select_aria: '請先選擇成員',
  people_select_hint: '請從上方搜尋並選擇成員。',
  people_issues_heading: '進行中任務',
  people_issues_subtitle: '依到期日由近到遠排序；跨所有可存取的專案。',
  people_issues_empty_title: '目前沒有進行中任務',
  people_issues_empty_description: '此成員在所有可存取的專案中皆無未完成任務。',
  people_issue_jump_project: '跳到專案 {project}',
  people_issue_no_due: '未設到期日',
  people_partial_permission: '部分結果因權限限制未顯示。',
  people_stats_heading: '工時統計',
  people_stats_from_to: '統計區間 {from} – {to}',
  people_stats_completed: '完成任務數',
  people_stats_sp: 'Story Points 加總',
  people_stats_actual_sp: 'Actual SP 加總',
  people_stats_accuracy: '估準度（SP / Actual）',
  people_stats_accuracy_na: '尚無 Actual SP，無法計算',
  people_stats_by_project: '依專案匯總',
  people_stats_empty_title: '此期間無工作紀錄',
  people_stats_empty_description: '可考慮擴大時間區間以取得更多樣本。',
  people_stats_expand_range: '擴大到三個月',
  people_stats_from_label: '起始日',
  people_stats_to_label: '結束日',
  people_stats_apply: '送出查詢',
  people_chart_sp_vs_actual: 'SP 計畫 vs Actual',
  people_chart_by_project: '完成數（依專案）',
  people_status_open: '進行中',
  people_status_done: '已完成',
  people_status_all: '全部',
} as const;

export type MessageKey = keyof typeof messages;
