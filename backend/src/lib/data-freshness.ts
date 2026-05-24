// FR-003：所有對 Jira 取資料的 response 都應透過 withFreshness 包回
// dataFreshness 欄位（live / cache + cacheTtlSeconds），供前端 freshness-bar 呈現。

export type DataSource = 'live' | 'cache';

export interface DataFreshness {
  fetchedAt: string;
  source: DataSource;
  cacheTtlSeconds?: number;
}

export interface FreshnessOptions {
  fetchedAt?: Date;
  source: DataSource;
  cacheTtlSeconds?: number;
}

/**
 * 把 payload 與 dataFreshness 包成最終回應 envelope。
 * Caller 通常為 service / route，會把 `source = cache ? 'cache' : 'live'` 由
 * cache layer 標示後傳入此 helper。
 */
export function withFreshness<T extends Record<string, unknown>>(
  payload: T,
  opts: FreshnessOptions,
): T & { dataFreshness: DataFreshness } {
  const freshness: DataFreshness = {
    fetchedAt: (opts.fetchedAt ?? new Date()).toISOString(),
    source: opts.source,
    ...(opts.cacheTtlSeconds !== undefined ? { cacheTtlSeconds: opts.cacheTtlSeconds } : {}),
  };
  return { ...payload, dataFreshness: freshness };
}

/**
 * 由 query string `?refresh=true` 解析使用者是否要求繞過 cache。
 */
export function parseForceRefresh(q: unknown): boolean {
  if (typeof q !== 'string') return false;
  return q === 'true' || q === '1' || q.toLowerCase() === 'yes';
}
