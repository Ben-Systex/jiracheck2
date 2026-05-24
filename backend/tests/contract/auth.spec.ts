// 契約測試（T021）：驗證 /auth/* 與 /me 路徑的 HTTP 形狀符合 OpenAPI
// - /auth/login 應 302 並設置 oauth_state cookie
// - /auth/callback 對 missing code/state 應 400
// - /auth/callback 對 state 不符應 401（auth_oauth_state_mismatch）
// - /me 未登入應 401（auth_unauthorized）
// 這些路徑均不需實際打 Atlassian，故以 skipSession 與環境變數注入測試。

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { generateKeyBase64 } from '../../src/services/auth/token-crypto';

describe('auth contract', () => {
  beforeAll(() => {
    process.env.ATLASSIAN_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.ATLASSIAN_OAUTH_CLIENT_SECRET = 'test-client-secret';
    process.env.ATLASSIAN_OAUTH_REDIRECT_URI = 'http://localhost:8080/api/v1/auth/callback';
    process.env.TOKEN_ENC_KEY = generateKeyBase64();
  });

  it('GET /api/v1/auth/login redirects to Atlassian and sets oauth_state cookie', async () => {
    const app = createApp({ skipSession: true });
    const res = await request(app).get('/api/v1/auth/login');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/^https:\/\/auth\.atlassian\.com\/authorize\?/);
    const cookieHeader = res.headers['set-cookie'];
    const cookies = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]) as string[];
    const stateCookie = cookies.find((c) => c.startsWith('oauth_state='));
    expect(stateCookie).toBeDefined();
    expect(stateCookie).toMatch(/HttpOnly/i);
  });

  it('GET /api/v1/auth/callback returns 400 problem when query missing', async () => {
    const app = createApp({ skipSession: true });
    const res = await request(app).get('/api/v1/auth/callback');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.cause).toBe('validation');
  });

  it('GET /api/v1/auth/callback returns 401 problem when state mismatch', async () => {
    const app = createApp({ skipSession: true });
    const res = await request(app)
      .get('/api/v1/auth/callback')
      .query({ code: 'c', state: 'wrong' })
      .set('Cookie', 'oauth_state=expected');
    expect(res.status).toBe(401);
    expect(res.body.cause).toBe('unauthorized');
  });

  it('GET /api/v1/me without session returns 401 problem', async () => {
    const app = createApp({ skipSession: true });
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.cause).toBe('unauthorized');
  });
});
