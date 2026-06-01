// T010：cron-utils 單元測試
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  toCronExpression,
  computeNextRunAt,
  validateFrequency,
  getServerTz,
  FrequencyError,
} from './cron-utils';

const ORIG_TZ = process.env.SERVER_TZ;

beforeEach(() => {
  process.env.SERVER_TZ = 'Asia/Taipei';
});

afterEach(() => {
  if (ORIG_TZ !== undefined) process.env.SERVER_TZ = ORIG_TZ;
  else delete process.env.SERVER_TZ;
});

describe('getServerTz', () => {
  it('預設 Asia/Taipei', () => {
    delete process.env.SERVER_TZ;
    expect(getServerTz()).toBe('Asia/Taipei');
  });
  it('讀環境變數', () => {
    process.env.SERVER_TZ = 'UTC';
    expect(getServerTz()).toBe('UTC');
  });
});

describe('toCronExpression', () => {
  it('daily 09:00 → "0 9 * * *"', () => {
    expect(toCronExpression({ type: 'daily', value: '09:00' })).toBe('0 9 * * *');
  });
  it('daily 23:59 → "59 23 * * *"', () => {
    expect(toCronExpression({ type: 'daily', value: '23:59' })).toBe('59 23 * * *');
  });
  it('daily 不合法 → FrequencyError', () => {
    expect(() => toCronExpression({ type: 'daily', value: '25:00' })).toThrow(FrequencyError);
    expect(() => toCronExpression({ type: 'daily', value: 'abc' })).toThrow(FrequencyError);
    expect(() => toCronExpression({ type: 'daily', value: '12:60' })).toThrow(FrequencyError);
  });

  it('weekly 週一 09:30 → "30 9 * * 1"', () => {
    expect(toCronExpression({ type: 'weekly', value: '09:30:1' })).toBe('30 9 * * 1');
  });
  it('weekly 週日 (DOW=7) → cron DOW=0', () => {
    expect(toCronExpression({ type: 'weekly', value: '09:00:7' })).toBe('0 9 * * 0');
  });
  it('weekly DOW 超界 → FrequencyError', () => {
    expect(() => toCronExpression({ type: 'weekly', value: '09:00:8' })).toThrow(/DOW/);
    expect(() => toCronExpression({ type: 'weekly', value: '09:00:0' })).toThrow(/DOW/);
  });
  it('weekly 缺欄位 → FrequencyError', () => {
    expect(() => toCronExpression({ type: 'weekly', value: '09:00' })).toThrow(FrequencyError);
  });

  it('monthly DOM=1 → "0 9 1 * *"', () => {
    expect(toCronExpression({ type: 'monthly', value: '09:00:1' })).toBe('0 9 1 * *');
  });
  it('monthly DOM 超界（29）→ FrequencyError', () => {
    expect(() => toCronExpression({ type: 'monthly', value: '09:00:29' })).toThrow(/DOM/);
  });

  it('cron 原樣回傳（不做格式檢查，交給 cron-parser）', () => {
    expect(toCronExpression({ type: 'cron', value: '*/5 * * * *' })).toBe('*/5 * * * *');
  });
});

describe('computeNextRunAt', () => {
  it('daily 09:00 + 當前 08:00 → 同一天 09:00', () => {
    const now = new Date('2026-05-30T00:00:00Z'); // 08:00 UTC+8
    const next = computeNextRunAt({ type: 'daily', value: '09:00' }, now);
    expect(next.toISOString()).toBe('2026-05-30T01:00:00.000Z'); // 09:00 UTC+8 = 01:00 UTC
  });
  it('daily 09:00 + 當前 10:00 → 隔天 09:00', () => {
    const now = new Date('2026-05-30T02:00:00Z'); // 10:00 UTC+8
    const next = computeNextRunAt({ type: 'daily', value: '09:00' }, now);
    expect(next.toISOString()).toBe('2026-05-31T01:00:00.000Z');
  });
  it('cron 每分鐘 → 不超過 1 分鐘', () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const next = computeNextRunAt({ type: 'cron', value: '* * * * *' }, now);
    const diff = next.getTime() - now.getTime();
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(60_000);
  });
  it('cron 字串非法 → FrequencyError(cron_invalid)', () => {
    expect(() => computeNextRunAt({ type: 'cron', value: 'not-a-cron' })).toThrow(FrequencyError);
    try {
      computeNextRunAt({ type: 'cron', value: 'not-a-cron' });
    } catch (e) {
      expect((e as FrequencyError).kind).toBe('cron_invalid');
    }
  });
});

describe('validateFrequency', () => {
  it('合法 → 回 cron expression', () => {
    expect(validateFrequency({ type: 'daily', value: '12:00' })).toBe('0 12 * * *');
  });
  it('不合法 → throw', () => {
    expect(() => validateFrequency({ type: 'daily', value: 'xx' })).toThrow(FrequencyError);
  });
});
