// T092：Prometheus metrics（憲法 IV「可觀測性」）
// - 對關鍵路徑暴露 延遲（histogram）/ 計數（counter）
// - http_request_duration_seconds：所有 HTTP 路由共用
// - jira_mcp_call_duration_seconds：對 mcp-atlassian 工具呼叫
// - nlq_query_duration_seconds：/nlq/query 端到端
// - bulk_operation_total：US4 批次更新最終狀態
//
// 註：使用 prom-client 預設 registry；server.ts 在 boot 時呼叫 collectDefaultMetrics
// 取得 Node runtime 指標（記憶體 / GC / event loop lag）。

import client, { type Histogram, type Counter, type Gauge, type Registry } from 'prom-client';
import type { RequestHandler } from 'express';

let initialized = false;

// ---- registry / default metrics -------------------------------------------

export function getRegistry(): Registry {
  return client.register;
}

/** 重複呼叫 idempotent；測試可重置 */
export function initMetrics(opts: { collectDefault?: boolean } = {}): void {
  if (initialized) return;
  initialized = true;
  if (opts.collectDefault ?? true) {
    client.collectDefaultMetrics({ prefix: 'jiracheck_' });
  }
}

export function __resetMetricsForTesting(): void {
  // 重置每個 metric 的計數但保留註冊狀態，避免 spec 跨 reset 後 inc/observe 找不到 metric
  httpRequestDuration.reset();
  httpRequestsTotal.reset();
  jiraMcpCallDuration.reset();
  nlqQueryDuration.reset();
  bulkOperationTotal.reset();
  authEventsTotal.reset();
  scheduledServiceTotal.reset();
  scheduledServiceDuration.reset();
  scheduledServiceActiveCount.reset();
  scheduleConfigsEnabledCount.reset();
  initialized = false;
}

// ---- application metrics --------------------------------------------------

export const httpRequestDuration: Histogram<string> = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 請求延遲（秒）',
  labelNames: ['method', 'route', 'status'],
  // p95 < 2s 為主目標（憲法 IV）；bucket 涵蓋 5ms - 30s
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 30],
});

export const httpRequestsTotal: Counter<string> = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP 請求總數',
  labelNames: ['method', 'route', 'status'],
});

export const jiraMcpCallDuration: Histogram<string> = new client.Histogram({
  name: 'jira_mcp_call_duration_seconds',
  help: 'mcp-atlassian 工具呼叫延遲（秒）',
  labelNames: ['tool', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

export const nlqQueryDuration: Histogram<string> = new client.Histogram({
  name: 'nlq_query_duration_seconds',
  help: '/nlq/query 端到端延遲（秒）',
  labelNames: ['status'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 3, 6, 10, 30],
});

export const bulkOperationTotal: Counter<string> = new client.Counter({
  name: 'bulk_operation_total',
  help: 'US4 批次更新作業總數（依最終狀態）',
  labelNames: ['status'],
});

export const authEventsTotal: Counter<string> = new client.Counter({
  name: 'auth_events_total',
  help: '認證事件總數',
  labelNames: ['event'], // login / callback_success / refresh / logout / state_mismatch
});

// ---- 002-scheduled-services metrics（research R-011）-----------------------

export const scheduledServiceTotal: Counter<string> = new client.Counter({
  name: 'scheduled_service_total',
  help: '定時服務執行總次數（依服務 ID 與結果）',
  labelNames: ['service_id', 'result'],
});

export const scheduledServiceDuration: Histogram<string> = new client.Histogram({
  name: 'scheduled_service_duration_seconds',
  help: '定時服務執行延遲（秒）',
  labelNames: ['service_id'],
  // 對應 SC-004 (5 min) / SC-005 (10 min) 上限
  buckets: [0.5, 1, 5, 10, 30, 60, 300, 600],
});

export const scheduledServiceActiveCount: Gauge<string> = new client.Gauge({
  name: 'scheduled_service_active_count',
  help: '目前正在執行的定時服務數量',
});

export const scheduleConfigsEnabledCount: Gauge<string> = new client.Gauge({
  name: 'schedule_configs_enabled_count',
  help: '啟用中的排程數量（CRUD 後更新）',
});

// ---- helpers --------------------------------------------------------------

/** 量測 async 函式延遲（秒）並紀錄到 histogram；ok→success/fail labels */
export async function observeDuration<T>(
  hist: Histogram<string>,
  labels: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const end = hist.startTimer(labels);
  try {
    const result = await fn();
    end({ status: labels['status'] ?? 'success' });
    return result;
  } catch (err) {
    end({ status: 'error' });
    throw err;
  }
}

// ---- http middleware ------------------------------------------------------

/** 對所有 HTTP 請求量 latency / count；route label 用 req.route.path 避免高基數 */
export const httpMetricsMiddleware: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationS = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status: String(res.statusCode),
    };
    httpRequestDuration.observe(labels, durationS);
    httpRequestsTotal.inc(labels, 1);
  });
  next();
};

function routeLabel(req: import('express').Request): string {
  // express 在 router 匹配後會把 route.path 設為帶 :id 的 pattern；未匹配時退到 path
  const matched = (req as { route?: { path?: string } }).route?.path;
  if (matched) {
    const base = (req.baseUrl ?? '').replace(/\/$/, '');
    return `${base}${matched}` || matched;
  }
  return req.path || 'unknown';
}
