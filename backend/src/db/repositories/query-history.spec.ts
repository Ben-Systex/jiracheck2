// T091：query_history repo 單元測試
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createQueryHistoryRepo } from './query-history';

function mockPool(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): Pool {
  return { query: vi.fn(impl) } as unknown as Pool;
}

describe('createQueryHistoryRepo.insert', () => {
  it('回傳新 id；query_plan stringified', async () => {
    const params: unknown[] = [];
    const repo = createQueryHistoryRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [{ id: 'qh-1' }] };
      }),
    );
    const res = await repo.insert({
      userId: 'u-1',
      originalQuestion: '查 PRJ 開放單',
      queryPlan: { intent: 'list_issues' },
      explanationZh: '列出符合條件的任務',
      resultCount: 7,
      latencyMs: 150,
      status: 'ok',
    });
    expect(res.id).toBe('qh-1');
    const arr = params[0] as unknown[];
    expect(arr[2]).toBe('{"intent":"list_issues"}');
    expect(arr[4]).toBe(7);
    expect(arr[6]).toBe('ok');
  });
});

describe('createQueryHistoryRepo.pruneOlderThanDays', () => {
  it('回傳 rowCount', async () => {
    const repo = createQueryHistoryRepo(mockPool(async () => ({ rows: [], rowCount: 13 })));
    expect(await repo.pruneOlderThanDays(30)).toBe(13);
  });

  it('rowCount null → 0', async () => {
    const repo = createQueryHistoryRepo(mockPool(async () => ({ rows: [], rowCount: null })));
    expect(await repo.pruneOlderThanDays()).toBe(0);
  });

  it('預設 90 天', async () => {
    let captured: unknown[] = [];
    const repo = createQueryHistoryRepo(
      mockPool(async (_sql, p) => {
        captured = (p ?? []) as unknown[];
        return { rows: [], rowCount: 0 };
      }),
    );
    await repo.pruneOlderThanDays();
    expect(captured[0]).toBe('90');
  });
});
