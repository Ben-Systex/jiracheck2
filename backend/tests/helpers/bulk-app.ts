// 測試用 mini-app + in-memory bulk repo

import express, { type Express } from 'express';
import { bulkRouter, type BulkDeps } from '../../src/routes/bulk';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import type {
  BulkOperation,
  BulkOperationItem,
  BulkOperationStatus,
  BulkTargetField,
  BulkUpdatesRepo,
  CreateOperationArgs,
} from '../../src/db/repositories/bulk-updates';

export interface BuildOptions {
  userId?: string;
  acquireSession: BulkDeps['acquireSession'];
  repo?: BulkUpdatesRepo;
}

export function buildBulkApp(opts: BuildOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = { userId: opts.userId ?? 'user-1', sid: 'test-sid' };
    next();
  });
  // 預設 fallback 到 in-memory repo，避免測試呼叫 getPool() 觸發 DATABASE_URL 檢查
  const repo = opts.repo ?? createInMemoryBulkRepo();
  app.use(
    '/api/v1',
    bulkRouter({
      acquireSession: opts.acquireSession,
      repo,
    }),
  );
  app.use((_req, res) => {
    sendProblem(res, buildProblem('not_found'));
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (typeof err === 'object' && err !== null && 'cause' in err) {
      sendProblem(res, err as ReturnType<typeof buildProblem>);
      return;
    }
    sendProblem(res, buildProblem('internal', { detail: String(err) }));
  });
  return app;
}

interface StoredOperation {
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
  items: Map<string, BulkOperationItem>;
}

export function createInMemoryBulkRepo(): BulkUpdatesRepo & {
  __all(): StoredOperation[];
  __idForUser(userId: string): string | undefined;
  __get(id: string): StoredOperation | undefined;
} {
  const byId = new Map<string, StoredOperation>();
  let seq = 0;
  return {
    async createOperation(args: CreateOperationArgs) {
      seq += 1;
      // 產生符合 UUID 格式的測試 id（路由有 uuid 驗證）
      const id = `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`;
      byId.set(id, {
        id,
        userId: args.userId,
        projectKey: args.projectKey,
        targetField: args.targetField,
        totalCount: args.totalCount,
        successCount: 0,
        failureCount: 0,
        status: 'running',
        startedAt: args.confirmedAt,
        completedAt: null,
        items: new Map(),
      });
      return { id };
    },
    async recordItem(args) {
      const op = byId.get(args.operationId);
      if (!op) throw new Error(`operation not found: ${args.operationId}`);
      op.items.set(args.issueKey, {
        issueKey: args.issueKey,
        result: args.result,
        errorMessage: args.errorMessage ?? null,
        appliedAt: args.appliedAt ?? null,
      });
    },
    async finalize(args) {
      const op = byId.get(args.operationId);
      if (!op) throw new Error(`operation not found: ${args.operationId}`);
      op.status = args.status;
      op.successCount = args.successCount;
      op.failureCount = args.failureCount;
      op.completedAt = args.completedAt;
    },
    async getById(userId, operationId): Promise<BulkOperation | null> {
      const op = byId.get(operationId);
      if (!op || op.userId !== userId) return null;
      return {
        id: op.id,
        userId: op.userId,
        projectKey: op.projectKey,
        targetField: op.targetField,
        totalCount: op.totalCount,
        successCount: op.successCount,
        failureCount: op.failureCount,
        status: op.status,
        startedAt: op.startedAt,
        completedAt: op.completedAt,
        items: [...op.items.values()].sort((a, b) => a.issueKey.localeCompare(b.issueKey)),
      };
    },
    __all: () => [...byId.values()],
    __idForUser: (userId) => [...byId.values()].find((o) => o.userId === userId)?.id,
    __get: (id) => byId.get(id),
  };
}
