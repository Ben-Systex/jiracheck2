// 測試用 mini-app for schedules routes（in-memory repos + 預先 mock admin）

import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { schedulesRouter, type SchedulesDeps } from '../../src/routes/schedules';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import type {
  CreateScheduleArgs,
  ScheduleConfig,
  ScheduleConfigsRepo,
  UpdateScheduleArgs,
} from '../../src/db/repositories/schedule-configs';
import type {
  ExtendedServiceId,
  ServiceLogResult,
  ServiceLogsRepo,
  ServiceLogTriggeredBy,
} from '../../src/db/repositories/service-logs';
import { __setPoolForTesting } from '../../src/db/pool';
import type { Pool, PoolClient } from 'pg';

const NOW = new Date('2026-05-30T00:00:00Z');

export function createInMemoryScheduleConfigsRepo(): ScheduleConfigsRepo & {
  _items: Map<string, ScheduleConfig>;
} {
  const items = new Map<string, ScheduleConfig>();
  let nextId = 1;
  return {
    _items: items,
    async create(args: CreateScheduleArgs): Promise<ScheduleConfig> {
      const id = `sc-${nextId++}`;
      const cfg: ScheduleConfig = {
        id,
        serviceId: args.serviceId,
        frequencyType: args.frequencyType,
        frequencyValue: args.frequencyValue,
        enabled: args.enabled,
        nextRunAt: args.nextRunAt,
        lastRunAt: null,
        createdBy: args.createdBy,
        updatedBy: args.createdBy,
        createdAt: NOW,
        updatedAt: NOW,
      };
      items.set(id, cfg);
      return cfg;
    },
    async update(args: UpdateScheduleArgs): Promise<ScheduleConfig | null> {
      const cur = items.get(args.id);
      if (!cur) return null;
      const updated: ScheduleConfig = {
        ...cur,
        serviceId: args.serviceId,
        frequencyType: args.frequencyType,
        frequencyValue: args.frequencyValue,
        enabled: args.enabled,
        nextRunAt: args.nextRunAt,
        updatedBy: args.updatedBy,
        updatedAt: NOW,
      };
      items.set(args.id, updated);
      return updated;
    },
    async delete(id: string): Promise<boolean> {
      return items.delete(id);
    },
    async getById(id: string): Promise<ScheduleConfig | null> {
      return items.get(id) ?? null;
    },
    async listAll(filter): Promise<ScheduleConfig[]> {
      let arr = [...items.values()];
      if (filter?.enabled !== undefined) arr = arr.filter((c) => c.enabled === filter.enabled);
      if (filter?.serviceId !== undefined) arr = arr.filter((c) => c.serviceId === filter.serviceId);
      return arr;
    },
    async listEnabled(): Promise<ScheduleConfig[]> {
      return [...items.values()].filter((c) => c.enabled);
    },
    async updateNextRun(id: string, nextRunAt: Date | null): Promise<void> {
      const cur = items.get(id);
      if (cur) items.set(id, { ...cur, nextRunAt });
    },
    async updateLastRun(id: string, lastRunAt: Date): Promise<void> {
      const cur = items.get(id);
      if (cur) items.set(id, { ...cur, lastRunAt });
    },
    async countEnabled(): Promise<number> {
      return [...items.values()].filter((c) => c.enabled).length;
    },
  };
}

