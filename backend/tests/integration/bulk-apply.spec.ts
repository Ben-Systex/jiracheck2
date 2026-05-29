// T075：bulk apply integration — acceptance #2 部分失敗 + edge case 版本衝突 + 確認字串錯誤 → 409

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildBulkApp, createInMemoryBulkRepo } from '../helpers/bulk-app';
import { createMockSession } from '../helpers/mcp-mock';

beforeAll(() => {
  process.env.BULK_PREVIEW_SECRET = 'unit-test-secret';
});

async function preview(app: ReturnType<typeof buildBulkApp>, totalCount: number) {
  return request(app).post('/api/v1/bulk/preview').send({
    projectKey: 'PAY',
    filter: {},
    targetField: 'assignee',
    targetValue: 'acc-new',
  }).expect((r) => {
    if (r.status !== 200 || r.body.totalCount !== totalCount) {
      throw new Error(`unexpected preview: ${r.status} totalCount=${r.body.totalCount}`);
    }
  });
}

describe('bulk apply integration', () => {
  it('acceptance #2: 35 筆中 34 成功 1 失敗 → partial_failure，每筆都寫入', async () => {
    const issues = Array.from({ length: 35 }, (_, i) => ({
      key: `PAY-${i + 1}`,
      fields: { summary: 's', project: { key: 'PAY' } },
    }));
    let editCall = 0;
    const mock = createMockSession({
      search_issues: () => ({ total: 35, issues }),
      edit_issue: (args) => {
        editCall += 1;
        if (args['issueKey'] === 'PAY-7') {
          return { ok: false, error: { code: 'permission_denied', message: '無權限' } };
        }
        return { ok: true };
      },
    });
    const repo = createInMemoryBulkRepo();
    const app = buildBulkApp({ acquireSession: async () => mock.session, repo });
    const prev = await preview(app, 35);

    const apply = await request(app).post('/api/v1/bulk/apply').send({
      previewToken: prev.body.previewToken,
      confirmText: '確認更新 35 筆',
      confirmCount: 35,
    });
    expect(apply.status).toBe(202);

    // 等背景作業
    await new Promise((r) => setTimeout(r, 60));

    const op = await request(app).get(`/api/v1/bulk/operations/${apply.body.operationId}`);
    expect(op.body.status).toBe('partial_failure');
    expect(op.body.totalCount).toBe(35);
    expect(op.body.successCount).toBe(34);
    expect(op.body.failureCount).toBe(1);
    expect(op.body.items.find((i: { issueKey: string }) => i.issueKey === 'PAY-7')).toMatchObject({
      result: 'permission_denied',
      errorMessage: '無權限',
    });
    expect(editCall).toBe(35);
  });

  it('edge case：version_conflict 歸類為一筆失敗', async () => {
    const issues = [
      { key: 'PAY-1', fields: { summary: 'x', project: { key: 'PAY' } } },
      { key: 'PAY-2', fields: { summary: 'y', project: { key: 'PAY' } } },
    ];
    const mock = createMockSession({
      search_issues: () => ({ total: 2, issues }),
      edit_issue: (args) =>
        args['issueKey'] === 'PAY-1'
          ? { ok: false, error: { code: 'version_conflict' } }
          : { ok: true },
    });
    const repo = createInMemoryBulkRepo();
    const app = buildBulkApp({ acquireSession: async () => mock.session, repo });
    const prev = await preview(app, 2);
    const apply = await request(app).post('/api/v1/bulk/apply').send({
      previewToken: prev.body.previewToken,
      confirmText: '確認更新 2 筆',
      confirmCount: 2,
    });
    await new Promise((r) => setTimeout(r, 30));
    const op = await request(app).get(`/api/v1/bulk/operations/${apply.body.operationId}`);
    expect(op.body.status).toBe('partial_failure');
    expect(op.body.items.find((i: { issueKey: string }) => i.issueKey === 'PAY-1').result).toBe('version_conflict');
  });

  it('confirmText 格式錯誤 → 409', async () => {
    const mock = createMockSession({
      search_issues: () => ({ total: 2, issues: [
        { key: 'PAY-1', fields: { summary: 'x', project: { key: 'PAY' } } },
        { key: 'PAY-2', fields: { summary: 'y', project: { key: 'PAY' } } },
      ] }),
    });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const prev = await preview(app, 2);
    const res = await request(app).post('/api/v1/bulk/apply').send({
      previewToken: prev.body.previewToken,
      confirmText: 'Confirm 2 items',
      confirmCount: 2,
    });
    expect(res.status).toBe(409);
  });

  it('confirmCount 與 totalCount 不一致 → 409', async () => {
    const mock = createMockSession({
      search_issues: () => ({ total: 2, issues: [
        { key: 'PAY-1', fields: { summary: 'x', project: { key: 'PAY' } } },
        { key: 'PAY-2', fields: { summary: 'y', project: { key: 'PAY' } } },
      ] }),
    });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const prev = await preview(app, 2);
    const res = await request(app).post('/api/v1/bulk/apply').send({
      previewToken: prev.body.previewToken,
      confirmText: '確認更新 3 筆',
      confirmCount: 3,
    });
    expect(res.status).toBe(409);
  });
});
