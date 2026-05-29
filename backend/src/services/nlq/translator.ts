// T050：US2 QueryPlan → (a) 中文 explanation + (b) MCP search_issues 呼叫 + 結果聚合
// 設計理念：
//   - explanation 為「我這樣理解」的可讀摘要（acceptance 條件之一）
//   - 對應 8 個 intent → 各自 mapper 函式：list_issues / count_issues / sum_* / avg_* / top_n_assignees / group_count
//   - 對 5 大統計（FR-022）皆走「以 JQL 撈 issues → 在 backend 端聚合」，避免依賴 mcp-atlassian 是否支援 aggregation
//   - 不在此處呼叫 LLM；本檔僅做 plan → JQL/聚合 的純函式轉換 + 一次 MCP search_issues 呼叫

import type { McpSession } from '../../mcp/types';
import type {
  QueryPlan,
  QueryPlanGroupBy,
  QueryPlanIntent,
} from './query-plan.schema';

const JIRA_FIELD_STORY_POINTS =
  process.env.JIRA_FIELD_STORY_POINTS ?? 'customfield_10016';
const JIRA_FIELD_ACTUAL_STORY_POINTS =
  process.env.JIRA_FIELD_ACTUAL_STORY_POINTS ?? 'customfield_10100';
const JIRA_FIELD_SPRINT =
  process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';

const MAX_ROWS = 1000;

// ---- 中文 explanation -----------------------------------------------------

const INTENT_LABEL: Record<QueryPlanIntent, string> = {
  list_issues: '列出符合條件的任務',
  count_issues: '統計符合條件的任務數',
  sum_story_points: '加總 Story Points',
  sum_actual_story_points: '加總 Actual Story Points',
  avg_story_points: '計算 Story Points 平均值',
  avg_actual_story_points: '計算 Actual Story Points 平均值',
  top_n_assignees: '依未完成任務數排出 Top N 負責人',
  group_count: '依指定維度分組計數',
};

const GROUPBY_LABEL: Record<QueryPlanGroupBy, string> = {
  assignee: '負責人',
  status: '狀態',
  project: '專案',
  sprint: 'Sprint',
  priority: '優先級',
};

export function explainPlanZh(plan: QueryPlan): string {
  const parts: string[] = [INTENT_LABEL[plan.intent]];
  appendFilterParts(parts, plan.filters);
  appendIntentExtras(parts, plan);
  return parts.join('，');
}

function appendFilterParts(parts: string[], f: QueryPlan['filters']): void {
  pushList(parts, f.projectKeys, '專案');
  if (f.assigneeAccountIds?.length) parts.push(`負責人 ${f.assigneeAccountIds.length} 人`);
  pushList(parts, f.statuses, '狀態');
  pushList(parts, f.sprintNames, 'Sprint');
  pushList(parts, f.labels, 'Label');
  pushRange(parts, f.createdRange, '建立期間');
  pushRange(parts, f.updatedRange, '更新期間');
}

function pushList(parts: string[], v: string[] | undefined, label: string): void {
  if (v?.length) parts.push(`${label} ${v.join('、')}`);
}

function pushRange(
  parts: string[],
  r: { from?: string | undefined; to?: string | undefined } | undefined,
  label: string,
): void {
  if (r?.from || r?.to) parts.push(`${label} ${r.from ?? '?'} – ${r.to ?? '?'}`);
}

function appendIntentExtras(parts: string[], plan: QueryPlan): void {
  if (plan.intent === 'top_n_assignees' && plan.topN) parts.push(`取前 ${plan.topN} 名`);
  if (plan.intent === 'group_count' && plan.groupBy) parts.push(`依 ${GROUPBY_LABEL[plan.groupBy]} 分組`);
}

// ---- JQL 建構 ------------------------------------------------------------

export function planToJql(plan: QueryPlan): string {
  const parts: string[] = [];
  const f = plan.filters;
  pushIn(parts, 'project', f.projectKeys);
  pushIn(parts, 'status', f.statuses);
  pushIn(parts, 'assignee', f.assigneeAccountIds);
  pushIn(parts, 'sprint', f.sprintNames);
  pushIn(parts, 'labels', f.labels);
  pushDateRange(parts, 'created', f.createdRange);
  pushDateRange(parts, 'updated', f.updatedRange);
  return parts.length === 0 ? 'project is not EMPTY' : parts.join(' AND ');
}

function pushIn(parts: string[], field: string, values: string[] | undefined): void {
  if (values?.length) parts.push(`${field} in (${values.map(q).join(', ')})`);
}

function pushDateRange(
  parts: string[],
  field: string,
  r: { from?: string | undefined; to?: string | undefined } | undefined,
): void {
  if (r?.from) parts.push(`${field} >= "${r.from}"`);
  if (r?.to) parts.push(`${field} <= "${r.to}"`);
}

function q(v: string): string {
  return `"${v.replace(/["\\]/g, '\\$&')}"`;
}

// ---- 執行 + 聚合 ---------------------------------------------------------

interface McpIssueRaw {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: { accountId?: string; displayName?: string } | null;
    priority?: { name?: string } | null;
    project?: { key?: string };
    labels?: string[];
    [k: string]: unknown;
  };
}

interface McpSearchResult {
  total?: number;
  issues: McpIssueRaw[];
  partialPermission?: boolean;
}

