// T091 + T066：runCleanup + scheduleCleanup 單元測試（mock pool + fake timer + 002 擴充）
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { runCleanup, scheduleCleanup } from './cleanup';
import type { ServiceLogsRepo } from '../db/repositories/service-logs';
import type { ProjectIssueSnapshotsRepo } from '../db/repositories/project-issue-snapshots';

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

function stubServiceLogsRepo(
  pruneCount: number,
): ServiceLogsRepo & { _inserts: Array<Record<string, unknown>> } {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    _inserts: inserts,
    async start() {
      return { id: 'sl-start', startedAt: new Date() };
    },
    async finalize() {
      /* noop */
    },
    async insertImmediate(args) {
      inserts.push(args as unknown as Record<string, unknown>);
      return { id: `sl-imm-${inserts.length}` };
    },
    async getById() {
      return null;
    },
    async list() {
      return { items: [], nextCursor: null };
    },
    streamForExport() {
      return {
        async *[Symbol.asyncIterator]() {
          /* noop */
        },
      };
    },
    async pruneOlderThanDays() {
      return pruneCount;
    },
    async countOpenForService() {
      return 0;
    },
  };
}

function stubSnapshotsRepo(pruneCount: number): ProjectIssueSnapshotsRepo {
  return {
    async insertBatch() {
      /* noop */
    },
    async getStreakAt() {
      return 0;
    },
    async pruneOlderThanDays() {
      return pruneCount;
    },
  };
}

describe('runCleanup', () => {
  it('回傳所有計數（含 002 新增）', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const pool = mockPool([{ rowCount: 5 }, { rowCount: 3 }, { rowCount: 7 }]);
    const serviceLogsRepo = stubServiceLogsRepo(11);
    const snapshotsRepo = stubSnapshotsRepo(4);
    const r = await runCleanup({ pool, log, serviceLogsRepo, snapshotsRepo });
    expect(r).toEqual({
      removedQueryHistory: 5,
      removedBulkOps: 3,
      removedSessions: 7,
      removedServiceLogs: 11,
      removedProjectIssueSnapshots: 4,
      systemCleanupLogId: 'sl-imm-1',
    });
    expect(log.info).toHaveBeenCalled();
  });

  it('寫入 SYSTEM_CLEANUP ServiceLog 含 notes.cleanup_deleted 結構化計數', async () => {
    const pool = mockPool([{ rowCount: 2 }, { rowCount: 1 }, { rowCount: 0 }]);
    const serviceLogsRepo = stubServiceLogsRepo(6);
    const snapshotsRepo = stubSnapshotsRepo(3);
    await runCleanup({ pool, serviceLogsRepo, snapshotsRepo, log: { info: vi.fn(), error: vi.fn() } });
    expect(serviceLogsRepo._inserts).toHaveLength(1);
    const ins = serviceLogsRepo._inserts[0]!;
    expect(ins.serviceId).toBe('SYSTEM_CLEANUP');
    expect(ins.triggeredBy).toBe('system');
    expect(ins.result).toBe('success');
    expect(ins.summary as string).toContain('service_logs=6');
    expect((ins.notes as { cleanup_deleted: Record<string, number> }).cleanup_deleted).toEqual({
      query_history: 2,
      bulk_update_operations: 1,
      sessions: 0,
      service_logs: 6,
      project_issue_snapshots: 3,
    });
  });

  it('SYSTEM_CLEANUP 寫入失敗 → 不阻擋整體 cleanup（仍回 result 但 systemCleanupLogId=null）', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const pool = mockPool([{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }]);
    const serviceLogsRepo = stubServiceLogsRepo(0);
    serviceLogsRepo.insertImmediate = async () => {
      throw new Error('insert failed');
    };
    const r = await runCleanup({
      pool,
      log,
      serviceLogsRepo,
      snapshotsRepo: stubSnapshotsRepo(0),
    });
    expect(r.systemCleanupLogId).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('遇 DB 錯誤 → 記 error 並 rethrow', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const pool = {
      query: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as Pool;
    await expect(
      runCleanup({
        pool,
        log,
        serviceLogsRepo: stubServiceLogsRepo(0),
        snapshotsRepo: stubSnapshotsRepo(0),
      }),
    ).rejects.toThrow(/db down/);
    expect(log.error).toHaveBeenCalled();
  });

  it('未提供 log → 預設使用 console', async () => {
    const pool = mockPool([{ rowCount: 0 }, { rowCount: 0 }, { rowCount: 0 }]);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await runCleanup({
        pool,
        serviceLogsRepo: stubServiceLogsRepo(0),
        snapshotsRepo: stubSnapshotsRepo(0),
      });
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
      const stop = scheduleCleanup({
        pool,
        log,
        now: () => new Date(),
        serviceLogsRepo: stubServiceLogsRepo(0),
        snapshotsRepo: stubSnapshotsRepo(0),
      });

      // 推進至 03:00
      await vi.advanceTimersByTimeAsync(70_000);
      expect(log.info).toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
