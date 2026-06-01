// T049：US3 CHKPROJ 服務實作 + rule-v1 純函式
// 流程：
//   1. 讀 project_check_lists → projects[]
//   2. 若空 → 寫 skipped 紀錄退出（FR-023）
//   3. for each projectKey (concurrency ≤ 5)：
//      - mcp search_issues（sprint info + open overdue）
//      - evaluateDelay(input) 走 rule-v1（FR-021）
//   4. 個別失敗（404/403/network）走 1 次重試 30s 後仍失敗 → notes.errors[]，整體 partial_failure
//   5. summary 中文「N 個專案，X 個延遲、Y 個正常、Z 個錯誤」
//   6. notes 含 rule_version='rule-v1' + delayed[] + errors[]

import type { RegisteredService, ServiceRunContext, ServiceRunResult } from './types';
import type { ProjectCheckListsRepo } from '../../db/repositories/project-check-lists';
import type { McpSession } from '../../mcp/types';

export const RULE_VERSION = 'rule-v1';
const SPRINT_PROGRESS_THRESHOLD = 0.5; // Sprint 過半
const COMPLETION_RATIO_THRESHOLD = 0.5; // 完成率 < 50%
const OVERDUE_DAYS_THRESHOLD = 3;
const CONCURRENCY = 5;
const RETRY_DELAY_MS = 30_000;

export type DelayCondition = 'A' | 'B';

/** 寫入 ServiceLog.notes.delayed[] 之單筆結構（前端 detail page 對應使用） */
export interface DelayedNoteEntry {
  projectKey: string;
  conditions: DelayCondition[];
  sprintProgress: number | null;
  completionRatio: number | null;
  overdueCount: number;
  maxOverdueDays: number;
}

/** 寫入 ServiceLog.notes.errors[] 之單筆結構 */
export interface ErrorNoteEntry {
  projectKey: string;
  message: string;
  retried: boolean;
}

export interface DelayEvaluation {
  delayed: boolean;
  conditions: DelayCondition[];
  /** 實際數據；用於 ServiceLog notes.delayed[] */
  data: {
    sprintProgress: number | null; // 0–1
    completionRatio: number | null; // 0–1
    overdueCount: number;
    maxOverdueDays: number;
  };
}

export interface ProjectCheckInput {
  projectKey: string;
  /** 進行中 Sprint 資訊；null 表示無 active sprint（條件 A 不適用） */
  sprint: {
    startDate: string;
    endDate: string;
    totalStoryPoints: number;
    completedStoryPoints: number;
  } | null;
  /** 未完成（非 Done）任務 */
  openIssues: Array<{
    key: string;
    dueDate: string | null;
  }>;
  /** 注入「現在」用於 overdue 計算（測試可固定） */
  now: Date;
}

/** rule-v1 純函式：A or B 任一觸發即「延遲」 */
export function evaluateDelay(input: ProjectCheckInput): DelayEvaluation {
  const conditionA = evaluateConditionA(input);
  const conditionB = evaluateConditionB(input);
  const conditions: DelayCondition[] = [];
  if (conditionA.matched) conditions.push('A');
  if (conditionB.matched) conditions.push('B');
  return {
    delayed: conditions.length > 0,
    conditions,
    data: {
      sprintProgress: conditionA.sprintProgress,
      completionRatio: conditionA.completionRatio,
      overdueCount: conditionB.overdueCount,
      maxOverdueDays: conditionB.maxOverdueDays,
    },
  };
}

interface ConditionAResult {
  matched: boolean;
  sprintProgress: number | null;
  completionRatio: number | null;
}

function evaluateConditionA(input: ProjectCheckInput): ConditionAResult {
  const sp = input.sprint;
  if (!sp) return { matched: false, sprintProgress: null, completionRatio: null };
  const sprintProgress = computeSprintProgress(sp.startDate, sp.endDate, input.now);
  const completionRatio = sp.totalStoryPoints > 0 ? sp.completedStoryPoints / sp.totalStoryPoints : null;
  if (sprintProgress === null || completionRatio === null) {
    return { matched: false, sprintProgress, completionRatio };
  }
  const matched =
    sprintProgress > SPRINT_PROGRESS_THRESHOLD && completionRatio < COMPLETION_RATIO_THRESHOLD;
  return { matched, sprintProgress, completionRatio };
}

function computeSprintProgress(startDate: string, endDate: string, now: Date): number | null {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const elapsed = now.getTime() - start;
  if (elapsed <= 0) return 0;
  if (elapsed >= end - start) return 1;
  return elapsed / (end - start);
}

interface ConditionBResult {
  matched: boolean;
  overdueCount: number;
  maxOverdueDays: number;
}

