// 測試用 mini-app + in-memory query-history repo + mock LlmClient

import express, { type Express } from 'express';
import { nlqRouter } from '../../src/routes/nlq';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResponse } from '../../src/services/nlq/llm';
import type {
  InsertArgs,
  QueryHistoryRepo,
} from '../../src/db/repositories/query-history';
import type { McpSession } from '../../src/mcp/types';

export interface BuildOptions {
  userId?: string;
  llm: LlmClient;
  acquireSession: () => Promise<McpSession>;
  repo?: QueryHistoryRepo;
}

export function buildNlqApp(opts: BuildOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = { userId: opts.userId ?? 'user-1', sid: 'test-sid' };
    next();
  });
  const repo = opts.repo ?? createInMemoryHistoryRepo();
  app.use(
    '/api/v1',
    nlqRouter({ acquireSession: opts.acquireSession, llm: opts.llm, repo }),
  );
  app.use((_req, res) => sendProblem(res, buildProblem('not_found')));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (typeof err === 'object' && err !== null && 'cause' in err) {
      sendProblem(res, err as ReturnType<typeof buildProblem>);
      return;
    }
    sendProblem(res, buildProblem('internal', { detail: String(err) }));
  });
  return app;
}

export function mockLlm(reply: string | ((req: LlmCompletionRequest) => string)): LlmClient {
  return {
    async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
      const text = typeof reply === 'function' ? reply(req) : reply;
      return { rawText: text, latencyMs: 1, model: 'mock' };
    },
  };
}

interface StoredHistory extends InsertArgs {
  id: string;
}

export function createInMemoryHistoryRepo(): QueryHistoryRepo & {
  __all(): StoredHistory[];
} {
  const all: StoredHistory[] = [];
  let seq = 0;
  return {
    async insert(args) {
      seq += 1;
      const id = `hist-${seq}`;
      all.push({ ...args, id });
      return { id };
    },
    async pruneOlderThanDays() {
      return 0;
    },
    __all: () => [...all],
  };
}
