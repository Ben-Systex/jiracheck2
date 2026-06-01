// T046：project-check-lists repository 單元測試
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createProjectCheckListsRepo } from './project-check-lists';

const NOW = new Date('2026-06-01T00:00:00Z');

function mkRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'pcl-1',
    project_key: 'PRJ',
    added_by: 'u-1',
    added_at: NOW,
    note: null,
    ...over,
  };
}

function mockPool(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): Pool {
  return { query: vi.fn(impl) } as unknown as Pool;
}

describe('list', () => {
  it('回 entries 排序 added_at DESC', async () => {
    const repo = createProjectCheckListsRepo(
      mockPool(async () => ({ rows: [mkRow(), mkRow({ id: 'pcl-2', project_key: 'OTHER' })] })),
    );
    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.projectKey).toBe('PRJ');
  });
});

describe('add', () => {
  it('INSERT 帶 note + 回 entry', async () => {
    const params: unknown[] = [];
    const repo = createProjectCheckListsRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [mkRow({ note: 'why' })] };
      }),
    );
    const e = await repo.add({ projectKey: 'PRJ', addedBy: 'u-1', note: 'why' });
    expect(e.note).toBe('why');
    expect((params[0] as unknown[])[2]).toBe('why');
  });

  it('note 預設 null', async () => {
    const params: unknown[] = [];
    const repo = createProjectCheckListsRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [mkRow()] };
      }),
    );
    await repo.add({ projectKey: 'PRJ', addedBy: 'u-1' });
    expect((params[0] as unknown[])[2]).toBeNull();
  });
});

describe('remove', () => {
  it('刪到 → true', async () => {
    const repo = createProjectCheckListsRepo(mockPool(async () => ({ rows: [], rowCount: 1 })));
    expect(await repo.remove('pcl-1')).toBe(true);
  });

  it('找不到 → false', async () => {
    const repo = createProjectCheckListsRepo(mockPool(async () => ({ rows: [], rowCount: 0 })));
    expect(await repo.remove('pcl-x')).toBe(false);
  });
});

describe('getByProjectKey', () => {
  it('找到 → 回 entry', async () => {
    const repo = createProjectCheckListsRepo(mockPool(async () => ({ rows: [mkRow()] })));
    const e = await repo.getByProjectKey('PRJ');
    expect(e?.id).toBe('pcl-1');
  });

  it('找不到 → null', async () => {
    const repo = createProjectCheckListsRepo(mockPool(async () => ({ rows: [] })));
    expect(await repo.getByProjectKey('GONE')).toBeNull();
  });
});

describe('listProjectKeys', () => {
  it('回字串陣列', async () => {
    const repo = createProjectCheckListsRepo(
      mockPool(async () => ({ rows: [{ project_key: 'A' }, { project_key: 'B' }] })),
    );
    expect(await repo.listProjectKeys()).toEqual(['A', 'B']);
  });
});
