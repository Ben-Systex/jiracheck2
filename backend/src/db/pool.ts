// PostgreSQL 連線池
// - 採 pg 內建 Pool；單例匯出，全應用共用
// - 透過 DATABASE_URL 連線；本機開發、CI、prod 皆同
// - 提供 closePool() 供測試與 graceful shutdown

import { Pool, type PoolConfig } from 'pg';

let pool: Pool | undefined;

export function getPool(config?: Partial<PoolConfig>): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...config,
  });

  pool.on('error', (err) => {
    console.error('[db] unexpected pool error:', err);
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

// 提供測試覆寫用：直接注入 mock pool
export function __setPoolForTesting(mock: Pool | undefined): void {
  pool = mock;
}
