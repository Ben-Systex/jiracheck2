// T050：CHKPROJ rule-v1 純函式 unit 測試 + buildResult / runner 邊界
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateDelay,
  createChkprojService,
  RULE_VERSION,
  type ProjectCheckInput,
} from './chkproj';
import type { McpSession } from '../../mcp/types';
import type { ProjectCheckListsRepo } from '../../db/repositories/project-check-lists';

const NOW = new Date('2026-06-15T12:00:00Z'); // 月中

function inputOnlySprint(over: Partial<ProjectCheckInput['sprint']> = {}): ProjectCheckInput {
  return {
    projectKey: 'PRJ',
    sprint: {
      startDate: '2026-06-01T00:00:00Z',
      endDate: '2026-06-20T00:00:00Z', // NOW=06-15 → progress ≈ 14.5/19 ≈ 0.76（過半）
      totalStoryPoints: 100,
      completedStoryPoints: 40,
      ...over,
    } as ProjectCheckInput['sprint'],
    openIssues: [],
    now: NOW,
  };
}

function inputOnlyOverdue(issues: Array<{ key: string; dueDate: string | null }>): ProjectCheckInput {
  return { projectKey: 'PRJ', sprint: null, openIssues: issues, now: NOW };
}

describe('evaluateDelay rule-v1', () => {
  it('條件 A only：Sprint 過半 + 完成率 < 50% → delayed', () => {
    const r = evaluateDelay(inputOnlySprint());
    expect(r.delayed).toBe(true);
    expect(r.conditions).toEqual(['A']);
    expect(r.data.sprintProgress).toBeGreaterThan(0.4);
    expect(r.data.completionRatio).toBeCloseTo(0.4, 2);
  });

  it('條件 A：完成率剛好 50% → 不觸發（嚴格 <）', () => {
    const r = evaluateDelay(inputOnlySprint({ completedStoryPoints: 50 }));
    expect(r.delayed).toBe(false);
  });

  it('條件 A：Sprint 未過半 → 不觸發', () => {
    // 推進到 sprint 才開始第 2 天（過半很遠），完成率仍低
    const input: ProjectCheckInput = inputOnlySprint({
      startDate: '2026-06-01T00:00:00Z',
      endDate: '2026-07-01T00:00:00Z',
    });
    input.now = new Date('2026-06-02T00:00:00Z');
    const r = evaluateDelay(input);
    expect(r.delayed).toBe(false);
  });

  it('條件 A：無 active sprint → 不觸發', () => {
    const r = evaluateDelay({ projectKey: 'P', sprint: null, openIssues: [], now: NOW });
    expect(r.delayed).toBe(false);
    expect(r.data.sprintProgress).toBeNull();
  });

  it('條件 A：totalStoryPoints=0 → 不觸發（completionRatio null）', () => {
    const r = evaluateDelay(inputOnlySprint({ totalStoryPoints: 0 }));
    expect(r.delayed).toBe(false);
    expect(r.data.completionRatio).toBeNull();
  });

  it('條件 B only：1 筆逾期 5 天 → delayed', () => {
    const r = evaluateDelay(inputOnlyOverdue([{ key: 'P-1', dueDate: '2026-06-10' }]));
    expect(r.delayed).toBe(true);
    expect(r.conditions).toEqual(['B']);
    expect(r.data.overdueCount).toBe(1);
    expect(r.data.maxOverdueDays).toBe(5);
  });

  it('條件 B：剛好逾期 3 天 → 觸發（≥ 3）', () => {
    const r = evaluateDelay(inputOnlyOverdue([{ key: 'P-1', dueDate: '2026-06-12' }]));
    expect(r.delayed).toBe(true);
    expect(r.data.maxOverdueDays).toBe(3);
  });

  it('條件 B：逾期 2 天 → 不觸發', () => {
    const r = evaluateDelay(inputOnlyOverdue([{ key: 'P-1', dueDate: '2026-06-13' }]));
    expect(r.delayed).toBe(false);
    expect(r.data.overdueCount).toBe(0);
  });

  it('條件 B：dueDate null 不算逾期', () => {
    const r = evaluateDelay(inputOnlyOverdue([{ key: 'P-1', dueDate: null }]));
    expect(r.delayed).toBe(false);
    expect(r.data.overdueCount).toBe(0);
  });

  it('A∩B 同時觸發 → conditions=["A","B"]', () => {
    const input = inputOnlySprint();
    input.openIssues = [
      { key: 'P-1', dueDate: '2026-06-10' },
      { key: 'P-2', dueDate: '2026-06-11' },
    ];
    const r = evaluateDelay(input);
    expect(r.conditions).toEqual(['A', 'B']);
    expect(r.data.overdueCount).toBe(2);
  });

  it('無 issue + 無 sprint → 不觸發', () => {
    const r = evaluateDelay({ projectKey: 'P', sprint: null, openIssues: [], now: NOW });
    expect(r.delayed).toBe(false);
  });
});

