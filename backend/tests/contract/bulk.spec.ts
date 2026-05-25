// T072：US4 契約測試
// 對 /bulk/preview、/bulk/apply、/bulk/operations/{id} 響應形狀

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildBulkApp, createInMemoryBulkRepo } from '../helpers/bulk-app';
import { createMockSession } from '../helpers/mcp-mock';

beforeAll(() => {
  process.env.BULK_PREVIEW_SECRET = 'unit-test-secret';
});

describe('bulk contract', () => {
  it('POST /bulk/preview returns previewToken + totalCount + items', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 2,
        issues: [
          { key: 'PAY-1', fields: { summary: 's1', project: { key: 'PAY' }, assignee: { accountId: 'a', displayName: 'A' } } },
          { key: 'PAY-2', fields: { summary: 's2', project: { key: 'PAY' }, assignee: null } },
        ],
      }),
    });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const res = await request(app)
      .post('/api/v1/bulk/preview')
      .send({ projectKey: 'PAY', filter: {}, targetField: 'assignee', targetValue: 'acc-new' });
    expect(res.status).toBe(200);
    expect(res.body.previewToken).toMatch(/.+\..+/);
    expect(res.body.totalCount).toBe(2);
    expect(res.body.items[0]).toMatchObject({ issueKey: 'PAY-1', editableByUser: true });
  });

  it('POST /bulk/preview rejects non-whitelist targetField', async () => {
    const mock = createMockSession({ search_issues: () => ({ issues: [] }) });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const res = await request(app)
      .post('/api/v1/bulk/preview')
      .send({ projectKey: 'PAY', filter: {}, targetField: 'status', targetValue: 'Done' });
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });

  it('POST /bulk/apply with wrong confirmText returns 409', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 2,
        issues: [
          { key: 'PAY-1', fields: { summary: 's1', project: { key: 'PAY' } } },
          { key: 'PAY-2', fields: { summary: 's2', project: { key: 'PAY' } } },
        ],
      }),
    });
    const repo = createInMemoryBulkRepo();
    const app = buildBulkApp({ acquireSession: async () => mock.session, repo });
    const prev = await request(app)
      .post('/api/v1/bulk/preview')
      .send({ projectKey: 'PAY', filter: {}, targetField: 'assignee', targetValue: 'acc-new' });
    expect(prev.status).toBe(200);

    const res = await request(app)
      .post('/api/v1/bulk/apply')
      .send({ previewToken: prev.body.previewToken, confirmText: '更新 2 筆', confirmCount: 2 });
    expect(res.status).toBe(409);
    expect(res.body.cause).toBe('conflict');
  });

  it('POST /bulk/apply happy path returns 202 + operationId', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 2,
        issues: [
          { key: 'PAY-1', fields: { summary: 's1', project: { key: 'PAY' } } },
          { key: 'PAY-2', fields: { summary: 's2', project: { key: 'PAY' } } },
        ],
      }),
      edit_issue: () => ({ ok: true }),
    });
    const repo = createInMemoryBulkRepo();
    const app = buildBulkApp({ acquireSession: async () => mock.session, repo });
    const prev = await request(app)
      .post('/api/v1/bulk/preview')
      .send({ projectKey: 'PAY', filter: {}, targetField: 'assignee', targetValue: 'acc-new' });

    const res = await request(app)
      .post('/api/v1/bulk/apply')
      .send({ previewToken: prev.body.previewToken, confirmText: '確認更新 2 筆', confirmCount: 2 });
    expect(res.status).toBe(202);
    expect(res.body.operationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /bulk/operations/{id} returns BulkOperation shape', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 1,
        issues: [{ key: 'PAY-1', fields: { summary: 's1', project: { key: 'PAY' } } }],
      }),
      edit_issue: () => ({ ok: true }),
    });
    const repo = createInMemoryBulkRepo();
    const app = buildBulkApp({ acquireSession: async () => mock.session, repo });
    const prev = await request(app)
      .post('/api/v1/bulk/preview')
      .send({ projectKey: 'PAY', filter: {}, targetField: 'label', targetValue: ['hot'] });
    const apply = await request(app)
      .post('/api/v1/bulk/apply')
      .send({ previewToken: prev.body.previewToken, confirmText: '確認更新 1 筆', confirmCount: 1 });
    // 等背景作業完成（直接 await done 太隱晦；用 polling/微 sleep）
    await new Promise((r) => setTimeout(r, 30));

    const res = await request(app).get(`/api/v1/bulk/operations/${apply.body.operationId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: apply.body.operationId,
      status: 'success',
      totalCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [expect.objectContaining({ issueKey: 'PAY-1', result: 'success' })],
    });
  });

  it('GET /bulk/operations/{id} 404 for other user', async () => {
    const mock = createMockSession({
      search_issues: () => ({ total: 1, issues: [{ key: 'PAY-1', fields: { summary: 'x', project: { key: 'PAY' } } }] }),
      edit_issue: () => ({ ok: true }),
    });
    const repo = createInMemoryBulkRepo();
    // user A 建立
    const appA = buildBulkApp({ userId: 'A', acquireSession: async () => mock.session, repo });
    const prev = await request(appA).post('/api/v1/bulk/preview').send({ projectKey: 'PAY', filter: {}, targetField: 'label', targetValue: ['x'] });
    const apply = await request(appA).post('/api/v1/bulk/apply').send({ previewToken: prev.body.previewToken, confirmText: '確認更新 1 筆', confirmCount: 1 });

    // user B 查 → 404
    const appB = buildBulkApp({ userId: 'B', acquireSession: async () => mock.session, repo });
    const res = await request(appB).get(`/api/v1/bulk/operations/${apply.body.operationId}`);
    expect(res.status).toBe(404);
  });
});
