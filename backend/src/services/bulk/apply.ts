// T081：US4 套用 service
// 流程：
//   1. verifyPreviewToken（HMAC + TTL + userId 比對）
//   2. 三方比對 confirmText / confirmCount / previewTotal
//   3. createOperation（status=running）
//   4. 對 token.issueKeys 逐筆呼叫 MCP edit_issue（Promise.allSettled）
//   5. 分類錯誤 → recordItem
//   6. finalize 設最終 status + 計數 + completedAt
//
// 注意：對 acceptance #2 — 即便部分失敗仍要走完所有 issue 並 finalize partial_failure

import type { McpSession } from '../../mcp/types';
import type {
  BulkItemResult,
  BulkOperationStatus,
  BulkUpdatesRepo,
} from '../../db/repositories/bulk-updates';
import { verifyPreviewToken } from './token';
import { verifyConfirmAlignment } from './validator';
import { traceSpan } from '../../lib/telemetry';
import { bulkOperationTotal } from '../../lib/metrics';

export interface BulkApplyArgs {
  userId: string;
  previewToken: string;
  confirmText: string;
  confirmCount: number;
  session: McpSession;
  repo: BulkUpdatesRepo;
  /** 對 mcp edit_issue 的目標 issue key list 上限保險（同 token.issueKeys.length） */
  maxConcurrency?: number;
  /** 注入時間（測試用） */
  nowFn?: () => Date;
}

export type BulkApplyErrorReason =
  | 'token_invalid'
  | 'token_expired'
  | 'confirm_text_invalid'
  | 'confirm_count_mismatch'
  | 'no_editable_items';

export class BulkApplyError extends Error {
  constructor(public readonly reason: BulkApplyErrorReason, detail?: string) {
    super(detail ?? reason);
    this.name = 'BulkApplyError';
  }
}

export interface BulkApplyResult {
  operationId: string;
  /** 非同步：apply 後立刻回 operationId；實際結果透過 polling 取得 */
  done: Promise<void>;
}

interface McpEditIssueResult {
  ok: boolean;
  error?: { code?: 'permission_denied' | 'version_conflict' | 'api_error'; message?: string };
}

export async function applyBulkUpdate(args: BulkApplyArgs): Promise<BulkApplyResult> {
  return traceSpan('bulk.apply', (span) => {
    span.setAttribute('bulk.user_id', args.userId);
    return applyInner(args);
  });
}

async function applyInner(args: BulkApplyArgs): Promise<BulkApplyResult> {
  const now = args.nowFn ?? (() => new Date());

  const verify = verifyPreviewToken(args.previewToken, args.userId);
  if (!verify.ok || !verify.payload) {
    const map: Record<string, BulkApplyErrorReason> = {
      malformed: 'token_invalid',
      signature_invalid: 'token_invalid',
      expired: 'token_expired',
      user_mismatch: 'token_invalid',
    };
    throw new BulkApplyError(
      map[verify.reason ?? 'malformed'] ?? 'token_invalid',
      `previewToken ${verify.reason}`,
    );
  }
  const payload = verify.payload;

  const align = verifyConfirmAlignment({
    confirmText: args.confirmText,
    confirmCount: args.confirmCount,
    previewTotal: payload.totalCount,
  });
  if (!align.ok) {
    const reason: BulkApplyErrorReason =
      align.reason === 'confirm_text_invalid' ? 'confirm_text_invalid' : 'confirm_count_mismatch';
    throw new BulkApplyError(reason, align.detail);
  }

  if (payload.issueKeys.length === 0) {
    throw new BulkApplyError('no_editable_items', '可編輯筆數為 0');
  }

  const op = await args.repo.createOperation({
    userId: args.userId,
    projectKey: payload.projectKey,
    filterDsl: payload.filterDsl,
    targetField: payload.targetField,
    targetValueJson: payload.targetValueJson,
    totalCount: payload.issueKeys.length,
    confirmedAt: now(),
  });

  const done = executeAndFinalize(args, payload.issueKeys, payload.previousValues, op.id, payload, now);
  return { operationId: op.id, done };
}

async function executeAndFinalize(
  args: BulkApplyArgs,
  issueKeys: string[],
  previousValues: Record<string, unknown>,
  operationId: string,
  payload: { targetField: string; targetValueJson: unknown },
  now: () => Date,
): Promise<void> {
  let successCount = 0;
  let failureCount = 0;

  for (const issueKey of issueKeys) {
    const outcome = await applySingle(args.session, issueKey, payload);
    await args.repo.recordItem({
      operationId,
      issueKey,
      previousValueJson: previousValues[issueKey],
      newValueJson: payload.targetValueJson,
      result: outcome.result,
      errorMessage: outcome.error ?? null,
      appliedAt: outcome.result === 'success' ? now() : null,
    });
    if (outcome.result === 'success') successCount += 1;
    else failureCount += 1;
  }

  const status: BulkOperationStatus =
    failureCount === 0 ? 'success' : successCount === 0 ? 'failure' : 'partial_failure';
  await args.repo.finalize({
    operationId,
    status,
    successCount,
    failureCount,
    completedAt: now(),
  });
  bulkOperationTotal.inc({ status }, 1);
}

interface SingleOutcome {
  result: BulkItemResult;
  error?: string;
}

async function applySingle(
  session: McpSession,
  issueKey: string,
  payload: { targetField: string; targetValueJson: unknown },
): Promise<SingleOutcome> {
  try {
    const res = await session.callTool<McpEditIssueResult>({
      name: 'edit_issue',
      arguments: {
        issueKey,
        fields: { [jiraFieldKeyFor(payload.targetField)]: payload.targetValueJson },
      },
    });
    if (res.content?.ok) return { result: 'success' };
    const code = res.content?.error?.code ?? 'api_error';
    return { result: code, error: res.content?.error?.message ?? code };
  } catch (err) {
    return { result: 'api_error', error: (err as Error).message };
  }
}

function jiraFieldKeyFor(field: string): string {
  switch (field) {
    case 'due_date':
      return 'duedate';
    case 'label':
      return 'labels';
    case 'sprint':
      return process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';
    default:
      return field;
  }
}
