// T091：bulk_update_operations repo 單元測試——以 mock Pool 覆蓋 createOperation / recordItem / finalize / getById / listByUser
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createBulkUpdatesRepo } from './bulk-updates';

function mockPool(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): Pool {
  return { query: vi.fn(impl) } as unknown as Pool;
}

describe('createBulkUpdatesRepo.createOperation', () => {
  it('INSERT 帶 JSON.stringify 過的 filterDsl / targetValueJson + 回傳 id', async () => {
    const params: unknown[] = [];
    const repo = createBulkUpdatesRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [{ id: 'op-1' }] };
      }),
    );
    const res = await repo.createOperation({
      userId: 'u-1',
      projectKey: 'PRJ',
      filterDsl: { statuses: ['Open'] },
      targetField: 'assignee',
      targetValueJson: { accountId: 'acc-x' },
      totalCount: 5,
      confirmedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(res.id).toBe('op-1');
    const arr = params[0] as unknown[];
    expect(arr[0]).toBe('u-1');
    expect(arr[1]).toBe('PRJ');
    expect(arr[2]).toBe('{"statuses":["Open"]}');
    expect(arr[3]).toBe('assignee');
    expect(arr[4]).toBe('{"accountId":"acc-x"}');
    expect(arr[5]).toBe(5);
  });
});

describe('createBulkUpdatesRepo.recordItem', () => {
  it('previousValueJson === undefined 寫入 null', async () => {
    const params: unknown[] = [];
    const repo = createBulkUpdatesRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [] };
      }),
    );
    await repo.recordItem({
      operationId: 'op-1',
      issueKey: 'PRJ-1',
      previousValueJson: undefined,
      newValueJson: { foo: 'bar' },
      result: 'success',
    });
    const arr = params[0] as unknown[];
    expect(arr[2]).toBeNull();
    expect(arr[3]).toBe('{"foo":"bar"}');
    expect(arr[5]).toBeNull(); // errorMessage default
    expect(arr[6]).toBeNull(); // appliedAt default
  });

  it('previousValueJson 已 stringify、errorMessage / appliedAt 帶入', async () => {
    const params: unknown[] = [];
    const repo = createBulkUpdatesRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [] };
      }),
    );
    const ts = new Date('2026-05-02T00:00:00Z');
    await repo.recordItem({
      operationId: 'op-2',
      issueKey: 'PRJ-9',
      previousValueJson: { x: 1 },
      newValueJson: { x: 2 },
      result: 'api_error',
      errorMessage: 'oops',
      appliedAt: ts,
    });
    const arr = params[0] as unknown[];
    expect(arr[2]).toBe('{"x":1}');
    expect(arr[3]).toBe('{"x":2}');
    expect(arr[4]).toBe('api_error');
    expect(arr[5]).toBe('oops');
    expect(arr[6]).toBe(ts);
  });
});

describe('createBulkUpdatesRepo.finalize', () => {
  it('UPDATE 帶 status / counts / completedAt', async () => {
    const params: unknown[] = [];
    const repo = createBulkUpdatesRepo(
      mockPool(async (_sql, p) => {
        params.push(p);
        return { rows: [] };
      }),
    );
    await repo.finalize({
      operationId: 'op-3',
      status: 'partial_failure',
      successCount: 2,
      failureCount: 1,
      completedAt: new Date('2026-05-03T00:00:00Z'),
    });
    const arr = params[0] as unknown[];
    expect(arr[0]).toBe('op-3');
    expect(arr[1]).toBe('partial_failure');
    expect(arr[2]).toBe(2);
    expect(arr[3]).toBe(1);
  });
});

