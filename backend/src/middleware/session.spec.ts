// T091：session middleware 單元測試——以注入式 Pool 覆蓋 cookies 解析 / 找不到 / 錯誤分支
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { sessionMiddleware, requireAuth } from './session';
import { __setPoolForTesting } from '../db/pool';

function fakeRes(): Response {
  const res: Partial<Response> & { statusCode: number } = { statusCode: 0 };
  res.setHeader = vi.fn().mockReturnValue(res as unknown as Response);
  res.end = vi.fn().mockReturnValue(res as unknown as Response);
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as unknown as Response;
  }) as unknown as Response['status'];
  res.json = vi.fn().mockReturnValue(res as unknown as Response);
  return res as unknown as Response;
}

function fakeReq(cookies: Record<string, string> = {}, sessionUser?: unknown): Request {
  return { cookies, sessionUser } as unknown as Request;
}

afterEach(() => {
  __setPoolForTesting(undefined);
});

describe('sessionMiddleware', () => {
  beforeEach(() => {
    __setPoolForTesting(undefined);
  });

  it('沒有 sid cookie → 直接 next()', async () => {
    const next = vi.fn();
    await sessionMiddleware(fakeReq(), fakeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it('有 sid → query DB 並注入 req.sessionUser', async () => {
    __setPoolForTesting({
      query: vi.fn(async () => ({
        rows: [
          {
            sid: 'sid-1',
            user_id: 'user-1',
            created_at: new Date(),
            expires_at: new Date(Date.now() + 86400000),
            last_seen_at: new Date(),
          },
        ],
      })),
    } as unknown as Pool);

    const req = fakeReq({ sid: 'sid-1' });
    const next = vi.fn();
    await sessionMiddleware(req, fakeRes(), next as NextFunction);
    expect(req.sessionUser).toEqual({ userId: 'user-1', sid: 'sid-1' });
    expect(next).toHaveBeenCalledWith();
  });

  it('sid 不存在於 DB → next 但不注入 sessionUser', async () => {
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Pool);
    const req = fakeReq({ sid: 'expired' });
    const next = vi.fn();
    await sessionMiddleware(req, fakeRes(), next as NextFunction);
    expect(req.sessionUser).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('DB 拋錯 → next(err)', async () => {
    const err = new Error('db down');
    __setPoolForTesting({
      query: vi.fn(async () => {
        throw err;
      }),
    } as unknown as Pool);
    const next = vi.fn();
    await sessionMiddleware(fakeReq({ sid: 'sid-1' }), fakeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('requireAuth', () => {
  it('未登入 → 401 Problem', () => {
    const next = vi.fn();
    const res = fakeRes();
    requireAuth(fakeReq(), res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('已登入 → next()', () => {
    const next = vi.fn();
    requireAuth(fakeReq({}, { userId: 'u-1', sid: 's' }), fakeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });
});
