// T093：US1/US3 N+1 風險路徑的 LRU cache
// - key = userId + tool + args hash
// - TTL 60 秒（research R-008）
// - forceRefresh=true 繞過（呼叫端從 ?refresh=true 對應）
// - 對 ?refresh=true 的請求：read 跳過快取、write 仍寫入（refresh 後新值仍可被後續請求使用）

import { createHash } from 'node:crypto';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheOptions {
  ttlMs?: number;
  maxSize?: number;
  /** 注入時間（測試） */
  now?: () => number;
}

export interface LookupKey {
  userId: string;
  tool: string;
  args: unknown;
}

export class JiraLruCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly now: () => number;

  constructor(opts: CacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.maxSize = opts.maxSize ?? 500;
    this.now = opts.now ?? Date.now;
  }

  /**
   * 取得 cache value；若未命中或 forceRefresh，呼叫 loader 並寫入。
   * 回傳 { value, source: 'cache' | 'live', cacheTtlSeconds? }
   */
  async getOrLoad<T>(
    key: LookupKey,
    loader: () => Promise<T>,
    opts: { forceRefresh?: boolean } = {},
  ): Promise<CachedResult<T>> {
    const k = computeKey(key);
    const now = this.now();
    if (!opts.forceRefresh) {
      const hit = this.entries.get(k);
      if (hit && hit.expiresAt > now) {
        this.touch(k, hit);
        return {
          value: hit.value as T,
          source: 'cache',
          cacheTtlSeconds: Math.floor((hit.expiresAt - now) / 1000),
        };
      }
    }
    const value = await loader();
    this.set(k, { value, expiresAt: now + this.ttlMs });
    return { value, source: 'live' };
  }

  size(): number {
    return this.entries.size;
  }

  /** 測試 / debug 用：清空整個 cache */
  clear(): void {
    this.entries.clear();
  }

  private touch(k: string, entry: Entry<unknown>): void {
    // LRU：重新插入即移到 Map 尾端
    this.entries.delete(k);
    this.entries.set(k, entry);
  }

  private set(k: string, entry: Entry<unknown>): void {
    if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(k, entry);
  }
}

export interface CachedResult<T> {
  value: T;
  source: 'live' | 'cache';
  cacheTtlSeconds?: number;
}

function computeKey(key: LookupKey): string {
  const argsStr = stableStringify(key.args);
  const hash = createHash('sha1').update(argsStr).digest('hex').slice(0, 16);
  return `${key.userId}:${key.tool}:${hash}`;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// 全域單例（與其他 service 共用）
let globalCache: JiraLruCache | undefined;
export function getJiraCache(): JiraLruCache {
  globalCache ??= new JiraLruCache();
  return globalCache;
}

export function __resetJiraCacheForTesting(): void {
  globalCache = undefined;
}
