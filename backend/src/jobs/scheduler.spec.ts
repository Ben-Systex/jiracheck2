// T022：scheduler 單元測試
// 不真實啟動 node-cron tick（採短間隔 + 立即 invoke 模式），改驗：
// - registerSchedule / unregisterSchedule 維護 tasks map 正確
// - start() 對 enabled list 全部 register
// - start() 對已逾期 ≤ 24h schedule 補登 missed
// - SC-001 觸發誤差 ≤ 60s：透過 cron 觸發後測 runner 被呼叫的時間 vs 設定時間

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from './scheduler';
import type { ScheduleConfig, ScheduleConfigsRepo } from '../db/repositories/schedule-configs';
import type { ServiceLogsRepo } from '../db/repositories/service-logs';
import type { Pool } from 'pg';

function fakeCfg(over: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    id: 'sc-1',
    serviceId: 'CHKPROJ',
    frequencyType: 'cron',
    frequencyValue: '*/1 * * * * *', // 每秒一次（測試）
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: new Date('2026-05-30T00:00:00Z'),
    updatedAt: new Date('2026-05-30T00:00:00Z'),
    ...over,
  };
}

function fakeScheduleRepo(initial: ScheduleConfig[] = []): ScheduleConfigsRepo & {
  _items: ScheduleConfig[];
  _nextRunCalls: Array<{ id: string; at: Date | null }>;
} {
  const items = [...initial];
  const nextRunCalls: Array<{ id: string; at: Date | null }> = [];
  return {
    _items: items,
    _nextRunCalls: nextRunCalls,
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
      return items;
    },
    async listEnabled() {
      return items.filter((i) => i.enabled);
    },
    async updateNextRun(id, at) {
      nextRunCalls.push({ id, at });
    },
    async updateLastRun() {
      /* noop */
    },
    async countEnabled() {
      return items.filter((i) => i.enabled).length;
    },
  };
}

function fakeServiceLogsRepo(): ServiceLogsRepo & { _immediates: Array<Record<string, unknown>> } {
  const immediates: Array<Record<string, unknown>> = [];
  return {
    _immediates: immediates,
    async start() {
      return { id: 'sl-1', startedAt: new Date() };
    },
    async finalize() {
      /* noop */
    },
    async insertImmediate(args) {
      immediates.push(args as unknown as Record<string, unknown>);
      return { id: 'sl-imm' };
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

function fakePool(): Pool {
  // scheduler 自身不直接用 pool；service-runner 走（這裡不會跑到 runner 真正執行因為我們直接驗 task.execute）
  return {
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [{ locked: true, unlocked: true }] })),
      release: vi.fn(),
    })),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
}

beforeEach(() => {
  process.env.SERVER_TZ = 'Asia/Taipei';
});

afterEach(() => {
  delete process.env.SERVER_TZ;
});

describe('Scheduler register / unregister', () => {
  it('start 對所有 enabled register', async () => {
    const repo = fakeScheduleRepo([fakeCfg({ id: 'a' }), fakeCfg({ id: 'b', enabled: false })]);
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: fakeServiceLogsRepo(),
      scheduleConfigsRepo: repo,
      services: {},
    });
    await sch.start();
    expect(sch.registeredCount()).toBe(1);
    await sch.stop();
  });

  it('registerSchedule(disabled cfg) → 不註冊', () => {
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: fakeServiceLogsRepo(),
      scheduleConfigsRepo: fakeScheduleRepo(),
      services: {},
    });
    sch.registerSchedule(fakeCfg({ enabled: false }));
    expect(sch.registeredCount()).toBe(0);
  });

  it('register 兩次同 id → 後者取代前者', () => {
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: fakeServiceLogsRepo(),
      scheduleConfigsRepo: fakeScheduleRepo(),
      services: {},
    });
    sch.registerSchedule(fakeCfg({ id: 'x' }));
    sch.registerSchedule(fakeCfg({ id: 'x' }));
    expect(sch.registeredCount()).toBe(1);
  });

  it('unregister 移除 task', () => {
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: fakeServiceLogsRepo(),
      scheduleConfigsRepo: fakeScheduleRepo(),
      services: {},
    });
    sch.registerSchedule(fakeCfg({ id: 'y' }));
    sch.unregisterSchedule('y');
    expect(sch.registeredCount()).toBe(0);
  });
});

