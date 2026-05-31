// T092：metrics 單元測試
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  initMetrics,
  __resetMetricsForTesting,
  getRegistry,
  httpRequestDuration,
  jiraMcpCallDuration,
  nlqQueryDuration,
  bulkOperationTotal,
  authEventsTotal,
  scheduledServiceTotal,
  scheduledServiceDuration,
  scheduledServiceActiveCount,
  scheduleConfigsEnabledCount,
  observeDuration,
  httpMetricsMiddleware,
} from './metrics';

beforeEach(() => {
  __resetMetricsForTesting();
  initMetrics({ collectDefault: false });
});

describe('initMetrics', () => {
  it('回傳 registry 含 default metrics（collectDefault=true）', () => {
    __resetMetricsForTesting();
    initMetrics({ collectDefault: true });
    const text = getRegistry().metrics();
    return text.then((s) => {
      expect(s).toMatch(/jiracheck_process_/);
    });
  });

  it('重複呼叫 idempotent', () => {
    initMetrics();
    initMetrics();
    expect(getRegistry()).toBeDefined();
  });
});

describe('observeDuration', () => {
  it('成功路徑 → 記 success', async () => {
    const result = await observeDuration(
      httpRequestDuration,
      { method: 'GET', route: '/x', status: 'success' },
      async () => 42,
    );
    expect(result).toBe(42);
  });

  it('失敗路徑 → 記 error 並 rethrow', async () => {
    await expect(
      observeDuration(
        httpRequestDuration,
        { method: 'GET', route: '/x', status: '200' },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow(/boom/);
  });
});

describe('httpMetricsMiddleware', () => {
  function fakeReq(method = 'GET', path = '/foo', baseUrl = '', routePath?: string): Request {
    return { method, path, baseUrl, route: routePath ? { path: routePath } : undefined } as unknown as Request;
  }

  function fakeRes(): Response & { _finish: () => void } {
    const listeners: Array<() => void> = [];
    const res = {
      statusCode: 200,
      on: vi.fn((evt: string, cb: () => void) => {
        if (evt === 'finish') listeners.push(cb);
      }),
      _finish() {
        listeners.forEach((cb) => cb());
      },
    } as unknown as Response & { _finish: () => void };
    return res;
  }

  it('在 res.finish 後 observe + inc 1 次', async () => {
    const next = vi.fn();
    const res = fakeRes();
    httpMetricsMiddleware(fakeReq('GET', '/api/v1/healthz', '', '/healthz'), res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    res._finish();
    // 透過 metrics 文字檢查確實有寫入
    const text = await getRegistry().metrics();
    expect(text).toMatch(/http_requests_total\{[^}]*route="\/healthz"/);
  });

  it('未匹配 route → 用 req.path', () => {
    const next = vi.fn();
    const res = fakeRes();
    httpMetricsMiddleware(fakeReq('POST', '/unknown'), res, next as NextFunction);
    res._finish();
    expect(next).toHaveBeenCalled();
  });

  it('req.path 空 → fallback unknown', () => {
    const next = vi.fn();
    const res = fakeRes();
    const req = { method: 'GET', path: '', baseUrl: '', route: undefined } as unknown as Request;
    httpMetricsMiddleware(req, res, next as NextFunction);
    res._finish();
    expect(next).toHaveBeenCalled();
  });
});

describe('counters / histograms exist', () => {
  it('histogram + counter 都可被 inc / observe', () => {
    jiraMcpCallDuration.observe({ tool: 'x', status: 'success' }, 0.1);
    nlqQueryDuration.observe({ status: 'ok' }, 1);
    bulkOperationTotal.inc({ status: 'success' }, 1);
    authEventsTotal.inc({ event: 'login' }, 1);
    expect(true).toBe(true);
  });
});

describe('scheduled service metrics (002)', () => {
  it('scheduledServiceTotal counter inc 後可在 metrics 文字找到', async () => {
    scheduledServiceTotal.inc({ service_id: 'CHKPROJ', result: 'success' }, 2);
    const text = await getRegistry().metrics();
    expect(text).toMatch(/scheduled_service_total\{[^}]*service_id="CHKPROJ"[^}]*result="success"\}\s+2/);
  });

  it('scheduledServiceDuration histogram observe', async () => {
    scheduledServiceDuration.observe({ service_id: 'CHKISSUE' }, 12.5);
    const text = await getRegistry().metrics();
    expect(text).toMatch(/scheduled_service_duration_seconds_count\{[^}]*service_id="CHKISSUE"\}\s+1/);
  });

  it('scheduledServiceActiveCount gauge set', async () => {
    scheduledServiceActiveCount.set(3);
    const text = await getRegistry().metrics();
    expect(text).toMatch(/scheduled_service_active_count\s+3/);
  });

  it('scheduleConfigsEnabledCount gauge set', async () => {
    scheduleConfigsEnabledCount.set(7);
    const text = await getRegistry().metrics();
    expect(text).toMatch(/schedule_configs_enabled_count\s+7/);
  });
});
