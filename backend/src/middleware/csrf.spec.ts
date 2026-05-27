import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { issueCsrfToken, verifyCsrfToken, CSRF_COOKIE } from './csrf';

describe('csrf middleware', () => {
  const ORIGINAL_BYPASS = process.env.BYPASS_CSRF;
  beforeAll(() => {
    // 暫時關閉 vitest.config.ts 預設開啟的 bypass，才能實際驗證 csrf 行為
    delete process.env.BYPASS_CSRF;
  });
  afterAll(() => {
    if (ORIGINAL_BYPASS !== undefined) process.env.BYPASS_CSRF = ORIGINAL_BYPASS;
  });
  it('issueCsrfToken sets cookie when missing', async () => {
    const app = express();
    app.use(cookieParser());
    app.get('/me', issueCsrfToken, (_req, res) => res.json({ ok: true }));
    const r = await request(app).get('/me');
    expect(r.status).toBe(200);
    const cookies = (Array.isArray(r.headers['set-cookie']) ? r.headers['set-cookie'] : [r.headers['set-cookie']]) as string[];
    expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE}=`))).toBe(true);
  });

  it('verifyCsrfToken rejects 403 when header missing', async () => {
    const app = express();
    app.use(cookieParser());
    app.post('/x', verifyCsrfToken, (_req, res) => res.json({ ok: true }));
    const r = await request(app).post('/x').set('Cookie', 'csrf=abc');
    expect(r.status).toBe(403);
    expect(r.body.cause).toBe('forbidden');
  });

  it('verifyCsrfToken accepts when header matches cookie', async () => {
    const app = express();
    app.use(cookieParser());
    app.post('/x', verifyCsrfToken, (_req, res) => res.json({ ok: true }));
    const r = await request(app).post('/x').set('Cookie', 'csrf=abc').set('x-csrf-token', 'abc');
    expect(r.status).toBe(200);
  });

  it('verifyCsrfToken bypasses when BYPASS_CSRF=true', async () => {
    process.env.BYPASS_CSRF = 'true';
    const app = express();
    app.use(cookieParser());
    app.post('/x', verifyCsrfToken, (_req, res) => res.json({ ok: true }));
    const r = await request(app).post('/x');
    expect(r.status).toBe(200);
    delete process.env.BYPASS_CSRF;
  });
});
