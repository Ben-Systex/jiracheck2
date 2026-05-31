// T017：service_logs repository（feature 002-scheduled-services）
// - start(): 開始執行時建立一筆（running，ended_at=NULL，result 預設 'failure' 由 finalize 改寫）
// - finalize(): 寫入最終結果 + summary + notes + ended_at
// - insertSkipped / insertMissed: 立即完成的紀錄（advisory lock 失敗 / 啟動時偵測錯過）
// - list(): keyset 分頁（confirmed_at DESC）+ 過濾
// - getById(): 詳細
// - streamForExport(): 流式匯出
// - pruneOlderThanDays(): cleanup job 用

import type { Pool } from 'pg';
import type { ServiceId } from './schedule-configs';

export type ExtendedServiceId = ServiceId | 'SYSTEM_CLEANUP';
export type ServiceLogResult = 'success' | 'partial_failure' | 'failure' | 'skipped' | 'missed';
export type ServiceLogTriggeredBy = 'schedule' | 'manual' | 'system';

export interface StartArgs {
  scheduleId?: string | null;
  serviceId: ExtendedServiceId;
  triggeredBy: ServiceLogTriggeredBy;
  triggeredByUserId?: string | null;
  ruleVersion?: string | null;
}

export interface FinalizeArgs {
  id: string;
  result: ServiceLogResult;
  summary: string;
  notes: Record<string, unknown>;
  endedAt: Date;
}

export interface InsertImmediateArgs {
  scheduleId?: string | null;
  serviceId: ExtendedServiceId;
  triggeredBy: ServiceLogTriggeredBy;
  triggeredByUserId?: string | null;
  result: ServiceLogResult;
  summary: string;
  notes?: Record<string, unknown>;
  startedAt?: Date;
  endedAt?: Date;
}

export interface ListArgs {
  serviceId?: ExtendedServiceId;
  result?: ServiceLogResult;
  from?: Date;
  to?: Date;
  cursor?: string;
  pageSize?: number;
}

export interface ServiceLogSummary {
  id: string;
  scheduleId: string | null;
  serviceId: ExtendedServiceId;
  triggeredBy: ServiceLogTriggeredBy;
  startedAt: Date;
  endedAt: Date | null;
  result: ServiceLogResult;
  summary: string;
  ruleVersion: string | null;
}

export interface ServiceLogDetail extends ServiceLogSummary {
  notes: Record<string, unknown>;
  triggeredByUserId: string | null;
}

export interface ServiceLogsRepo {
  start(args: StartArgs): Promise<{ id: string; startedAt: Date }>;
  finalize(args: FinalizeArgs): Promise<void>;
  insertImmediate(args: InsertImmediateArgs): Promise<{ id: string }>;
  getById(id: string): Promise<ServiceLogDetail | null>;
  list(args: ListArgs): Promise<{ items: ServiceLogSummary[]; nextCursor: string | null }>;
  pruneOlderThanDays(days: number): Promise<number>;
  countOpenForService(serviceId: ExtendedServiceId): Promise<number>;
}

interface RawRow {
  id: string;
  schedule_id: string | null;
  service_id: ExtendedServiceId;
  triggered_by: ServiceLogTriggeredBy;
  triggered_by_user_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  result: ServiceLogResult;
  summary: string;
  notes: Record<string, unknown>;
  rule_version: string | null;
}

const SUMMARY_COLS =
  'id, schedule_id, service_id, triggered_by, started_at, ended_at, result, summary, rule_version';
const DETAIL_COLS = `${SUMMARY_COLS}, notes, triggered_by_user_id`;

function rowToSummary(r: RawRow): ServiceLogSummary {
  return {
    id: r.id,
    scheduleId: r.schedule_id,
    serviceId: r.service_id,
    triggeredBy: r.triggered_by,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    result: r.result,
    summary: r.summary,
    ruleVersion: r.rule_version,
  };
}

