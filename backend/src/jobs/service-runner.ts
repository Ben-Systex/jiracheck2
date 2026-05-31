// T019：service-runner（feature 002-scheduled-services）
// 統一執行流程：
//   1. session-level advisory lock（pg_try_advisory_lock(hashtext($1))）→ 失敗則寫 skipped 紀錄退出
//   2. serviceLogsRepo.start({ ... }) 取得 logId（DB 預設 result='failure'）
//   3. 呼叫 services[serviceId].run({ logId, session, now })
//   4. serviceLogsRepo.finalize({ id, result, summary, notes, endedAt })
//   5. 對應 metrics 寫入（scheduledServiceTotal / Duration / ActiveCount）
//   6. 始終 pg_advisory_unlock 釋放鎖；observe duration
//
// 對應 [research R-003](../specs/002-scheduled-services/research.md#r-003同服務互斥fr-006) advisory lock 設計
// 對應 [research R-005](../specs/002-scheduled-services/research.md#r-005服務失敗重試spec-edge-case-9) service-level 不重試

import type { Pool, PoolClient } from 'pg';
import type {
  ExtendedServiceId,
  ServiceLogsRepo,
  ServiceLogTriggeredBy,
} from '../db/repositories/service-logs';
import type { ScheduleConfigsRepo } from '../db/repositories/schedule-configs';
import type { McpSession } from '../mcp/types';
import type { RegisteredService, ServiceRegistry, ServiceRunResult } from './services/types';
import {
  scheduledServiceTotal,
  scheduledServiceDuration,
  scheduledServiceActiveCount,
} from '../lib/metrics';
import { traceSpan } from '../lib/telemetry';
import { getLogger } from '../lib/logger';

export interface ServiceRunnerDeps {
  pool: Pool;
  serviceLogsRepo: ServiceLogsRepo;
  scheduleConfigsRepo: ScheduleConfigsRepo;
  services: ServiceRegistry;
  /** 取得 admin 的 mcp session；CHKPROJ / CHKISSUE 用 */
  acquireSession?: () => Promise<McpSession>;
  /** 注入時間（測試） */
  now?: () => Date;
}

export interface RunServiceArgs {
  serviceId: ExtendedServiceId;
  triggeredBy: ServiceLogTriggeredBy;
  triggeredByUserId?: string | null;
  scheduleId?: string | null;
}

export interface RunServiceResult {
  /** 對應 ServiceLog id（無論 skipped / success / failure 皆有） */
  serviceLogId: string;
  /** 是否走完整 run（false = skipped） */
  executed: boolean;
}

/**
 * 執行單一服務並把結果寫入 service_logs。
 * - 同服務 ID 互斥（pg advisory lock）：lock 失敗 → 立即寫 skipped 紀錄
 * - 對 NOT registered 服務 → 寫 failure 紀錄
 */
export async function runService(
  deps: ServiceRunnerDeps,
  args: RunServiceArgs,
): Promise<RunServiceResult> {
  return traceSpan(
    'scheduled.service.run',
    () => runServiceInner(deps, args),
    {
      'service.id': args.serviceId,
      'service.triggered_by': args.triggeredBy,
    },
  );
}

async function runServiceInner(
  deps: ServiceRunnerDeps,
  args: RunServiceArgs,
): Promise<RunServiceResult> {
  const log = getLogger();
  const now = deps.now ?? (() => new Date());
  const service = deps.services[args.serviceId];

  // 嘗試取 advisory lock；client 必須跟著 lock 一起釋放
  const client = await deps.pool.connect();
  const locked = await tryAcquireLock(client, args.serviceId);
  if (!locked) {
    client.release();
    return registerSkipped(deps, args);
  }

  if (!service) {
    try {
      return await registerNotRegistered(deps, args, now());
    } finally {
      await releaseLock(client, args.serviceId);
      client.release();
    }
  }

  // 建立 running ServiceLog
  const ruleVersion = null; // 由 service 之 result 寫回 finalize 處理；start 時為 null
  const started = await deps.serviceLogsRepo.start({
    scheduleId: args.scheduleId ?? null,
    serviceId: args.serviceId,
    triggeredBy: args.triggeredBy,
    triggeredByUserId: args.triggeredByUserId ?? null,
    ruleVersion,
  });
  scheduledServiceActiveCount.inc();
  const endTimer = scheduledServiceDuration.startTimer({ service_id: args.serviceId });

  try {
    const session = await prepareSession(deps, service);
    const result = await service.run({ logId: started.id, session, now });
    await finalizeOK(deps, started.id, result, now());
    endTimer();
    scheduledServiceTotal.inc({ service_id: args.serviceId, result: result.result }, 1);
    if (args.scheduleId) {
      await deps.scheduleConfigsRepo.updateLastRun(args.scheduleId, started.startedAt);
    }
    return { serviceLogId: started.id, executed: true };
  } catch (err) {
    log.error({ err, serviceId: args.serviceId }, '[runService] uncaught error');
    await finalizeError(deps, started.id, err as Error, now());
    endTimer();
    scheduledServiceTotal.inc({ service_id: args.serviceId, result: 'failure' }, 1);
    return { serviceLogId: started.id, executed: true };
  } finally {
    scheduledServiceActiveCount.dec();
    await releaseLock(client, args.serviceId);
    client.release();
  }
}

