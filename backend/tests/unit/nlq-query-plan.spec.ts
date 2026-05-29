// T044：QueryPlan schema 合法 / 不合法 + explanation snapshot

import { describe, it, expect } from 'vitest';
import { QueryPlanSchema } from '../../src/services/nlq/query-plan.schema';
import { explainPlanZh, planToJql } from '../../src/services/nlq/translator';

describe('QueryPlanSchema', () => {
  it('accepts a minimal list_issues plan', () => {
    const r = QueryPlanSchema.safeParse({ intent: 'list_issues', filters: {} });
    expect(r.success).toBe(true);
  });

  it('rejects unknown intent', () => {
    const r = QueryPlanSchema.safeParse({ intent: 'foo', filters: {} });
    expect(r.success).toBe(false);
  });

  it('top_n_assignees requires topN', () => {
    const r = QueryPlanSchema.safeParse({ intent: 'top_n_assignees', filters: {} });
    expect(r.success).toBe(false);
  });

  it('group_count requires groupBy', () => {
    const r = QueryPlanSchema.safeParse({ intent: 'group_count', filters: {} });
    expect(r.success).toBe(false);
  });

  it('rejects topN > 50', () => {
    const r = QueryPlanSchema.safeParse({ intent: 'top_n_assignees', filters: {}, topN: 51 });
    expect(r.success).toBe(false);
  });

  it('accepts full plan with filters + groupBy', () => {
    const r = QueryPlanSchema.safeParse({
      intent: 'group_count',
      filters: { projectKeys: ['PAY'], createdRange: { from: '2026-04-01', to: '2026-04-30' } },
      groupBy: 'status',
    });
    expect(r.success).toBe(true);
  });
});

describe('explainPlanZh', () => {
  it('returns 中文 summary mentioning intent and filters', () => {
    const text = explainPlanZh({
      intent: 'count_issues',
      filters: {
        projectKeys: ['PAY', 'BILL'],
        statuses: ['Done'],
        createdRange: { from: '2026-04-01', to: '2026-04-30' },
      },
      groupBy: null,
      topN: null,
    });
    expect(text).toContain('統計符合條件的任務數');
    expect(text).toContain('PAY');
    expect(text).toContain('Done');
    expect(text).toContain('2026-04-01');
  });

  it('top_n_assignees mentions Top N', () => {
    const text = explainPlanZh({
      intent: 'top_n_assignees',
      filters: {},
      groupBy: null,
      topN: 5,
    });
    expect(text).toContain('取前 5 名');
  });
});

describe('planToJql', () => {
  it('builds JQL with project + status', () => {
    const jql = planToJql({
      intent: 'list_issues',
      filters: { projectKeys: ['PAY'], statuses: ['Done'] },
      groupBy: null,
      topN: null,
    });
    expect(jql).toContain('project in ("PAY")');
    expect(jql).toContain('status in ("Done")');
  });
});
