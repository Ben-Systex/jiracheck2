// T029 契約測試：對 OpenAPI projects schema 與 status code 做形狀斷言
// - GET /projects/recent → items[]、dataFreshness
// - GET /projects/search → 帶 q；validation 失敗 → 400 problem
// - GET /projects/{key} → ProjectDashboard（含 topAssignees）；404 problem
//
// 採 mock McpSession（不打真實 Jira）；DB 採 in-memory recent-access repo。

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildProjectsApp, createInMemoryRecentRepo } from '../helpers/projects-app';
import { createMockSession } from '../helpers/mcp-mock';

const projectsFixture = {
  projects: [
    { key: 'PAY', name: 'Payments', avatarUrl: 'https://example/p.png' },
    { key: 'BILL', name: 'Billing' },
    { key: 'CORE', name: 'Core' },
  ],
};

describe('projects contract', () => {
  let mockSession: ReturnType<typeof createMockSession>;

  beforeEach(() => {
    mockSession = createMockSession({
      list_projects: () => projectsFixture,
      search_issues: () => ({ total: 7, issues: [] }),
    });
  });

  it('GET /api/v1/projects/recent returns items[] + dataFreshness', async () => {
    const recentRepo = createInMemoryRecentRepo([
      { projectKey: 'PAY', lastAccessedAt: new Date('2026-05-20T10:00:00Z'), accessCount: 3 },
    ]);
    const app = buildProjectsApp({
      acquireSession: async () => mockSession.session,
      recentRepo,
    });
    const res = await request(app).get('/api/v1/projects/recent');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ key: 'PAY', openIssueCount: expect.any(Number) }),
      ]),
      dataFreshness: { source: 'live', fetchedAt: expect.any(String) },
    });
    expect(res.body.items.length).toBeLessThanOrEqual(5);
  });

  it('GET /api/v1/projects/search?q returns filtered items[] + dataFreshness', async () => {
    const app = buildProjectsApp({
      acquireSession: async () => mockSession.session,
      recentRepo: createInMemoryRecentRepo(),
    });
    const res = await request(app).get('/api/v1/projects/search').query({ q: 'pay' });
    expect(res.status).toBe(200);
    expect(res.body.dataFreshness.source).toBe('live');
    expect(res.body.items.map((i: { key: string }) => i.key)).toContain('PAY');
    expect(res.body.items.map((i: { key: string }) => i.key)).not.toContain('CORE');
  });

  it('GET /api/v1/projects/search without q returns 400 problem', async () => {
    const app = buildProjectsApp({
      acquireSession: async () => mockSession.session,
      recentRepo: createInMemoryRecentRepo(),
    });
    const res = await request(app).get('/api/v1/projects/search');
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });

  it('GET /api/v1/projects/{key} returns ProjectDashboard with topAssignees', async () => {
    mockSession = createMockSession({
      list_projects: () => projectsFixture,
      search_issues: (args) => {
        // 對 topAssignees 的 JQL 回 2 個人；其他回 0
        const jql = String(args['jql'] ?? '');
        if (jql.includes('assignee is not EMPTY')) {
          return {
            total: 2,
            issues: [
              {
                key: 'PAY-1',
                fields: {
                  summary: 'A',
                  assignee: { accountId: 'acc-1', displayName: 'Alice' },
                  customfield_10016: 3,
                },
              },
              {
                key: 'PAY-2',
                fields: {
                  summary: 'B',
                  assignee: { accountId: 'acc-1', displayName: 'Alice' },
                  customfield_10016: 5,
                },
              },
            ],
          };
        }
        return { total: 4, issues: [] };
      },
    });
    const app = buildProjectsApp({
      acquireSession: async () => mockSession.session,
      recentRepo: createInMemoryRecentRepo(),
    });
    const res = await request(app).get('/api/v1/projects/PAY');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      key: 'PAY',
      name: 'Payments',
      openIssueCount: 4,
      topAssignees: [
        expect.objectContaining({
          person: { accountId: 'acc-1', displayName: 'Alice' },
          openIssueCount: 2,
          totalSP: 8,
        }),
      ],
      dataFreshness: { source: 'live' },
    });
  });

  it('GET /api/v1/projects/{key} 404 problem when not visible', async () => {
    const app = buildProjectsApp({
      acquireSession: async () => mockSession.session,
      recentRepo: createInMemoryRecentRepo(),
    });
    const res = await request(app).get('/api/v1/projects/NOPE');
    expect(res.status).toBe(404);
    expect(res.body.cause).toBe('not_found');
  });
});
