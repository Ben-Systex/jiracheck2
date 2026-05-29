import { describe, it, expect, vi } from 'vitest';
import { McpSessionPool } from './session-pool';
import type { McpSession, McpSessionFactory } from './types';

function makeFactory(): {
  factory: McpSessionFactory;
  created: Array<{ userId: string; accessToken: string; closed: boolean }>;
} {
  const created: Array<{ userId: string; accessToken: string; closed: boolean }> = [];
  const factory: McpSessionFactory = {
    create: vi.fn(async (userId: string, accessToken: string) => {
      const rec = { userId, accessToken, closed: false };
      created.push(rec);
      const session: McpSession = {
        callTool: async <T = unknown>() => ({ content: { ok: true } as unknown as T }),
        close: async () => {
          rec.closed = true;
        },
      };
      return session;
    }),
  };
  return { factory, created };
}

describe('McpSessionPool', () => {
  it('reuses existing session for same user+token', async () => {
    const { factory, created } = makeFactory();
    const pool = new McpSessionPool({ factory, sweepIntervalMs: 0 });
    const a = await pool.acquire('u1', 'tok1');
    const b = await pool.acquire('u1', 'tok1');
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
    await pool.closeAll();
  });

  it('rebuilds session when access token changes', async () => {
    const { factory, created } = makeFactory();
    const pool = new McpSessionPool({ factory, sweepIntervalMs: 0 });
    await pool.acquire('u1', 'tok1');
    await pool.acquire('u1', 'tok2');
    expect(created).toHaveLength(2);
    expect(created[0]?.closed).toBe(true);
    await pool.closeAll();
  });

  it('evicts oldest when exceeding maxSize', async () => {
    const { factory, created } = makeFactory();
    let now = 1_000_000;
    const pool = new McpSessionPool({
      factory,
      maxSize: 2,
      sweepIntervalMs: 0,
      now: () => now,
    });
    await pool.acquire('u1', 'tok');
    now += 1;
    await pool.acquire('u2', 'tok');
    now += 1;
    await pool.acquire('u3', 'tok');
    // u1 應被 evict
    expect(created[0]?.closed).toBe(true);
    expect(pool.size()).toBe(2);
    await pool.closeAll();
  });

  it('idle sweep closes sessions past threshold', async () => {
    const { factory, created } = makeFactory();
    let now = 1_000_000;
    const pool = new McpSessionPool({
      factory,
      idleMs: 100,
      sweepIntervalMs: 0,
      now: () => now,
    });
    await pool.acquire('u1', 'tok');
    now += 200; // 過期
    await pool.sweep();
    expect(created[0]?.closed).toBe(true);
    expect(pool.size()).toBe(0);
  });

  it('closeAll closes every session', async () => {
    const { factory, created } = makeFactory();
    const pool = new McpSessionPool({ factory, sweepIntervalMs: 0 });
    await pool.acquire('u1', 'tok');
    await pool.acquire('u2', 'tok');
    await pool.closeAll();
    expect(created.every((c) => c.closed)).toBe(true);
    expect(pool.size()).toBe(0);
  });
});
