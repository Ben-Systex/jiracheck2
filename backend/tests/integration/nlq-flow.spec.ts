// T045：mocked Anthropic + mocked MCP 全流程；涵蓋 acceptance #1–#4

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildNlqApp, mockLlm, createInMemoryHistoryRepo } from '../helpers/nlq-app';
import { createMockSession } from '../helpers/mcp-mock';

describe('nlq integration flow', () => {
  it('acceptance #1: list_issues 黃金路徑寫入 history', async () => {
    const llm = mockLlm(JSON.stringify({
      intent: 'list_issues',
      filters: { projectKeys: ['PAY'], statuses: ['In Progress'] },
    }));
    const session = createMockSession({
      search_issues: () => ({
        total: 2,
        issues: [
          { key: 'PAY-1', fields: { summary: 'a', status: { name: 'In Progress' }, project: { key: 'PAY' }, assignee: { accountId: 'acc-1', displayName: 'Alice' } } },
          { key: 'PAY-2', fields: { summary: 'b', status: { name: 'In Progress' }, project: { key: 'PAY' }, assignee: null } },
        ],
      }),
    });
    const repo = createInMemoryHistoryRepo();
    const app = buildNlqApp({ llm, acquireSession: async () => session.session, repo });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: '列出 PAY 進行中任務' });
    expect(res.status).toBe(200);
    expect(res.body.results.items).toHaveLength(2);
    expect(repo.__all()[0]).toMatchObject({ resultCount: 2, status: 'ok' });
  });

  it('acceptance #2: sum_story_points 聚合', async () => {
    const llm = mockLlm(JSON.stringify({
      intent: 'sum_story_points',
      filters: { projectKeys: ['PAY'] },
    }));
    const session = createMockSession({
      search_issues: () => ({
        total: 3,
        issues: [
          { key: 'PAY-1', fields: { project: { key: 'PAY' }, customfield_10016: 3 } },
          { key: 'PAY-2', fields: { project: { key: 'PAY' }, customfield_10016: 5 } },
          { key: 'PAY-3', fields: { project: { key: 'PAY' }, customfield_10016: 2 } },
        ],
      }),
    });
    const app = buildNlqApp({ llm, acquireSession: async () => session.session });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: 'PAY 任務的 SP 總和' });
    expect(res.body.results).toEqual({ sum: 10 });
  });

  it('acceptance #3: top_n_assignees with topN=3', async () => {
    const llm = mockLlm(JSON.stringify({
      intent: 'top_n_assignees',
      filters: {},
      topN: 3,
    }));
    const session = createMockSession({
      search_issues: () => ({
        total: 5,
        issues: [
          { key: 'X-1', fields: { project: { key: 'X' }, assignee: { accountId: 'a', displayName: 'A' } } },
          { key: 'X-2', fields: { project: { key: 'X' }, assignee: { accountId: 'a', displayName: 'A' } } },
          { key: 'X-3', fields: { project: { key: 'X' }, assignee: { accountId: 'a', displayName: 'A' } } },
          { key: 'X-4', fields: { project: { key: 'X' }, assignee: { accountId: 'b', displayName: 'B' } } },
          { key: 'X-5', fields: { project: { key: 'X' }, assignee: { accountId: 'c', displayName: 'C' } } },
        ],
      }),
    });
    const app = buildNlqApp({ llm, acquireSession: async () => session.session });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: 'Top 3 任務最多人' });
    expect(res.body.results.items).toEqual([
      expect.objectContaining({ person: expect.objectContaining({ accountId: 'a' }), count: 3 }),
      expect.objectContaining({ person: expect.objectContaining({ accountId: 'b' }), count: 1 }),
      expect.objectContaining({ person: expect.objectContaining({ accountId: 'c' }), count: 1 }),
    ]);
  });

  it('acceptance #4: group_count by status', async () => {
    const llm = mockLlm(JSON.stringify({
      intent: 'group_count',
      filters: { projectKeys: ['PAY'] },
      groupBy: 'status',
    }));
    const session = createMockSession({
      search_issues: () => ({
        total: 4,
        issues: [
          { key: 'PAY-1', fields: { project: { key: 'PAY' }, status: { name: 'To Do' } } },
          { key: 'PAY-2', fields: { project: { key: 'PAY' }, status: { name: 'To Do' } } },
          { key: 'PAY-3', fields: { project: { key: 'PAY' }, status: { name: 'Done' } } },
          { key: 'PAY-4', fields: { project: { key: 'PAY' }, status: { name: 'In Progress' } } },
        ],
      }),
    });
    const app = buildNlqApp({ llm, acquireSession: async () => session.session });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: 'PAY 各狀態統計' });
    expect(res.body.results.items).toEqual([
      expect.objectContaining({ key: 'To Do', count: 2 }),
      expect.objectContaining({ key: 'Done', count: 1 }),
      expect.objectContaining({ key: 'In Progress', count: 1 }),
    ]);
  });
});