// ---- service runner: build CHKPROJ + integration ---------------------------

function fakeRepo(keys: string[]): ProjectCheckListsRepo {
  return {
    async list() {
      return [];
    },
    async add() {
      throw new Error('unused');
    },
    async remove() {
      return false;
    },
    async getByProjectKey() {
      return null;
    },
    async listProjectKeys() {
      return keys;
    },
  };
}

function fakeSession(): McpSession {
  return {
    async callTool<T = unknown>() {
      return { content: {} as T };
    },
    async close() {
      /* noop */
    },
  };
}

describe('createChkprojService', () => {
  it('清單為空 → skipped + reason=empty_checklist', async () => {
    const svc = createChkprojService({
      projectCheckListsRepo: fakeRepo([]),
      fetchProject: vi.fn(),
    });
    const r = await svc.run({ logId: 'sl-1', session: fakeSession(), now: () => NOW });
    expect(r.result).toBe('skipped');
    expect((r.notes as { reason?: string }).reason).toBe('empty_checklist');
  });

  it('全部成功 → success + delayed[] 含正確專案', async () => {
    const fetch = vi.fn(async (_s: McpSession, key: string): Promise<ProjectCheckInput> => {
      if (key === 'PRJ-A') return { ...inputOnlySprint(), projectKey: 'PRJ-A', now: NOW };
      return { projectKey: key, sprint: null, openIssues: [], now: NOW };
    });
    const svc = createChkprojService({
      projectCheckListsRepo: fakeRepo(['PRJ-A', 'PRJ-B', 'PRJ-C']),
      fetchProject: fetch,
      retryDelayMs: 0,
      concurrency: 2,
    });
    const r = await svc.run({ logId: 'sl-1', session: fakeSession(), now: () => NOW });
    expect(r.result).toBe('success');
    expect(r.summary).toContain('3 個專案');
    expect(r.summary).toContain('1 個延遲');
    const notes = r.notes as { delayed: Array<{ projectKey: string }>; errors: unknown[] };
    expect(notes.delayed).toHaveLength(1);
    expect(notes.delayed[0]!.projectKey).toBe('PRJ-A');
    expect(notes.errors).toHaveLength(0);
  });

  it('部分失敗（retry 後仍失敗）→ partial_failure', async () => {
    const fetch = vi
      .fn<(s: McpSession, key: string) => Promise<ProjectCheckInput>>()
      .mockImplementation(async (_s, key) => {
        if (key === 'PRJ-FAIL') throw new Error('no access');
        return { projectKey: key, sprint: null, openIssues: [], now: NOW };
      });
    const svc = createChkprojService({
      projectCheckListsRepo: fakeRepo(['PRJ-OK', 'PRJ-FAIL']),
      fetchProject: fetch,
      retryDelayMs: 0,
    });
    const r = await svc.run({ logId: 'sl-1', session: fakeSession(), now: () => NOW });
    expect(r.result).toBe('partial_failure');
    expect((r.notes as { errors: Array<{ projectKey: string }> }).errors[0]!.projectKey).toBe('PRJ-FAIL');
    expect(r.ruleVersion).toBe(RULE_VERSION);
    // retry 應已嘗試（fetch called 2 次 for PRJ-FAIL + 1 次 for PRJ-OK = 3 次）
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('SC-004：50 mock projects 整批 < 5 分鐘（mock 模式 < 1s）', async () => {
    const keys = Array.from({ length: 50 }, (_, i) => `P-${i}`);
    const fetch = vi.fn(async (_s: McpSession, key: string): Promise<ProjectCheckInput> => ({
      projectKey: key,
      sprint: null,
      openIssues: [],
      now: NOW,
    }));
    const svc = createChkprojService({
      projectCheckListsRepo: fakeRepo(keys),
      fetchProject: fetch,
      retryDelayMs: 0,
      concurrency: 5,
    });
    const t0 = Date.now();
    const r = await svc.run({ logId: 'sl-1', session: fakeSession(), now: () => NOW });
    const elapsed = Date.now() - t0;
    expect(r.result).toBe('success');
    expect(elapsed).toBeLessThan(5 * 60 * 1000);
  });
});
