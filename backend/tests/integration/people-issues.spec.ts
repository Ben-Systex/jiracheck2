// T060：跨專案任務匯總 + partialPermission 旗標 + cursor 分頁

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildPeopleApp } from '../helpers/people-app';
import { createMockSession } from '../helpers/mcp-mock';

describe('people issues integration', () => {
  it('aggregates issues across projects and propagates partialPermission', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 3,
        startAt: 0,
        partialPermission: true,
        issues: [
          { key: 'PAY-1', fields: { summary: 's1', status: { name: 'In Progress' }, project: { key: 'PAY' } } },
          { key: 'BILL-9', fields: { summary: 's2', status: { name: 'To Do' }, project: { key: 'BILL' } } },
          { key: 'CORE-7', fields: { summary: 's3', status: { name: 'In Review' }, project: { key: 'CORE' } } },
        ],
      }),
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app).get('/api/v1/people/acc-1/issues');
    expect(res.status).toBe(200);
    expect(new Set(res.body.items.map((i: { projectKey: string }) => i.projectKey))).toEqual(
      new Set(['PAY', 'BILL', 'CORE']),
    );
    expect(res.body.partialPermission).toBe(true);
  });

  it('issues cursor pagination: nextCursor present when total > page', async () => {
    const mock = createMockSession({
      search_issues: (args) => {
        const startAt = Number(args['startAt'] ?? 0);
        // 假設 total=120 page=50
        const issues = Array.from({ length: 50 }, (_, i) => ({
          key: `PROJ-${startAt + i + 1}`,
          fields: { summary: 'x', status: { name: 'To Do' }, project: { key: 'PROJ' } },
        }));
        return { total: 120, startAt, maxResults: 50, issues };
      },
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });

    const r1 = await request(app).get('/api/v1/people/acc-1/issues').query({ pageSize: 50 });
    expect(r1.body.items).toHaveLength(50);
    expect(r1.body.nextCursor).not.toBeNull();

    const r2 = await request(app)
      .get('/api/v1/people/acc-1/issues')
      .query({ pageSize: 50, cursor: r1.body.nextCursor });
    expect(r2.body.items[0].key).toBe('PROJ-51');
  });

  it('issues JQL respects status filter', async () => {
    const mock = createMockSession({
      search_issues: () => ({ total: 0, issues: [] }),
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    await request(app).get('/api/v1/people/acc-1/issues').query({ status: 'done' });
    const jql = String(mock.calls[0]!.arguments['jql'] ?? '');
    expect(jql).toContain('statusCategory = Done');
    expect(jql).toContain('ORDER BY duedate ASC');
  });
});
