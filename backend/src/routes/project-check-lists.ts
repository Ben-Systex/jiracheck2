// T047：US3 project-check-lists routes
// 3 endpoints: GET / POST / DELETE
// 對應 OpenAPI Tag project-check-lists；全 admin-only。

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/session';
import { requireAdmin } from '../middleware/require-admin';
import { verifyCsrfToken } from '../middleware/csrf';
import { buildProblem, sendProblem } from '../lib/problem';
import {
  createProjectCheckListsRepo,
  type ProjectCheckListEntry,
  type ProjectCheckListsRepo,
} from '../db/repositories/project-check-lists';
import { getPool } from '../db/pool';

export interface ProjectCheckListsDeps {
  repo?: ProjectCheckListsRepo;
}

const addBodySchema = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  note: z.string().max(500).optional(),
});

function toResponse(e: ProjectCheckListEntry): unknown {
  return {
    id: e.id,
    projectKey: e.projectKey,
    addedBy: e.addedBy,
    addedAt: e.addedAt.toISOString(),
    note: e.note,
  };
}

export function projectCheckListsRouter(deps: ProjectCheckListsDeps = {}): Router {
  const router = Router();
  const repo = deps.repo ?? createProjectCheckListsRepo(getPool());

  router.get('/project-check-lists', requireAuth, requireAdmin, async (_req, res, next) => {
    try {
      const items = await repo.list();
      res.json({ items: items.map(toResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/project-check-lists',
    requireAuth,
    requireAdmin,
    verifyCsrfToken,
    async (req, res, next) => {
      try {
        const parsed = addBodySchema.safeParse(req.body);
        if (!parsed.success) {
          sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
          return;
        }
        const existing = await repo.getByProjectKey(parsed.data.projectKey);
        if (existing) {
          sendProblem(res, buildProblem('conflict', { messageKey: 'project_check_list_conflict' }));
          return;
        }
        const addArgs: Parameters<ProjectCheckListsRepo['add']>[0] = {
          projectKey: parsed.data.projectKey,
          addedBy: req.sessionUser!.userId,
        };
        if (parsed.data.note !== undefined) addArgs.note = parsed.data.note;
        const entry = await repo.add(addArgs);
        res.status(201).json(toResponse(entry));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/project-check-lists/:id',
    requireAuth,
    requireAdmin,
    verifyCsrfToken,
    async (req, res, next) => {
      try {
        const id = req.params['id'] as string;
        const ok = await repo.remove(id);
        if (!ok) {
          sendProblem(res, buildProblem('not_found', { messageKey: 'project_check_list_not_found' }));
          return;
        }
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
