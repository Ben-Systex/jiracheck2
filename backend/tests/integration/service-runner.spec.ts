// T020：service-runner integration spec
// 注入 in-memory 版本的 service-logs / schedule-configs repos + mock pool / client
// 對 success / failure / skipped (lock failed) / not registered 各路徑驗證

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { runService } from '../../src/jobs/service-runner';
import type { RegisteredService } from '../../src/jobs/services/types';
import type { ServiceLogsRepo, ExtendedServiceId } from '../../src/db/repositories/service-logs';
import type { ScheduleConfigsRepo } from '../../src/db/repositories/schedule-configs';
import { __resetMetricsForTesting, initMetrics, scheduledServiceTotal, getRegistry } from '../../src/lib/metrics';

interface FakeLock {
  acquired: Set<string>;
  /** 取得時要回傳的值（默認 true） */
  forceFail: boolean;
}

function makeFakeClient(lock: FakeLock): PoolClient {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]): Promise<unknown> => {
      const key = (params?.[0] as string) ?? '';
      if (/pg_try_advisory_lock/.test(sql)) {
        if (lock.forceFail) return { rows: [{ locked: false }] };
        lock.acquired.add(key);
        return { rows: [{ locked: true }] };
      }
      if (/pg_advisory_unlock/.test(sql)) {
        lock.acquired.delete(key);
        return { rows: [{ unlocked: true }] };
      }
      if (/UPDATE service_logs SET rule_version/.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function makePool(client: PoolClient): Pool {
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
}

function inMemoryServiceLogsRepo(): ServiceLogsRepo & { _logs: Map<string, Record<string, unknown>> } {
  const logs = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return {
    _logs: logs,
    async start(args) {
      const id = `sl-${nextId++}`;
      const startedAt = new Date('2026-05-30T00:00:00Z');
      logs.set(id, { ...args, id, startedAt, result: 'running' });
      return { id, startedAt };
    },
    async finalize(args) {
      const cur = logs.get(args.id) ?? {};
      logs.set(args.id, { ...cur, ...args });
    },
    async insertImmediate(args) {
      const id = `sl-${nextId++}`;
      logs.set(id, { ...args, id });
      return { id };
    },
    async getById() {
      return null;
    },
    async list() {
      return { items: [], nextCursor: null };
    },
    async pruneOlderThanDays() {
      return 0;
    },
    async countOpenForService() {
      return 0;
    },
  };
}

function inMemoryScheduleConfigsRepo(): ScheduleConfigsRepo & { _lastRunCalls: Array<{ id: string; at: Date }> } {
  const lastRunCalls: Array<{ id: string; at: Date }> = [];
  return {
    _lastRunCalls: lastRunCalls,
    async create() {
      throw new Error('unused');
    },
    async update() {
      return null;
    },
    async delete() {
      return false;
    },
    async getById() {
      return null;
    },
    async listAll() {
      return [];
    },
    async listEnabled() {
      return [];
    },
    async updateNextRun() {
      /* noop */
    },
    async updateLastRun(id, at) {
      lastRunCalls.push({ id, at });
    },
    async countEnabled() {
      return 0;
    },
  };
}

function fakeService(over: Partial<RegisteredService> & Pick<RegisteredService, 'id'>): RegisteredService {
  return {
    needsMcpSession: false,
    async run() {
      return { result: 'success', summary: 'OK', notes: {} };
    },
    ...over,
  };
}

beforeEach(() => {
  __resetMetricsForTesting();
  initMetrics({ collectDefault: false });
});

describe('runService 成功路徑', () => {
  it('serviceLogs.start → service.run → finalize success', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: false };
    const client = makeFakeClient(lock);
    const pool = makePool(client);
    const serviceLogsRepo = inMemoryServiceLogsRepo();
    const scheduleConfigsRepo = inMemoryScheduleConfigsRepo();
    const r = await runService(
      {
        pool,
        serviceLogsRepo,
        scheduleConfigsRepo,
        services: {
          CHKPROJ: fakeService({
            id: 'CHKPROJ',
            run: async () => ({ result: 'success', summary: '3 個專案、1 個延遲', notes: { delayed: ['PROJ-B'] }, ruleVersion: 'rule-v1' }),
          }),
        },
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    expect(r.executed).toBe(true);
    expect(r.serviceLogId).toMatch(/^sl-\d+$/);
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('success');
    expect(log?.summary).toContain('1 個延遲');
    // lock 已釋放
    expect(lock.acquired.size).toBe(0);
    // metrics 寫入
    const text = await getRegistry().metrics();
    expect(text).toMatch(/scheduled_service_total\{[^}]*service_id="CHKPROJ"[^}]*result="success"\}\s+1/);
  });

  it('帶 scheduleId → scheduleConfigsRepo.updateLastRun 被呼叫', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: false };
    const client = makeFakeClient(lock);
    const pool = makePool(client);
    const scheduleConfigsRepo = inMemoryScheduleConfigsRepo();
    await runService(
      {
        pool,
        serviceLogsRepo: inMemoryServiceLogsRepo(),
        scheduleConfigsRepo,
        services: { CHKPROJ: fakeService({ id: 'CHKPROJ' }) },
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'schedule', scheduleId: 'sc-1' },
    );
    expect(scheduleConfigsRepo._lastRunCalls).toHaveLength(1);
    expect(scheduleConfigsRepo._lastRunCalls[0]!.id).toBe('sc-1');
  });
});

