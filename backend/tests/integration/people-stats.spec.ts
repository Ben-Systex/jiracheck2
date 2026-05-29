// T061：以 mock issues 驗 totals + byProject + estimateAccuracyRatio 計算

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildPeopleApp } from '../helpers/people-app';
import { createMockSession } from '../helpers/mcp-mock';

describe('people stats integration', () => {
  it('aggregates totals and byProject; estimateAccuracyRatio rounded to 3 decimals', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 5,
        issues: [
          // PAY：planned 7 / actual 10 → 0.7
          { key: 'PAY-1', fields: { summary: 'a', status: { name: 'Done' }, project: { key: 'PAY' }, customfield_10016: 3, customfield_10100: 4 } },
          { key: 'PAY-2', fields: { summary: 'b', status: { name: 'Done' }, project: { key: 'PAY' }, customfield_10016: 4, customfield_10100: 6 } },
          // BILL：planned 5 / actual 3 → 1.667
          { key: 'BILL-1', fields: { summary: 'c', status: { name: 'Done' }, project: { key: 'BILL' }, customfield_10016: 5, customfield_10100: 3 } },
          // 無 SP/ActualSP（應視作 0）
          { key: 'CORE-1', fields: { summary: 'd', status: { name: 'Done' }, project: { key: 'CORE' } } },
          { key: 'CORE-2', fields: { summary: 'e', status: { name: 'Done' }, project: { key: 'CORE' } } },
        ],
      }),
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app)
      .get('/api/v1/people/acc-1/stats')
      .query({ from: '2026-04-01', to: '2026-04-30' });
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      completedCount: 5,
      storyPointsSum: 12,
      actualStoryPointsSum: 13,
      estimateAccuracyRatio: 0.923,
    });
    const byKey = new Map<string, unknown>(
      res.body.byProject.map((p: { projectKey: string }) => [p.projectKey, p]),
    );
    expect(byKey.get('PAY')).toMatchObject({ completedCount: 2, storyPointsSum: 7, actualStoryPointsSum: 10 });
    expect(byKey.get('BILL')).toMatchObject({ completedCount: 1, storyPointsSum: 5 });
    expect(byKey.get('CORE')).toMatchObject({ completedCount: 2, storyPointsSum: 0 });
  });

  it('estimateAccuracyRatio is null when actualStoryPointsSum=0', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        issues: [
          { key: 'X-1', fields: { summary: 'a', status: { name: 'Done' }, project: { key: 'X' }, customfield_10016: 3 } },
        ],
      }),
    });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    const res = await request(app)
      .get('/api/v1/people/acc-1/stats')
      .query({ from: '2026-04-01', to: '2026-04-30' });
    expect(res.body.totals.estimateAccuracyRatio).toBeNull();
  });

  it('JQL contains resolved range', async () => {
    const mock = createMockSession({ search_issues: () => ({ issues: [] }) });
    const app = buildPeopleApp({ acquireSession: async () => mock.session });
    await request(app)
      .get('/api/v1/people/acc-1/stats')
      .query({ from: '2026-04-01', to: '2026-04-30' });
    const jql = String(mock.calls[0]!.arguments['jql'] ?? '');
    expect(jql).toContain('statusCategory = Done');
    expect(jql).toContain('resolved >= "2026-04-01"');
    expect(jql).toContain('resolved <= "2026-04-30"');
  });
});
