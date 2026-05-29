// T080：US4 預覽 service
// - filter → JQL → MCP search_issues → 投影 (currentValue / proposedValue / editableByUser)
// - 命中筆數驗 200 上限（FR-046）+ target_field 白名單（FR-047）
// - 簽出 previewToken（30 分鐘 TTL）讓 apply 階段唯一引用本次預覽結果（acceptance #4）

import type { McpSession } from '../../mcp/types';
import type { BulkTargetField } from '../../db/repositories/bulk-updates';
import {
  assertTargetFieldAllowed,
  assertTotalCountWithinLimit,
  BULK_MAX_TOTAL,
} from './validator';
import { signPreviewToken, type PreviewTokenPayload } from './token';
import { traceSpan } from '../../lib/telemetry';

export interface BulkPreviewFilter {
  statuses?: string[];
  assigneeAccountIds?: string[];
  sprintNames?: string[];
  labels?: string[];
  issueTypes?: string[];
  dueDateRange?: { from?: string; to?: string };
}

export interface BulkPreviewRequest {
  userId: string;
  projectKey: string;
  filter: BulkPreviewFilter;
  targetField: BulkTargetField;
  targetValue: unknown;
}

export interface BulkPreviewItem {
  issueKey: string;
  summary: string;
  currentValue: unknown;
  proposedValue: unknown;
  editableByUser: boolean;
}

export interface BulkPreviewResult {
  previewToken: string;
  totalCount: number;
  items: BulkPreviewItem[];
}

// ---- raw MCP types --------------------------------------------------------

interface McpIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    assignee?: { accountId?: string; displayName?: string } | null;
    priority?: { name?: string } | null;
    duedate?: string | null;
    labels?: string[];
    project?: { key?: string };
    /** mcp-atlassian 可附 editmeta 給「使用者是否可編輯該欄位」資訊 */
    editmeta?: { fields?: Record<string, unknown> };
    [field: string]: unknown;
  };
}

interface McpSearchIssuesResult {
  total?: number;
  issues: McpIssue[];
}

// ---- public API -----------------------------------------------------------

export async function previewBulkUpdate(
  session: McpSession,
  req: BulkPreviewRequest,
): Promise<BulkPreviewResult> {
  return traceSpan(
    'bulk.preview',
    () => previewInner(session, req),
    { 'bulk.project': req.projectKey, 'bulk.target_field': req.targetField },
  );
}

async function previewInner(
  session: McpSession,
  req: BulkPreviewRequest,
): Promise<BulkPreviewResult> {
  const fieldCheck = assertTargetFieldAllowed(req.targetField);
  if (!fieldCheck.ok) throw new BulkPreviewError('validation', fieldCheck.detail);

  const jql = buildJql(req.projectKey, req.filter);
  const res = await session.callTool<McpSearchIssuesResult>({
    name: 'search_issues',
    arguments: {
      jql,
      fields: defaultFields(req.targetField),
      maxResults: BULK_MAX_TOTAL + 1, // 多取 1 筆好判斷是否超量
    },
  });

  const raw = res.content?.issues ?? [];
  const total = res.content?.total ?? raw.length;

  const totalCheck = assertTotalCountWithinLimit(total);
  if (!totalCheck.ok) throw new BulkPreviewError('too_many', totalCheck.detail, total);

  const items: BulkPreviewItem[] = raw.slice(0, BULK_MAX_TOTAL).map((iss) => ({
    issueKey: iss.key,
    summary: iss.fields.summary ?? '',
    currentValue: extractCurrentValue(iss, req.targetField),
    proposedValue: req.targetValue,
    editableByUser: isEditable(iss, req.targetField),
  }));

  const previousValues: Record<string, unknown> = {};
  for (const item of items) previousValues[item.issueKey] = item.currentValue;

  const payload: Omit<PreviewTokenPayload, 'expiresAt'> = {
    userId: req.userId,
    projectKey: req.projectKey,
    targetField: req.targetField,
    targetValueJson: req.targetValue,
    filterDsl: filterToDsl(req.filter),
    issueKeys: items.filter((i) => i.editableByUser).map((i) => i.issueKey),
    previousValues,
    totalCount: items.length,
  };
  return {
    previewToken: signPreviewToken(payload),
    totalCount: items.length,
    items,
  };
}