export interface PlanExecutionResult {
  /** 對應 intent 的最終 result envelope；前端依 intent 多型呈現 */
  results: Record<string, unknown>;
  /** 主結果筆數（用於 query_history.result_count） */
  resultCount: number;
  /** 是否因權限被過濾 */
  partialPermission: boolean;
  /** mcp 回傳的 total（避免 service 重新 call） */
  totalRows: number;
  /** 過長時的截斷旗標 */
  truncated: boolean;
}

export async function executePlan(
  session: McpSession,
  plan: QueryPlan,
): Promise<PlanExecutionResult> {
  const jql = planToJql(plan);
  const res = await session.callTool<McpSearchResult>({
    name: 'search_issues',
    arguments: {
      jql,
      fields: defaultFields(),
      maxResults: MAX_ROWS,
    },
  });
  const issues = res.content?.issues ?? [];
  const truncated = (res.content?.total ?? issues.length) > MAX_ROWS;
  const partialPermission = res.content?.partialPermission ?? false;

  const results = aggregate(plan, issues);
  return {
    results,
    resultCount: resultCount(plan, issues),
    partialPermission,
    totalRows: res.content?.total ?? issues.length,
    truncated,
  };
}

function defaultFields(): string[] {
  return [
    'summary',
    'status',
    'assignee',
    'priority',
    'project',
    'labels',
    JIRA_FIELD_STORY_POINTS,
    JIRA_FIELD_ACTUAL_STORY_POINTS,
    JIRA_FIELD_SPRINT,
  ];
}

// ---- aggregation per intent ---------------------------------------------

function aggregate(plan: QueryPlan, issues: McpIssueRaw[]): Record<string, unknown> {
  switch (plan.intent) {
    case 'list_issues':
      return { items: issues.map(toListItem) };
    case 'count_issues':
      return { count: issues.length };
    case 'sum_story_points':
      return { sum: sumField(issues, JIRA_FIELD_STORY_POINTS) };
    case 'sum_actual_story_points':
      return { sum: sumField(issues, JIRA_FIELD_ACTUAL_STORY_POINTS) };
    case 'avg_story_points':
      return { avg: avgField(issues, JIRA_FIELD_STORY_POINTS) };
    case 'avg_actual_story_points':
      return { avg: avgField(issues, JIRA_FIELD_ACTUAL_STORY_POINTS) };
    case 'top_n_assignees':
      return { items: topNAssignees(issues, plan.topN ?? 5) };
    case 'group_count':
      return { items: groupCount(issues, plan.groupBy!) };
  }
}

function resultCount(plan: QueryPlan, issues: McpIssueRaw[]): number {
  if (plan.intent === 'list_issues' || plan.intent === 'top_n_assignees' || plan.intent === 'group_count') {
    return issues.length;
  }
  return 1;
}

function toListItem(i: McpIssueRaw): Record<string, unknown> {
  return {
    key: i.key,
    summary: i.fields.summary ?? '',
    status: i.fields.status?.name ?? 'Unknown',
    projectKey: i.fields.project?.key ?? '',
    assignee: i.fields.assignee
      ? { accountId: i.fields.assignee.accountId, displayName: i.fields.assignee.displayName }
      : null,
  };
}

function numField(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function sumField(issues: McpIssueRaw[], field: string): number {
  return issues.reduce((acc, i) => acc + numField(i.fields[field]), 0);
}

function avgField(issues: McpIssueRaw[], field: string): number | null {
  if (issues.length === 0) return null;
  const total = sumField(issues, field);
  return Math.round((total / issues.length) * 1000) / 1000;
}

function topNAssignees(issues: McpIssueRaw[], topN: number): Array<Record<string, unknown>> {
  const m = new Map<string, { person: { accountId: string; displayName: string }; count: number }>();
  for (const i of issues) {
    const a = i.fields.assignee;
    if (!a?.accountId) continue;
    const e = m.get(a.accountId);
    if (e) e.count += 1;
    else m.set(a.accountId, { person: { accountId: a.accountId, displayName: a.displayName ?? a.accountId }, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, topN);
}

function groupCount(issues: McpIssueRaw[], by: QueryPlanGroupBy): Array<Record<string, unknown>> {
  const m = new Map<string, number>();
  for (const i of issues) {
    const k = keyByGroup(i, by);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([k, v]) => ({ key: k, count: v }))
    .sort((a, b) => b.count - a.count);
}

const GROUP_KEY_EXTRACTORS: Record<QueryPlanGroupBy, (i: McpIssueRaw) => string> = {
  assignee: (i) => i.fields.assignee?.displayName ?? i.fields.assignee?.accountId ?? '(未指派)',
  status: (i) => i.fields.status?.name ?? '(未知狀態)',
  project: (i) => i.fields.project?.key ?? '(未知專案)',
  sprint: (i) => sprintKey(i.fields[JIRA_FIELD_SPRINT]),
  priority: (i) => i.fields.priority?.name ?? '(無優先級)',
};

function keyByGroup(i: McpIssueRaw, by: QueryPlanGroupBy): string {
  return GROUP_KEY_EXTRACTORS[by](i);
}

function sprintKey(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return '(無 Sprint)';
  const first = v[0];
  if (typeof first === 'object' && first !== null) {
    return ((first as Record<string, unknown>)['name'] as string) ?? '(無 Sprint)';
  }
  if (typeof first === 'string') {
    const m = /name=([^,\]]+)/.exec(first);
    return m?.[1] ?? '(無 Sprint)';
  }
  return '(無 Sprint)';
}
