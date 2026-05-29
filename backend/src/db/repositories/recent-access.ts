// T033：US1「最近 5 個專案」repository
// - upsertAccess：使用者點擊任一專案時更新 last_accessed_at / access_count
// - listRecent：首頁取前 N 筆（預設 5）
// - pruneOver100：當單一使用者超過 100 筆時，LRU 移除最舊（data-model 保留策略）
// 所有查詢都帶 user_id，避免跨權限洩漏。

import type { Pool, PoolClient } from 'pg';

export interface RecentAccessRow {
  projectKey: string;
  lastAccessedAt: Date;
  accessCount: number;
}

export interface RecentAccessRepo {
  upsertAccess(userId: string, projectKey: string): Promise<void>;
  listRecent(userId: string, limit?: number): Promise<RecentAccessRow[]>;
  pruneOver100(userId: string): Promise<number>;
}

const MAX_KEEP_PER_USER = 100;
const DEFAULT_LIMIT = 5;

export function createRecentAccessRepo(pool: Pool): RecentAccessRepo {
  return {
    async upsertAccess(userId, projectKey) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO recent_project_access (user_id, project_key, last_accessed_at, access_count)
           VALUES ($1, $2, now(), 1)
           ON CONFLICT (user_id, project_key)
           DO UPDATE SET last_accessed_at = now(),
                         access_count = recent_project_access.access_count + 1`,
          [userId, projectKey],
        );
        await pruneOver100Inner(client, userId);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async listRecent(userId, limit = DEFAULT_LIMIT) {
      const { rows } = await pool.query<{
        project_key: string;
        last_accessed_at: Date;
        access_count: number;
      }>(
        `SELECT project_key, last_accessed_at, access_count
         FROM recent_project_access
         WHERE user_id = $1
         ORDER BY last_accessed_at DESC
         LIMIT $2`,
        [userId, limit],
      );
      return rows.map((r) => ({
        projectKey: r.project_key,
        lastAccessedAt: r.last_accessed_at,
        accessCount: r.access_count,
      }));
    },

    async pruneOver100(userId) {
      const client = await pool.connect();
      try {
        const removed = await pruneOver100Inner(client, userId);
        return removed;
      } finally {
        client.release();
      }
    },
  };
}

// 採 CTE keep：保留 last_accessed_at DESC 排序的前 N 筆 project_key，刪除其餘
// 對「同一時間戳的多筆」邊界較直觀，避免 < cutoff 嚴格不等於造成漏刪
async function pruneOver100Inner(client: PoolClient, userId: string): Promise<number> {
  const { rowCount } = await client.query(
    `WITH keep AS (
       SELECT project_key
       FROM recent_project_access
       WHERE user_id = $1
       ORDER BY last_accessed_at DESC
       LIMIT $2
     )
     DELETE FROM recent_project_access
     WHERE user_id = $1
       AND project_key NOT IN (SELECT project_key FROM keep)`,
    [userId, MAX_KEEP_PER_USER],
  );
  return rowCount ?? 0;
}