function evaluateConditionB(input: ProjectCheckInput): ConditionBResult {
  let count = 0;
  let maxDays = 0;
  for (const issue of input.openIssues) {
    if (!issue.dueDate) continue;
    const days = daysSince(issue.dueDate, input.now);
    if (days >= OVERDUE_DAYS_THRESHOLD) {
      count += 1;
      if (days > maxDays) maxDays = days;
    }
  }
  return { matched: count > 0, overdueCount: count, maxOverdueDays: maxDays };
}

function daysSince(dueDate: string, now: Date): number {
  const due = new Date(dueDate).getTime();
  if (!Number.isFinite(due)) return 0;
  return Math.floor((now.getTime() - due) / (24 * 60 * 60 * 1000));
}

// ---- service runner integration ------------------------------------------

export interface ChkprojDeps {
  projectCheckListsRepo: ProjectCheckListsRepo;
  fetchProject: (session: McpSession, key: string) => Promise<ProjectCheckInput>;
  /** retry 間隔，預設 30 秒；測試可注入 0 */
  retryDelayMs?: number;
  /** 並發上限，預設 5；測試可注入 1 */
  concurrency?: number;
}

interface ProjectOutcome {
  projectKey: string;
  evaluation?: DelayEvaluation;
  error?: { message: string; retried: boolean };
}

export function createChkprojService(deps: ChkprojDeps): RegisteredService {
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const retryDelay = deps.retryDelayMs ?? RETRY_DELAY_MS;

  async function checkOne(session: McpSession, key: string, now: Date): Promise<ProjectOutcome> {
    try {
      const input = applyNow(await deps.fetchProject(session, key), now);
      return { projectKey: key, evaluation: evaluateDelay(input) };
    } catch {
      // 1 次重試（patch P5 / FR-022）
      await sleep(retryDelay);
      try {
        const input = applyNow(await deps.fetchProject(session, key), now);
        return { projectKey: key, evaluation: evaluateDelay(input) };
      } catch (err2) {
        return {
          projectKey: key,
          error: { message: (err2 as Error).message, retried: true },
        };
      }
    }
  }

  async function runConcurrent(
    session: McpSession,
    keys: string[],
    now: Date,
  ): Promise<ProjectOutcome[]> {
    const outcomes: ProjectOutcome[] = [];
    let i = 0;
    async function worker(): Promise<void> {
      while (i < keys.length) {
        const idx = i++;
        outcomes[idx] = await checkOne(session, keys[idx]!, now);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, keys.length) }, () => worker());
    await Promise.all(workers);
    return outcomes;
  }

  return {
    id: 'CHKPROJ',
    needsMcpSession: true,
    async run(ctx: ServiceRunContext): Promise<ServiceRunResult> {
      const keys = await deps.projectCheckListsRepo.listProjectKeys();
      if (keys.length === 0) {
        return {
          result: 'skipped',
          summary: '專案檢查清單為空；本次未檢查任何專案。',
          notes: { reason: 'empty_checklist', rule_version: RULE_VERSION },
          ruleVersion: RULE_VERSION,
        };
      }
      const outcomes = await runConcurrent(ctx.session, keys, ctx.now());
      return buildResult(outcomes);
    },
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 將 ctx 的「現在」覆蓋到 fetchProject 結果上；
 * 確保 evaluateDelay 用的時間與 runService 一致（測試可預測）。
 */
function applyNow(input: ProjectCheckInput, now: Date): ProjectCheckInput {
  return { ...input, now };
}

function buildResult(outcomes: ProjectOutcome[]): ServiceRunResult {
  const total = outcomes.length;
  const errors = outcomes.filter((o) => o.error);
  const evaluated = outcomes.filter((o) => o.evaluation);
  const delayed = evaluated.filter((o) => o.evaluation!.delayed);

  const result: ServiceRunResult['result'] =
    errors.length === 0 ? 'success' : 'partial_failure';

  const summary = `${total} 個專案，${delayed.length} 個延遲、${evaluated.length - delayed.length} 個正常、${errors.length} 個錯誤（依規則 ${RULE_VERSION}）`;

  const notes: Record<string, unknown> = {
    rule_version: RULE_VERSION,
    delayed: delayed.map((o) => ({
      projectKey: o.projectKey,
      conditions: o.evaluation!.conditions,
      sprintProgress: o.evaluation!.data.sprintProgress,
      completionRatio: o.evaluation!.data.completionRatio,
      overdueCount: o.evaluation!.data.overdueCount,
      maxOverdueDays: o.evaluation!.data.maxOverdueDays,
    })),
    errors: errors.map((o) => ({
      projectKey: o.projectKey,
      message: o.error!.message,
      retried: o.error!.retried,
    })),
    total,
  };

  return { result, summary, notes, ruleVersion: RULE_VERSION };
}
