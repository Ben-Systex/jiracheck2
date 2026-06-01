// CHKPROJ 對 mcp-atlassian 的「拉專案資料」函式
// 對應 [research R-008](../../../specs/002-scheduled-services/research.md#r-008chkproj-rule-v1-規則寫死位置)
// rule-v1 不需要 sprint detail；本 helper 抽離 chkproj 主邏輯以利測試替身

import type { McpSession } from '../../mcp/types';
import type { ProjectCheckInput } from '../../jobs/services/chkproj';

const JIRA_FIELD_STORY_POINTS = process.env.JIRA_FIELD_STORY_POINTS ?? 'customfield_10016';
const JIRA_FIELD_SPRINT = process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';

interface McpIssueRaw {
  key: string;
  fields: {
    status?: { name?: string; statusCategory?: { key?: string } };
    duedate?: string | null;
    [field: string]: unknown;
  };
}

interface McpSearchIssuesResult {
  total?: number;
  issues: McpIssueRaw[];
}

interface SprintMeta {
  state?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * 對單一專案：
 *   1. 取 active sprint 內所有 issue → 算 SP completion
 *   2. 取 open (statusCategory != Done) 且有 dueDate 的 issue → CHKPROJ rule-v1 條件 B
 */
export async function fetchProjectForChkproj(
  session: McpSession,
  projectKey: string,
): Promise<ProjectCheckInput> {
  const [sprintInfo, openIssues] = await Promise.all([
    fetchActiveSprintInfo(session, projectKey),
    fetchOpenIssuesWithDue(session, projectKey),
  ]);
  return {
    projectKey,
    sprint: sprintInfo,
    openIssues,
    now: new Date(),
  };
}

async function fetchActiveSprintInfo(
  session: McpSession,
  projectKey: string,
): Promise<ProjectCheckInput['sprint']> {
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql: `project = "${projectKey}" AND sprint in openSprints()`,
      fields: ['status', JIRA_FIELD_STORY_POINTS, JIRA_FIELD_SPRINT],
      maxResults: 1000,
    },
  });
  return aggregateSprintInfo(res.content?.issues ?? []);
}

function aggregateSprintInfo(issues: McpIssueRaw[]): ProjectCheckInput['sprint'] {
  if (issues.length === 0) return null;
  let total = 0;
  let completed = 0;
  let meta: SprintMeta | null = null;
  for (const issue of issues) {
    const sp = numericField(issue.fields[JIRA_FIELD_STORY_POINTS]);
    total += sp;
    if (isDoneIssue(issue)) completed += sp;
    if (!meta) meta = firstActiveSprintMeta(issue.fields[JIRA_FIELD_SPRINT]);
  }
  if (!meta?.startDate || !meta?.endDate) return null;
  return {
    startDate: meta.startDate,
    endDate: meta.endDate,
    totalStoryPoints: total,
    completedStoryPoints: completed,
  };
}

function isDoneIssue(issue: McpIssueRaw): boolean {
  return isDone(issue.fields.status?.name, issue.fields.status?.statusCategory?.key);
}

async function fetchOpenIssuesWithDue(
  session: McpSession,
  projectKey: string,
): Promise<ProjectCheckInput['openIssues']> {
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql: `project = "${projectKey}" AND statusCategory != Done AND duedate is not EMPTY`,
      fields: ['duedate'],
      maxResults: 500,
    },
  });
  const issues = res.content?.issues ?? [];
  return issues.map((i) => ({ key: i.key, dueDate: i.fields.duedate ?? null }));
}

function numericField(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isDone(name?: string, catKey?: string): boolean {
  if (catKey === 'done') return true;
  if (!name) return false;
  const lc = name.toLowerCase();
  return lc === 'done' || lc === '完成' || lc === 'closed' || lc === 'resolved';
}

function firstActiveSprintMeta(v: unknown): SprintMeta | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  // 取第一個 state=active 的；若皆無 state 屬性退到第一個
  const active = v.find((x) => isObject(x) && (x as Record<string, unknown>)['state'] === 'active');
  const first = active ?? v[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as Record<string, unknown>;
    return {
      ...(typeof o['state'] === 'string' ? { state: o['state'] } : {}),
      ...(typeof o['name'] === 'string' ? { name: o['name'] } : {}),
      ...(typeof o['startDate'] === 'string' ? { startDate: o['startDate'] } : {}),
      ...(typeof o['endDate'] === 'string' ? { endDate: o['endDate'] } : {}),
    };
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
