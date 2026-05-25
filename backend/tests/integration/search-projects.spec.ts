// T031：mock MCP 回 10 個專案 → 搜尋 "pay" 過濾出 3 筆
// 同時驗證搜尋結果不會 enrich（openIssueCount = 0）

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildProjectsApp, createInMemoryRecentRepo } from '../helpers/projects-app';
import { createMockSession } from '../helpers/mcp-mock';

describe('search-projects integration', () => {
  it('filters projects by q (case-insensitive) and does not enrich each item', async () => {
    const projects = {
      projects: [
        { key: 'PAY', name: 'Payments' },
        { key: 'PAY2', name: 'Payments Refund' },
        { key: 'BILL', name: 'Billing' },
        { key: 'CORE', name: 'Core' },
        { key: 'OPS', name: 'Operations' },
        { key: 'NET', name: 'Network' },
        { key: 'INF', name: 'Infrastructure' },
        { key: 'API', name: 'API Gateway' },
        { key: 'AUTH', name: 'Auth Service' },
        { key: 'PAYG', name: 'Pay-as-you-go' },
      ],
    };
    const mock = createMockSession({
      list_projects: () => projects,
      search_issues: () => ({ total: 99, issues: [] }),
    });
    const app = buildProjectsApp({
      acquireSession: async () => mock.session,
      recentRepo: createInMemoryRecentRepo(),
    });

    const res = await request(app).get('/api/v1/projects/search').query({ q: 'pay' });
    expect(res.status).toBe(200);
    const keys = res.body.items.map((i: { key: string }) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['PAY', 'PAY2', 'PAYG']));
    expect(keys).toHaveLength(3);
    // 不 enrich：openIssueCount 應為 0、sprintProgress 為 null
    for (const item of res.body.items) {
      expect(item.openIssueCount).toBe(0);
      expect(item.sprintProgress).toBeNull();
    }
    // search_issues 不應被呼叫（驗證沒有 N+1）
    const searchCalls = mock.calls.filter((c) => c.name === 'search_issues');
    expect(searchCalls).toHaveLength(0);
  });
});