describe('createBulkUpdatesRepo.getById', () => {
  it('查無 → null（跨權限保護）', async () => {
    const repo = createBulkUpdatesRepo(mockPool(async () => ({ rows: [] })));
    expect(await repo.getById('u', 'op-x')).toBeNull();
  });

  it('查到 → 回傳 BulkOperation 含 items', async () => {
    const opRow = {
      id: 'op-1',
      user_id: 'u-1',
      project_key: 'PRJ',
      target_field: 'assignee',
      total_count: 3,
      success_count: 2,
      failure_count: 1,
      status: 'partial_failure',
      confirmed_at: new Date('2026-05-01T00:00:00Z'),
      completed_at: new Date('2026-05-01T00:01:00Z'),
    };
    let callIdx = 0;
    const repo = createBulkUpdatesRepo(
      mockPool(async () => {
        callIdx += 1;
        if (callIdx === 1) return { rows: [opRow] };
        return {
          rows: [
            { issue_key: 'PRJ-1', result: 'success', error_message: null, applied_at: opRow.completed_at },
            { issue_key: 'PRJ-2', result: 'permission_denied', error_message: 'no perm', applied_at: null },
          ],
        };
      }),
    );
    const op = await repo.getById('u-1', 'op-1');
    expect(op).not.toBeNull();
    expect(op!.items.length).toBe(2);
    expect(op!.items[0]!.issueKey).toBe('PRJ-1');
    expect(op!.items[1]!.errorMessage).toBe('no perm');
    expect(op!.successCount).toBe(2);
  });
});

describe('createBulkUpdatesRepo.listByUser', () => {
  it('支援 projectKey / status / cursor + 回傳 nextCursor 當有更多', async () => {
    const baseRow = (i: number) => ({
      id: `op-${i}`,
      project_key: 'PRJ',
      target_field: 'label' as const,
      total_count: 1,
      success_count: 1,
      failure_count: 0,
      status: 'success' as const,
      confirmed_at: new Date(`2026-05-${String(20 - i).padStart(2, '0')}T00:00:00Z`),
      completed_at: null,
    });

    const captured: unknown[] = [];
    const repo = createBulkUpdatesRepo(
      mockPool(async (_sql, params) => {
        captured.push(params);
        return {
          rows: [baseRow(1), baseRow(2), baseRow(3)], // pageSize=2 → 3 row → 有下一頁
        };
      }),
    );

    const res = await repo.listByUser({
      userId: 'u-1',
      projectKey: 'PRJ',
      status: 'success',
      pageSize: 2,
    });
    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).not.toBeNull();
    // 解碼 cursor
    const decoded = JSON.parse(Buffer.from(res.nextCursor!, 'base64url').toString('utf8')) as { t: string };
    expect(typeof decoded.t).toBe('string');
  });

  it('帶入 cursor 時，SQL params 含 confirmed_at < $N', async () => {
    const cursor = Buffer.from(JSON.stringify({ t: '2026-05-01T00:00:00.000Z' }), 'utf8').toString('base64url');
    let seenSql = '';
    const repo = createBulkUpdatesRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    await repo.listByUser({ userId: 'u-1', cursor });
    expect(seenSql).toMatch(/confirmed_at < \$\d/);
  });

  it('壞 cursor → 視為無 cursor', async () => {
    let seenSql = '';
    const repo = createBulkUpdatesRepo(
      mockPool(async (sql) => {
        seenSql = sql;
        return { rows: [] };
      }),
    );
    await repo.listByUser({ userId: 'u-1', cursor: 'INVALID-CURSOR' });
    expect(seenSql).not.toMatch(/confirmed_at </);
  });

  it('當 row 數 ≤ pageSize 時 nextCursor=null', async () => {
    const repo = createBulkUpdatesRepo(
      mockPool(async () => ({
        rows: [
          {
            id: 'op-1',
            project_key: 'P',
            target_field: 'label',
            total_count: 1,
            success_count: 0,
            failure_count: 0,
            status: 'running',
            confirmed_at: new Date(),
            completed_at: null,
          },
        ],
      })),
    );
    const res = await repo.listByUser({ userId: 'u', pageSize: 5 });
    expect(res.nextCursor).toBeNull();
  });
});
