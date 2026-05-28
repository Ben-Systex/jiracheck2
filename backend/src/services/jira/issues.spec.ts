// T091：services/jira/issues 單元測試——listByAssignee + statsByAssignee 多分支
import { describe, it, expect, vi } from 'vitest';
import type { McpSession } from '../../mcp/types';
import { listByAssignee, statsByAssignee } from './issues';

function mockSession(
  resolver: (args: { jql: string; startAt?: number; maxResults?: number }) => unknown,
): McpSession {
  return {
    callTool: vi.fn(async ({ arguments: args }) => ({
      content: resolver(args as { jql: string }),
    })),
  } as unknown as McpSession;
}

describe('listByAssignee', () => {
  it('預設 status=open 拼出 statusCategory != Done + ORDER BY duedate ASC', async () => {
    let seenJql = '';
    const session = mockSession((args) => {
      seenJql = args.jql;
      return { total: 0, issues: [] };
    });
    await listByAssignee(session, 'acc-1');
    expect(seenJql).toMatch(/statusCategory != Done/);
    expect(seenJql).toMatch(/ORDER BY duedate ASC NULLS LAST/);
  });

  it('status=done → statusCategory = Done', async () => {
    let seenJql = '';
    const session = mockSession((args) => {
      seenJql = args.jql;
      return { issues: [] };
    });
    await listByAssignee(session, 'a', { status: 'done' });
    expect(seenJql).toMatch(/statusCategory = Done/);
  });

  it('status=all → 不加 status 過濾', async () => {
    let seenJql = '';
    const session = mockSession((args) => {
      seenJql = args.jql;
      return { issues: [] };
    });
    await listByAssignee(session, 'a', { status: 'all' });
    expect(seenJql).not.toMatch(/statusCategory/);
  });

  it('clampPageSize：0 / 999 → 1 / 100', async () => {
    let maxResults = 0;
    const session = mockSession((args) => {
      maxResults = (args as { maxResults?: number }).maxResults ?? 0;
      return { issues: [] };
    });
    await listByAssignee(session, 'a', { pageSize: 0 });
    expect(maxResults).toBe(1);
    await listByAssignee(session, 'a', { pageSize: 999 });
    expect(maxResults).toBe(100);
    await listByAssignee(session, 'a', { pageSize: Number.NaN });
    expect(maxResults).toBe(50);
  });

  it('回傳 mapping：assignee / dueDate / sprint / labels', async () => {
    const session = mockSession(() => ({
      total: 1,
      issues: [
        {
          key: 'PRJ-1',
          fields: {
            summary: 'Issue 1',
            status: { name: 'Open' },
            assignee: {
              accountId: 'acc-1',
              displayName: 'Ben',
              emailAddress: 'b@x',
              avatarUrls: { '48x48': 'http://x/avatar' },
            },
            priority: { name: 'High' },
            duedate: '2026-06-30',
            labels: ['foo'],
            project: { key: 'PRJ' },
            customfield_10016: 3,
            customfield_10100: 4,
            customfield_10020: [{ name: 'Sprint X' }],
          },
        },
      ],
    }));
    const res = await listByAssignee(session, 'acc-1');
    expect(res.items[0]!.assignee?.email).toBe('b@x');
    expect(res.items[0]!.assignee?.avatarUrl).toBe('http://x/avatar');
    expect(res.items[0]!.dueDate).toBe('2026-06-30');
    expect(res.items[0]!.sprint).toBe('Sprint X');
    expect(res.items[0]!.labels).toEqual(['foo']);
    expect(res.items[0]!.storyPoints).toBe(3);
    expect(res.items[0]!.actualStoryPoints).toBe(4);
  });

  it('cursor / nextCursor：總筆數大於 startAt+items → nextCursor 非 null', async () => {
    const session = mockSession(() => ({
      total: 100,
      issues: Array.from({ length: 50 }, (_, i) => ({
        key: `P-${i}`,
        fields: { project: { key: 'P' } },
      })),
    }));
    const res = await listByAssignee(session, 'acc-1');
    expect(res.nextCursor).not.toBeNull();
    // 解碼 cursor
    const decoded = JSON.parse(Buffer.from(res.nextCursor!, 'base64url').toString('utf8')) as { startAt: number };
    expect(decoded.startAt).toBe(50);
  });

  it('decodeCursor：壞字串 → startAt=0', async () => {
    let startAt = -1;
    const session = mockSession((args) => {
      startAt = (args as { startAt?: number }).startAt ?? -1;
      return { issues: [] };
    });
    await listByAssignee(session, 'a', { cursor: 'NOT-BASE64' });
    expect(startAt).toBe(0);
  });

  it('assignee 缺欄位 → 用 accountId 補 displayName', async () => {
    const session = mockSession(() => ({
      issues: [{ key: 'P-1', fields: { assignee: { accountId: 'a-only' } } }],
    }));
    const res = await listByAssignee(session, 'a');
    expect(res.items[0]!.assignee?.displayName).toBe('a-only');
  });

  it('projectKeyOf：缺 project.key → 取 key 前綴', async () => {
    const session = mockSession(() => ({
      issues: [{ key: 'PRJ-7', fields: {} }],
    }));
    const res = await listByAssignee(session, 'a');
    expect(res.items[0]!.projectKey).toBe('PRJ');
  });

  it('extractSprintName：陣列首為字串 + 物件無 name → null', async () => {
    const session = mockSession(() => ({
      issues: [
        {
          key: 'P-1',
          fields: { project: { key: 'P' }, customfield_10020: ['name=SprintGH'] },
        },
        {
          key: 'P-2',
          fields: { project: { key: 'P' }, customfield_10020: [{ endDate: '2026-06-01' }] },
        },
      ],
    }));
    const res = await listByAssignee(session, 'a');
    expect(res.items[0]!.sprint).toBe('SprintGH');
    expect(res.items[1]!.sprint).toBeNull();
  });
});

