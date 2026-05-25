// T074：bulk preview integration — acceptance #1 / #3 / #5

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildBulkApp } from '../helpers/bulk-app';
import { createMockSession } from '../helpers/mcp-mock';

beforeAll(() => {
  process.env.BULK_PREVIEW_SECRET = 'unit-test-secret';
});

describe('bulk preview integration', () => {
  it('acceptance #1: 列出符合條件 issue 含 key/summary/currentValue/proposedValue', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 2,
        issues: [
          {
            key: 'PAY-1',
            fields: {
              summary: 'Issue A',
              project: { key: 'PAY' },
              assignee: { accountId: 'acc-old-1', displayName: 'Old1' },
            },
          },
          {
            key: 'PAY-2',
            fields: {
              summary: 'Issue B',
              project: { key: 'PAY' },
              assignee: { accountId: 'acc-old-2', displayName: 'Old2' },
            },
          },
        ],
      }),
    });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const res = await request(app).post('/api/v1/bulk/preview').send({
      projectKey: 'PAY',
      filter: { sprintNames: ['Sprint 24'], statuses: ['To Do'] },
      targetField: 'assignee',
      targetValue: 'acc-new',
    });
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(2);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        issueKey: 'PAY-1',
        summary: 'Issue A',
        currentValue: expect.objectContaining({ accountId: 'acc-old-1' }),
        proposedValue: 'acc-new',
      }),
      expect.objectContaining({ issueKey: 'PAY-2' }),
    ]);

    // JQL 應含篩選條件
    const jql = String(mock.calls[0]!.arguments['jql'] ?? '');
    expect(jql).toContain('project = "PAY"');
    expect(jql).toContain('sprint in ("Sprint 24")');
    expect(jql).toContain('status in ("To Do")');
  });

  it('acceptance #3: editmeta 缺欄位 → editableByUser=false', async () => {
    const mock = createMockSession({
      search_issues: () => ({
        total: 2,
        issues: [
          {
            key: 'PAY-1',
            fields: {
              summary: 'editable',
              project: { key: 'PAY' },
              assignee: null,
              editmeta: { fields: { assignee: {} } },
            },
          },
          {
            key: 'PAY-2',
            fields: {
              summary: 'not editable',
              project: { key: 'PAY' },
              assignee: null,
              editmeta: { fields: { /* no assignee */ summary: {} } },
            },
          },
        ],
      }),
    });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const res = await request(app).post('/api/v1/bulk/preview').send({
      projectKey: 'PAY',
      filter: {},
      targetField: 'assignee',
      targetValue: 'acc-new',
    });
    expect(res.body.items.find((i: { issueKey: string }) => i.issueKey === 'PAY-1').editableByUser).toBe(true);
    expect(res.body.items.find((i: { issueKey: string }) => i.issueKey === 'PAY-2').editableByUser).toBe(false);
  });

  it('acceptance #5: 0 筆預覽仍 200，items=[]、totalCount=0', async () => {
    const mock = createMockSession({ search_issues: () => ({ total: 0, issues: [] }) });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const res = await request(app).post('/api/v1/bulk/preview').send({
      projectKey: 'PAY',
      filter: {},
      targetField: 'label',
      targetValue: ['hot'],
    });
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it('FR-046: total > 200 → 400 problem', async () => {
    const issues = Array.from({ length: 201 }, (_, i) => ({
      key: `PAY-${i + 1}`,
      fields: { summary: 's', project: { key: 'PAY' } },
    }));
    const mock = createMockSession({ search_issues: () => ({ total: 201, issues }) });
    const app = buildBulkApp({ acquireSession: async () => mock.session });
    const res = await request(app).post('/api/v1/bulk/preview').send({
      projectKey: 'PAY',
      filter: {},
      targetField: 'label',
      targetValue: ['x'],
    });
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });
});
