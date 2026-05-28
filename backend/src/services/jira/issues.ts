// T064：US3 跨專案 issue 列表 + 工時統計 service
//
// - listByAssignee：依到期日 ASC 排序的跨專案 issue 清單；status 預設 open（FR-031 + acceptance #1）
// - statsByAssignee：指定區間 [from, to] 的完成數 / Story Points / Actual Story Points / 估準度
//   （FR-032）。同時提供 byProject 匯總與 items 明細（FR-034）。
//
// JQL 規則：
//   - open 狀態：statusCategory != Done
//   - done  狀態：statusCategory = Done
//   - 區間：resolved >= "{from}" AND resolved <= "{to}"（含 from/to，使用者本地時區交給 Jira 處理）
//
// cursor 設計：base64-json({ startAt }) — 與 mcp-atlassian search_issues 的 startAt 對應。
// 對 OpenAPI IssueList.nextCursor / partialPermission 對齊。

import type { McpSession } from '../../mcp/types';
import type { PersonRef } from './users';
import { traceSpan } from '../../lib/telemetry';

const JIRA_FIELD_STORY_POINTS =
  process.env.JIRA_FIELD_STORY_POINTS ?? 'customfield_10016';
const JIRA_FIELD_ACTUAL_STORY_POINTS =
  process.env.JIRA_FIELD_ACTUAL_STORY_POINTS ?? 'customfield_10100';
const JIRA_FIELD_SPRINT =
  process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';

export interface IssueSummary {
  key: string;
  summary: string;
  status: string;
  projectKey: string;
  assignee: PersonRef | null;
  priority: string | null;
  dueDate: string | null;
  storyPoints: number | null;
  actualStoryPoints: number | null;
  sprint: string | null;
  labels: string[];
}

export interface IssueListResult {
  items: IssueSummary[];
  nextCursor: string | null;
  partialPermission: boolean;
}

export type IssueStatus = 'open' | 'done' | 'all';

export interface ListByAssigneeOptions {
  status?: IssueStatus;
  pageSize?: number;
  cursor?: string;
}

export interface PersonStatsTotals {
  completedCount: number;
  storyPointsSum: number;
  actualStoryPointsSum: number;
  estimateAccuracyRatio: number | null;
}

export interface PersonStatsByProject {
  projectKey: string;
  completedCount: number;
  storyPointsSum: number;
  actualStoryPointsSum: number;
}

export interface PersonStatsResult {
  from: string;
  to: string;
  totals: PersonStatsTotals;
  byProject: PersonStatsByProject[];
  items: IssueSummary[];
}

// ---- raw MCP types ---------------------------------------------------------

interface McpAssignee {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

interface McpIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: McpAssignee | null;
    priority?: { name?: string } | null;
    duedate?: string | null;
    labels?: string[];
    project?: { key?: string };
    [field: string]: unknown;
  };
}

interface McpSearchIssuesResult {
  total?: number;
  startAt?: number;
  maxResults?: number;
  issues: McpIssue[];
  /** mcp-atlassian 在權限受限時可能附加此旗標 */
  partialPermission?: boolean;
}

// ---- listByAssignee --------------------------------------------------------

export async function listByAssignee(
  session: McpSession,
  accountId: string,
  opts: ListByAssigneeOptions = {},
): Promise<IssueListResult> {
  return traceSpan(
    'jira.issues.listByAssignee',
    () => listByAssigneeInner(session, accountId, opts),
    { 'jira.assignee.accountId': accountId, 'jira.issues.status': opts.status ?? 'open' },
  );
}

async function listByAssigneeInner(
  session: McpSession,
  accountId: string,
  opts: ListByAssigneeOptions,
): Promise<IssueListResult> {
  const status = opts.status ?? 'open';
  const pageSize = clampPageSize(opts.pageSize);
  const startAt = decodeCursor(opts.cursor);

  const jql = buildListJql(accountId, status);
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql,
      fields: defaultIssueFields(),
      startAt,
      maxResults: pageSize,
    },
  });

  const issues = res.content?.issues ?? [];
  const items = issues.map(toIssueSummary);
  const next = startAt + items.length;
  const total = res.content?.total;
  const hasMore = total === undefined ? items.length === pageSize : next < total;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(next) : null,
    partialPermission: res.content?.partialPermission ?? false,
  };
}

// ---- statsByAssignee -------------------------------------------------------

export async function statsByAssignee(
  session: McpSession,
  accountId: string,
  from: string,
  to: string,
): Promise<PersonStatsResult> {
  return traceSpan(
    'jira.issues.statsByAssignee',
    () => statsByAssigneeInner(session, accountId, from, to),
    { 'jira.assignee.accountId': accountId, 'jira.range.from': from, 'jira.range.to': to },
  );
}

async function statsByAssigneeInner(
  session: McpSession,
  accountId: string,
  from: string,
  to: string,
): Promise<PersonStatsResult> {
  validateDateRange(from, to);
  const jql = buildStatsJql(accountId, from, to);
  // 為支撐 byProject + items 明細，一次拉 500 筆內（spec acceptance #2 預設展開）
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql,
      fields: defaultIssueFields(),
      startAt: 0,
      maxResults: 500,
    },
  });
  const items = (res.content?.issues ?? []).map(toIssueSummary);

  const totals = aggregateTotals(items);
  const byProject = aggregateByProject(items);

  return { from, to, totals, byProject, items };
}

