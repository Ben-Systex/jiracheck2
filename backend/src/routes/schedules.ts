// T024：US1 排程 CRUD + 立即執行 routes
// 7 endpoints:
//   GET    /schedules
//   POST   /schedules
//   GET    /schedules/:id
//   PUT    /schedules/:id
//   DELETE /schedules/:id
//   POST   /schedules/:id/trigger
//
// 全部 endpoints 經 sessionMiddleware → requireAuth → requireAdmin
// 寫入端（POST/PUT/DELETE）額外 verifyCsrfToken

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/session';
import { requireAdmin } from '../middleware/require-admin';
import { verifyCsrfToken } from '../middleware/csrf';
import { buildProblem, sendProblem } from '../lib/problem';
import {
  createScheduleConfigsRepo,
  type ScheduleConfig,
  type ScheduleConfigsRepo,
} from '../db/repositories/schedule-configs';
import { createServiceLogsRepo, type ServiceLogsRepo } from '../db/repositories/service-logs';
import { getPool } from '../db/pool';
import {
  computeNextRunAt,
  FrequencyError,
  validateFrequency,
} from '../lib/cron-utils';
import { runService, type ServiceRunnerDeps } from '../jobs/service-runner';
import type { Scheduler } from '../jobs/scheduler';
import { scheduleConfigsEnabledCount } from '../lib/metrics';

export interface SchedulesDeps {
  /** 由 test / server 注入；提供 services / acquireSession 給 runner */
  runnerDeps: ServiceRunnerDeps;
  /** 由 server 注入；route 觸發 CRUD 後通知 scheduler register / unregister */
  scheduler?: Scheduler;
  /** 注入 repo（測試覆寫；prod 由 getPool() 建） */
  repo?: ScheduleConfigsRepo;
  serviceLogsRepo?: ServiceLogsRepo;
}

const serviceIdSchema = z.enum(['CHKPROJ', 'CHKISSUE']);
const frequencyTypeSchema = z.enum(['daily', 'weekly', 'monthly', 'cron']);

const upsertBodySchema = z.object({
  serviceId: serviceIdSchema,
  frequencyType: frequencyTypeSchema,
  frequencyValue: z.string().min(1).max(120),
  enabled: z.boolean(),
});

const listQuerySchema = z.object({
  enabled: z.enum(['true', 'false']).optional(),
  serviceId: serviceIdSchema.optional(),
});

