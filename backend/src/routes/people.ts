// T065：US3 routes
// - GET /people/search?q
// - GET /people/{accountId}/issues?status&pageSize&cursor&refresh
// - GET /people/{accountId}/stats?from&to&refresh
//
// 後兩條走 withFreshness 包回（FR-003）；?refresh=true 預留給 Phase 7 cache layer。

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/session';
import { buildProblem, sendProblem } from '../lib/problem';
import { withFreshness, parseForceRefresh } from '../lib/data-freshness';
import { searchUsers } from '../services/jira/users';
import {
  listByAssignee,
  statsByAssignee,
} from '../services/jira/issues';
import type { McpSession } from '../mcp/types';
import { getJiraCache, type JiraLruCache } from '../services/jira/cache';

export interface PeopleDeps {
  acquireSession: (userId: string) => Promise<McpSession>;
  cache?: JiraLruCache;
}

const accountIdSchema = z.string().min(1).max(128);
const searchQuerySchema = z.object({
  q: z.string().min(1).max(64),
});
const issuesQuerySchema = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
const statsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export function peopleRouter(deps: PeopleDeps): Router {
  const router = Router();
  const cache = deps.cache ?? getJiraCache();

  router.get('/people/search', requireAuth, async (req, res, next) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendProblem(
          res,
          buildProblem('validation', { messageKey: 'error_validation' }),
        );
        return;
      }
      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const items = await searchUsers(session, parsed.data.q);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/people/:accountId/issues', requireAuth, async (req, res, next) => {
    try {
      const accountId = accountIdSchema.safeParse(req.params['accountId']);
      if (!accountId.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const q = issuesQuerySchema.safeParse(req.query);
      if (!q.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const forceRefresh = parseForceRefresh(req.query['refresh']);
      const userId = req.sessionUser!.userId;
      const cached = await cache.getOrLoad(
        { userId, tool: 'people.listIssues', args: { accountId: accountId.data, ...q.data } },
        async () => {
          const session = await deps.acquireSession(userId);
          return listByAssignee(session, accountId.data, {
            status: q.data.status,
            pageSize: q.data.pageSize,
            ...(q.data.cursor ? { cursor: q.data.cursor } : {}),
          });
        },
        { forceRefresh },
      );
      const result = cached.value;
      res.json(
        withFreshness(
          {
            items: result.items,
            nextCursor: result.nextCursor,
            partialPermission: result.partialPermission,
          },
          {
            source: cached.source,
            ...(cached.cacheTtlSeconds !== undefined ? { cacheTtlSeconds: cached.cacheTtlSeconds } : {}),
          },
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/people/:accountId/stats', requireAuth, async (req, res, next) => {
    try {
      const accountId = accountIdSchema.safeParse(req.params['accountId']);
      if (!accountId.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const q = statsQuerySchema.safeParse(req.query);
      if (!q.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const forceRefresh = parseForceRefresh(req.query['refresh']);
      const userId = req.sessionUser!.userId;
      const cached = await cache.getOrLoad(
        { userId, tool: 'people.stats', args: { accountId: accountId.data, from: q.data.from, to: q.data.to } },
        async () => {
          const session = await deps.acquireSession(userId);
          return statsByAssignee(session, accountId.data, q.data.from, q.data.to);
        },
        { forceRefresh },
      );
      res.json(
        withFreshness(cached.value, {
          source: cached.source,
          ...(cached.cacheTtlSeconds !== undefined ? { cacheTtlSeconds: cached.cacheTtlSeconds } : {}),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
