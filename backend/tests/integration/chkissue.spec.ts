// T062：CHKISSUE integration spec via runService
// - 5 projects (3 有 issue / 2 無) + 連續 false snapshot 觸發 empty_streak
// - partial_failure 路徑
// - SC-005: 200 mock projects < 10 分鐘

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runService } from '../../src/jobs/service-runner';
import { createChkissueService } from '../../src/jobs/services/chkissue';
import type {
  ProjectIssueSnapshotsRepo,
  SnapshotEntry,
} from '../../src/db/repositories/project-issue-snapshots';
import {
  __resetMetricsForTesting,
  initMetrics,
} from '../../src/lib/metrics';
import type { Pool, PoolClient } from 'pg';
import type { McpSession } from '../../src/mcp/types';

function fakeClient(): PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
      if (/pg_advisory_unlock/.test(sql)) return { rows: [{ unlocked: true }] };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function fakePool(): Pool {
  return {
    connect: vi.fn(async () => fakeClient()),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
}

function fakeServiceLogs(): {
  _logs: Map<string, Record<string, unknown>>;
  start(args: unknown): Promise<{ id: string; startedAt: Date }>;
  finalize(args: unknown): Promise<void>;
  insertImmediate(args: unknown): Promise<{ id: string }>;
  getById(): Promise<null>;
  list(): Promise<{ items: never[]; nextCursor: null }>;
  streamForExport(): AsyncIterable<never>;
  pruneOlderThanDays(): Promise<number>;
  countOpenForService(): Promise<number>;
} {
  const logs = new Map<string, Record<string, unknown>>();
  let n = 1;
  return {
    _logs: logs,
    async start(args) {
      const id = `sl-${n++}`;
      logs.set(id, { id, ...(args as Record<string, unknown>) });
      return { id, startedAt: new Date() };
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
          /* noop */
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

interface StubSnapshotsRepo extends ProjectIssueSnapshotsRepo {
  _inserts: SnapshotEntry[];
  _streakByProject: Map<string, number>;
}

function fakeSnapshotsRepo(): StubSnapshotsRepo {
  const inserts: SnapshotEntry[] = [];
  const streakByProject = new Map<string, number>();
  return {
    _inserts: inserts,
    _streakByProject: streakByProject,
    async insertBatch(args) {
      for (const s of args.snapshots) inserts.push(s);
    },
    async getStreakAt(projectKey) {
      return streakByProject.get(projectKey) ?? 0;
    },
    async pruneOlderThanDays() {
      return 0;
    },
  };
}

const fakeAcquireSession = async (): Promise<McpSession> => ({
  async callTool<T = unknown>() {
    return { content: {} as T };
  },
  async close() {
    /* noop */
  },
});

beforeEach(() => {
  __resetMetricsForTesting();
  initMetrics({ collectDefault: false });
});

describe('CHKISSUE integration via runService', () => {
  it('5 projects（3 有 / 2 無）→ success + with_issues / without_issues 分組', async () => {
    const serviceLogs = fakeServiceLogs();
    const snapshots = fakeSnapshotsRepo();
    const chkissue = createChkissueService({
      snapshotsRepo: snapshots,
      listProjects: async () => ['A', 'B', 'C', 'D', 'E'],
      countIssues: async (_s, key) => (['A', 'B', 'C'].includes(key) ? 3 : 0),
      retryDelayMs: 0,
      emptyStreakThreshold: 999, // 不觸發 streak
    });
    const r = await runService(
      {
        pool: fakePool(),
        serviceLogsRepo: serviceLogs as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKISSUE: chkissue },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKISSUE', triggeredBy: 'manual' },
    );
    const log = serviceLogs._logs.get(r.serviceLogId);
    expect(log?.result).toBe('success');
    const notes = log?.notes as {
      with_issues: Array<{ projectKey: string }>;
      without_issues: string[];
      empty_streak: unknown[];
    };
    expect(notes.with_issues).toHaveLength(3);
    expect(notes.without_issues).toEqual(['D', 'E']);
    expect(notes.empty_streak).toHaveLength(0);
  });

  it('連續無任務達門檻 → notes.empty_streak[] 含警示', async () => {
    const serviceLogs = fakeServiceLogs();
    const snapshots = fakeSnapshotsRepo();
    snapshots._streakByProject.set('B', 4); // pretend B 已連續 4 次無任務
    const chkissue = createChkissueService({
      snapshotsRepo: snapshots,
      listProjects: async () => ['A', 'B'],
      countIssues: async (_s, key) => (key === 'A' ? 5 : 0),
      retryDelayMs: 0,
      emptyStreakThreshold: 4,
    });
    const r = await runService(
      {
        pool: fakePool(),
        serviceLogsRepo: serviceLogs as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKISSUE: chkissue },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKISSUE', triggeredBy: 'manual' },
    );
    const notes = serviceLogs._logs.get(r.serviceLogId)?.notes as {
      empty_streak: Array<{ projectKey: string; streak: number }>;
    };
    expect(notes.empty_streak).toHaveLength(1);
    expect(notes.empty_streak[0]!.projectKey).toBe('B');
    expect(notes.empty_streak[0]!.streak).toBe(4);
  });

  it('部分失敗（單一專案 API 錯）→ partial_failure', async () => {
    const serviceLogs = fakeServiceLogs();
    const snapshots = fakeSnapshotsRepo();
    const chkissue = createChkissueService({
      snapshotsRepo: snapshots,
      listProjects: async () => ['OK', 'FAIL'],
      countIssues: async (_s, key) => {
        if (key === 'FAIL') throw new Error('boom');
        return 1;
      },
      retryDelayMs: 0,
    });
    const r = await runService(
      {
        pool: fakePool(),
        serviceLogsRepo: serviceLogs as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKISSUE: chkissue },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKISSUE', triggeredBy: 'manual' },
    );
    const log = serviceLogs._logs.get(r.serviceLogId);
    expect(log?.result).toBe('partial_failure');
    const errors = (log?.notes as { errors: Array<{ projectKey: string }> }).errors;
    expect(errors[0]!.projectKey).toBe('FAIL');
  });

  it('空可見專案 → skipped', async () => {
    const serviceLogs = fakeServiceLogs();
    const snapshots = fakeSnapshotsRepo();
    const chkissue = createChkissueService({
      snapshotsRepo: snapshots,
      listProjects: async () => [],
      countIssues: async () => 0,
    });
    const r = await runService(
      {
        pool: fakePool(),
        serviceLogsRepo: serviceLogs as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKISSUE: chkissue },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKISSUE', triggeredBy: 'manual' },
    );
    const log = serviceLogs._logs.get(r.serviceLogId);
    expect(log?.result).toBe('skipped');
    expect((log?.notes as { reason?: string }).reason).toBe('no_visible_projects');
  });

  it('SC-005：200 mock projects 整批 < 10 分鐘（mock 模式 < 1s）', async () => {
    const keys = Array.from({ length: 200 }, (_, i) => `P-${i}`);
    const serviceLogs = fakeServiceLogs();
    const snapshots = fakeSnapshotsRepo();
    const chkissue = createChkissueService({
      snapshotsRepo: snapshots,
      listProjects: async () => keys,
      countIssues: async () => 0,
      retryDelayMs: 0,
      concurrency: 5,
    });
    const t0 = Date.now();
    await runService(
      {
        pool: fakePool(),
        serviceLogsRepo: serviceLogs as never,
        scheduleConfigsRepo: fakeScheduleConfigs() as never,
        services: { CHKISSUE: chkissue },
        acquireSession: fakeAcquireSession,
      },
      { serviceId: 'CHKISSUE', triggeredBy: 'manual' },
    );
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(10 * 60 * 1000);
  });
});
