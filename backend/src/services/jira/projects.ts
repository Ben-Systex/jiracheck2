// T034：US1 專案儀表板的 Jira 取數 service
// - 直接呼叫使用者私有的 McpSession（per-user，由 routes 注入）
// - 對「最近 5 個」與「單一專案」做 enrich：openIssueCount / sprintProgress
// - 搜尋結果不 enrich（避免 N+1，憲法 IV）；openIssueCount 預設 0，sprintProgress 為 null
//
// 對應 MCP 工具：
//   list_projects → { projects: [{ key, name, avatarUrl }] }
//   search_issues → { issues: [...], total }
//
// 注意：本 service 不主動依賴 DB pool；recent_project_access 由 route 在最後 upsert。

import type { McpSession } from '../../mcp/types';

const JIRA_FIELD_STORY_POINTS =
  process.env.JIRA_FIELD_STORY_POINTS ?? 'customfield_10016';
const JIRA_FIELD_SPRINT =
  process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';
// JIRA_FIELD_ACTUAL_STORY_POINTS 將在 US3 stats 中用到（Phase 5），此處先不引用

export interface ProjectCard {
  key: string;
  name: string;
  avatarUrl?: string | null;
  openIssueCount: number;
  sprintProgress: SprintProgress | null;
  lastAccessedAt?: string | null;
}

export interface SprintProgress {
  completedSP: number;
  totalSP: number;
  sprintName?: string;
  endsAt?: string | null;
}

export interface ProjectDashboard extends ProjectCard {
  topAssignees: TopAssignee[];
}

export interface TopAssignee {
  person: { accountId: string; displayName: string };
  openIssueCount: number;
  totalSP: number;
}

export interface ListProjectsOptions {
  q?: string;
  enrich?: boolean;
}

interface McpProjectRaw {
  key: string;
  name: string;
  avatarUrl?: string;
}

interface McpIssueRaw {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: { accountId?: string; displayName?: string } | null;
    [field: string]: unknown;
  };
}

interface McpSearchIssuesResult {
  total?: number;
  issues: McpIssueRaw[];
}

interface McpListProjectsResult {
  projects: McpProjectRaw[];
}

// ---- list / search ----------------------------------------------------

export async function listAccessibleProjects(
  session: McpSession,
  opts: ListProjectsOptions = {},
): Promise<ProjectCard[]> {
  const res = await session.callTool<McpListProjectsResult>({
    name: 'list_projects',
    arguments: opts.q ? { query: opts.q } : {},
  });
  const raw = res.content?.projects ?? [];
  // 「搜尋」端點：不 enrich（避免 N+1）
  const projects = opts.q
    ? raw.filter((p) =>
        [p.key, p.name].some((f) =>
          f.toLowerCase().includes(opts.q!.toLowerCase()),
        ),
      )
    : raw;
  if (!opts.enrich) {
    return projects.map((p) => ({
      key: p.key,
      name: p.name,
      avatarUrl: p.avatarUrl ?? null,
      openIssueCount: 0,
      sprintProgress: null,
    }));
  }
  return Promise.all(projects.map((p) => enrichProject(session, p)));
}

export async function listRecentEnriched(
  session: McpSession,
  keys: string[],
): Promise<ProjectCard[]> {
  if (keys.length === 0) return [];
  // 取得專案基本資料：以單次 list_projects 拿全部，記憶體 filter
  const res = await session.callTool<McpListProjectsResult>({
    name: 'list_projects',
    arguments: {},
  });
  const allProjects = res.content?.projects ?? [];
  const projectsByKey = new Map(allProjects.map((p) => [p.key, p]));
  const enriched = await Promise.all(
    keys.map(async (key) => {
      const proj = projectsByKey.get(key);
      if (!proj) return null;
      return enrichProject(session, proj);
    }),
  );
  return enriched.filter((p): p is ProjectCard => p !== null);
}

export async function getProject(
  session: McpSession,
  key: string,
): Promise<ProjectDashboard | null> {
  const res = await session.callTool<McpListProjectsResult>({
    name: 'list_projects',
    arguments: {},
  });
  const proj = (res.content?.projects ?? []).find((p) => p.key === key);
  if (!proj) return null;
  const card = await enrichProject(session, proj);
  const topAssignees = await getTopAssignees(session, key);
  return { ...card, topAssignees };
}

// ---- internal: enrichment ---------------------------------------------

async function enrichProject(
  session: McpSession,
  proj: McpProjectRaw,
): Promise<ProjectCard> {
  const [openCount, sprintProgress] = await Promise.all([
    getOpenIssueCount(session, proj.key),
    getSprintProgress(session, proj.key),
  ]);
  return {
    key: proj.key,
    name: proj.name,
    avatarUrl: proj.avatarUrl ?? null,
    openIssueCount: openCount,
    sprintProgress,
  };
}

