// T079：US4 bulk_update_operations / bulk_update_items repository
// - createOperation：使用者按下「確認套用」時建立、status=running
// - recordItem：每筆 issue 處理完寫一筆（success / permission_denied / version_conflict / api_error）
// - finalize：更新最終 status + success/failure 計數 + completed_at
// - getById：查單一操作（含 items）；對非該使用者擁有的 id 回 null（避免跨權限洩漏）

import type { Pool } from 'pg';

export type BulkTargetField =
  | 'assignee'
  | 'due_date'
  | 'label'
  | 'priority'
  | 'sprint';

export type BulkOperationStatus =
  | 'running'
  | 'success'
  | 'partial_failure'
  | 'failure'
  | 'cancelled';

export type BulkItemResult =
  | 'success'
  | 'permission_denied'
  | 'version_conflict'
  | 'api_error';

export interface CreateOperationArgs {
  userId: string;
  projectKey: string;
  filterDsl: Record<string, unknown>;
  targetField: BulkTargetField;
  targetValueJson: unknown;
  totalCount: number;
  confirmedAt: Date;
}

export interface RecordItemArgs {
  operationId: string;
  issueKey: string;
  previousValueJson: unknown;
  newValueJson: unknown;
  result: BulkItemResult;
  errorMessage?: string | null;
  appliedAt?: Date | null;
}

export interface FinalizeArgs {
  operationId: string;
  status: BulkOperationStatus;
  successCount: number;
  failureCount: number;
  completedAt: Date;
}

export interface BulkOperationItem {
  issueKey: string;
  result: BulkItemResult;
  errorMessage: string | null;
  appliedAt: Date | null;
}

export interface BulkOperation {
  id: string;
  userId: string;
  projectKey: string;
  targetField: BulkTargetField;
  totalCount: number;
  successCount: number;
  failureCount: number;
  status: BulkOperationStatus;
  startedAt: Date;
  completedAt: Date | null;
  items: BulkOperationItem[];
}

export interface BulkOperationSummary {
  id: string;
  projectKey: string;
  targetField: BulkTargetField;
  totalCount: number;
  successCount: number;
  failureCount: number;
  status: BulkOperationStatus;
  startedAt: Date;
  completedAt: Date | null;
}

export interface ListByUserArgs {
  userId: string;
  projectKey?: string;
  status?: BulkOperationStatus;
  cursor?: string;
  pageSize?: number;
}

export interface BulkUpdatesRepo {
  createOperation(args: CreateOperationArgs): Promise<{ id: string }>;
  recordItem(args: RecordItemArgs): Promise<void>;
  finalize(args: FinalizeArgs): Promise<void>;
  getById(userId: string, operationId: string): Promise<BulkOperation | null>;
  listByUser(args: ListByUserArgs): Promise<{ items: BulkOperationSummary[]; nextCursor: string | null }>;
}

