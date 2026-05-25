// T030：呼叫 /projects/{key} 後 recent_project_access 應 upsert，
// 並反映於 /projects/recent 的順序。
// 採 in-memory repo（與真實 DB 介面一致）+ mock MCP；避免 Testcontainers
// 在本地預設啟動。Phase 7 會切到 real PG。

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildProjectsApp, createInMemoryRecentRepo } from '../helpers/projects-app';
import { createMockSession } from '../helpers/mcp-mock';

describe('recent-access integration', () => {
  it('upserts recent_project_access and reflects new order on /projects/recent', async () => {
    const projects = {
      projects: [
        { key: 'PAY', name: 'Payments' },
        { key: 'BILL', name: 'Billing' },
        { key: 'CORE', name: 'Core' },
      ],
    };
    const mock = createMockSession({
      list_projects: () => projects,
      search_issues: () => ({ total: 0, issues: [] }),
    });
    const repo = createInMemoryRecentRepo([
      { projectKey: 'PAY', lastAccessedAt: new Date('2026-05-20T10:00:00Z'), accessCount: 1 },
      { projectKey: 'BILL', lastAccessedAt: new Date('2026-05-21T10:00:00Z'), accessCount: 1 },
    ]);
    const app = buildProjectsApp({
      acquireSession: async () => mock.session,
      recentRepo: repo,
    });
    // 第一次：order = BILL, PAY
    const r1 = await request(app).get('/api/v1/projects/recent');
    expect(r1.body.items.map((i: { key: string }) => i.key)).toEqual(['BILL', 'PAY']);

    // 訪問 CORE → upsert
    const visit = await request(app).get('/api/v1/projects/CORE');
    expect(visit.status).toBe(200);

    // 第二次：CORE 應排到第一
    const r2 = await request(app).get('/api/v1/projects/recent');
    expect(r2.body.items[0].key).toBe('CORE');
    expect(r2.body.items.map((i: { key: string }) => i.key)).toHaveLength(3);
  });
});
