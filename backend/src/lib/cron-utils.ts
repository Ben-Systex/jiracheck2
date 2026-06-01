// T009：cron / frequency 工具（feature 002-scheduled-services）
// - 將「每日 / 每週 / 每月 / cron」4 種 frequency 統一轉成 5 段 cron expression
// - 驗證 frequency 合法性（不合法 → throw FrequencyError，由 route 對映 problem）
// - 計算下次預定時間（next_run_at）
//
// 對應 [research R-006](../../specs/002-scheduled-services/research.md#r-006cron-字串驗證與時區fr-003--fr-008)：
//   時區固定 process.env.SERVER_TZ ?? 'Asia/Taipei'；以 UTC Date 回傳。

import { CronExpressionParser } from 'cron-parser';

export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'cron';

export interface FrequencyInput {
  type: FrequencyType;
  value: string;
}

export class FrequencyError extends Error {
  constructor(
    public readonly kind: 'frequency_invalid' | 'cron_invalid',
    detail: string,
  ) {
    super(detail);
    this.name = 'FrequencyError';
  }
}

/** 取目前的時區字串（預設 Asia/Taipei） */
export function getServerTz(env: NodeJS.ProcessEnv = process.env): string {
  return env.SERVER_TZ ?? 'Asia/Taipei';
}

/**
 * 將 frequency 轉成 5 段 cron expression（minute hour day-of-month month day-of-week）。
 *
 * - daily: `HH:MM` → `MM HH * * *`
 * - weekly: `HH:MM:DOW`（DOW 1-7，週一=1，週日=7）→ `MM HH * * DOW%7`（cron 週日=0）
 * - monthly: `HH:MM:DOM`（DOM 1-28）→ `MM HH DOM * *`
 * - cron: 原樣回傳（5 或 6 段皆可，由 cron-parser 驗）
 */
export function toCronExpression({ type, value }: FrequencyInput): string {
  switch (type) {
    case 'daily':
      return dailyToCron(value);
    case 'weekly':
      return weeklyToCron(value);
    case 'monthly':
      return monthlyToCron(value);
    case 'cron':
      return value;
  }
}

function dailyToCron(value: string): string {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!m) throw new FrequencyError('frequency_invalid', `daily 需 HH:MM，收到「${value}」`);
  const [, hh, mm] = m;
  assertTime(Number(hh), Number(mm), value);
  return `${Number(mm)} ${Number(hh)} * * *`;
}

function weeklyToCron(value: string): string {
  const m = /^(\d{1,2}):(\d{1,2}):(\d)$/.exec(value);
  if (!m) throw new FrequencyError('frequency_invalid', `weekly 需 HH:MM:DOW，收到「${value}」`);
  const [, hh, mm, dow] = m;
  assertTime(Number(hh), Number(mm), value);
  const dowNum = Number(dow);
  if (dowNum < 1 || dowNum > 7) {
    throw new FrequencyError('frequency_invalid', `weekly DOW 必須 1–7（週一=1，週日=7），收到「${dow}」`);
  }
  // 轉成 cron DOW（0=Sunday，1=Monday）：7 對應到 0
  const cronDow = dowNum === 7 ? 0 : dowNum;
  return `${Number(mm)} ${Number(hh)} * * ${cronDow}`;
}

function monthlyToCron(value: string): string {
  const m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!m) throw new FrequencyError('frequency_invalid', `monthly 需 HH:MM:DOM，收到「${value}」`);
  const [, hh, mm, dom] = m;
  assertTime(Number(hh), Number(mm), value);
  const domNum = Number(dom);
  if (domNum < 1 || domNum > 28) {
    throw new FrequencyError('frequency_invalid', `monthly DOM 必須 1–28，收到「${dom}」`);
  }
  return `${Number(mm)} ${Number(hh)} ${domNum} * *`;
}

function assertTime(hh: number, mm: number, rawValue: string): void {
  if (hh < 0 || hh > 23) {
    throw new FrequencyError('frequency_invalid', `小時 0–23 之間，收到「${rawValue}」`);
  }
  if (mm < 0 || mm > 59) {
    throw new FrequencyError('frequency_invalid', `分鐘 0–59 之間，收到「${rawValue}」`);
  }
}

/**
 * 驗證 frequency 並計算下次執行時間。不合法 → throw FrequencyError。
 *
 * @param input frequency 設定
 * @param now 注入 currentDate（測試用）；預設 new Date()
 * @returns 下次執行時間（UTC Date 物件）
 */
export function computeNextRunAt(input: FrequencyInput, now: Date = new Date()): Date {
  const expr = toCronExpression(input);
  try {
    const interval = CronExpressionParser.parse(expr, {
      tz: getServerTz(),
      currentDate: now,
    });
    return interval.next().toDate();
  } catch (err) {
    if (input.type === 'cron') {
      throw new FrequencyError('cron_invalid', (err as Error).message);
    }
    throw new FrequencyError('frequency_invalid', (err as Error).message);
  }
}

/** 純驗證：合法即回 cron expression；不合法 throw */
export function validateFrequency(input: FrequencyInput): string {
  const expr = toCronExpression(input); // 先抓格式錯
  try {
    CronExpressionParser.parse(expr, { tz: getServerTz() });
  } catch (err) {
    if (input.type === 'cron') throw new FrequencyError('cron_invalid', (err as Error).message);
    throw new FrequencyError('frequency_invalid', (err as Error).message);
  }
  return expr;
}
