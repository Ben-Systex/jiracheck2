// T053：US2 routes — POST /nlq/query
// - 接 { question, executeImmediately? }
// - 走 analyze() 並寫入 query_history（含 clarification / error 也一併紀錄）
// - 若 status=ok 且 executeImmediately=true 附 dataFreshness（FR-003）

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/session';
import { rateLimit } from '../middleware/rate-limit';
import { buildProblem, sendProblem } from '../lib/problem';
import { withFreshness } from '../lib/data-freshness';
import { analyze, NlqError } from '../services/nlq';
import type { LlmClient } from '../services/nlq/llm';
import type { McpSession } from '../mcp/types';
import {
  createQueryHistoryRepo,
  type QueryHistoryRepo,
} from '../db/repositories/query-history';
import { getPool } from '../db/pool';

export interface NlqDeps {
  acquireSession: (userId: string) => Promise<McpSession>;
  llm: LlmClient;
  repo?: QueryHistoryRepo;
}

const bodySchema = z.object({
  question: z.string().min(1).max(1000),
  executeImmediately: z.boolean().optional(),
});

export function nlqRouter(deps: NlqDeps): Router {
  const router = Router();
  const repo = deps.repo ?? createQueryHistoryRepo(getPool());

  router.post('/nlq/query', requireAuth, rateLimit({ perMinute: 6 }), async (req, res, next) => {
    try {
      await handleNlqQuery(req, res, deps, repo);
    } catch (err) {
      if (err instanceof NlqError) {
        const messageKey = err.code === 'too_long' ? 'nlq_question_too_long' : 'error_validation';
        sendProblem(res, buildProblem('validation', { messageKey }));
        return;
      }
      next(err);
    }
  });

  return router;
}

async function handleNlqQuery(
  req: import('express').Request,
  res: import('express').Response,
  deps: NlqDeps,
  repo: QueryHistoryRepo,
): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendProblem(res, buildProblem('validation', {
      messageKey: 'nlq_question_too_long',
      detail: '問句長度需在 1 – 1000 字元之間',
    }));
    return;
  }
  const userId = req.sessionUser!.userId;
  const session = await deps.acquireSession(userId);
  const result = await analyze({
    question: parsed.data.question,
    executeImmediately: parsed.data.executeImmediately ?? true,
    llm: deps.llm,
    session,
  });
  await repo.insert({
    userId,
    originalQuestion: parsed.data.question,
    queryPlan: result.plan ?? {},
    explanationZh: result.explanationZh,
    resultCount: result.resultCount,
    latencyMs: result.latencyMs,
    status: result.status,
  });

  if (result.status === 'error') {
    sendProblem(res, buildProblem('validation', {
      messageKey: 'nlq_clarification_needed',
      detail: result.explanationZh,
    }));
    return;
  }
  res.json(buildNlqResponseBody(result));
}

function buildNlqResponseBody(result: Awaited<ReturnType<typeof analyze>>): unknown {
  const base = {
    explanationZh: result.explanationZh,
    plan: result.plan,
    status: result.status,
    ...(result.clarificationQuestions ? { clarificationQuestions: result.clarificationQuestions } : {}),
    ...(result.results ? { results: result.results } : {}),
    latencyMs: result.latencyMs,
  };
  return result.status === 'ok' && result.results
    ? withFreshness(base, { source: 'live' })
    : base;
}
