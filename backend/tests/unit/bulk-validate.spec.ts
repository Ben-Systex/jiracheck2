// T073：bulk validator 單元測試
// - 白名單 FR-047
// - 200 上限 FR-046
// - confirmText 正規式
// - 三方比對 acceptance #4

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TARGET_FIELDS,
  BULK_MAX_TOTAL,
  CONFIRM_TEXT_PATTERN,
  assertTargetFieldAllowed,
  assertTotalCountWithinLimit,
  parseConfirmText,
  verifyConfirmAlignment,
} from '../../src/services/bulk/validator';

describe('bulk validator', () => {
  it('ALLOWED_TARGET_FIELDS 包含 5 個白名單欄位（FR-047）', () => {
    expect(new Set(ALLOWED_TARGET_FIELDS)).toEqual(
      new Set(['assignee', 'due_date', 'label', 'priority', 'sprint']),
    );
  });

  it('assertTargetFieldAllowed: 白名單通過 / 其他拒絕', () => {
    for (const f of ALLOWED_TARGET_FIELDS) {
      expect(assertTargetFieldAllowed(f).ok).toBe(true);
    }
    const bad = assertTargetFieldAllowed('status');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('target_field_not_allowed');
  });

  it('assertTotalCountWithinLimit: 0 / 1 / 200 通過, 201 拒（FR-046）', () => {
    expect(assertTotalCountWithinLimit(0).ok).toBe(true);
    expect(assertTotalCountWithinLimit(1).ok).toBe(true);
    expect(assertTotalCountWithinLimit(BULK_MAX_TOTAL).ok).toBe(true);
    const over = assertTotalCountWithinLimit(BULK_MAX_TOTAL + 1);
    expect(over.ok).toBe(false);
    expect(over.reason).toBe('too_many_items');
  });

  it('CONFIRM_TEXT_PATTERN 規範字串', () => {
    expect(CONFIRM_TEXT_PATTERN.test('確認更新 35 筆')).toBe(true);
    expect(CONFIRM_TEXT_PATTERN.test('確認更新35筆')).toBe(true);
    expect(CONFIRM_TEXT_PATTERN.test('確認更新  100  筆')).toBe(true);
    expect(CONFIRM_TEXT_PATTERN.test('更新 35 筆')).toBe(false);
    expect(CONFIRM_TEXT_PATTERN.test('確認更新 35')).toBe(false);
    expect(CONFIRM_TEXT_PATTERN.test('Confirm update 35 items')).toBe(false);
  });

  it('parseConfirmText 取出數字', () => {
    expect(parseConfirmText('確認更新 35 筆')).toBe(35);
    expect(parseConfirmText('確認更新0筆')).toBe(0);
    expect(parseConfirmText('xxx')).toBeNull();
  });

  it('verifyConfirmAlignment 三方比對成功', () => {
    expect(
      verifyConfirmAlignment({ confirmText: '確認更新 35 筆', confirmCount: 35, previewTotal: 35 }).ok,
    ).toBe(true);
  });

  it('verifyConfirmAlignment 格式錯 → confirm_text_invalid', () => {
    const r = verifyConfirmAlignment({ confirmText: '更新 35', confirmCount: 35, previewTotal: 35 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('confirm_text_invalid');
  });

  it('verifyConfirmAlignment N != confirmCount → confirm_count_mismatch', () => {
    const r = verifyConfirmAlignment({ confirmText: '確認更新 34 筆', confirmCount: 35, previewTotal: 35 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('confirm_count_mismatch');
  });

  it('verifyConfirmAlignment confirmCount != previewTotal → confirm_count_mismatch', () => {
    const r = verifyConfirmAlignment({ confirmText: '確認更新 35 筆', confirmCount: 35, previewTotal: 34 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('confirm_count_mismatch');
  });
});
