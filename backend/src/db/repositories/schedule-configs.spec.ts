// T016：schedule_configs repository 單元測試（mock pool）
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createScheduleConfigsRepo } from './schedule-configs';

const NOW = new Date('2026-05-30T00:00:00Z');

function mkRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'sc-1',
    service_id: 'CHKPROJ',
    frequency_type: 'daily',
    frequency_value: '09:00',
    enabled: true,
    next_run_at: NOW,
    last_run_at: null,
    created_by: 'u-1',
    updated_by: 'u-1',
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function mockPool(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): Pool {
  return { query: vi.fn(impl) } as unknown as Pool;
}

describe('create', () => {
  it('INSERT 帶完整欄位 + 回 ScheduleConfig', async () => {
    const params: unknown[] = [];
    const repo = createScheduleConfigsRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [mkRow()] };
      }),
    );
    const cfg = await repo.create({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: NOW,
      createdBy: 'u-1',
    });
    expect(cfg.id).toBe('sc-1');
    expect(cfg.serviceId).toBe('CHKPROJ');
    expect(cfg.frequencyValue).toBe('09:00');
    expect((params[0] as unknown[])[5]).toBe('u-1'); // created_by + updated_by 同
  });
});

describe('update', () => {
  it('UPDATE 帶 updated_by + 回新 row', async () => {
    const repo = createScheduleConfigsRepo(
      mockPool(async () => ({ rows: [mkRow({ updated_by: 'u-2', frequency_value: '10:00' })] })),
    );
    const res = await repo.update({
      id: 'sc-1',
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '10:00',
      enabled: true,
      nextRunAt: NOW,
      updatedBy: 'u-2',
    });
    expect(res).not.toBeNull();
    expect(res!.updatedBy).toBe('u-2');
    expect(res!.frequencyValue).toBe('10:00');
  });

  it('找不到 id → null', async () => {
    const repo = createScheduleConfigsRepo(mockPool(async () => ({ rows: [] })));
    const res = await repo.update({
      id: 'missing',
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: null,
      updatedBy: 'u-1',
    });
    expect(res).toBeNull();
  });
});

describe('delete', () => {
  it('刪 1 筆 → true', async () => {
    const repo = createScheduleConfigsRepo(mockPool(async () => ({ rows: [], rowCount: 1 })));
    expect(await repo.delete('sc-1')).toBe(true);
  });
  it('找不到 → false', async () => {
    const repo = createScheduleConfigsRepo(mockPool(async () => ({ rows: [], rowCount: 0 })));
    expect(await repo.delete('sc-x')).toBe(false);
  });
});

describe('getById', () => {
  it('找到 → 回 config', async () => {
    const repo = createScheduleConfigsRepo(mockPool(async () => ({ rows: [mkRow()] })));
    const cfg = await repo.getById('sc-1');
    expect(cfg?.id).toBe('sc-1');
  });
  it('找不到 → null', async () => {
    const repo = createScheduleConfigsRepo(mockPool(async () => ({ rows: [] })));
    expect(await repo.getById('x')).toBeNull();
  });
});

describe('listAll', () => {
  it('無 filter → 不帶 WHERE', async () => {
    let seenSql = '';
    const repo = createScheduleConfigsRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    await repo.listAll();
    expect(seenSql).not.toMatch(/WHERE/);
  });
  it('enabled 過濾', async () => {
    let seenSql = '';
    let seenParams: unknown[] = [];
    const repo = createScheduleConfigsRepo(
      mockPool(async (sql, p) => {
        seenSql = sql;
        seenParams = (p ?? []) as unknown[];
        return { rows: [] };
      }),
    );
    await repo.listAll({ enabled: false });
    expect(seenSql).toMatch(/WHERE enabled = \$1/);
    expect(seenParams[0]).toBe(false);
  });
  it('serviceId 過濾', async () => {
    let seenSql = '';
    const repo = createScheduleConfigsRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    await repo.listAll({ serviceId: 'CHKISSUE' });
    expect(seenSql).toMatch(/service_id = \$/);
  });
});

describe('listEnabled', () => {
  it('回 enabled=true 的清單', async () => {
    const repo = createScheduleConfigsRepo(
      mockPool(async () => ({ rows: [mkRow(), mkRow({ id: 'sc-2' })] })),
    );
    const list = await repo.listEnabled();
    expect(list).toHaveLength(2);
  });
});

describe('updateNextRun / updateLastRun', () => {
  it('updateNextRun 接受 null', async () => {
    let seenParams: unknown[] = [];
    const repo = createScheduleConfigsRepo(
      mockPool(async (_sql, p) => {
        seenParams = (p ?? []) as unknown[];
        return { rows: [], rowCount: 1 };
      }),
    );
    await repo.updateNextRun('sc-1', null);
    expect(seenParams).toEqual(['sc-1', null]);
  });

  it('updateLastRun 寫 Date', async () => {
    let seenParams: unknown[] = [];
    const repo = createScheduleConfigsRepo(
      mockPool(async (_sql, p) => {
        seenParams = (p ?? []) as unknown[];
        return { rows: [], rowCount: 1 };
      }),
    );
    await repo.updateLastRun('sc-1', NOW);
    expect(seenParams[1]).toBe(NOW);
  });
});

describe('countEnabled', () => {
  it('解析 count 為 number', async () => {
    const repo = createScheduleConfigsRepo(
      mockPool(async () => ({ rows: [{ c: '5' }] })),
    );
    expect(await repo.countEnabled()).toBe(5);
  });
  it('空 row → 0', async () => {
    const repo = createScheduleConfigsRepo(mockPool(async () => ({ rows: [] })));
    expect(await repo.countEnabled()).toBe(0);
  });
});
