// T091：services/bulk/preview 單元測試——buildJql / extractCurrentValue / isEditable / 命中筆數上限
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { McpSession } from '../../mcp/types';
import { previewBulkUpdate, BulkPreviewError } from './preview';
import { generateKeyBase64 } from '../auth/token-crypto';

function mockSession(resolver: (jql: string) => unknown): McpSession {
  return {
    callTool: vi.fn(async ({ arguments: args }) => ({
      content: resolver((args as { jql: string }).jql),
    })),
  } as unknown as McpSession;
}

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = generateKeyBase64();
});

describe('previewBulkUpdate', () => {
  it('targetField 非白名單 → BulkPreviewError(validation)', async () => {
    const session = mockSession(() => ({ issues: [] }));
    await expect(
      previewBulkUpdate(session, {
        userId: 'u',
        projectKey: 'P',
        filter: {},
        targetField: 'forbidden' as unknown as 'label',
        targetValue: 'x',
      }),
    ).rejects.toBeInstanceOf(BulkPreviewError);
  });

  it('命中超過 200 → BulkPreviewError(too_many)', async () => {
    const session = mockSession(() => ({
      total: 250,
      issues: Array.from({ length: 201 }, (_, i) => ({ key: `P-${i}`, fields: {} })),
    }));
    try {
      await previewBulkUpdate(session, {
        userId: 'u',
        projectKey: 'P',
        filter: {},
        targetField: 'label',
        targetValue: ['x'],
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BulkPreviewError);
      expect((err as BulkPreviewError).code).toBe('too_many');
      expect((err as BulkPreviewError).totalCount).toBe(250);
    }
  });

  it('buildJql 帶 statuses / assignee / sprint / label / issuetype / dueDateRange', async () => {
    let seenJql = '';
    const session = mockSession((jql) => {
      seenJql = jql;
      return { total: 0, issues: [] };
    });
    await previewBulkUpdate(session, {
      userId: 'u',
      projectKey: 'PRJ "X"', // 確認 escape
      filter: {
        statuses: ['Open'],
        assigneeAccountIds: ['acc-1'],
        sprintNames: ['Sprint 1'],
        labels: ['lab'],
        issueTypes: ['Bug'],
        dueDateRange: { from: '2026-01-01', to: '2026-02-01' },
      },
      targetField: 'label',
      targetValue: ['new'],
    });
    expect(seenJql).toMatch(/project = "PRJ \\"X\\""/);
    expect(seenJql).toMatch(/status in \("Open"\)/);
    expect(seenJql).toMatch(/assignee in \("acc-1"\)/);
    expect(seenJql).toMatch(/sprint in \("Sprint 1"\)/);
    expect(seenJql).toMatch(/labels in \("lab"\)/);
    expect(seenJql).toMatch(/issuetype in \("Bug"\)/);
    expect(seenJql).toMatch(/duedate >= "2026-01-01"/);
    expect(seenJql).toMatch(/duedate <= "2026-02-01"/);
  });

  it('extractCurrentValue / isEditable：各 target field 路徑', async () => {
    // assignee 路徑
    let session = mockSession(() => ({
      issues: [
        {
          key: 'P-1',
          fields: {
            assignee: { accountId: 'a', displayName: 'A' },
            editmeta: { fields: { assignee: {} } },
          },
        },
      ],
    }));
    let res = await previewBulkUpdate(session, {
      userId: 'u',
      projectKey: 'P',
      filter: {},
      targetField: 'assignee',
      targetValue: { accountId: 'b' },
    });
    expect(res.items[0]!.currentValue).toEqual({ accountId: 'a', displayName: 'A' });
    expect(res.items[0]!.editableByUser).toBe(true);

    // due_date / 無 editmeta → 預設 editable true
    session = mockSession(() => ({
      issues: [{ key: 'P-2', fields: { duedate: '2026-06-30' } }],
    }));
    res = await previewBulkUpdate(session, {
      userId: 'u',
      projectKey: 'P',
      filter: {},
      targetField: 'due_date',
      targetValue: '2026-07-01',
    });
    expect(res.items[0]!.currentValue).toBe('2026-06-30');
    expect(res.items[0]!.editableByUser).toBe(true);

    // priority / 有 editmeta 但 key 不在 → editable false
    session = mockSession(() => ({
      issues: [
        {
          key: 'P-3',
          fields: {
            priority: { name: 'High' },
            editmeta: { fields: { duedate: {} } },
          },
        },
      ],
    }));
    res = await previewBulkUpdate(session, {
      userId: 'u',
      projectKey: 'P',
      filter: {},
      targetField: 'priority',
      targetValue: 'Low',
    });
    expect(res.items[0]!.currentValue).toBe('High');
    expect(res.items[0]!.editableByUser).toBe(false);

    // sprint 路徑（陣列）
    session = mockSession(() => ({
      issues: [
        {
          key: 'P-4',
          fields: { customfield_10020: [{ name: 'Sprint A' }] },
        },
      ],
    }));
    res = await previewBulkUpdate(session, {
      userId: 'u',
      projectKey: 'P',
      filter: {},
      targetField: 'sprint',
      targetValue: 'Sprint B',
    });
    expect(Array.isArray(res.items[0]!.currentValue)).toBe(true);

    // label：無 → 空陣列
    session = mockSession(() => ({
      issues: [{ key: 'P-5', fields: {} }],
    }));
    res = await previewBulkUpdate(session, {
      userId: 'u',
      projectKey: 'P',
      filter: {},
      targetField: 'label',
      targetValue: ['lab'],
    });
    expect(res.items[0]!.currentValue).toEqual([]);
  });

  it('回傳含可驗證的 previewToken', async () => {
    const session = mockSession(() => ({
      issues: [{ key: 'P-1', fields: { duedate: '2026-06-30' } }],
    }));
    const res = await previewBulkUpdate(session, {
      userId: 'u-1',
      projectKey: 'P',
      filter: {},
      targetField: 'due_date',
      targetValue: '2026-07-01',
    });
    expect(typeof res.previewToken).toBe('string');
    expect(res.totalCount).toBe(1);
  });
});
