// T094：IP + user 雙維度 token bucket rate limit
// - 預設一般端點：60 req / 60s（per user / per IP）
// - 對 /nlq/query：6 req / 60s（LLM 較貴）
// - 對 /bulk/apply：4 req / 60s（寫入 + 影響範圍大）
// - 超量回 429 + RFC 7807

import type { RequestHandler } from 'express';
import { buildProblem, sendProblem } from '../lib/problem';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitOptions {
  /** 每分鐘允許的請求數（同時也是 bucket 容量） */
  perMinute: number;
  /** 注入時間（測試） */
  now?: () => number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const now = opts.now ?? Date.now;
  const capacity = opts.perMinute;
  const refillPerMs = capacity / WINDOW_MS;

  return (req, res, next) => {
    const key = buildKey(req);
    const t = now();
    const b = buckets.get(key) ?? { tokens: capacity, lastRefill: t };
    // 補回令牌
    const elapsed = t - b.lastRefill;
    if (elapsed > 0) {
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
      b.lastRefill = t;
    }
    if (b.tokens < 1) {
      buckets.set(key, b);
      res.setHeader('Retry-After', '60');
      sendProblem(res, buildProblem('rate_limited', { messageKey: 'error_rate_limited' }));
      return;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    next();
  };
}

function buildKey(req: {
  ip?: string | undefined;
  sessionUser?: { userId: string } | undefined;
  baseUrl?: string | undefined;
  path?: string | undefined;
}): string {
  const who = req.sessionUser?.userId ?? `ip:${req.ip ?? 'unknown'}`;
  const where = `${req.baseUrl ?? ''}${req.path ?? ''}`;
  return `${who}|${where}`;
}

/** 測試 / 清理用 */
export function __resetBucketsForTesting(): void {
  buckets.clear();
}
