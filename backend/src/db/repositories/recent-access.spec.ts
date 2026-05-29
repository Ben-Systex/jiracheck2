// T091：recent_project_access repo 單元測試
import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createRecentAccessRepo } from './recent-access';

function mockClient(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): PoolClient {
  return {
    query: vi.fn(impl),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function mockPool(client: PoolClient, queryImpl?: (sql: string, params?: unknown[]) => Promise<unknown>): Pool {
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(queryImpl ?? (async () => ({ rows: [], rowCount: 0 }))),
  } as unknown as Pool;
}

describe('listRecent', () => {
  it('回傳轉換後欄位', async () => {
    const repo = createRecentAccessRepo(
      mockPool(
        mockClient(async () => ({ rows: [] })),
        async () => ({
          rows: [
            {
              project_key: 'PRJ',
              last_accessed_at: new Date('2026-05-01T00:00:00Z'),
              access_count: 4,
            },
          ],
        }),
      ),
    );
    const list = await repo.listRecent('u-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.projectKey).toBe('PRJ');
    expect(list[0]!.accessCount).toBe(4);
  });

  it('支援 limit 參數', async () => {
    let limitParam: unknown;
    const repo = createRecentAccessRepo(
      mockPool(
        mockClient(async () => ({ rows: [] })),
        async (_sql, params) => {
          limitParam = (params as unknown[])[1];
          return { rows: [] };
        },
      ),
    );
    await repo.listRecent('u', 10);
    expect(limitParam).toBe(10);
  });
});

describe('upsertAccess', () => {
  it('BEGIN → INSERT ON CONFLICT → prune → COMMIT', async () => {
    const sqlLog: string[] = [];
    const client = mockClient(async (sql) => {
      sqlLog.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      return { rows: [], rowCount: 0 };
    });
    const repo = createRecentAccessRepo(mockPool(client));
    await repo.upsertAccess('u-1', 'PRJ');
    expect(sqlLog[0]).toBe('BEGIN');
    expect(sqlLog[sqlLog.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('當 INSERT 失敗 → ROLLBACK 並 throw', async () => {
    const sqlLog: string[] = [];
    const client = mockClient(async (sql) => {
      sqlLog.push(sql);
      if (sql.startsWith('INSERT')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    });
    const repo = createRecentAccessRepo(mockPool(client));
    await expect(repo.upsertAccess('u-1', 'P')).rejects.toThrow(/boom/);
    expect(sqlLog).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('pruneOver100', () => {
  it('回傳 rowCount', async () => {
    const client = mockClient(async () => ({ rows: [], rowCount: 3 }));
    const repo = createRecentAccessRepo(mockPool(client));
    expect(await repo.pruneOver100('u-1')).toBe(3);
    expect(client.release).toHaveBeenCalled();
  });

  it('rowCount null → 0', async () => {
    const client = mockClient(async () => ({ rows: [], rowCount: null }));
    const repo = createRecentAccessRepo(mockPool(client));
    expect(await repo.pruneOver100('u-1')).toBe(0);
  });
});
