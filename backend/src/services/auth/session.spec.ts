// T091：services/auth/session 單元測試——以假 Pool 物件覆蓋 SQL 呼叫分支
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  generateSid,
  createSession,
  touchSession,
  destroySession,
  pruneExpiredSessions,
} from './session';

function fakePool(queryImpl: (sql: string, params?: unknown[]) => Promise<unknown>): Pool {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

describe('generateSid', () => {
  it('produces 256-bit base64url string', () => {
    const sid = generateSid();
    // base64url 編 32 bytes → 43 chars（無 padding）
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('produces distinct values', () => {
    expect(generateSid()).not.toBe(generateSid());
  });
});

describe('createSession', () => {
  it('insert + returns SessionRecord with default 7d expiry', async () => {
    const captured: unknown[] = [];
    const pool = fakePool(async (_sql, params) => {
      captured.push(params);
      return { rows: [] };
    });
    const rec = await createSession(pool, 'user-1', { userAgent: 'jest', ip: '127.0.0.1' });
    expect(rec.userId).toBe('user-1');
    expect(rec.sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ttlMs = rec.expiresAt.getTime() - rec.createdAt.getTime();
    expect(ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
    // 確認 params 帶 userAgent / ip
    const args = captured[0] as unknown[];
    expect(args[4]).toBe('jest');
    expect(args[5]).toBe('127.0.0.1');
  });
  it('當 meta 未帶時，userAgent/ip 寫入 null', async () => {
    const captured: unknown[] = [];
    const pool = fakePool(async (_sql, params) => {
      captured.push(params);
      return { rows: [] };
    });
    await createSession(pool, 'user-2');
    const args = captured[0] as unknown[];
    expect(args[4]).toBeNull();
    expect(args[5]).toBeNull();
  });
});

describe('touchSession', () => {
  it('回傳 SessionRecord 當 row 存在', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date('2026-01-08T00:00:00Z');
    const pool = fakePool(async () => ({
      rows: [
        {
          sid: 'abc',
          user_id: 'u-1',
          created_at: now,
          expires_at: expiresAt,
          last_seen_at: now,
        },
      ],
    }));
    const rec = await touchSession(pool, 'abc');
    expect(rec).toBeDefined();
    expect(rec?.sid).toBe('abc');
    expect(rec?.userId).toBe('u-1');
    expect(rec?.expiresAt).toEqual(expiresAt);
  });
  it('當無 row（過期）回傳 undefined', async () => {
    const pool = fakePool(async () => ({ rows: [] }));
    expect(await touchSession(pool, 'missing')).toBeUndefined();
  });
});

describe('destroySession / pruneExpiredSessions', () => {
  it('destroySession 對 sid 執行 DELETE', async () => {
    const queryFn = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const pool = { query: queryFn } as unknown as Pool;
    await destroySession(pool, 'sid-x');
    expect(queryFn).toHaveBeenCalledTimes(1);
    const callArgs = queryFn.mock.calls[0] as unknown as [string, unknown[]];
    expect(callArgs[0]).toMatch(/DELETE FROM sessions/);
    expect(callArgs[1]).toEqual(['sid-x']);
  });
  it('pruneExpiredSessions 回傳 rowCount', async () => {
    const pool = fakePool(async () => ({ rows: [], rowCount: 7 }));
    expect(await pruneExpiredSessions(pool)).toBe(7);
  });
  it('pruneExpiredSessions rowCount null → 0', async () => {
    const pool = fakePool(async () => ({ rows: [], rowCount: null }));
    expect(await pruneExpiredSessions(pool)).toBe(0);
  });
});
