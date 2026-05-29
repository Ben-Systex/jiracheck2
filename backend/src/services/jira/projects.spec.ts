// T091：services/jira/projects 單元測試——以注入 mock McpSession 覆蓋 enrich 分支與 sprint 解析
import { describe, it, expect, vi } from 'vitest';
import type { McpSession } from '../../mcp/types';
import {
  listAccessibleProjects,
  listRecentEnriched,
  getProject,
} from './projects';

function makeMockSession(handler: (name: string, args: Record<string, unknown>) => unknown): McpSession {
  return {
    callTool: vi.fn(async ({ name, arguments: args }) => ({ content: handler(name, args) })),
  } as unknown as McpSession;
}

describe('listAccessibleProjects', () => {
  it('無 enrich：不發 N+1 query，回傳基本欄位', async () => {
    const session = makeMockSession((name) => {
      if (name === 'list_projects') {
        return {
          projects: [
            { key: 'P1', name: 'Project One' },
            { key: 'P2', name: 'Project Two', avatarUrl: 'https://a/avatar.png' },
          ],
        };
      }
      return {};
    });
    const list = await listAccessibleProjects(session);
    expect(list).toHaveLength(2);
    expect(list[0]!.openIssueCount).toBe(0);
    expect(list[0]!.sprintProgress).toBeNull();
    expect(list[1]!.avatarUrl).toBe('https://a/avatar.png');
    expect(list[0]!.avatarUrl).toBeNull();
  });

  it('帶 q 篩選後不 enrich', async () => {
    const session = makeMockSession((name) => {
      if (name === 'list_projects') {
        return {
          projects: [
            { key: 'ABC', name: 'Alpha' },
            { key: 'XYZ', name: 'Other' },
          ],
        };
      }
      return {};
    });
    const list = await listAccessibleProjects(session, { q: 'alp' });
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('ABC');
  });

  it('enrich=true：呼叫 search_issues 取 openIssueCount + sprintProgress', async () => {
    const session = makeMockSession((name) => {
      if (name === 'list_projects') return { projects: [{ key: 'P1', name: 'P1' }] };
      if (name === 'search_issues') {
        return {
          total: 12,
          issues: [
            { key: 'P1-1', fields: { status: { name: 'Done' }, customfield_10016: 3, customfield_10020: ['Sprint 1'] } },
            { key: 'P1-2', fields: { status: { name: 'In Progress' }, customfield_10016: '2' } },
          ],
        };
      }
      return {};
    });
    const list = await listAccessibleProjects(session, { enrich: true });
    expect(list[0]!.openIssueCount).toBe(12);
    expect(list[0]!.sprintProgress).not.toBeNull();
    expect(list[0]!.sprintProgress!.totalSP).toBe(5);
    expect(list[0]!.sprintProgress!.completedSP).toBe(3);
  });

  it('open issues 全空 → sprintProgress 為 null', async () => {
    const session = makeMockSession((name) => {
      if (name === 'list_projects') return { projects: [{ key: 'P1', name: 'P1' }] };
      if (name === 'search_issues') return { total: 0, issues: [] };
      return {};
    });
    const list = await listAccessibleProjects(session, { enrich: true });
    expect(list[0]!.sprintProgress).toBeNull();
  });
});

describe('listRecentEnriched', () => {
  it('keys 空 → 直接回空陣列', async () => {
    const session = makeMockSession(() => ({}));
    expect(await listRecentEnriched(session, [])).toEqual([]);
  });

  it('部分 key 在 list_projects 找不到 → 過濾掉', async () => {
    const session = makeMockSession((name) => {
      if (name === 'list_projects') return { projects: [{ key: 'A', name: 'A' }] };
      if (name === 'search_issues') return { total: 0, issues: [] };
      return {};
    });
    const list = await listRecentEnriched(session, ['A', 'GONE']);
    expect(list).toHaveLength(1);
    expect(list[0]!.key).toBe('A');
  });
});

describe('getProject', () => {
  it('找不到 → null', async () => {
    const session = makeMockSession((name) => {
      if (name === 'list_projects') return { projects: [] };
      return {};
    });
    expect(await getProject(session, 'PRJ')).toBeNull();
  });

  it('找到 → 回傳 dashboard 含 topAssignees', async () => {
    const session = makeMockSession((name, args) => {
      if (name === 'list_projects') return { projects: [{ key: 'PRJ', name: 'PRJ' }] };
      if (name === 'search_issues') {
        const jql = String(args['jql'] ?? '');
        if (/assignee is not EMPTY/.test(jql)) {
          // top assignees
          return {
            issues: [
              { key: 'PRJ-1', fields: { assignee: { accountId: 'a1', displayName: 'A1' }, customfield_10016: 3 } },
              { key: 'PRJ-2', fields: { assignee: { accountId: 'a1', displayName: 'A1' }, customfield_10016: 2 } },
              { key: 'PRJ-3', fields: { assignee: { accountId: 'a2', displayName: 'A2' }, customfield_10016: 'NaN' } },
              { key: 'PRJ-4', fields: { assignee: null, customfield_10016: 1 } }, // 略過
            ],
          };
        }
        if (/openSprints/.test(jql)) {
          return {
            issues: [
              {
                key: 'PRJ-X',
                fields: {
                  status: { name: 'Closed' },
                  customfield_10016: 5,
                  customfield_10020: [{ name: 'Sprint A', endDate: '2026-06-01' }],
                },
              },
            ],
          };
        }
        return { total: 3, issues: [] };
      }
      return {};
    });

    const dashboard = await getProject(session, 'PRJ');
    expect(dashboard).not.toBeNull();
    expect(dashboard!.topAssignees).toHaveLength(2);
    expect(dashboard!.topAssignees[0]!.openIssueCount).toBe(2);
    expect(dashboard!.sprintProgress?.sprintName).toBe('Sprint A');
    expect(dashboard!.sprintProgress?.endsAt).toBe('2026-06-01');
  });

  it('sprint field 為字串（greenhopper 古早格式）→ 解析 name', async () => {
    const session = makeMockSession((name, args) => {
      if (name === 'list_projects') return { projects: [{ key: 'P', name: 'P' }] };
      if (name === 'search_issues') {
        const jql = String(args['jql'] ?? '');
        if (/openSprints/.test(jql)) {
          return {
            issues: [
              {
                key: 'P-1',
                fields: {
                  status: { name: 'In Progress' },
                  customfield_10016: 8,
                  customfield_10020: [
                    'com.atlassian.greenhopper.service.sprint.Sprint@xx[name=Sprint Legacy,endDate=2026-06-01]',
                  ],
                },
              },
            ],
          };
        }
        return { total: 1, issues: [] };
      }
      return {};
    });
    const d = await getProject(session, 'P');
    expect(d?.sprintProgress?.sprintName).toBe('Sprint Legacy');
  });
});
