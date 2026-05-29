// T082：US4 批次更新驗證 — 白名單 / 200 上限 / confirmText regex 三方比對
// 規則：
//   - FR-047 白名單：assignee / due_date / label / priority / sprint
//   - FR-046 單次上限：200 筆；> 200 直接拒
//   - confirmText 正規式：^確認更新\s*(\d+)\s*筆$
//   - 三方比對：confirmText 解析的 N == confirmCount == previewTotal

import type { BulkTargetField } from '../../db/repositories/bulk-updates';

export const ALLOWED_TARGET_FIELDS: readonly BulkTargetField[] = [
  'assignee',
  'due_date',
  'label',
  'priority',
  'sprint',
] as const;

export const BULK_MAX_TOTAL = 200;
export const CONFIRM_TEXT_PATTERN = /^確認更新\s*(\d+)\s*筆$/;

export type ValidationFailReason =
  | 'target_field_not_allowed'
  | 'too_many_items'
  | 'confirm_text_invalid'
  | 'confirm_count_mismatch';

export interface ValidationResult {
  ok: boolean;
  reason?: ValidationFailReason;
  detail?: string;
}

export function assertTargetFieldAllowed(field: string): ValidationResult {
  if (!ALLOWED_TARGET_FIELDS.includes(field as BulkTargetField)) {
    return {
      ok: false,
      reason: 'target_field_not_allowed',
      detail: `欄位 "${field}" 不在白名單`,
    };
  }
  return { ok: true };
}

export function assertTotalCountWithinLimit(total: number): ValidationResult {
  if (!Number.isInteger(total) || total < 0) {
    return { ok: false, reason: 'too_many_items', detail: 'totalCount 必須為非負整數' };
  }
  if (total > BULK_MAX_TOTAL) {
    return {
      ok: false,
      reason: 'too_many_items',
      detail: `總筆數 ${total} 超過上限 ${BULK_MAX_TOTAL}`,
    };
  }
  return { ok: true };
}

/** 解析 confirmText 中的「N 筆」數字；無法解析回 null */
export function parseConfirmText(text: string): number | null {
  const m = CONFIRM_TEXT_PATTERN.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export interface ConfirmAlignmentArgs {
  confirmText: string;
  confirmCount: number;
  previewTotal: number;
}

/** 三方比對：confirmText 解析的 N == confirmCount == previewTotal */
export function verifyConfirmAlignment(args: ConfirmAlignmentArgs): ValidationResult {
  const parsed = parseConfirmText(args.confirmText);
  if (parsed === null) {
    return { ok: false, reason: 'confirm_text_invalid', detail: '格式須為「確認更新 N 筆」' };
  }
  if (parsed !== args.confirmCount) {
    return {
      ok: false,
      reason: 'confirm_count_mismatch',
      detail: `confirmText 解析數字 ${parsed} 與 confirmCount ${args.confirmCount} 不符`,
    };
  }
  if (args.confirmCount !== args.previewTotal) {
    return {
      ok: false,
      reason: 'confirm_count_mismatch',
      detail: `confirmCount ${args.confirmCount} 與 preview totalCount ${args.previewTotal} 不符`,
    };
  }
  return { ok: true };
}