// ---- error class ----------------------------------------------------------

export type BulkPreviewErrorCode = 'validation' | 'too_many' | 'upstream';

export class BulkPreviewError extends Error {
  constructor(
    public readonly code: BulkPreviewErrorCode,
    detail?: string,
    public readonly totalCount?: number,
  ) {
    super(detail ?? code);
    this.name = 'BulkPreviewError';
  }
}

// ---- helpers --------------------------------------------------------------

function buildJql(projectKey: string, f: BulkPreviewFilter): string {
  const parts: string[] = [`project = "${escapeJql(projectKey)}"`];
  pushInClause(parts, 'status', f.statuses);
  pushInClause(parts, 'assignee', f.assigneeAccountIds);
  pushInClause(parts, 'sprint', f.sprintNames);
  pushInClause(parts, 'labels', f.labels);
  pushInClause(parts, 'issuetype', f.issueTypes);
  pushDueDateClause(parts, f.dueDateRange);
  return parts.join(' AND ');
}

function pushInClause(parts: string[], field: string, values: string[] | undefined): void {
  if (values?.length) parts.push(`${field} in (${values.map(quoteJql).join(', ')})`);
}

function pushDueDateClause(
  parts: string[],
  range: BulkPreviewFilter['dueDateRange'],
): void {
  if (range?.from) parts.push(`duedate >= "${range.from}"`);
  if (range?.to) parts.push(`duedate <= "${range.to}"`);
}

function escapeJql(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

function quoteJql(v: string): string {
  return `"${escapeJql(v)}"`;
}

function defaultFields(field: BulkTargetField): string[] {
  const base = ['summary', 'status', 'project', 'editmeta'];
  switch (field) {
    case 'assignee':
      return [...base, 'assignee'];
    case 'due_date':
      return [...base, 'duedate'];
    case 'label':
      return [...base, 'labels'];
    case 'priority':
      return [...base, 'priority'];
    case 'sprint':
      return [...base, process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020'];
  }
}

function extractCurrentValue(iss: McpIssue, field: BulkTargetField): unknown {
  const f = iss.fields;
  switch (field) {
    case 'assignee':
      return currentAssignee(f);
    case 'due_date':
      return f.duedate ?? null;
    case 'label':
      return f.labels ?? [];
    case 'priority':
      return f.priority?.name ?? null;
    case 'sprint':
      return currentSprint(f);
  }
}

function currentAssignee(f: McpIssue['fields']): unknown {
  return f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName } : null;
}

function currentSprint(f: McpIssue['fields']): unknown {
  const v = f[process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020'];
  return Array.isArray(v) ? v : null;
}

/**
 * editableByUser 推導：若 mcp-atlassian 提供 editmeta.fields[targetField] 就用該結果；
 * 否則保守視為 true（後續 apply 時 jira 仍會擋）。
 */
function isEditable(iss: McpIssue, field: BulkTargetField): boolean {
  const meta = iss.fields.editmeta?.fields;
  if (!meta) return true;
  const key = jiraFieldKey(field);
  return key in meta;
}

function jiraFieldKey(field: BulkTargetField): string {
  switch (field) {
    case 'assignee':
      return 'assignee';
    case 'due_date':
      return 'duedate';
    case 'label':
      return 'labels';
    case 'priority':
      return 'priority';
    case 'sprint':
      return process.env.JIRA_FIELD_SPRINT ?? 'customfield_10020';
  }
}

/** 將 filter 物件序列化為審計用 DSL（之後寫入 bulk_update_operations.filter_dsl jsonb） */
function filterToDsl(f: BulkPreviewFilter): Record<string, unknown> {
  return JSON.parse(JSON.stringify(f)) as Record<string, unknown>;
}
