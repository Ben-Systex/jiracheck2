// T059：US3 契約測試
// 對 GET /people/search、/{accountId}/issues、/{accountId}/stats 的 OpenAPI 響應斷言

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildPeopleApp } from '../helpers/people-app';
import { createMockSession } from '../helpers/mcp-mock';

const userFixture = {
  users: [
    { accountId: 'acc-1', displayName: 'Alice', emailAddress: 'alice@ex.com' },
    { accountId: 'acc-2', displayName: 'Aaron' },
  ],
};

describe('people contract', () => {
  it('GET /people/search?q returns { items: PersonRef[] }', async () => {
    const mock = createMockSession({ user_search: () => userFixture });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app).get('/api/v1/people/search').query({ q: 'a' });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ accountId: 'acc-1', displayName: 'Alice', email: 'alice@ex.com' }),
      expect.objectContaining({ accountId: 'acc-2', displayName: 'Aaron', email: null }),
    ]);
  });

  it('GET /people/search without q returns 400 problem', async () => {
    const mock = createMockSession({ user_search: () => userFixture });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app).get('/api/v1/people/search');
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });

  it('GET /people/{accountId}/issues returns IssueList shape with dataFreshness', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 2,
        startAt: 0,
        issues: [
          {
            key: 'PAY-1',
            fields: {
              summary: 'a',
              status: { name: 'In Progress' },
              project: { key: 'PAY' },
              duedate: '2026-06-01',
              labels: ['x'],
            },
          },
          {
            key: 'BILL-2',
            fields: {
              summary: 'b',
              status: { name: 'To Do' },
              project: { key: 'BILL' },
            },
          },
        ],
      }),
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app).get('/api/v1/people/acc-1/issues');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: [
        expect.objectContaining({ key: 'PAY-1', projectKey: 'PAY', dueDate: '2026-06-01' }),
        expect.objectContaining({ key: 'BILL-2', projectKey: 'BILL' }),
      ],
      dataFreshness: { source: 'live' },
      partialPermission: false,
    });
    expect(res.body.nextCursor).toBeNull();
  });

  it('GET /people/{accountId}/stats returns totals + byProject + items', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 3,
        issues: [
          {
            key: 'PAY-1',
            fields: {
              summary: 'a',
              status: { name: 'Done' },
              project: { key: 'PAY' },
              customfield_10016: 3,
              customfield_10100: 2,
            },
          },
          {
            key: 'PAY-2',
            fields: {
              summary: 'b',
              status: { name: 'Done' },
              project: { key: 'PAY' },
              customfield_10016: 5,
              customfield_10100: 6,
            },
          },
          {
            key: 'BILL-9',
            fields: {
              summary: 'c',
              status: { name: 'Done' },
              project: { key: 'BILL' },
              customfield_10016: 2,
              customfield_10100: 2,
            },
          },
        ],
      }),
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app)
      .get('/api/v1/people/acc-1/stats')
      .query({ from: '2026-04-01', to: '2026-04-30' });
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      completedCount: 3,
      storyPointsSum: 10,
      actualStoryPointsSum: 10,
      estimateAccuracyRatio: 1,
    });
    expect(res.body.byProject).toEqual([
      expect.objectContaining({
        projectKey: 'PAY',
        completedCount: 2,
        storyPointsSum: 8,
        actualStoryPointsSum: 8,
      }),
      expect.objectContaining({ projectKey: 'BILL', completedCount: 1 }),
    ]);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.dataFreshness.source).toBe('live');
  });

  it('GET /people/{accountId}/stats validates from/to format', async () => {
    const mock = createMockSession({ search_issues: () => ({ issues: [] }) });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app)
      .get('/api/v1/people/acc-1/stats')
      .query({ from: '2026/04/01', to: '2026-04-30' });
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });
});
