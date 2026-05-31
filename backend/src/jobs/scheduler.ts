// T021：排程器（feature 002-scheduled-services）
// - 啟動時掃 listEnabled() 一次性 register node-cron task
// - register / unregister 對應 schedule CRUD（前端 / route 觸發）
// - 觸發時呼叫 service-runner.runService（內部含 advisory lock）
// - 啟動時偵測「上次預定 ≤ 24h 內已過」→ 寫一筆 missed 紀錄（research R-004）
// - 每次觸發後重算 next_run_at 寫回 schedule_configs

import { schedule as cronSchedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type {
  ScheduleConfig,
  ScheduleConfigsRepo,
} from '../db/repositories/schedule-configs';
import type { ServiceLogsRepo } from '../db/repositories/service-logs';
import type { ServiceRunnerDeps } from './service-runner';
import { runService } from './service-runner';
import { computeNextRunAt, getServerTz, toCronExpression } from '../lib/cron-utils';
import { scheduleConfigsEnabledCount } from '../lib/metrics';
import { getLogger } from '../lib/logger';

const MISSED_GRACE_MS = 24 * 60 * 60 * 1000;

export interface SchedulerDeps extends ServiceRunnerDeps {
  serviceLogsRepo: ServiceLogsRepo;
  scheduleConfigsRepo: ScheduleConfigsRepo;
}

export class Scheduler {
  private readonly tasks = new Map<string, ScheduledTask>();
  private started = false;

  constructor(private readonly deps: SchedulerDeps) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const enabled = await this.deps.scheduleConfigsRepo.listEnabled();
    await this.handleMissedOnStartup(enabled);
    for (const cfg of enabled) {
      this.registerSchedule(cfg);
    }
    scheduleConfigsEnabledCount.set(enabled.length);
  }

  /**
   * 註冊一筆排程的 cron task。重複註冊 → 先 unregister。
   */
  registerSchedule(cfg: ScheduleConfig): void {
    if (!cfg.enabled) {
      this.unregisterSchedule(cfg.id);
      return;
    }
    if (this.tasks.has(cfg.id)) this.unregisterSchedule(cfg.id);

    const cronExpr = toCronExpression({ type: cfg.frequencyType, value: cfg.frequencyValue });
    const log = getLogger();
    const task = cronSchedule(
      cronExpr,
      async () => {
        try {
          await runService(this.deps, {
            serviceId: cfg.serviceId,
            triggeredBy: 'schedule',
            scheduleId: cfg.id,
          });
        } catch (err) {
          log.error({ err, scheduleId: cfg.id }, '[scheduler] runService threw');
        }
        // 重算下次預定時間
        try {
          const next = computeNextRunAt(
            { type: cfg.frequencyType, value: cfg.frequencyValue },
            (this.deps.now ?? (() => new Date()))(),
          );
          await this.deps.scheduleConfigsRepo.updateNextRun(cfg.id, next);
        } catch (err) {
          log.warn({ err, scheduleId: cfg.id }, '[scheduler] failed to update next_run_at');
        }
      },
      { timezone: getServerTz(), name: `schedule-${cfg.id}` },
    );
    this.tasks.set(cfg.id, task);
    log.info({ scheduleId: cfg.id, cronExpr }, '[scheduler] registered');
  }

  unregisterSchedule(scheduleId: string): void {
    const task = this.tasks.get(scheduleId);
    if (!task) return;
    void Promise.resolve(task.stop()).catch(() => undefined);
    void Promise.resolve(task.destroy()).catch(() => undefined);
    this.tasks.delete(scheduleId);
    getLogger().info({ scheduleId }, '[scheduler] unregistered');
  }

  /** 對所有 enabled schedules 重新註冊（CRUD 後呼叫；測試用） */
  async refreshAll(): Promise<void> {
    const enabled = await this.deps.scheduleConfigsRepo.listEnabled();
    const newIds = new Set(enabled.map((c) => c.id));
    // 移除不在 enabled 中的舊 task
    for (const oldId of [...this.tasks.keys()]) {
      if (!newIds.has(oldId)) this.unregisterSchedule(oldId);
    }
    for (const cfg of enabled) this.registerSchedule(cfg);
    scheduleConfigsEnabledCount.set(enabled.length);
  }

  async stop(): Promise<void> {
    for (const id of [...this.tasks.keys()]) this.unregisterSchedule(id);
    this.started = false;
  }

  registeredCount(): number {
    return this.tasks.size;
  }

  private async handleMissedOnStartup(enabled: ScheduleConfig[]): Promise<void> {
    const now = (this.deps.now ?? (() => new Date()))();
    const cutoffStart = new Date(now.getTime() - MISSED_GRACE_MS);
    for (const cfg of enabled) {
      const nra = cfg.nextRunAt;
      // 已逾期且 ≤ 24h 才補登 missed；超過 24h 視為「重大停機」不再 noise
      if (!nra) continue;
      if (nra >= now) continue; // 還沒到，正常
      if (nra < cutoffStart) continue; // 超過 24h
      try {
        await this.deps.serviceLogsRepo.insertImmediate({
          scheduleId: cfg.id,
          serviceId: cfg.serviceId,
          triggeredBy: 'system',
          result: 'missed',
          summary: `系統暫停期間錯過本次觸發（預定 ${nra.toISOString()}）`,
          notes: { plannedAt: nra.toISOString() },
          startedAt: nra,
          endedAt: now,
        });
      } catch (err) {
        getLogger().warn({ err, scheduleId: cfg.id }, '[scheduler] insert missed log failed');
      }
    }
  }
}
