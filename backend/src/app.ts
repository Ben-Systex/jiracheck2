// Express app bootstrap — Phase 2 後將補上中介層、route、MCP client 等
// 目前僅保留最小骨架，使 dev server 可啟動以驗證 toolchain。

import express, { type Express } from 'express';

export function createApp(): Express {
  const app = express();
  app.get('/api/v1/healthz', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 8080);
  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] listening on :${port}`);
  });
}
