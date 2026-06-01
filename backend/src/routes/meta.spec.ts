// T091 + T008：/api/v1/meta routes 單元測試（/healthz + /me + isAdmin 擴充）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';
import { metaRouter } from './meta';
import { __setPoolForTesting } from '../db/pool';

const ORIG_ADMIN_IDS = process.env.ADMIN_ACCOUNT_IDS;

beforeEach(() => {
  delete process.env.ADMIN_ACCOUNT_IDS;
});

afterEach(() => {
  __setPoolForTesting(undefined);
  if (ORIG_ADMIN_IDS !== undefined) process.env.ADMIN_ACCOUNT_IDS = ORIG_ADMIN_IDS;
  else delete process.env.ADMIN_ACCOUNT_IDS;
});

function buildApp(pool?: Pool, authed = false): express.Express {
  const app = express();
  app.use(cookieParser());
  if (pool) __setPoolForTesting(pool);
  if (authed) {
    app.use((req, _res, next) => {
      req.sessionUser = { userId: 'u-1', sid: 's-1' };
      next();
    });
  }
  app.use('/api/v1', metaRouter());
  return app;
}

describe('GET /healthz', () => {
  it('回傳 200 + ok:true + ISO 時間戳', async () => {
    const res = await request(buildApp()).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.ts).toBe('string');
  });
});

describe('GET /me', () => {
  it('未登入 → 401 problem', async () => {
    const res = await request(buildApp()).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.cause).toBe('unauthorized');
  });

  it('已登入但 DB 查不到 → 404 problem', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
    const res = await request(buildApp(pool, true)).get('/api/v1/me');
    expect(res.status).toBe(404);
    expect(res.body.cause).toBe('not_found');
  });

  it('已登入並查得 → 回 200 + accountId / displayName / email + isAdmin=false（env 未設）', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            atlassian_account_id: 'acc-x',
            display_name: 'Ben',
            email: 'ben@example.com',
          },
        ],
      })),
    } as unknown as Pool;
    const res = await request(buildApp(pool, true)).get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accountId: 'acc-x',
      displayName: 'Ben',
      email: 'ben@example.com',
      isAdmin: false,
    });
  });

  it('email 為 null 也回傳', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            atlassian_account_id: 'acc-y',
            display_name: 'NoMail',
            email: null,
          },
        ],
      })),
    } as unknown as Pool;
    const res = await request(buildApp(pool, true)).get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });

  it('admin 帳號 → isAdmin=true', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            atlassian_account_id: 'acc-admin',
            display_name: 'Admin',
            email: 'a@x',
          },
        ],
      })),
    } as unknown as Pool;
    const res = await request(buildApp(pool, true)).get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it('非 admin 帳號 → isAdmin=false', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            atlassian_account_id: 'acc-not-admin',
            display_name: 'User',
            email: 'u@x',
          },
        ],
      })),
    } as unknown as Pool;
    const res = await request(buildApp(pool, true)).get('/api/v1/me');
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(false);
  });
});