// ---- aggregation helpers ---------------------------------------------------

function aggregateTotals(items: IssueSummary[]): PersonStatsTotals {
  let storyPointsSum = 0;
  let actualStoryPointsSum = 0;
  for (const it of items) {
    storyPointsSum += it.storyPoints ?? 0;
    actualStoryPointsSum += it.actualStoryPoints ?? 0;
  }
  const ratio =
    actualStoryPointsSum > 0
      ? round3(storyPointsSum / actualStoryPointsSum)
      : null;
  return {
    completedCount: items.length,
    storyPointsSum,
    actualStoryPointsSum,
    estimateAccuracyRatio: ratio,
  };
}

function aggregateByProject(items: IssueSummary[]): PersonStatsByProject[] {
  const map = new Map<string, PersonStatsByProject>();
  for (const it of items) {
    const existing = map.get(it.projectKey);
    if (existing) {
      existing.completedCount += 1;
      existing.storyPointsSum += it.storyPoints ?? 0;
      existing.actualStoryPointsSum += it.actualStoryPoints ?? 0;
    } else {
      map.set(it.projectKey, {
        projectKey: it.projectKey,
        completedCount: 1,
        storyPointsSum: it.storyPoints ?? 0,
        actualStoryPointsSum: it.actualStoryPoints ?? 0,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.completedCount - a.completedCount);
}

// ---- JQL builders ----------------------------------------------------------

function buildListJql(accountId: string, status: IssueStatus): string {
  const base = `assignee = "${escapeJqlValue(accountId)}"`;
  const statusFilter =
    status === 'open'
      ? 'statusCategory != Done'
      : status === 'done'
        ? 'statusCategory = Done'
        : '';
  const where = statusFilter ? `${base} AND ${statusFilter}` : base;
  // FR acceptance #1：依到期日由近到遠排序（NULL 放最後）
  return `${where} ORDER BY duedate ASC NULLS LAST, updated DESC`;
}

function buildStatsJql(accountId: string, from: string, to: string): string {
  return `assignee = "${escapeJqlValue(accountId)}" AND statusCategory = Done AND resolved >= "${from}" AND resolved <= "${to}" ORDER BY resolved ASC`;
}

function escapeJqlValue(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

// ---- cursor helpers --------------------------------------------------------

function encodeCursor(startAt: number): string {
  return Buffer.from(JSON.stringify({ startAt }), 'utf8').toString('base64url');
}

function decodeCursor(c: string | undefined): number {
  if (!c) return 0;
  try {
    const json = Buffer.from(c, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { startAt?: unknown };
    const n = parsed.startAt;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

// ---- field mapping ---------------------------------------------------------

function defaultIssueFields(): string[] {
  return [
    'summary',
    'status',
    'assignee',
    'priority',
    'duedate',
    'labels',
    'project',
    JIRA_FIELD_STORY_POINTS,
    JIRA_FIELD_ACTUAL_STORY_POINTS,
    JIRA_FIELD_SPRINT,
  ];
}

function toIssueSummary(raw: McpIssue): IssueSummary {
  const f = raw.fields;
  return {
    key: raw.key,
    summary: f.summary ?? '',
    status: f.status?.name ?? 'Unknown',
    projectKey: projectKeyOf(raw),
    assignee: f.assignee ? toPersonRefFromAssignee(f.assignee) : null,
    priority: f.priority?.name ?? null,
    dueDate: f.duedate ?? null,
    storyPoints: numericField(f[JIRA_FIELD_STORY_POINTS]),
    actualStoryPoints: numericField(f[JIRA_FIELD_ACTUAL_STORY_POINTS]),
    sprint: extractSprintName(f[JIRA_FIELD_SPRINT]),
    labels: f.labels ?? [],
  };
}

function projectKeyOf(raw: McpIssue): string {
  return raw.fields.project?.key ?? raw.key.split('-')[0] ?? '';
}

function toPersonRefFromAssignee(a: McpAssignee): PersonRef {
  return {
    accountId: a.accountId ?? '',
    displayName: a.displayName ?? a.accountId ?? '',
    email: a.emailAddress ?? null,
    avatarUrl: a.avatarUrls?.['48x48'] ?? null,
  };
}

// ---- misc utils ------------------------------------------------------------

function numericField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractSprintName(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0];
  if (typeof first === 'string') {
    const m = /name=([^,\]]+)/.exec(first);
    return m?.[1] ?? null;
  }
  if (typeof first === 'object' && first !== null) {
    const obj = first as Record<string, unknown>;
    return typeof obj['name'] === 'string' ? (obj['name'] as string) : null;
  }
  return null;
}

function clampPageSize(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 50;
  return Math.min(100, Math.max(1, Math.floor(v)));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function validateDateRange(from: string, to: string): void {
  if (!isYmd(from) || !isYmd(to)) {
    throw new Error('from / to 必須為 YYYY-MM-DD');
  }
  if (from > to) {
    throw new Error('from 不可晚於 to');
  }
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