function toResponse(c: ScheduleConfig): unknown {
  return {
    id: c.id,
    serviceId: c.serviceId,
    frequencyType: c.frequencyType,
    frequencyValue: c.frequencyValue,
    enabled: c.enabled,
    nextRunAt: c.nextRunAt?.toISOString() ?? null,
    lastRunAt: c.lastRunAt?.toISOString() ?? null,
    createdBy: c.createdBy,
    updatedBy: c.updatedBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function schedulesRouter(deps: SchedulesDeps): Router {
  const router = Router();
  const repo = deps.repo ?? createScheduleConfigsRepo(getPool());
  // serviceLogsRepo 目前未直接於 route 中使用（觸發走 runnerDeps），
  // 但保留 deps.serviceLogsRepo 介面供未來路由直接訪問（e.g. inline trigger 紀錄 GET）
  void (deps.serviceLogsRepo ?? createServiceLogsRepo(getPool()));

  router.get('/schedules', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const q = listQuerySchema.safeParse(req.query);
      if (!q.success) {
        sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
        return;
      }
      const filter: { enabled?: boolean; serviceId?: 'CHKPROJ' | 'CHKISSUE' } = {};
      if (q.data.enabled !== undefined) filter.enabled = q.data.enabled === 'true';
      if (q.data.serviceId !== undefined) filter.serviceId = q.data.serviceId;
      const items = await repo.listAll(filter);
      res.json({ items: items.map(toResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/schedules',
    requireAuth,
    requireAdmin,
    verifyCsrfToken,
    async (req, res, next) => {
      try {
        const parsed = upsertBodySchema.safeParse(req.body);
        if (!parsed.success) {
          sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
          return;
        }
        try {
          validateFrequency({
            type: parsed.data.frequencyType,
            value: parsed.data.frequencyValue,
          });
        } catch (err) {
          if (err instanceof FrequencyError) {
            sendProblem(res, problemForFrequency(err));
            return;
          }
          throw err;
        }
        const nextRunAt = parsed.data.enabled
          ? computeNextRunAt({
              type: parsed.data.frequencyType,
              value: parsed.data.frequencyValue,
            })
          : null;
        const cfg = await repo.create({
          serviceId: parsed.data.serviceId,
          frequencyType: parsed.data.frequencyType,
          frequencyValue: parsed.data.frequencyValue,
          enabled: parsed.data.enabled,
          nextRunAt,
          createdBy: req.sessionUser!.userId,
        });
        deps.scheduler?.registerSchedule(cfg);
        await updateEnabledGauge(repo);
        res.status(201).json(toResponse(cfg));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/schedules/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const cfg = await repo.getById((req.params['id'] as string));
      if (!cfg) {
        sendProblem(res, buildProblem('not_found', { messageKey: 'schedule_not_found' }));
        return;
      }
      res.json(toResponse(cfg));
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/schedules/:id',
    requireAuth,
    requireAdmin,
    verifyCsrfToken,
    async (req, res, next) => {
      try {
        const parsed = upsertBodySchema.safeParse(req.body);
        if (!parsed.success) {
          sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
          return;
        }
        try {
          validateFrequency({
            type: parsed.data.frequencyType,
            value: parsed.data.frequencyValue,
          });
        } catch (err) {
          if (err instanceof FrequencyError) {
            sendProblem(res, problemForFrequency(err));
            return;
          }
          throw err;
        }
        const nextRunAt = parsed.data.enabled
          ? computeNextRunAt({
              type: parsed.data.frequencyType,
              value: parsed.data.frequencyValue,
            })
          : null;
        const updated = await repo.update({
          id: (req.params['id'] as string),
          serviceId: parsed.data.serviceId,
          frequencyType: parsed.data.frequencyType,
          frequencyValue: parsed.data.frequencyValue,
          enabled: parsed.data.enabled,
          nextRunAt,
          updatedBy: req.sessionUser!.userId,
        });
        if (!updated) {
          sendProblem(res, buildProblem('not_found', { messageKey: 'schedule_not_found' }));
          return;
        }
        deps.scheduler?.registerSchedule(updated);
        if (!updated.enabled) deps.scheduler?.unregisterSchedule(updated.id);
        await updateEnabledGauge(repo);
        res.json(toResponse(updated));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/schedules/:id',
    requireAuth,
    requireAdmin,
    verifyCsrfToken,
    async (req, res, next) => {
      try {
        const id = (req.params['id'] as string);
        const ok = await repo.delete(id);
        if (!ok) {
          sendProblem(res, buildProblem('not_found', { messageKey: 'schedule_not_found' }));
          return;
        }
        deps.scheduler?.unregisterSchedule(id);
        await updateEnabledGauge(repo);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/schedules/:id/trigger',
    requireAuth,
    requireAdmin,
    verifyCsrfToken,
    async (req, res, next) => {
      try {
        const cfg = await repo.getById((req.params['id'] as string));
        if (!cfg) {
          sendProblem(res, buildProblem('not_found', { messageKey: 'schedule_not_found' }));
          return;
        }
        // 非同步：立即建立 ServiceLog 並回 202；實際 run 走 setImmediate
        const result = await runService(deps.runnerDeps, {
          serviceId: cfg.serviceId,
          triggeredBy: 'manual',
          triggeredByUserId: req.sessionUser!.userId,
          scheduleId: cfg.id,
        });
        res.status(202).json({ serviceLogId: result.serviceLogId });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;

  async function updateEnabledGauge(r: ScheduleConfigsRepo): Promise<void> {
    try {
      scheduleConfigsEnabledCount.set(await r.countEnabled());
    } catch {
      /* 不阻擋主流程 */
    }
  }
}

function problemForFrequency(err: FrequencyError): import('../lib/problem').ProblemDetails {
  return buildProblem('validation', {
    messageKey: err.kind === 'cron_invalid' ? 'schedule_cron_invalid' : 'schedule_frequency_invalid',
    detail: err.message,
  });
}

// 讓 unused import 不會被 eslint 砍
export type { ServiceLogsRepo };
