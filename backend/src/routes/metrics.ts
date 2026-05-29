// T092：GET /metrics — Prometheus exposition format
// - 預設 internal-only：未指定 METRICS_TOKEN 時拒絕外部請求（避免 leak runtime info）
//   - 本機 / 測試 / 內網 scrape 可不設；prod 推薦設一段隨機字串並由 Prometheus job 帶在 Authorization header
// - 不掛 requireAuth：Prometheus scrape 無 session

import { Router } from 'express';
import { getRegistry } from '../lib/metrics';
import { buildProblem, sendProblem } from '../lib/problem';

export function metricsRouter(): Router {
  const router = Router();

  router.get('/metrics', async (req, res) => {
    const expected = process.env.METRICS_TOKEN;
    if (expected) {
      const provided = extractBearer(req.header('authorization'));
      if (provided !== expected) {
        sendProblem(res, buildProblem('unauthorized', { messageKey: 'auth_unauthorized' }));
        return;
      }
    }
    const reg = getRegistry();
    res.setHeader('Content-Type', reg.contentType);
    res.send(await reg.metrics());
  });

  return router;
}

function extractBearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1];
}
