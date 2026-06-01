// T051：CHKPROJ integration spec
// 透過 service-runner 跑 CHKPROJ + 驗 ServiceLog 寫入 / metrics observe

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runService } from '../../src/jobs/service-runner';
import { createChkprojService } from '../../src/jobs/services/chkproj';
import type { ProjectCheckListsRepo } from '../../src/db/repositories/project-check-lists';
import {
  __resetMetricsForTesting,
  initMetrics,
  getRegistry,
} from '../../src/lib/metrics';
import type { Pool, PoolClient } from 'pg';

const NOW = new Date('2026-06-15T12:00:00Z');

function fakeRepo(keys: string[]): ProjectCheckListsRepo {
  return {
    async list() {
      return [];
    },
    async add() {
      throw new Error('unused');
    },
    async remove() {
      return false;
    },
    async getByProjectKey() {
      return null;
    },
    async listProjectKeys() {
      return keys;
    },
  };
}

function fakeClient(lockOk = true): PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: lockOk }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: true }] };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function fakePool(client: PoolClient): Pool {
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
}

interface FakeServiceLogs {
  _logs: Map<string, Record<string, unknown>>;
  start(args: unknown): Promise<{ id: string; startedAt: Date }>;
  finalize(args: unknown): Promise<void>;
  insertImmediate(args: unknown): Promise<{ id: string }>;
  getById(): Promise<null>;
  list(): Promise<{ items: never[]; nextCursor: null }>;
  streamForExport(): AsyncIterable<never>;
  pruneOlderThanDays(): Promise<number>;
  countOpenForService(): Promise<number>;
}

function fakeServiceLogs(): FakeServiceLogs {
  const logs = new Map<string, Record<string, unknown>>();
  let n = 1;
  return {
    _logs: logs,
    async start(args) {
      const id = `sl-${n++}`;
      logs.set(id, { id, startedAt: NOW, ...(args as Record<string, unknown>) });
      return { id, startedAt: NOW };
    },
    async finalize(args) {
      const a = args as { id: string };
      const cur = logs.get(a.id) ?? {};
      logs.set(a.id, { ...cur, ...(args as Record<string, unknown>) });
    },
    async insertImmediate(args) {
      const id = `sl-imm-${n++}`;
      logs.set(id, { id, ...(args as Record<string, unknown>) });
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
          /* empty */
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

function fakeScheduleConfigs(): {
  updateLastRun(id: string, at: Date): Promise<void>;
  create(): Promise<never>;
  update(): Promise<null>;
  delete(): Promise<false>;
  getById(): Promise<null>;
  listAll(): Promise<never[]>;
  listEnabled(): Promise<never[]>;
  updateNextRun(): Promise<void>;
  countEnabled(): Promise<number>;
} {
  return {
    async create() {
      throw new Error('unused');
    },
    async update() {
      return null;
    },
    async delete() {
      return false;
    },
    async getById() {
      return null;
    },
    async listAll() {
      return [];
    },
    async listEnabled() {
      return [];
    },
    async updateNextRun() {
      /* noop */
    },
    async updateLastRun() {
      /* noop */
    },
    async countEnabled() {
      return 0;
    },
  };
}

beforeEach(() => {
  __resetMetricsForTesting();
  initMetrics({ collectDefault: false });
});

const fakeAcquireSession = async (): Promise<import('../../src/mcp/types').McpSession> => ({
  async callTool<T = unknown>() {
    return { content: {} as T };
  },
  async close() {
    /* noop */
  },
});

describe('CHKPROJ integration via runService', () => {
  it('清單為空 → ServiceLog result=skipped', async () => {
    const serviceLogsRepo = fakeServiceLogs();
    const chkproj = createChkprojService({
      projectCheckListsRepo: fakeRepo([]),
      fetchProject: vi.fn(),
    });
    const r = await runService(
      {
        pool: fakePool(fakeClient()),
        serviceLogsRepo: serviceLogsRepo as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKPROJ: chkproj },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    expect(r.executed).toBe(true);
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('skipped');
    expect((log?.notes as { reason?: string }).reason).toBe('empty_checklist');
  });

  it('3 個專案、1 個延遲 → success + summary 含 1 個延遲', async () => {
    const NOW_LOCAL = new Date('2026-06-15T12:00:00Z');
    const serviceLogsRepo = fakeServiceLogs();
    const chkproj = createChkprojService({
      projectCheckListsRepo: fakeRepo(['PRJ-A', 'PRJ-B', 'PRJ-C']),
      fetchProject: async (_s, key) => {
        if (key === 'PRJ-B') {
          return {
            projectKey: key,
            sprint: null,
            openIssues: [{ key: 'PRJ-B-1', dueDate: '2026-06-10' }],
            now: NOW_LOCAL,
          };
        }
        return { projectKey: key, sprint: null, openIssues: [], now: NOW_LOCAL };
      },
      retryDelayMs: 0,
    });
    const r = await runService(
      {
        pool: fakePool(fakeClient()),
        serviceLogsRepo: serviceLogsRepo as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKPROJ: chkproj },
        acquireSession: fakeAcquireSession,
        now: () => NOW_LOCAL,
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('success');
    expect(log?.summary as string).toContain('1 個延遲');
    const text = await getRegistry().metrics();
    expect(text).toMatch(/scheduled_service_total\{[^}]*service_id="CHKPROJ"[^}]*result="success"\}\s+1/);
  });

  it('部分失敗 → ServiceLog result=partial_failure + notes.errors[]', async () => {
    const serviceLogsRepo = fakeServiceLogs();
    const chkproj = createChkprojService({
      projectCheckListsRepo: fakeRepo(['PRJ-OK', 'PRJ-FAIL']),
      fetchProject: async (_s, key) => {
        if (key === 'PRJ-FAIL') throw new Error('no access');
        return { projectKey: key, sprint: null, openIssues: [], now: NOW };
      },
      retryDelayMs: 0,
    });
    const r = await runService(
      {
        pool: fakePool(fakeClient()),
        serviceLogsRepo: serviceLogsRepo as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKPROJ: chkproj },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    const log = serviceLogsRepo._logs.get(r.serviceLogId);
    expect(log?.result).toBe('partial_failure');
    const errors = (log?.notes as { errors: Array<{ projectKey: string }> }).errors;
    expect(errors[0]!.projectKey).toBe('PRJ-FAIL');
  });

  it('SC-004：50 mock projects 整批執行 < 5 分鐘（mock 模式 < 1s）', async () => {
    const keys = Array.from({ length: 50 }, (_, i) => `P-${i}`);
    const serviceLogsRepo = fakeServiceLogs();
    const chkproj = createChkprojService({
      projectCheckListsRepo: fakeRepo(keys),
      fetchProject: async (_s, key) => ({
        projectKey: key,
        sprint: null,
        openIssues: [],
        now: NOW,
      }),
      retryDelayMs: 0,
      concurrency: 5,
    });
    const t0 = Date.now();
    await runService(
      {
        pool: fakePool(fakeClient()),
        serviceLogsRepo: serviceLogsRepo as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKPROJ: chkproj },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKPROJ', triggeredBy: 'manual' },
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(5 * 60 * 1000);
  });
});