function rowToDetail(r: RawRow): ServiceLogDetail {
  return {
    ...rowToSummary(r),
    notes: r.notes ?? {},
    triggeredByUserId: r.triggered_by_user_id,
  };
}

function encodeCursor(d: Date): string {
  return Buffer.from(JSON.stringify({ t: d.toISOString() }), 'utf8').toString('base64url');
}

function decodeCursor(c: string | undefined): Date | null {
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

export function createServiceLogsRepo(pool: Pool): ServiceLogsRepo {
  return {
    async start(args) {
      const { rows } = await pool.query<{ id: string; started_at: Date }>(
        `INSERT INTO service_logs
           (schedule_id, service_id, triggered_by, triggered_by_user_id,
            result, summary, notes, rule_version)
         VALUES ($1, $2, $3, $4, 'failure', '', '{}'::jsonb, $5)
         RETURNING id, started_at`,
        [
          args.scheduleId ?? null,
          args.serviceId,
          args.triggeredBy,
          args.triggeredByUserId ?? null,
          args.ruleVersion ?? null,
        ],
      );
      const r = rows[0]!;
      return { id: r.id, startedAt: r.started_at };
    },

    async finalize(args) {
      await pool.query(
        `UPDATE service_logs
            SET result = $2,
                summary = $3,
                notes = $4::jsonb,
                ended_at = $5
          WHERE id = $1`,
        [args.id, args.result, args.summary, JSON.stringify(args.notes), args.endedAt],
      );
    },

    async insertImmediate(args) {
      const now = new Date();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO service_logs
           (schedule_id, service_id, triggered_by, triggered_by_user_id,
            started_at, ended_at, result, summary, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id`,
        [
          args.scheduleId ?? null,
          args.serviceId,
          args.triggeredBy,
          args.triggeredByUserId ?? null,
          args.startedAt ?? now,
          args.endedAt ?? now,
          args.result,
          args.summary,
          JSON.stringify(args.notes ?? {}),
        ],
      );
      return { id: rows[0]!.id };
    },

    async getById(id) {
      const { rows } = await pool.query<RawRow>(
        `SELECT ${DETAIL_COLS} FROM service_logs WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      return r ? rowToDetail(r) : null;
    },

    async list(args) {
      const pageSize = Math.min(100, Math.max(1, args.pageSize ?? 20));
      const conds: string[] = [];
      const params: unknown[] = [];
      if (args.serviceId) {
        params.push(args.serviceId);
        conds.push(`service_id = $${params.length}`);
      }
      if (args.result) {
        params.push(args.result);
        conds.push(`result = $${params.length}`);
      }
      if (args.from) {
        params.push(args.from);
        conds.push(`started_at >= $${params.length}`);
      }
      if (args.to) {
        params.push(args.to);
        conds.push(`started_at <= $${params.length}`);
      }
      const cursorDate = decodeCursor(args.cursor);
      if (cursorDate) {
        params.push(cursorDate);
        conds.push(`started_at < $${params.length}`);
      }
      params.push(pageSize + 1);
      const limitIdx = params.length;
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const { rows } = await pool.query<RawRow>(
        `SELECT ${SUMMARY_COLS} FROM service_logs ${where}
         ORDER BY started_at DESC
         LIMIT $${limitIdx}`,
        params,
      );

      const items = rows.slice(0, pageSize).map(rowToSummary);
      const last = items[items.length - 1];
      const nextCursor = rows.length > pageSize && last ? encodeCursor(last.startedAt) : null;
      return { items, nextCursor };
    },

    async pruneOlderThanDays(days) {
      const { rowCount } = await pool.query(
        `DELETE FROM service_logs
          WHERE started_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      );
      return rowCount ?? 0;
    },

    async countOpenForService(serviceId) {
      const { rows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM service_logs
          WHERE service_id = $1 AND ended_at IS NULL`,
        [serviceId],
      );
      return Number(rows[0]?.c ?? 0);
    },
  };
}
