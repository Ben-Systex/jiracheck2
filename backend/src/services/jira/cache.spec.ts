import { describe, it, expect } from 'vitest';
import { JiraLruCache } from './cache';

describe('JiraLruCache', () => {
  it('caches loader result for TTL', async () => {
    let now = 1000;
    const cache = new JiraLruCache({ ttlMs: 100, now: () => now });
    let calls = 0;
    const load = async () => ({ n: ++calls });

    const a = await cache.getOrLoad({ userId: 'u1', tool: 't', args: { q: 1 } }, load);
    expect(a.source).toBe('live');
    expect((a.value as { n: number }).n).toBe(1);

    const b = await cache.getOrLoad({ userId: 'u1', tool: 't', args: { q: 1 } }, load);
    expect(b.source).toBe('cache');
    expect((b.value as { n: number }).n).toBe(1);
    expect(b.cacheTtlSeconds).toBeGreaterThanOrEqual(0);

    now += 200;
    const c = await cache.getOrLoad({ userId: 'u1', tool: 't', args: { q: 1 } }, load);
    expect(c.source).toBe('live');
    expect((c.value as { n: number }).n).toBe(2);
  });

  it('forceRefresh bypasses cache and refreshes value', async () => {
    const cache = new JiraLruCache({ ttlMs: 60_000 });
    let calls = 0;
    const load = async () => ++calls;
    await cache.getOrLoad({ userId: 'u', tool: 't', args: 1 }, load);
    const r = await cache.getOrLoad({ userId: 'u', tool: 't', args: 1 }, load, { forceRefresh: true });
    expect(r.source).toBe('live');
    expect(r.value).toBe(2);
  });

  it('key differs by userId / tool / args', async () => {
    const cache = new JiraLruCache({ ttlMs: 60_000 });
    const a = await cache.getOrLoad({ userId: 'A', tool: 't', args: 1 }, async () => 'A');
    const b = await cache.getOrLoad({ userId: 'B', tool: 't', args: 1 }, async () => 'B');
    expect(a.value).toBe('A');
    expect(b.value).toBe('B');
    expect(cache.size()).toBe(2);
  });

  it('LRU eviction at maxSize', async () => {
    const cache = new JiraLruCache({ ttlMs: 60_000, maxSize: 2 });
    await cache.getOrLoad({ userId: 'u', tool: 't', args: 1 }, async () => 1);
    await cache.getOrLoad({ userId: 'u', tool: 't', args: 2 }, async () => 2);
    await cache.getOrLoad({ userId: 'u', tool: 't', args: 3 }, async () => 3);
    expect(cache.size()).toBe(2);
  });
});
