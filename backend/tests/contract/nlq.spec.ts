// T042：US2 契約測試
// 對 POST /nlq/query 三種狀態的回應結構：ok / clarification_needed / partial_permission

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildNlqApp, mockLlm, createInMemoryHistoryRepo } from '../helpers/nlq-app';
import { createMockSession } from '../helpers/mcp-mock';

describe('nlq contract', () => {
  it('status=ok with results when LLM returns valid plan', async () => {
    const llm = mockLlm(JSON.stringify({
      intent: 'count_issues',
      filters: { projectKeys: ['PAY'], statuses: ['Done'] },
    }));
    const session = createMockSession({
      search_issues: () => ({ total: 7, issues: Array.from({ length: 7 }, (_, i) => ({ key: `PAY-${i + 1}`, fields: { summary: 's', project: { key: 'PAY' } } })) }),
    });
    const repo = createInMemoryHistoryRepo();
    const app = buildNlqApp({ llm, acquireSession: async () => session.session, repo });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: 'PAY 已完成多少筆' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      explanationZh: expect.stringContaining('統計'),
      plan: expect.objectContaining({ intent: 'count_issues' }),
      results: { count: 7 },
      dataFreshness: { source: 'live' },
    });
    expect(repo.__all()).toHaveLength(1);
    expect(repo.__all()[0]!.status).toBe('ok');
  });

  it('status=clarification_needed when LLM signals ambiguity', async () => {
    const llm = mockLlm(JSON.stringify({
      needsClarification: true,
      questions: ['請補充時間範圍？', '請指定專案？'],
    }));
    const session = createMockSession({});
    const app = buildNlqApp({ llm, acquireSession: async () => session.session });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: '我做了多少' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('clarification_needed');
    expect(res.body.clarificationQuestions).toEqual(['請補充時間範圍？', '請指定專案？']);
    expect(res.body.results).toBeUndefined();
    expect(res.body.dataFreshness).toBeUndefined();
  });

  it('status=partial_permission when mcp returns partialPermission flag', async () => {
    const llm = mockLlm(JSON.stringify({ intent: 'list_issues', filters: { projectKeys: ['PAY'] } }));
    const session = createMockSession({
      search_issues: () => ({ total: 1, issues: [{ key: 'PAY-1', fields: { summary: 's', project: { key: 'PAY' } } }], partialPermission: true }),
    });
    const app = buildNlqApp({ llm, acquireSession: async () => session.session });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: '列出 PAY 任務' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('partial_permission');
    expect(res.body.dataFreshness).toBeUndefined();
  });

  it('returns 400 when question too long', async () => {
    const llm = mockLlm('{}');
    const app = buildNlqApp({ llm, acquireSession: async () => createMockSession({}).session });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });

  it('returns 400 problem when LLM JSON cannot pass schema', async () => {
    const llm = mockLlm(JSON.stringify({ intent: 'nope', filters: {} }));
    const session = createMockSession({});
    const repo = createInMemoryHistoryRepo();
    const app = buildNlqApp({ llm, acquireSession: async () => session.session, repo });
    const res = await request(app).post('/api/v1/nlq/query').send({ question: '亂問' });
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
    // 仍寫一筆 error history
    expect(repo.__all()).toHaveLength(1);
    expect(repo.__all()[0]!.status).toBe('error');
  });
});
