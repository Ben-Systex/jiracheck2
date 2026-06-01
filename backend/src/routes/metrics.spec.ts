// T092：/metrics route 單元測試
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { metricsRouter } from './metrics';
import {
  __resetMetricsForTesting,
  initMetrics,
  httpRequestsTotal,
  scheduledServiceTotal,
} from '../lib/metrics';

function buildApp(): express.Express {
  const app = express();
  app.use('/api/v1', metricsRouter());
  return app;
}

beforeEach(() => {
  __resetMetricsForTesting();
  initMetrics({ collectDefault: false });
  delete process.env.METRICS_TOKEN;
});

afterEach(() => {
  delete process.env.METRICS_TOKEN;
  __resetMetricsForTesting();
});

describe('GET /metrics', () => {
  it('預設無 token → 公開可讀，回 Prometheus 文字', async () => {
    httpRequestsTotal.inc({ method: 'GET', route: '/x', status: '200' }, 3);
    const res = await request(buildApp()).get('/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/http_requests_total\{[^}]+\}\s+3/);
  });

  it('設定 METRICS_TOKEN → 無 Authorization → 401', async () => {
    process.env.METRICS_TOKEN = 'super-secret';
    const res = await request(buildApp()).get('/api/v1/metrics');
    expect(res.status).toBe(401);
    expect(res.body.cause).toBe('unauthorized');
  });

  it('設定 METRICS_TOKEN → Bearer 正確 → 200', async () => {
    process.env.METRICS_TOKEN = 'super-secret';
    const res = await request(buildApp())
      .get('/api/v1/metrics')
      .set('Authorization', 'Bearer super-secret');
    expect(res.status).toBe(200);
  });

  it('設定 METRICS_TOKEN → Bearer 不符 → 401', async () => {
    process.env.METRICS_TOKEN = 'super-secret';
    const res = await request(buildApp())
      .get('/api/v1/metrics')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('Authorization header 非 Bearer 格式 → 401', async () => {
    process.env.METRICS_TOKEN = 'super-secret';
    const res = await request(buildApp())
      .get('/api/v1/metrics')
      .set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('CHKPROJ + CHKISSUE 各 inc 後 endpoint 文字含對應 metric', async () => {
    scheduledServiceTotal.inc({ service_id: 'CHKPROJ', result: 'success' }, 2);
    scheduledServiceTotal.inc({ service_id: 'CHKISSUE', result: 'partial_failure' }, 1);
    const res = await request(buildApp()).get('/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/scheduled_service_total\{[^}]*service_id="CHKPROJ"[^}]*result="success"\}\s+2/);
    expect(res.text).toMatch(/scheduled_service_total\{[^}]*service_id="CHKISSUE"[^}]*result="partial_failure"\}\s+1/);
  });
});
