// T083：US4 routes
// - POST /bulk/preview → { previewToken, totalCount, items }
// - POST /bulk/apply → 202 Accepted { operationId }（acceptance #2：背景作業）
// - GET  /bulk/operations/{id} → BulkOperation full

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/session';
import { rateLimit } from '../middleware/rate-limit';
import { verifyCsrfToken } from '../middleware/csrf';
import { buildProblem, sendProblem } from '../lib/problem';
import {
  createBulkUpdatesRepo,
  type BulkTargetField,
  type BulkUpdatesRepo,
} from '../db/repositories/bulk-updates';
import { getPool } from '../db/pool';
import type { McpSession } from '../mcp/types';
import {
  previewBulkUpdate,
  BulkPreviewError,
  type BulkPreviewFilter,
} from '../services/bulk/preview';
import { applyBulkUpdate, BulkApplyError } from '../services/bulk/apply';
import { ALLOWED_TARGET_FIELDS } from '../services/bulk/validator';

export interface BulkDeps {
  acquireSession: (userId: string) => Promise<McpSession>;
  repo?: BulkUpdatesRepo;
}

const targetFieldSchema = z.enum(
  ALLOWED_TARGET_FIELDS as readonly [BulkTargetField, ...BulkTargetField[]],
);

const filterSchema = z.object({
  statuses: z.array(z.string()).optional(),
  assigneeAccountIds: z.array(z.string()).optional(),
  sprintNames: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  issueTypes: z.array(z.string()).optional(),
  dueDateRange: z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .optional(),
});

const previewBodySchema = z.object({
  projectKey: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  filter: filterSchema,
  targetField: targetFieldSchema,
  targetValue: z.unknown(),
});

const applyBodySchema = z.object({
  previewToken: z.string().min(1),
  confirmText: z.string().min(1).max(64),
  confirmCount: z.number().int().min(0),
});

export function bulkRouter(deps: BulkDeps): Router {
  const router = Router();
  const repo = deps.repo ?? createBulkUpdatesRepo(getPool());

  router.post('/bulk/preview', requireAuth, verifyCsrfToken, async (req, res, next) => {
    try {
      const parsed = previewBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const result = await previewBulkUpdate(session, {
        userId,
        projectKey: parsed.data.projectKey,
        filter: parsed.data.filter as BulkPreviewFilter,
        targetField: parsed.data.targetField,
        targetValue: parsed.data.targetValue,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof BulkPreviewError) {
        sendProblem(
          res,
          buildProblem(err.code === 'too_many' ? 'validation' : 'validation', {
            messageKey: err.code === 'too_many' ? 'bulk_too_many_items' : 'error_validation',
            detail: err.message,
          }),
        );
        return;
      }
      next(err);
    }
  });

  router.post('/bulk/apply', requireAuth, verifyCsrfToken, rateLimit({ perMinute: 4 }), async (req, res, next) => {
    try {
      const parsed = applyBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'bulk_confirm_text_invalid' }));
        return;
      }
      const userId = req.sessionUser!.userId;
      const session = await deps.acquireSession(userId);
      const { operationId, done } = await applyBulkUpdate({
        userId,
        previewToken: parsed.data.previewToken,
        confirmText: parsed.data.confirmText,
        confirmCount: parsed.data.confirmCount,
        session,
        repo,
      });
      // 不 await done：背景跑、202 立刻回
      void done.catch(() => undefined);
      res.status(202).json({ operationId });
    } catch (err) {
      if (err instanceof BulkApplyError) {
        sendApplyError(res, err);
        return;
      }
      next(err);
    }
  });

  router.get('/bulk/operations', requireAuth, async (req, res, next) => {
    try {
      const listSchema = z.object({
        projectKey: z.string().optional(),
        status: z.enum(['running', 'success', 'partial_failure', 'failure', 'cancelled']).optional(),
        cursor: z.string().optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      });
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const userId = req.sessionUser!.userId;
      const result = await repo.listByUser({
        userId,
        ...(parsed.data.projectKey ? { projectKey: parsed.data.projectKey } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(parsed.data.pageSize !== undefined ? { pageSize: parsed.data.pageSize } : {}),
      });
      res.json({
        items: result.items.map((s) => ({
          id: s.id,
          projectKey: s.projectKey,
          targetField: s.targetField,
          totalCount: s.totalCount,
          successCount: s.successCount,
          failureCount: s.failureCount,
          status: s.status,
          startedAt: s.startedAt.toISOString(),
          completedAt: s.completedAt ? s.completedAt.toISOString() : null,
        })),
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/bulk/operations/:id', requireAuth, async (req, res, next) => {
    try {
      const id = z.string().uuid().safeParse(req.params['id']);
      if (!id.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const userId = req.sessionUser!.userId;
      const op = await repo.getById(userId, id.data);
      if (!op) {
        sendProblem(res, buildProblem('not_found'));
        return;
      }
      res.json(toOperationDto(op));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function sendApplyError(
  res: import('express').Response,
  err: BulkApplyError,
): void {
  switch (err.reason) {
    case 'token_expired':
      sendProblem(res, buildProblem('conflict', { messageKey: 'error_validation', detail: 'previewToken 已過期，請重新預覽' }));
      return;
    case 'token_invalid':
      sendProblem(res, buildProblem('conflict', { messageKey: 'error_validation', detail: 'previewToken 無效' }));
      return;
    case 'confirm_text_invalid':
      sendProblem(res, buildProblem('conflict', { messageKey: 'bulk_confirm_text_invalid', detail: err.message }));
      return;
    case 'confirm_count_mismatch':
      sendProblem(res, buildProblem('conflict', { messageKey: 'bulk_confirm_count_mismatch', detail: err.message }));
      return;
    case 'no_editable_items':
      sendProblem(res, buildProblem('validation', { messageKey: 'bulk_no_permission_items' }));
      return;
  }
}

function toOperationDto(op: ReturnType<BulkUpdatesRepo['getById']> extends Promise<infer T> ? NonNullable<T> : never) {
  return {
    id: op.id,
    status: op.status,
    totalCount: op.totalCount,
    successCount: op.successCount,
    failureCount: op.failureCount,
    startedAt: op.startedAt.toISOString(),
    completedAt: op.completedAt ? op.completedAt.toISOString() : null,
    items: op.items.map((i) => ({
      issueKey: i.issueKey,
      result: i.result,
      errorMessage: i.errorMessage,
      appliedAt: i.appliedAt ? i.appliedAt.toISOString() : null,
    })),
  };
}
