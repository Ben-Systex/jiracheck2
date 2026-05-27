// T047：US2 query_history repository
// - insert：每次 /nlq/query 完成（含 clarification / error）皆寫一筆
// - pruneOlderThanDays：排程清理；data-model 保留 90 天

import type { Pool } from 'pg';

export type QueryHistoryStatus = 'ok' | 'partial_permission' | 'clarification_needed' | 'error';

export interface InsertArgs {
  userId: string;
  originalQuestion: string;
  queryPlan: unknown;
  explanationZh: string;
  resultCount: number;
  latencyMs: number;
  status: QueryHistoryStatus;
}

export interface QueryHistoryRepo {
  insert(args: InsertArgs): Promise<{ id: string }>;
  pruneOlderThanDays(days?: number): Promise<number>;
}

export function createQueryHistoryRepo(pool: Pool): QueryHistoryRepo {
  return {
    async insert(args) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO query_history
           (user_id, original_question, query_plan, explanation_zh,
            result_count, latency_ms, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          args.userId,
          args.originalQuestion,
          JSON.stringify(args.queryPlan),
          args.explanationZh,
          args.resultCount,
          args.latencyMs,
          args.status,
        ],
      );
      return { id: rows[0]!.id };
    },
    async pruneOlderThanDays(days = 90) {
      const { rowCount } = await pool.query(
        `DELETE FROM query_history
         WHERE created_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      );
      return rowCount ?? 0;
    },
  };
}
