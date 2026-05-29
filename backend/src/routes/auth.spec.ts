// T091：/api/v1/auth routes 單元測試——/logout + 異常 callback 分支
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Pool } from 'pg';
import { authRouter } from './auth';
import { __setPoolForTesting } from '../db/pool';

afterEach(() => {
  __setPoolForTesting(undefined);
});

function buildApp(pool?: Pool, config?: Parameters<typeof authRouter>[0]): express.Express {
  const app = express();
  app.use(cookieParser());
  if (pool) __setPoolForTesting(pool);
  app.use('/api/v1/auth', authRouter(config));
  return app;
}

describe('POST /logout', () => {
  it('沒有 sid cookie 也回 204 + 清除 cookie', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(',') : setCookie ?? '';
    expect(cookieStr).toMatch(/sid=;/);
  });

  it('有 sid → 呼叫 DELETE FROM sessions', async () => {
    const queryFn = vi.fn(async () => ({ rows: [] }));
    const pool = { query: queryFn } as unknown as Pool;
    const res = await request(buildApp(pool)).post('/api/v1/auth/logout').set('Cookie', 'sid=abc');
    expect(res.status).toBe(204);
    expect(queryFn).toHaveBeenCalled();
  });

  it('DB throw 仍回 204（吞錯）', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as Pool;
    const res = await request(buildApp(pool)).post('/api/v1/auth/logout').set('Cookie', 'sid=abc');
    expect(res.status).toBe(204);
  });
});

describe('GET /login 失敗分支', () => {
  it('讀取 OAuth config 拋錯 → 500 problem', async () => {
    // 沒設定環境變數時 loadOAuthConfig 拋 Error
    const savedCid = process.env.ATLASSIAN_OAUTH_CLIENT_ID;
    delete process.env.ATLASSIAN_OAUTH_CLIENT_ID;
    try {
      const res = await request(buildApp()).get('/api/v1/auth/login');
      expect(res.status).toBe(500);
      expect(res.body.cause).toBe('internal');
    } finally {
      if (savedCid !== undefined) process.env.ATLASSIAN_OAUTH_CLIENT_ID = savedCid;
    }
  });
});
