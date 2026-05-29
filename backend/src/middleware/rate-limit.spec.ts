import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimit, __resetBucketsForTesting } from './rate-limit';

describe('rate-limit middleware', () => {
  beforeEach(() => __resetBucketsForTesting());

  it('allows up to capacity and rejects the (n+1)-th with 429 problem', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as { sessionUser?: unknown }).sessionUser = { userId: 'u1', sid: 's' };
      next();
    });
    app.use(rateLimit({ perMinute: 3 }));
    app.get('/x', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const r = await request(app).get('/x');
      expect(r.status).toBe(200);
    }
    const r4 = await request(app).get('/x');
    expect(r4.status).toBe(429);
    expect(r4.body.cause).toBe('rate_limited');
    expect(r4.headers['retry-after']).toBe('60');
  });

  it('different users have separate buckets', async () => {
    const app = express();
    let uid = 'u1';
    app.use((req, _res, next) => {
      (req as { sessionUser?: unknown }).sessionUser = { userId: uid, sid: 's' };
      next();
    });
    app.use(rateLimit({ perMinute: 1 }));
    app.get('/x', (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(429);
    uid = 'u2';
    expect((await request(app).get('/x')).status).toBe(200);
  });
});
