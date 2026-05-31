// T036：US2 ServiceLogs 檢視 routes
// 3 endpoints:
//   GET /service-logs       — keyset 分頁 + 過濾（serviceId / result / from / to / cursor / pageSize）
//   GET /service-logs/:id   — 詳細（含 notes JSON）
//   GET /service-logs/export — CSV stream（UTF-8 BOM + csv-stringify）
//
// 全部 admin-only（requireAuth → requireAdmin）。

import { Router } from 'express';
import { z } from 'zod';
import { stringify } from 'csv-stringify';
import { requireAuth } from '../middleware/session';
import { requireAdmin } from '../middleware/require-admin';
import { buildProblem, sendProblem } from '../lib/problem';
import {
  createServiceLogsRepo,
  type ExtendedServiceId,
  type ListArgs,
  type ServiceLogResult,
  type ServiceLogsRepo,
} from '../db/repositories/service-logs';
import { getPool } from '../db/pool';

export interface ServiceLogsDeps {
  repo?: ServiceLogsRepo;
}

const serviceIdSchema = z.enum(['CHKPROJ', 'CHKISSUE', 'SYSTEM_CLEANUP']);
const resultSchema = z.enum(['success', 'partial_failure', 'failure', 'skipped', 'missed']);

const listQuerySchema = z.object({
  serviceId: serviceIdSchema.optional(),
  result: resultSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const exportQuerySchema = z.object({
  serviceId: serviceIdSchema.optional(),
  result: resultSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function setIf<K extends keyof ListArgs>(
  out: ListArgs,
  key: K,
  value: ListArgs[K] | undefined,
): void {
  if (value !== undefined) out[key] = value;
}

function toListArgs(q: z.infer<typeof listQuerySchema>, defaultRange = true): ListArgs {
  const out: ListArgs = {};
  setIf(out, 'serviceId', q.serviceId as ExtendedServiceId | undefined);
  setIf(out, 'result', q.result as ServiceLogResult | undefined);
  setIf(out, 'from', q.from ? new Date(q.from) : undefined);
  setIf(out, 'to', q.to ? new Date(q.to) : undefined);
  setIf(out, 'cursor', q.cursor);
  setIf(out, 'pageSize', q.pageSize);
  if (defaultRange && !out.from && !out.cursor) {
    out.from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  return out;
}

export function serviceLogsRouter(deps: ServiceLogsDeps = {}): Router {
  const router = Router();
  const repo = deps.repo ?? createServiceLogsRepo(getPool());

  router.get('/service-logs', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const q = listQuerySchema.safeParse(req.query);
      if (!q.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const result = await repo.list(toListArgs(q.data));
      res.json({
        items: result.items.map((it) => ({
          id: it.id,
          scheduleId: it.scheduleId,
          serviceId: it.serviceId,
          triggeredBy: it.triggeredBy,
          startedAt: it.startedAt.toISOString(),
          endedAt: it.endedAt?.toISOString() ?? null,
          result: it.result,
          summary: it.summary,
          ruleVersion: it.ruleVersion,
        })),
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  });

  // /export 必須在 /:id 之前，否則會被 :id route 攔截
  router.get('/service-logs/export', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const q = exportQuerySchema.safeParse(req.query);
      if (!q.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=service-logs-${ts}.csv`);
      // UTF-8 BOM 讓 Excel 直接打開不亂碼
      res.write('﻿');

      const stringifier = stringify({
        header: true,
        columns: ['startedAt', 'endedAt', 'serviceId', 'triggeredBy', 'result', 'summary', 'notes'],
      });
      stringifier.on('error', (err) => {
        next(err);
      });
      stringifier.pipe(res);

      const exportArgs: import('../db/repositories/service-logs').ExportArgs = {};
      if (q.data.serviceId) exportArgs.serviceId = q.data.serviceId as ExtendedServiceId;
      if (q.data.result) exportArgs.result = q.data.result as ServiceLogResult;
      if (q.data.from) exportArgs.from = new Date(q.data.from);
      if (q.data.to) exportArgs.to = new Date(q.data.to);
      for await (const row of repo.streamForExport(exportArgs)) {
        stringifier.write(row);
      }
      stringifier.end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/service-logs/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const id = req.params['id'] as string;
      const detail = await repo.getById(id);
      if (!detail) {
        sendProblem(res, buildProblem('not_found', { messageKey: 'service_log_not_found' }));
        return;
      }
      res.json({
        id: detail.id,
        scheduleId: detail.scheduleId,
        serviceId: detail.serviceId,
        triggeredBy: detail.triggeredBy,
        triggeredByUserId: detail.triggeredByUserId,
        startedAt: detail.startedAt.toISOString(),
        endedAt: detail.endedAt?.toISOString() ?? null,
        result: detail.result,
        summary: detail.summary,
        notes: detail.notes,
        ruleVersion: detail.ruleVersion,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
