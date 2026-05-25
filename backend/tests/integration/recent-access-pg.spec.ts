// 對真實 PostgreSQL 16 跑的 recent-access repository round-trip smoke。
// 預設 skip；需顯式設 RUN_INTEGRATION_DB=true 才會跑。
// Phase 3 驗證：本檔可用「ops/docker-compose.yml + ops/docker-compose.local.yml」啟的 PG 跑。
// Phase 7 會切到 Testcontainers 自動啟動。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createRecentAccessRepo } from '../../src/db/repositories/recent-access';

const RUN = process.env.RUN_INTEGRATION_DB === 'true';

describe.skipIf(!RUN)('recent-access repository against real PG', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // 建一個臨時使用者
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (atlassian_account_id, display_name)
       VALUES ('smoke-' || gen_random_uuid()::text, 'Smoke User')
       RETURNING id`,
    );
    userId = rows[0]!.id;
  });

  afterAll(async () => {
    // 透過 ON DELETE CASCADE 連動清掉 recent_project_access
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  });

  it('upsertAccess + listRecent: 新增、訪問現存、排序最新優先', async () => {
    const repo = createRecentAccessRepo(pool);
    await repo.upsertAccess(userId, 'PAY');
    await repo.upsertAccess(userId, 'BILL');
    await repo.upsertAccess(userId, 'CORE');

    // 再次訪問 PAY → 應排第一
    await new Promise((r) => setTimeout(r, 10));
    await repo.upsertAccess(userId, 'PAY');

    const recent = await repo.listRecent(userId, 5);
    expect(recent.map((r) => r.projectKey)).toEqual(['PAY', 'CORE', 'BILL']);

    const pay = recent.find((r) => r.projectKey === 'PAY')!;
    expect(pay.accessCount).toBe(2);
  });

  it('listRecent honors limit', async () => {
    const repo = createRecentAccessRepo(pool);
    const recent = await repo.listRecent(userId, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.projectKey).toBe('PAY');
  });

  it('pruneOver100: 第 100 筆以後應被砍掉', async () => {
    const repo = createRecentAccessRepo(pool);
    // 已有 PAY/BILL/CORE 3 筆；再塞 99 筆湊到 102，預期保留 100 筆
    for (let i = 0; i < 99; i++) {
      await pool.query(
        `INSERT INTO recent_project_access (user_id, project_key, last_accessed_at, access_count)
         VALUES ($1, $2, now() - ($3 || ' seconds')::interval, 1)
         ON CONFLICT (user_id, project_key) DO NOTHING`,
        [userId, `BULK${i}`, i],
      );
    }
    const before = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recent_project_access WHERE user_id = $1`,
      [userId],
    );
    expect(Number(before.rows[0]!.c)).toBe(102);

    const removed = await repo.pruneOver100(userId);
    expect(removed).toBeGreaterThanOrEqual(2);

    const after = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recent_project_access WHERE user_id = $1`,
      [userId],
    );
    expect(Number(after.rows[0]!.c)).toBeLessThanOrEqual(100);
  });
});