export function createBulkUpdatesRepo(pool: Pool): BulkUpdatesRepo {
  return {
    async createOperation(args) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO bulk_update_operations
           (user_id, project_key, filter_dsl, target_field, target_value_json,
            total_count, confirmed_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
         RETURNING id`,
        [
          args.userId,
          args.projectKey,
          JSON.stringify(args.filterDsl),
          args.targetField,
          JSON.stringify(args.targetValueJson),
          args.totalCount,
          args.confirmedAt,
        ],
      );
      return { id: rows[0]!.id };
    },

    async recordItem(args) {
      await pool.query(
        `INSERT INTO bulk_update_items
           (operation_id, issue_key, previous_value_json, new_value_json,
            result, error_message, applied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (operation_id, issue_key) DO UPDATE
           SET previous_value_json = EXCLUDED.previous_value_json,
               new_value_json = EXCLUDED.new_value_json,
               result = EXCLUDED.result,
               error_message = EXCLUDED.error_message,
               applied_at = EXCLUDED.applied_at`,
        [
          args.operationId,
          args.issueKey,
          args.previousValueJson === undefined ? null : JSON.stringify(args.previousValueJson),
          JSON.stringify(args.newValueJson),
          args.result,
          args.errorMessage ?? null,
          args.appliedAt ?? null,
        ],
      );
    },

    async finalize(args) {
      await pool.query(
        `UPDATE bulk_update_operations
           SET status = $2,
               success_count = $3,
               failure_count = $4,
               completed_at = $5
         WHERE id = $1`,
        [
          args.operationId,
          args.status,
          args.successCount,
          args.failureCount,
          args.completedAt,
        ],
      );
    },

    async getById(userId, operationId) {
      const opRes = await pool.query<{
        id: string;
        user_id: string;
        project_key: string;
        target_field: BulkTargetField;
        total_count: number;
        success_count: number;
        failure_count: number;
        status: BulkOperationStatus;
        confirmed_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT id, user_id, project_key, target_field, total_count,
                success_count, failure_count, status, confirmed_at, completed_at
         FROM bulk_update_operations
         WHERE id = $1 AND user_id = $2`,
        [operationId, userId],
      );
      const op = opRes.rows[0];
      if (!op) return null;

      const itemsRes = await pool.query<{
        issue_key: string;
        result: BulkItemResult;
        error_message: string | null;
        applied_at: Date | null;
      }>(
        `SELECT issue_key, result, error_message, applied_at
         FROM bulk_update_items
         WHERE operation_id = $1
         ORDER BY issue_key ASC`,
        [operationId],
      );

      return {
        id: op.id,
        userId: op.user_id,
        projectKey: op.project_key,
        targetField: op.target_field,
        totalCount: op.total_count,
        successCount: op.success_count,
        failureCount: op.failure_count,
        status: op.status,
        startedAt: op.confirmed_at,
        completedAt: op.completed_at,
        items: itemsRes.rows.map((r) => ({
          issueKey: r.issue_key,
          result: r.result,
          errorMessage: r.error_message,
          appliedAt: r.applied_at,
        })),
      };
    },

    async listByUser(args) {
      const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 20));
      const conditions: string[] = ['user_id = $1'];
      const params: unknown[] = [args.userId];
      let i = 2;
      if (args.projectKey) {
        conditions.push(`project_key = $${i++}`);
        params.push(args.projectKey);
      }
      if (args.status) {
        conditions.push(`status = $${i++}`);
        params.push(args.status);
      }
      const cursorDate = decodeListCursor(args.cursor);
      if (cursorDate) {
        conditions.push(`confirmed_at < $${i++}`);
        params.push(cursorDate);
      }
      params.push(pageSize + 1);
      const limitIdx = i;

      const { rows } = await pool.query<{
        id: string;
        project_key: string;
        target_field: BulkTargetField;
        total_count: number;
        success_count: number;
        failure_count: number;
        status: BulkOperationStatus;
        confirmed_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT id, project_key, target_field, total_count,
                success_count, failure_count, status, confirmed_at, completed_at
         FROM bulk_update_operations
         WHERE ${conditions.join(' AND ')}
         ORDER BY confirmed_at DESC
         LIMIT $${limitIdx}`,
        params,
      );

      const items = rows.slice(0, pageSize).map((r) => ({
        id: r.id,
        projectKey: r.project_key,
        targetField: r.target_field,
        totalCount: r.total_count,
        successCount: r.success_count,
        failureCount: r.failure_count,
        status: r.status,
        startedAt: r.confirmed_at,
        completedAt: r.completed_at,
      }));
      const last = items[items.length - 1];
      const nextCursor = rows.length > pageSize && last ? encodeListCursor(last.startedAt) : null;
      return { items, nextCursor };
    },
  };
}

function encodeListCursor(d: Date): string {
  return Buffer.from(JSON.stringify({ t: d.toISOString() }), 'utf8').toString('base64url');
}

function decodeListCursor(c: string | undefined): Date | null {
  if (!c) return null;
  try {
    const obj = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { t?: unknown };
    if (typeof obj.t !== 'string') return null;
    const d = new Date(obj.t);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}
