// T006：require-admin middleware 單元測試
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import type { Request, Response, NextFunction } from 'express';
import { requireAdmin, isAdminByUserId, getAdminAccountIds } from './require-admin';
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

function fakeReq(userId?: string): Request {
  return {
    sessionUser: userId ? { userId, sid: 's' } : undefined,
  } as unknown as Request;
}

const ORIG_ADMIN_IDS = process.env.ADMIN_ACCOUNT_IDS;

beforeEach(() => {
  delete process.env.ADMIN_ACCOUNT_IDS;
});

afterEach(() => {
  __setPoolForTesting(undefined);
  if (ORIG_ADMIN_IDS !== undefined) process.env.ADMIN_ACCOUNT_IDS = ORIG_ADMIN_IDS;
  else delete process.env.ADMIN_ACCOUNT_IDS;
});

describe('getAdminAccountIds', () => {
  it('未設 env → 空 Set', () => {
    expect(getAdminAccountIds({} as NodeJS.ProcessEnv).size).toBe(0);
  });

  it('空字串 → 空 Set', () => {
    expect(getAdminAccountIds({ ADMIN_ACCOUNT_IDS: '' } as NodeJS.ProcessEnv).size).toBe(0);
  });

  it('單一 accountId', () => {
    const s = getAdminAccountIds({ ADMIN_ACCOUNT_IDS: 'acc-1' } as NodeJS.ProcessEnv);
    expect(s.has('acc-1')).toBe(true);
  });

  it('逗號分隔 + 去空白', () => {
    const s = getAdminAccountIds({ ADMIN_ACCOUNT_IDS: 'a , b,  c' } as NodeJS.ProcessEnv);
    expect(s.size).toBe(3);
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
    expect(s.has('c')).toBe(true);
  });
});

describe('isAdminByUserId', () => {
  it('env 未設 → 直接 false（不查 DB）', async () => {
    const queryFn = vi.fn();
    __setPoolForTesting({ query: queryFn } as unknown as Pool);
    expect(await isAdminByUserId('u-1')).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('白名單命中', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [{ atlassian_account_id: 'acc-admin' }] })),
    } as unknown as Pool);
    expect(await isAdminByUserId('u-1')).toBe(true);
  });

  it('使用者存在但非白名單', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [{ atlassian_account_id: 'acc-other' }] })),
    } as unknown as Pool);
    expect(await isAdminByUserId('u-1')).toBe(false);
  });

  it('使用者查無 → false', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Pool);
    expect(await isAdminByUserId('u-missing')).toBe(false);
  });
});

describe('requireAdmin middleware', () => {
  it('未登入 → 401', async () => {
    const next = vi.fn();
    const res = fakeRes();
    await requireAdmin(fakeReq(), res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('已登入但 env 未設 → 403', async () => {
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [{ atlassian_account_id: 'acc-1' }] })),
    } as unknown as Pool);
    const next = vi.fn();
    const res = fakeRes();
    await requireAdmin(fakeReq('u-1'), res, next as NextFunction);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('已登入 + admin → next()', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [{ atlassian_account_id: 'acc-admin' }] })),
    } as unknown as Pool);
    const next = vi.fn();
    await requireAdmin(fakeReq('u-1'), fakeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it('已登入但非 admin → 403', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    __setPoolForTesting({
      query: vi.fn(async () => ({ rows: [{ atlassian_account_id: 'acc-other' }] })),
    } as unknown as Pool);
    const next = vi.fn();
    const res = fakeRes();
    await requireAdmin(fakeReq('u-1'), res, next as NextFunction);
    expect(res.statusCode).toBe(403);
  });

  it('DB 拋錯 → next(err)', async () => {
    process.env.ADMIN_ACCOUNT_IDS = 'acc-admin';
    const err = new Error('db down');
    __setPoolForTesting({
      query: vi.fn(async () => {
        throw err;
      }),
    } as unknown as Pool);
    const next = vi.fn();
    await requireAdmin(fakeReq('u-1'), fakeRes(), next as NextFunction);
    expect(next).toHaveBeenCalledWith(err);
  });
});