describe('statsByAssignee', () => {
  it('正常匯總 totals + byProject', async () => {
    const session = mockSession(() => ({
      issues: [
        {
          key: 'A-1',
          fields: {
            project: { key: 'A' },
            customfield_10016: 5,
            customfield_10100: 5,
          },
        },
        {
          key: 'A-2',
          fields: {
            project: { key: 'A' },
            customfield_10016: 3,
            customfield_10100: 6,
          },
        },
        {
          key: 'B-1',
          fields: {
            project: { key: 'B' },
            customfield_10016: 2,
            customfield_10100: 2,
          },
        },
      ],
    }));
    const r = await statsByAssignee(session, 'acc-1', '2026-04-01', '2026-04-30');
    expect(r.totals.completedCount).toBe(3);
    expect(r.totals.storyPointsSum).toBe(10);
    expect(r.totals.actualStoryPointsSum).toBe(13);
    expect(r.totals.estimateAccuracyRatio).toBe(0.769);
    expect(r.byProject).toHaveLength(2);
    expect(r.byProject[0]!.projectKey).toBe('A');
  });

  it('actual=0 → ratio null', async () => {
    const session = mockSession(() => ({
      issues: [{ key: 'X-1', fields: { project: { key: 'X' }, customfield_10016: 5 } }],
    }));
    const r = await statsByAssignee(session, 'a', '2026-04-01', '2026-04-30');
    expect(r.totals.estimateAccuracyRatio).toBeNull();
  });

  it('日期格式錯 → throw', async () => {
    const session = mockSession(() => ({ issues: [] }));
    await expect(statsByAssignee(session, 'a', '20260401', '2026-04-30')).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('from > to → throw', async () => {
    const session = mockSession(() => ({ issues: [] }));
    await expect(statsByAssignee(session, 'a', '2026-05-01', '2026-04-30')).rejects.toThrow(/from 不可晚於 to/);
  });
});