async function prepareSession(
  deps: ServiceRunnerDeps,
  service: RegisteredService,
): Promise<McpSession> {
  if (!service.needsMcpSession) {
    // 對不需 mcp 的服務（如 SYSTEM_CLEANUP）回傳 stub session 物件
    return {
      async callTool() {
        throw new Error('service did not declare needsMcpSession=true but tried callTool');
      },
      async close() {
        /* noop */
      },
    };
  }
  if (!deps.acquireSession) {
    throw new Error(`service ${service.id} 需要 mcp session 但 deps.acquireSession 未注入`);
  }
  return deps.acquireSession();
}

async function tryAcquireLock(client: PoolClient, serviceId: string): Promise<boolean> {
  const { rows } = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
    [serviceId],
  );
  return rows[0]?.locked ?? false;
}

async function releaseLock(client: PoolClient, serviceId: string): Promise<void> {
  try {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [serviceId]);
  } catch (err) {
    getLogger().warn({ err, serviceId }, '[runService] pg_advisory_unlock failed');
  }
}

async function registerSkipped(
  deps: ServiceRunnerDeps,
  args: RunServiceArgs,
): Promise<RunServiceResult> {
  const { id } = await deps.serviceLogsRepo.insertImmediate({
    scheduleId: args.scheduleId ?? null,
    serviceId: args.serviceId,
    triggeredBy: args.triggeredBy,
    triggeredByUserId: args.triggeredByUserId ?? null,
    result: 'skipped',
    summary: '上一次仍在執行，本次略過。',
    notes: { reason: 'concurrent_run' },
  });
  scheduledServiceTotal.inc({ service_id: args.serviceId, result: 'skipped' }, 1);
  return { serviceLogId: id, executed: false };
}

async function registerNotRegistered(
  deps: ServiceRunnerDeps,
  args: RunServiceArgs,
  now: Date,
): Promise<RunServiceResult> {
  const { id } = await deps.serviceLogsRepo.insertImmediate({
    scheduleId: args.scheduleId ?? null,
    serviceId: args.serviceId,
    triggeredBy: args.triggeredBy,
    triggeredByUserId: args.triggeredByUserId ?? null,
    result: 'failure',
    summary: `服務 ${args.serviceId} 未註冊`,
    notes: { reason: 'not_registered' },
    startedAt: now,
    endedAt: now,
  });
  scheduledServiceTotal.inc({ service_id: args.serviceId, result: 'failure' }, 1);
  return { serviceLogId: id, executed: false };
}

async function finalizeOK(
  deps: ServiceRunnerDeps,
  id: string,
  result: ServiceRunResult,
  endedAt: Date,
): Promise<void> {
  await deps.serviceLogsRepo.finalize({
    id,
    result: result.result,
    summary: result.summary,
    notes: result.notes,
    endedAt,
  });
  if (result.ruleVersion) {
    // 將 ruleVersion 寫入；service_logs.rule_version 為獨立欄位
    // 簡化處理：透過直接 UPDATE（避免擴 finalize 介面）
    await deps.pool.query(`UPDATE service_logs SET rule_version = $2 WHERE id = $1`, [
      id,
      result.ruleVersion,
    ]);
  }
}

async function finalizeError(
  deps: ServiceRunnerDeps,
  id: string,
  err: Error,
  endedAt: Date,
): Promise<void> {
  await deps.serviceLogsRepo.finalize({
    id,
    result: 'failure',
    summary: `服務執行失敗：${err.message}`,
    notes: { error: err.message, stack: err.stack },
    endedAt,
  });
}
