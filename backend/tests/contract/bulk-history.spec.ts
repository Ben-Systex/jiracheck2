// T112：GET /bulk/operations 契約測試（query 組合 + 分頁）

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildBulkApp, createInMemoryBulkRepo } from '../helpers/bulk-app';
import { createMockSession } from '../helpers/mcp-mock';

async function seedOperations(repo: ReturnType<typeof createInMemoryBulkRepo>, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { id } = await repo.createOperation({
      userId: 'user-1',
      projectKey: i % 2 === 0 ? 'PAY' : 'BILL',
      filterDsl: {},
      targetField: 'assignee',
      targetValueJson: 'acc-x',
      totalCount: 1,
      // 早到晚 — confirmed_at 不重複
      confirmedAt: new Date(Date.UTC(2026, 0, i + 1, 12, 0, 0)),
    });
    ids.push(id);
  }
  return ids;
}

describe('GET /bulk/operations', () => {
  it('lists user operations DESC + filter by projectKey', async () => {
    const repo = createInMemoryBulkRepo();
    await seedOperations(repo, 5);
    const app = buildBulkApp({
      acquireSession: async () => createMockSession({}).session,
      repo,
    });
    const res = await request(app).get('/api/v1/bulk/operations').query({ projectKey: 'PAY' });
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: { projectKey: string }) => i.projectKey === 'PAY')).toBe(true);
    expect(res.body.items[0].startedAt > res.body.items[1].startedAt).toBe(true);
  });

  it('pagination: pageSize + cursor', async () => {
    const repo = createInMemoryBulkRepo();
    await seedOperations(repo, 5);
    const app = buildBulkApp({
      acquireSession: async () => createMockSession({}).session,
      repo,
    });
    const p1 = await request(app).get('/api/v1/bulk/operations').query({ pageSize: 2 });
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).not.toBeNull();

    const p2 = await request(app)
      .get('/api/v1/bulk/operations')
      .query({ pageSize: 2, cursor: p1.body.nextCursor });
    expect(p2.body.items).toHaveLength(2);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
  });

  it('status filter', async () => {
    const repo = createInMemoryBulkRepo();
    const ids = await seedOperations(repo, 3);
    await repo.finalize({ operationId: ids[0]!, status: 'success', successCount: 1, failureCount: 0, completedAt: new Date() });
    await repo.finalize({ operationId: ids[1]!, status: 'partial_failure', successCount: 1, failureCount: 1, completedAt: new Date() });
    const app = buildBulkApp({
      acquireSession: async () => createMockSession({}).session,
      repo,
    });
    const res = await request(app).get('/api/v1/bulk/operations').query({ status: 'success' });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].status).toBe('success');
  });

  it('cross-user isolation: only own user operations', async () => {
    const repo = createInMemoryBulkRepo();
    await repo.createOperation({
      userId: 'someone-else',
      projectKey: 'PAY',
      filterDsl: {},
      targetField: 'assignee',
      targetValueJson: 'x',
      totalCount: 1,
      confirmedAt: new Date(),
    });
    const app = buildBulkApp({
      userId: 'user-1',
      acquireSession: async () => createMockSession({}).session,
      repo,
    });
    const res = await request(app).get('/api/v1/bulk/operations');
    expect(res.body.items).toEqual([]);
  });
});
