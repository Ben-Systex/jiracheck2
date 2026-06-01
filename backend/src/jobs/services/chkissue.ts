// T061：US4 CHKISSUE 服務
// 流程：
//   1. mcp list_projects 取所有可見專案
//   2. 對每專案以 search_issues JQL `project = {key}` maxResults=1 判斷 issue_count
//   3. 寫入 project_issue_snapshots
//   4. 對每無 issue 專案查 getStreakAt ≥ CHKISSUE_EMPTY_STREAK_THRESHOLD →
//      加入 notes.empty_streak[]
//   5. summary：「總 N、有任務 X、無任務 Y、其中 Z 個已連續 K 次無任務」
//   6. 單一專案 API 失敗：retry 1 次 → 失敗則記 errors[] + partial_failure（FR-033）
//
// 對應 [research R-009](../../../specs/002-scheduled-services/research.md#r-009chkissue-連續-n-次無任務的偵測fr-032)

import type { RegisteredService, ServiceRunContext, ServiceRunResult } from './types';
import type { ProjectIssueSnapshotsRepo, SnapshotEntry } from '../../db/repositories/project-issue-snapshots';
import type { McpSession } from '../../mcp/types';

const CONCURRENCY = 5;
const RETRY_DELAY_MS = 30_000;
const DEFAULT_STREAK_THRESHOLD = 4;

export interface EmptyStreakEntry {
  projectKey: string;
  streak: number;
}

export interface ErrorEntry {
  projectKey: string;
  message: string;
  retried: boolean;
}

interface ProjectListResponse {
  projects?: Array<{ key: string }>;
}

interface SearchIssuesResponse {
  total?: number;
  issues?: Array<{ key: string }>;
}

export interface ChkissueDeps {
  snapshotsRepo: ProjectIssueSnapshotsRepo;
  /** 取所有可見專案 keys；測試可注入 fixed list */
  listProjects?: (session: McpSession) => Promise<string[]>;
  /** 對單一 projectKey 取 issue count；retry 由 service 內部處理 */
  countIssues?: (session: McpSession, projectKey: string) => Promise<number>;
  /** 連續 N 次無任務之警示門檻；預設由 env 取 */
  emptyStreakThreshold?: number;
  retryDelayMs?: number;
  concurrency?: number;
}

interface ProjectOutcome {
  projectKey: string;
  issueCount?: number;
  error?: { message: string; retried: boolean };
}

export function createChkissueService(deps: ChkissueDeps): RegisteredService {
  const threshold = deps.emptyStreakThreshold ?? getThresholdFromEnv();
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const retryDelay = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const listProjects = deps.listProjects ?? defaultListProjects;
  const countIssues = deps.countIssues ?? defaultCountIssues;

  async function checkOne(session: McpSession, key: string): Promise<ProjectOutcome> {
    try {
      const count = await countIssues(session, key);
      return { projectKey: key, issueCount: count };
    } catch {
      await sleep(retryDelay);
      try {
        const count = await countIssues(session, key);
        return { projectKey: key, issueCount: count };
      } catch (err2) {
        return {
          projectKey: key,
          error: { message: (err2 as Error).message, retried: true },
        };
      }
    }
  }

  async function runConcurrent(session: McpSession, keys: string[]): Promise<ProjectOutcome[]> {
    const outcomes: ProjectOutcome[] = [];
    let i = 0;
    async function worker(): Promise<void> {
      while (i < keys.length) {
        const idx = i++;
        outcomes[idx] = await checkOne(session, keys[idx]!);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()),
    );
    return outcomes;
  }

  async function detectEmptyStreaks(
    outcomes: ProjectOutcome[],
    serviceLogId: string,
  ): Promise<EmptyStreakEntry[]> {
    // 1. 寫入 snapshots（含這次的）
    const snapshots: SnapshotEntry[] = outcomes
      .filter((o) => o.issueCount !== undefined)
      .map((o) => ({
        projectKey: o.projectKey,
        hasIssues: o.issueCount! > 0,
        issueCount: o.issueCount!,
      }));
    await deps.snapshotsRepo.insertBatch({ serviceLogId, snapshots });

    // 2. 對無任務專案查 streak（含 just-inserted；snapshot_at DESC）
    const emptyKeys = snapshots.filter((s) => !s.hasIssues).map((s) => s.projectKey);
    const streakEntries: EmptyStreakEntry[] = [];
    for (const key of emptyKeys) {
      const streak = await deps.snapshotsRepo.getStreakAt(key, threshold + 1);
      if (streak >= threshold) streakEntries.push({ projectKey: key, streak });
    }
    return streakEntries;
  }

  return {
    id: 'CHKISSUE',
    needsMcpSession: true,
    async run(ctx: ServiceRunContext): Promise<ServiceRunResult> {
      const keys = await listProjects(ctx.session);
      if (keys.length === 0) {
        return {
          result: 'skipped',
          summary: '目前無可見專案；本次未檢查。',
          notes: { reason: 'no_visible_projects' },
        };
      }
      const outcomes = await runConcurrent(ctx.session, keys);
      const emptyStreak = await detectEmptyStreaks(outcomes, ctx.logId);
      return buildResult(outcomes, emptyStreak);
    },
  };
}

function buildResult(
  outcomes: ProjectOutcome[],
  emptyStreak: EmptyStreakEntry[],
): ServiceRunResult {
  const total = outcomes.length;
  const evaluated = outcomes.filter((o) => o.issueCount !== undefined);
  const errors = outcomes.filter((o) => o.error);
  const withIssues = evaluated.filter((o) => o.issueCount! > 0);
  const withoutIssues = evaluated.filter((o) => o.issueCount! === 0);
  const status = errors.length === 0 ? 'success' : 'partial_failure';

  const summaryParts: string[] = [
    `總 ${total} 個專案`,
    `有任務 ${withIssues.length} 個`,
    `無任務 ${withoutIssues.length} 個`,
  ];
  if (emptyStreak.length > 0) summaryParts.push(`${emptyStreak.length} 個已連續無任務`);
  if (errors.length > 0) summaryParts.push(`${errors.length} 個錯誤`);

  return {
    result: status,
    summary: summaryParts.join('、'),
    notes: {
      total,
      with_issues: withIssues.map((o) => ({ projectKey: o.projectKey, issueCount: o.issueCount! })),
      without_issues: withoutIssues.map((o) => o.projectKey),
      empty_streak: emptyStreak,
      errors: errors.map((o) => ({
        projectKey: o.projectKey,
        message: o.error!.message,
        retried: o.error!.retried,
      })),
    },
  };
}

function getThresholdFromEnv(): number {
  const raw = process.env.CHKISSUE_EMPTY_STREAK_THRESHOLD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_STREAK_THRESHOLD;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

async function defaultListProjects(session: McpSession): Promise<string[]> {
  const res = await session.callTool<ProjectListResponse>({
    name: 'list_projects',
    arguments: {},
  });
  return (res.content?.projects ?? []).map((p) => p.key);
}

async function defaultCountIssues(session: McpSession, projectKey: string): Promise<number> {
  const res = await session.callTool<SearchIssuesResponse>({
    name: 'search_issues',
    arguments: {
      jql: `project = "${projectKey}"`,
      fields: ['summary'],
      maxResults: 1,
    },
  });
  return res.content?.total ?? res.content?.issues?.length ?? 0;
}