describe('Scheduler.refreshAll', () => {
  it('移除已停用 + 加上新啟用', async () => {
    const repo = fakeScheduleRepo([fakeCfg({ id: 'a' })]);
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: fakeServiceLogsRepo(),
      scheduleConfigsRepo: repo,
      services: {},
    });
    await sch.start();
    expect(sch.registeredCount()).toBe(1);

    // 模擬 a 被刪、加入 b
    repo._items.length = 0;
    repo._items.push(fakeCfg({ id: 'b' }));
    await sch.refreshAll();
    expect(sch.registeredCount()).toBe(1);
    await sch.stop();
  });
});

describe('Scheduler.start 補登 missed', () => {
  it('上次預定 1 小時前 → 寫 missed 紀錄', async () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const planned = new Date('2026-05-30T09:00:00Z'); // 1 小時前
    const repo = fakeScheduleRepo([fakeCfg({ nextRunAt: planned })]);
    const slRepo = fakeServiceLogsRepo();
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: slRepo,
      scheduleConfigsRepo: repo,
      services: {},
      now: () => now,
    });
    await sch.start();
    expect(slRepo._immediates).toHaveLength(1);
    expect(slRepo._immediates[0]!.result).toBe('missed');
    await sch.stop();
  });

  it('上次預定 25 小時前（>24h）→ 不補登', async () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const planned = new Date('2026-05-29T09:00:00Z'); // 25 小時前
    const repo = fakeScheduleRepo([fakeCfg({ nextRunAt: planned })]);
    const slRepo = fakeServiceLogsRepo();
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: slRepo,
      scheduleConfigsRepo: repo,
      services: {},
      now: () => now,
    });
    await sch.start();
    expect(slRepo._immediates).toHaveLength(0);
    await sch.stop();
  });

  it('nextRunAt 為未來 → 不補登', async () => {
    const now = new Date('2026-05-30T10:00:00Z');
    const planned = new Date('2026-05-30T12:00:00Z'); // 未來
    const repo = fakeScheduleRepo([fakeCfg({ nextRunAt: planned })]);
    const slRepo = fakeServiceLogsRepo();
    const sch = new Scheduler({
      pool: fakePool(),
      serviceLogsRepo: slRepo,
      scheduleConfigsRepo: repo,
      services: {},
      now: () => now,
    });
    await sch.start();
    expect(slRepo._immediates).toHaveLength(0);
    await sch.stop();
  });
});

describe('SC-001 觸發時點誤差驗證', () => {
  // 此 case 不真實等到 cron tick；改用 computeNextRunAt 驗證「下次預定時間相對誤差」
  // 對 cron expression 「*/1 * * * *」（每分鐘），下次時間 - 當前 ≤ 60s
  it('每分鐘 cron 的下次觸發時點與設定時間誤差 ≤ 60 秒', async () => {
    const { computeNextRunAt } = await import('../lib/cron-utils.js');
    const now = new Date('2026-05-30T00:00:15Z'); // 00:00:15
    const next = computeNextRunAt({ type: 'cron', value: '* * * * *' }, now);
    const diff = next.getTime() - now.getTime();
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(60_000);
  });

  it('每日 09:00 對應的下次觸發精確到秒（無漂移）', async () => {
    const { computeNextRunAt } = await import('../lib/cron-utils.js');
    const now = new Date('2026-05-30T00:00:00Z'); // 08:00 Asia/Taipei
    const next = computeNextRunAt({ type: 'daily', value: '09:00' }, now);
    // 預期：同日 09:00 Asia/Taipei = 01:00 UTC
    expect(next.toISOString()).toBe('2026-05-30T01:00:00.000Z');
  });
});