export function createInMemoryServiceLogsRepo(): ServiceLogsRepo & {
  _logs: Map<string, Record<string, unknown>>;
} {
  const logs = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return {
    _logs: logs,
    async start(args: {
      scheduleId?: string | null;
      serviceId: ExtendedServiceId;
      triggeredBy: ServiceLogTriggeredBy;
      triggeredByUserId?: string | null;
      ruleVersion?: string | null;
    }) {
      const id = `sl-${nextId++}`;
      logs.set(id, { ...args, id, startedAt: NOW, result: 'running' });
      return { id, startedAt: NOW };
    },
    async finalize(args: {
      id: string;
      result: ServiceLogResult;
      summary: string;
      notes: Record<string, unknown>;
      endedAt: Date;
    }) {
      const cur = logs.get(args.id) ?? {};
      logs.set(args.id, { ...cur, ...args });
    },
    async insertImmediate(args) {
      const id = `sl-${nextId++}`;
      logs.set(id, { ...args, id });
      return { id };
    },
    async getById() {
      return null;
    },
    async list() {
      return { items: [], nextCursor: null };
    },
    streamForExport() {
      return {
        async *[Symbol.asyncIterator]() {
          /* empty in-memory default */
        },
      };
    },
    async pruneOlderThanDays() {
      return 0;
    },
    async countOpenForService() {
      return 0;
    },
  };
}

/** mock pg pool + 預先注入 atlassian_account_id → users.id 對照 */
export function setupPoolForAdminTests(accountIdByUserId: Map<string, string>): void {
  const fakeClient: PoolClient = {
    query: async (sql: string, _params?: unknown[]) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: true }] };
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  } as unknown as PoolClient;

  const pool: Pool = {
    connect: async () => fakeClient,
    query: async (sql: string, params?: unknown[]) => {
      // require-admin: SELECT atlassian_account_id FROM users WHERE id = $1
      if (/atlassian_account_id.*FROM users WHERE id/.test(sql)) {
        const userId = (params as unknown[])[0] as string;
        const accId = accountIdByUserId.get(userId);
        return accId ? { rows: [{ atlassian_account_id: accId }] } : { rows: [] };
      }
      // 其他 query 預設空
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  __setPoolForTesting(pool);
}

export function teardownAdminPool(): void {
  __setPoolForTesting(undefined);
}

export interface BuildScheduleAppArgs {
  userId?: string;
  /** 注入 fixed schedulesDeps；若未指定預設提供 in-memory 版本 */
  deps?: Partial<SchedulesDeps>;
}

type BuiltApp = {
  app: Express;
  repo: ReturnType<typeof createInMemoryScheduleConfigsRepo>;
  serviceLogsRepo: ReturnType<typeof createInMemoryServiceLogsRepo>;
};

function makeFakeRunnerPool(): Pool {
  return {
    connect: async () => ({
      query: async () => ({ rows: [{ locked: true }] }),
      release: () => undefined,
    }),
  } as unknown as Pool;
}

function resolveRepos(args: BuildScheduleAppArgs): {
  repo: ReturnType<typeof createInMemoryScheduleConfigsRepo>;
  serviceLogsRepo: ReturnType<typeof createInMemoryServiceLogsRepo>;
} {
  const repo =
    (args.deps?.repo as ReturnType<typeof createInMemoryScheduleConfigsRepo>) ??
    createInMemoryScheduleConfigsRepo();
  const serviceLogsRepo =
    (args.deps?.serviceLogsRepo as ReturnType<typeof createInMemoryServiceLogsRepo>) ??
    createInMemoryServiceLogsRepo();
  return { repo, serviceLogsRepo };
}

export function buildSchedulesApp(args: BuildScheduleAppArgs = {}): BuiltApp {
  const userId = args.userId ?? 'user-admin';
  const { repo, serviceLogsRepo } = resolveRepos(args);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.sessionUser = { userId, sid: 'test-sid' };
    next();
  });

  const deps: SchedulesDeps = {
    runnerDeps: args.deps?.runnerDeps ?? {
      pool: makeFakeRunnerPool(),
      serviceLogsRepo,
      scheduleConfigsRepo: repo,
      services: {},
    },
    repo,
    serviceLogsRepo,
    ...(args.deps?.scheduler !== undefined ? { scheduler: args.deps.scheduler } : {}),
  };
  app.use('/api/v1', schedulesRouter(deps));
  app.use((_req, res) => sendProblem(res, buildProblem('not_found')));
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      sendProblem(res, buildProblem('internal', { detail: String(err) }));
    },
  );
  return { app, repo, serviceLogsRepo };
}
