// T076：每次套用皆寫入 bulk_update_operations + bulk_update_items；可由 /bulk/operations/{id} 查詢

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildBulkApp, createInMemoryBulkRepo } from '../helpers/bulk-app';
import { createMockSession } from '../helpers/mcp-mock';

beforeAll(() => {
  process.env.BULK_PREVIEW_SECRET = 'unit-test-secret';
});

describe('bulk audit integration', () => {
  it('persists operation + each item via repository on apply', async () => {
    const issues = [
      { key: 'PAY-1', fields: { summary: 'a', project: { key: 'PAY' } } },
      { key: 'PAY-2', fields: { summary: 'b', project: { key: 'PAY' } } },
      { key: 'PAY-3', fields: { summary: 'c', project: { key: 'PAY' } } },
    ];
    const mock = createMockSession({
      search_issues: () => ({ total: 3, issues }),
      edit_issue: (args) =>
        args['issueKey'] === 'PAY-2'
          ? { ok: false, error: { code: 'api_error', message: 'Jira 5xx' } }
          : { ok: true },
    });
    const repo = createInMemoryBulkRepo();
    const app = buildBulkApp({ acquireSession: async () => mock.session, repo });

    const prev = await request(app).post('/api/v1/bulk/preview').send({
      projectKey: 'PAY',
      filter: { labels: ['hot'] },
      targetField: 'label',
      targetValue: ['migrated'],
    });
    const apply = await request(app).post('/api/v1/bulk/apply').send({
      previewToken: prev.body.previewToken,
      confirmText: '確認更新 3 筆',
      confirmCount: 3,
    });
    await new Promise((r) => setTimeout(r, 30));

    const ops = repo.__all();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.targetField).toBe('label');
    expect(ops[0]!.projectKey).toBe('PAY');
    expect(ops[0]!.status).toBe('partial_failure');
    expect(ops[0]!.successCount).toBe(2);
    expect(ops[0]!.failureCount).toBe(1);
    expect(ops[0]!.items.size).toBe(3);

    // /bulk/operations/{id} 可查
    const dto = await request(app).get(`/api/v1/bulk/operations/${apply.body.operationId}`);
    expect(dto.status).toBe(200);
    expect(dto.body.items.find((i: { issueKey: string }) => i.issueKey === 'PAY-2')).toMatchObject({
      result: 'api_error',
      errorMessage: 'Jira 5xx',
    });
  });
});
