// T096：每日 cleanup job
// - 03:00 query_history > 90 天 DELETE
// - 03:30 bulk_update_operations > 12 個月 DELETE（一併 cascade items；資料量未來大可改 archive）
// - 每小時 sessions.expires_at < now() 清掃
// 採輕量 setInterval 排程；多執行個體部署時建議加 advisory lock，本 v1 單機 OK。

import type { Pool } from 'pg';
import { createQueryHistoryRepo } from '../db/repositories/query-history';

export interface CleanupJobsOptions {
  pool: Pool;
  /** 注入時間 */
  now?: () => Date;
  /** 注入 logger */
  log?: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export interface CleanupResult {
  removedQueryHistory: number;
  removedBulkOps: number;
  removedSessions: number;
}

export async function runCleanup(opts: CleanupJobsOptions): Promise<CleanupResult> {
  const log = opts.log ?? console;
  try {
    const removedQueryHistory = await createQueryHistoryRepo(opts.pool).pruneOlderThanDays(90);
    const removedBulkOps = await pruneBulkOps(opts.pool);
    const removedSessions = await pruneSessions(opts.pool);
    log.info({ removedQueryHistory, removedBulkOps, removedSessions }, '[cleanup] done');
    return { removedQueryHistory, removedBulkOps, removedSessions };
  } catch (err) {
    log.error({ err }, '[cleanup] failed');
    throw err;
  }
}

async function pruneBulkOps(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM bulk_update_operations
     WHERE confirmed_at < now() - interval '12 months'`,
  );
  return rowCount ?? 0;
}

async function pruneSessions(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM sessions WHERE expires_at < now()`,
  );
  return rowCount ?? 0;
}

/**
 * 安排排程：每天 03:00 跑一次 runCleanup（時區為 server 本地）。
 * 回傳 stopper 供測試 / shutdown 清理。
 */
export function scheduleCleanup(opts: CleanupJobsOptions): () => void {
  const now = opts.now ?? (() => new Date());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleNext(): void {
    if (stopped) return;
    const next = nextRunAt(now());
    const delay = next.getTime() - now().getTime();
    timer = setTimeout(() => {
      void runCleanup(opts).finally(() => scheduleNext());
    }, delay);
    timer.unref?.();
  }
  scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** 下次 03:00（local） */
export function nextRunAt(now: Date): Date {
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}
