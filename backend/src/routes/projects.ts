// T035：US1 專案儀表板 routes
// - GET /projects/recent?refresh=true → 最近 5 個（enrich）
// - GET /projects/search?q&refresh=true → 搜尋（不 enrich，避免 N+1）
// - GET /projects/{key} → 單一儀表板；回應前 upsert recent_project_access
//
// 所有回應透過 withFreshness 包回（FR-003）。
// 透過 deps 注入 acquireSession（per-user MCP session）與 recent-access repo —
// 方便契約測試以 mock 取代真實 MCP 與 DB。

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/session';
import { buildProblem, sendProblem } from '../lib/problem';
import { withFreshness, parseForceRefresh } from '../lib/data-freshness';
import {
  listAccessibleProjects,
  listRecentEnriched,
  getProject,
  type ProjectCard,
} from '../services/jira/projects';
import type { McpSession } from '../mcp/types';
import {
  createRecentAccessRepo,
  type RecentAccessRepo,
} from '../db/repositories/recent-access';
import { getPool } from '../db/pool';

export interface ProjectsDeps {
  acquireSession: (userId: string) => Promise<McpSession>;
  recentRepo?: RecentAccessRepo;
}

const projectKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]+$/);
const searchQuerySchema = z.object({
  q: z.string().min(1).max(64),
});

export function projectsRouter(deps: ProjectsDeps): Router {
  const router = Router();
  const recentRepo = deps.recentRepo ?? createRecentAccessRepo(getPool());

  router.get('/projects/recent', requireAuth, async (req, res, next) => {
    try {
      const userId = req.sessionUser!.userId;
      // refresh=true 預留給 Phase 7 cache layer 用；目前皆走 live（無 cache）
      parseForceRefresh(req.query['refresh']);
      const recent = await recentRepo.listRecent(userId, 5);
      const session = await deps.acquireSession(userId);
      const enriched = await listRecentEnriched(
        session,
        recent.map((r) => r.projectKey),
      );
      const items = enriched.map((c) =>
        withLastAccessed(
          c,
          recent.find((r) => r.projectKey === c.key)?.lastAccessedAt,
        ),
      );
      res.json(withFreshness({ items }, { source: 'live' }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects/search', requireAuth, async (req, res, next) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendProblem(
          res,
          buildProblem('validation', { messageKey: 'project_search_too_short' }),
        );
        return;
      }
      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const items = await listAccessibleProjects(session, {
        q: parsed.data.q,
        enrich: false,
      });
      res.json(withFreshness({ items }, { source: 'live' }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects/:key', requireAuth, async (req, res, next) => {
    try {
      const key = projectKeySchema.safeParse(req.params['key']);
      if (!key.success) {
        sendProblem(
          res,
          buildProblem('validation', { messageKey: 'error_validation' }),
        );
        return;
      }
      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const dashboard = await getProject(session, key.data);
      if (!dashboard) {
        sendProblem(
          res,
          buildProblem('not_found', { messageKey: 'project_not_found' }),
        );
        return;
      }
      await recentRepo.upsertAccess(userId, key.data);
      res.json(withFreshness(dashboard, { source: 'live' }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function withLastAccessed(card: ProjectCard, lastAccessedAt?: Date): ProjectCard {
  return lastAccessedAt
    ? { ...card, lastAccessedAt: lastAccessedAt.toISOString() }
    : card;
}