async function getOpenIssueCount(
  session: McpSession,
  projectKey: string,
): Promise<number> {
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql: `project = "${projectKey}" AND statusCategory != Done`,
      fields: ['summary'],
      maxResults: 0,
    },
  });
  return res.content?.total ?? res.content?.issues?.length ?? 0;
}

async function getSprintProgress(
  session: McpSession,
  projectKey: string,
): Promise<SprintProgress | null> {
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql: `project = "${projectKey}" AND sprint in openSprints()`,
      fields: ['summary', 'status', JIRA_FIELD_STORY_POINTS, JIRA_FIELD_SPRINT],
      maxResults: 100,
    },
  });
  const issues = res.content?.issues ?? [];
  if (issues.length === 0) return null;
  return aggregateSprintProgress(issues);
}

interface SprintAcc {
  completedSP: number;
  totalSP: number;
  sprintName: string | undefined;
  endsAt: string | undefined;
}

function aggregateSprintProgress(issues: McpIssueRaw[]): SprintProgress {
  const acc: SprintAcc = {
    completedSP: 0,
    totalSP: 0,
    sprintName: undefined,
    endsAt: undefined,
  };
  for (const issue of issues) {
    accumulateIssueIntoSprint(acc, issue);
  }
  return {
    completedSP: acc.completedSP,
    totalSP: acc.totalSP,
    ...(acc.sprintName !== undefined ? { sprintName: acc.sprintName } : {}),
    ...(acc.endsAt !== undefined ? { endsAt: acc.endsAt } : {}),
  };
}

function accumulateIssueIntoSprint(acc: SprintAcc, issue: McpIssueRaw): void {
  const sp = numericField(issue.fields[JIRA_FIELD_STORY_POINTS]);
  acc.totalSP += sp;
  if (isDoneStatus(issue.fields.status?.name)) acc.completedSP += sp;
  const sprint = firstSprintMeta(issue.fields[JIRA_FIELD_SPRINT]);
  if (sprint) {
    acc.sprintName ??= sprint.name;
    acc.endsAt ??= sprint.endDate;
  }
}

async function getTopAssignees(
  session: McpSession,
  projectKey: string,
): Promise<TopAssignee[]> {
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql: `project = "${projectKey}" AND statusCategory != Done AND assignee is not EMPTY`,
      fields: ['summary', 'assignee', JIRA_FIELD_STORY_POINTS],
      maxResults: 200,
    },
  });
  const issues = res.content?.issues ?? [];
  const byAccount = new Map<string, TopAssignee>();
  for (const issue of issues) {
    const a = issue.fields.assignee;
    if (!a?.accountId) continue;
    const sp = numericField(issue.fields[JIRA_FIELD_STORY_POINTS]);
    const existing = byAccount.get(a.accountId);
    if (existing) {
      existing.openIssueCount += 1;
      existing.totalSP += sp;
    } else {
      byAccount.set(a.accountId, {
        person: {
          accountId: a.accountId,
          displayName: a.displayName ?? a.accountId,
        },
        openIssueCount: 1,
        totalSP: sp,
      });
    }
  }
  return [...byAccount.values()]
    .sort((a, b) => b.openIssueCount - a.openIssueCount)
    .slice(0, 5);
}

// ---- helpers ----------------------------------------------------------

function numericField(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isDoneStatus(name?: string): boolean {
  if (!name) return false;
  const lc = name.toLowerCase();
  return lc === 'done' || lc === '完成' || lc === 'closed' || lc === 'resolved';
}

interface SprintMeta {
  name?: string;
  endDate?: string;
}

function firstSprintMeta(v: unknown): SprintMeta | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0];
  if (typeof first === 'string') {
    const name = parseSprintName(first);
    return name ? { name } : null;
  }
  if (typeof first === 'object' && first !== null) {
    const obj = first as Record<string, unknown>;
    return {
      ...(typeof obj['name'] === 'string' ? { name: obj['name'] as string } : {}),
      ...(typeof obj['endDate'] === 'string'
        ? { endDate: obj['endDate'] as string }
        : {}),
    };
  }
  return null;
}

// Jira 早期 sprint field 為字串「com.atlassian.greenhopper.service.sprint.Sprint@xx[name=Sprint 1,...]」
function parseSprintName(raw: string): string | undefined {
  const m = /name=([^,\]]+)/.exec(raw);
  return m?.[1];
}