describe('runService 失敗路徑', () => {
  it('service.run throw → finalize failure + metrics inc', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: false };
    const pool = makePool(makeFakeClient(lock));
    const serviceLogsRepo = inMemoryServiceLogsRepo();
    const r = await runService(
      {
        pool,
        serviceLogsRepo,
        scheduleConfigsRepo: inMemoryScheduleConfigsRepo(),
        services: {
          CHKPROJ: fakeService({
            id: 'CHKPROJ',
            run: async () => {
              throw new Error('boom');
            },
          }),
        },
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('failure');
    expect((log?.notes as { error?: string })?.error).toBe('boom');
    const text = await getRegistry().metrics();
    expect(text).toMatch(/scheduled_service_total\{[^}]*service_id="CHKPROJ"[^}]*result="failure"\}\s+1/);
  });
});

describe('runService advisory lock 失敗 → skipped', () => {
  it('forceFail=true → 立即寫 skipped 紀錄', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: true };
    const pool = makePool(makeFakeClient(lock));
    const serviceLogsRepo = inMemoryServiceLogsRepo();
    const r = await runService(
      {
        pool,
        serviceLogsRepo,
        scheduleConfigsRepo: inMemoryScheduleConfigsRepo(),
        services: { CHKPROJ: fakeService({ id: 'CHKPROJ' }) },
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    expect(r.executed).toBe(false);
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('skipped');
    expect((log?.notes as { reason?: string })?.reason).toBe('concurrent_run');
    expect(scheduledServiceTotal).toBeDefined();
  });
});

describe('runService 服務未註冊', () => {
  it('未註冊 → failure + reason=not_registered', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: false };
    const pool = makePool(makeFakeClient(lock));
    const serviceLogsRepo = inMemoryServiceLogsRepo();
    const r = await runService(
      {
        pool,
        serviceLogsRepo,
        scheduleConfigsRepo: inMemoryScheduleConfigsRepo(),
        services: {}, // 空 registry
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    expect(r.executed).toBe(false);
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('failure');
    expect((log?.notes as { reason?: string })?.reason).toBe('not_registered');
  });
});

describe('runService needsMcpSession=true 但無 acquireSession', () => {
  it('throw 內部錯 → finalize failure', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: false };
    const pool = makePool(makeFakeClient(lock));
    const serviceLogsRepo = inMemoryServiceLogsRepo();
    const r = await runService(
      {
        pool,
        serviceLogsRepo,
        scheduleConfigsRepo: inMemoryScheduleConfigsRepo(),
        services: {
          CHKPROJ: fakeService({ id: 'CHKPROJ', needsMcpSession: true }),
        },
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('failure');
    expect(log?.summary as string).toContain('acquireSession 未注入');
  });
});

describe('runService SYSTEM_CLEANUP 走無 mcp 路徑', () => {
  it('needsMcpSession=false → 不查 acquireSession', async () => {
    const lock: FakeLock = { acquired: new Set(), forceFail: false };
    const pool = makePool(makeFakeClient(lock));
    const acquireSession = vi.fn();
    const r = await runService(
      {
        pool,
        serviceLogsRepo: inMemoryServiceLogsRepo(),
        scheduleConfigsRepo: inMemoryScheduleConfigsRepo(),
        services: {
          SYSTEM_CLEANUP: fakeService({
            id: 'SYSTEM_CLEANUP',
            needsMcpSession: false,
            run: async () => ({ result: 'success', summary: 'cleaned 100 rows', notes: { cleaned: 100 } }),
          }),
        },
        acquireSession,
      },
      { serviceId: 'SYSTEM_CLEANUP' as ExtendedServiceId, triggeredBy: 'system' },
    );
    expect(r.executed).toBe(true);
    expect(acquireSession).not.toHaveBeenCalled();
  });
});
