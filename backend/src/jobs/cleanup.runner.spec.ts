// T091：runCleanup + scheduleCleanup 單元測試（mock pool + fake timer）
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { runCleanup, scheduleCleanup } from './cleanup';

function mockPool(queries: Array<{ rowCount: number }>): Pool {
  let idx = 0;
  return {
    query: vi.fn(async () => {
      const r = queries[idx] ?? { rowCount: 0 };
      idx += 1;
      return { rows: [], rowCount: r.rowCount };
    }),
  } as unknown as Pool;
}

describe('runCleanup', () => {
  it('回傳三段計數', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const pool = mockPool([{ rowCount: 5 }, { rowCount: 3 }, { rowCount: 7 }]);
    const r = await runCleanup({ pool, log });
    expect(r).toEqual({ removedQueryHistory: 5, removedBulkOps: 3, removedSessions: 7 });
    expect(log.info).toHaveBeenCalled();
  });

  it('遇 DB 錯誤 → 記 error 並 rethrow', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const pool = {
      query: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as Pool;
    await expect(runCleanup({ pool, log })).rejects.toThrow(/db down/);
    expect(log.error).toHaveBeenCalled();
  });

  it('未提供 log → 預設使用 console', async () => {
    const pool = mockPool([{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }]);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await runCleanup({ pool });
      expect(infoSpy).toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe('scheduleCleanup', () => {
  it('在排程觸發後執行 runCleanup；stopper 阻擋後續排程', async () => {
    vi.useFakeTimers();
    try {
      const log = { info: vi.fn(), error: vi.fn() };
      const pool = mockPool([{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }]);
      // now=02:59 → 距 03:00 約 1 分鐘
      const now = new Date('2026-05-27T02:59:00');
      vi.setSystemTime(now);
      const stop = scheduleCleanup({ pool, log, now: () => new Date() });

      // 推進至 03:00
      await vi.advanceTimersByTimeAsync(70_000);
      expect(log.info).toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
