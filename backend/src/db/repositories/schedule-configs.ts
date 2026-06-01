// T015：schedule_configs repository（feature 002-scheduled-services）
// - admin-only 全域資源；CRUD 不需 userId 隔離
// - next_run_at / last_run_at 由 service 層（runner / scheduler）更新

import type { Pool } from 'pg';

export type ServiceId = 'CHKPROJ' | 'CHKISSUE';
export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleConfig {
  id: string;
  serviceId: ServiceId;
  frequencyType: FrequencyType;
  frequencyValue: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScheduleArgs {
  serviceId: ServiceId;
  frequencyType: FrequencyType;
  frequencyValue: string;
  enabled: boolean;
  nextRunAt: Date | null;
  createdBy: string;
}

export interface UpdateScheduleArgs {
  id: string;
  serviceId: ServiceId;
  frequencyType: FrequencyType;
  frequencyValue: string;
  enabled: boolean;
  nextRunAt: Date | null;
  updatedBy: string;
}

export interface ListSchedulesArgs {
  enabled?: boolean;
  serviceId?: ServiceId;
}

export interface ScheduleConfigsRepo {
  create(args: CreateScheduleArgs): Promise<ScheduleConfig>;
  update(args: UpdateScheduleArgs): Promise<ScheduleConfig | null>;
  delete(id: string): Promise<boolean>;
  getById(id: string): Promise<ScheduleConfig | null>;
  listAll(args?: ListSchedulesArgs): Promise<ScheduleConfig[]>;
  listEnabled(): Promise<ScheduleConfig[]>;
  updateNextRun(id: string, nextRunAt: Date | null): Promise<void>;
  updateLastRun(id: string, lastRunAt: Date): Promise<void>;
  countEnabled(): Promise<number>;
}

interface RawRow {
  id: string;
  service_id: ServiceId;
  frequency_type: FrequencyType;
  frequency_value: string;
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
}

function rowToConfig(r: RawRow): ScheduleConfig {
  return {
    id: r.id,
    serviceId: r.service_id,
    frequencyType: r.frequency_type,
    frequencyValue: r.frequency_value,
    enabled: r.enabled,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const COLS =
  'id, service_id, frequency_type, frequency_value, enabled, next_run_at, last_run_at, created_by, updated_by, created_at, updated_at';

export function createScheduleConfigsRepo(pool: Pool): ScheduleConfigsRepo {
  return {
    async create(args) {
      const { rows } = await pool.query<RawRow>(
        `INSERT INTO schedule_configs
           (service_id, frequency_type, frequency_value, enabled, next_run_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING ${COLS}`,
        [
          args.serviceId,
          args.frequencyType,
          args.frequencyValue,
          args.enabled,
          args.nextRunAt,
          args.createdBy,
        ],
      );
      return rowToConfig(rows[0]!);
    },

    async update(args) {
      const { rows } = await pool.query<RawRow>(
        `UPDATE schedule_configs
            SET service_id = $2,
                frequency_type = $3,
                frequency_value = $4,
                enabled = $5,
                next_run_at = $6,
                updated_by = $7,
                updated_at = now()
          WHERE id = $1
          RETURNING ${COLS}`,
        [
          args.id,
          args.serviceId,
          args.frequencyType,
          args.frequencyValue,
          args.enabled,
          args.nextRunAt,
          args.updatedBy,
        ],
      );
      const r = rows[0];
      return r ? rowToConfig(r) : null;
    },

    async delete(id) {
      const { rowCount } = await pool.query(`DELETE FROM schedule_configs WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    },

    async getById(id) {
      const { rows } = await pool.query<RawRow>(
        `SELECT ${COLS} FROM schedule_configs WHERE id = $1`,
        [id],
      );
      const r = rows[0];
      return r ? rowToConfig(r) : null;
    },

    async listAll(args = {}) {
      const conds: string[] = [];
      const params: unknown[] = [];
      if (args.enabled !== undefined) {
        params.push(args.enabled);
        conds.push(`enabled = $${params.length}`);
      }
      if (args.serviceId !== undefined) {
        params.push(args.serviceId);
        conds.push(`service_id = $${params.length}`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await pool.query<RawRow>(
        `SELECT ${COLS} FROM schedule_configs ${where} ORDER BY created_at DESC`,
        params,
      );
      return rows.map(rowToConfig);
    },

    async listEnabled() {
      const { rows } = await pool.query<RawRow>(
        `SELECT ${COLS} FROM schedule_configs WHERE enabled = true ORDER BY created_at`,
      );
      return rows.map(rowToConfig);
    },

    async updateNextRun(id, nextRunAt) {
      await pool.query(`UPDATE schedule_configs SET next_run_at = $2 WHERE id = $1`, [
        id,
        nextRunAt,
      ]);
    },

    async updateLastRun(id, lastRunAt) {
      await pool.query(`UPDATE schedule_configs SET last_run_at = $2 WHERE id = $1`, [
        id,
        lastRunAt,
      ]);
    },

    async countEnabled() {
      const { rows } = await pool.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM schedule_configs WHERE enabled = true`,
      );
      return Number(rows[0]?.c ?? 0);
    },
  };
}
