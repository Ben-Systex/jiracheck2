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

export interface PeopleDeps {
  acquireSession: (userId: string) => Promise<McpSession>;
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
      parseForceRefresh(req.query['refresh']);

      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const result = await listByAssignee(session, accountId.data, {
        status: q.data.status,
        pageSize: q.data.pageSize,
        ...(q.data.cursor ? { cursor: q.data.cursor } : {}),
      });

      res.json(
        withFreshness(
          {
            items: result.items,
            nextCursor: result.nextCursor,
            partialPermission: result.partialPermission,
          },
          { source: 'live' },
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
      parseForceRefresh(req.query['refresh']);

      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const stats = await statsByAssignee(
        session,
        accountId.data,
        q.data.from,
        q.data.to,
      );
      res.json(withFreshness(stats, { source: 'live' }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
