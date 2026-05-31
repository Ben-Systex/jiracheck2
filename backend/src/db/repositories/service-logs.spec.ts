// T018：service_logs repository 單元測試
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createServiceLogsRepo } from './service-logs';

const NOW = new Date('2026-05-30T00:00:00Z');

function mockPool(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): Pool {
  return { query: vi.fn(impl) } as unknown as Pool;
}

describe('start', () => {
  it('INSERT 帶完整欄位 + 回 id + startedAt', async () => {
    const params: unknown[] = [];
    const repo = createServiceLogsRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [{ id: 'sl-1', started_at: NOW }] };
      }),
    );
    const r = await repo.start({
      scheduleId: 'sc-1',
      serviceId: 'CHKPROJ',
      triggeredBy: 'schedule',
      ruleVersion: 'rule-v1',
    });
    expect(r.id).toBe('sl-1');
    expect(r.startedAt).toEqual(NOW);
    const arr = params[0] as unknown[];
    expect(arr[0]).toBe('sc-1');
    expect(arr[1]).toBe('CHKPROJ');
    expect(arr[2]).toBe('schedule');
    expect(arr[4]).toBe('rule-v1');
  });

  it('無 scheduleId / userId / ruleVersion → 寫 null', async () => {
    const params: unknown[] = [];
    const repo = createServiceLogsRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [{ id: 'sl-2', started_at: NOW }] };
      }),
    );
    await repo.start({ serviceId: 'CHKISSUE', triggeredBy: 'manual' });
    const arr = params[0] as unknown[];
    expect(arr[0]).toBeNull();
    expect(arr[3]).toBeNull();
    expect(arr[4]).toBeNull();
  });
});

describe('finalize', () => {
  it('UPDATE 帶 result / summary / notes / endedAt', async () => {
    const params: unknown[] = [];
    const repo = createServiceLogsRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [], rowCount: 1 };
      }),
    );
    await repo.finalize({
      id: 'sl-1',
      result: 'success',
      summary: 'OK',
      notes: { delayed: ['PRJ-A'] },
      endedAt: NOW,
    });
    const arr = params[0] as unknown[];
    expect(arr[0]).toBe('sl-1');
    expect(arr[1]).toBe('success');
    expect(arr[2]).toBe('OK');
    expect(arr[3]).toBe('{"delayed":["PRJ-A"]}');
  });
});

describe('insertImmediate', () => {
  it('skipped / 立即完成的紀錄', async () => {
    const repo = createServiceLogsRepo(
      mockPool(async () => ({ rows: [{ id: 'sl-3' }] })),
    );
    const r = await repo.insertImmediate({
      serviceId: 'CHKPROJ',
      triggeredBy: 'manual',
      result: 'skipped',
      summary: '上一次仍在執行',
    });
    expect(r.id).toBe('sl-3');
  });
});

describe('getById', () => {
  it('找到 → 回 detail', async () => {
    const repo = createServiceLogsRepo(
      mockPool(async () => ({
        rows: [
          {
            id: 'sl-1',
            schedule_id: 'sc-1',
            service_id: 'CHKPROJ',
            triggered_by: 'schedule',
            triggered_by_user_id: null,
            started_at: NOW,
            ended_at: NOW,
            result: 'success',
            summary: 'OK',
            notes: { foo: 'bar' },
            rule_version: 'rule-v1',
          },
        ],
      })),
    );
    const r = await repo.getById('sl-1');
    expect(r).not.toBeNull();
    expect(r!.notes).toEqual({ foo: 'bar' });
    expect(r!.ruleVersion).toBe('rule-v1');
  });

  it('找不到 → null', async () => {
    const repo = createServiceLogsRepo(mockPool(async () => ({ rows: [] })));
    expect(await repo.getById('x')).toBeNull();
  });
});

describe('list', () => {
  const mkRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'sl',
    schedule_id: null,
    service_id: 'CHKPROJ',
    triggered_by: 'manual',
    started_at: new Date('2026-05-29T00:00:00Z'),
    ended_at: new Date('2026-05-29T00:01:00Z'),
    result: 'success',
    summary: 'OK',
    rule_version: null,
    ...over,
  });

  it('無 filter → 不帶 WHERE', async () => {
    let seenSql = '';
    const repo = createServiceLogsRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    await repo.list({});
    expect(seenSql).not.toMatch(/WHERE/);
  });

  it('完整 filter (service+result+from+to+cursor)', async () => {
    let seenSql = '';
    const repo = createServiceLogsRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    const cursor = Buffer.from(JSON.stringify({ t: '2026-05-01T00:00:00.000Z' }), 'utf8').toString('base64url');
    await repo.list({
      serviceId: 'CHKPROJ',
      result: 'failure',
      from: new Date('2026-04-01T00:00:00Z'),
      to: new Date('2026-05-01T00:00:00Z'),
      cursor,
    });
    expect(seenSql).toMatch(/service_id = \$/);
    expect(seenSql).toMatch(/result = \$/);
    expect(seenSql).toMatch(/started_at >= \$/);
    expect(seenSql).toMatch(/started_at <= \$/);
    expect(seenSql).toMatch(/started_at < \$/);
  });

  it('row 多於 pageSize → 回 nextCursor', async () => {
    const repo = createServiceLogsRepo(
      mockPool(async () => ({ rows: [mkRow({ id: 'a' }), mkRow({ id: 'b' }), mkRow({ id: 'c' })] })),
    );
    const r = await repo.list({ pageSize: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.nextCursor).not.toBeNull();
  });

  it('row ≤ pageSize → nextCursor=null', async () => {
    const repo = createServiceLogsRepo(mockPool(async () => ({ rows: [mkRow({ id: 'a' })] })));
    const r = await repo.list({ pageSize: 20 });
    expect(r.nextCursor).toBeNull();
  });

  it('壞 cursor → 視為無 cursor', async () => {
    let seenSql = '';
    const repo = createServiceLogsRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    await repo.list({ cursor: 'NOT-VALID' });
    expect(seenSql).not.toMatch(/started_at </);
  });
});

describe('pruneOlderThanDays', () => {
  it('回 rowCount', async () => {
    const repo = createServiceLogsRepo(mockPool(async () => ({ rows: [], rowCount: 11 })));
    expect(await repo.pruneOlderThanDays(90)).toBe(11);
  });
  it('null → 0', async () => {
    const repo = createServiceLogsRepo(mockPool(async () => ({ rows: [], rowCount: null })));
    expect(await repo.pruneOlderThanDays(90)).toBe(0);
  });
});

describe('countOpenForService', () => {
  it('解析 count text → number', async () => {
    const repo = createServiceLogsRepo(mockPool(async () => ({ rows: [{ c: '3' }] })));
    expect(await repo.countOpenForService('CHKPROJ')).toBe(3);
  });
});
