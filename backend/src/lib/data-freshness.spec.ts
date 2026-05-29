import { describe, it, expect } from 'vitest';
import { withFreshness, parseForceRefresh } from './data-freshness';

describe('data-freshness', () => {
  it('attaches live dataFreshness with current time', () => {
    const out = withFreshness({ items: [] }, { source: 'live' });
    expect(out.items).toEqual([]);
    expect(out.dataFreshness.source).toBe('live');
    expect(new Date(out.dataFreshness.fetchedAt).getTime()).toBeGreaterThan(0);
    expect(out.dataFreshness.cacheTtlSeconds).toBeUndefined();
  });

  it('attaches cache dataFreshness with ttl', () => {
    const fetchedAt = new Date('2026-05-22T12:00:00Z');
    const out = withFreshness({ ok: true }, { source: 'cache', fetchedAt, cacheTtlSeconds: 42 });
    expect(out.dataFreshness).toEqual({
      fetchedAt: '2026-05-22T12:00:00.000Z',
      source: 'cache',
      cacheTtlSeconds: 42,
    });
  });

  it('parses ?refresh=true variants correctly', () => {
    expect(parseForceRefresh('true')).toBe(true);
    expect(parseForceRefresh('1')).toBe(true);
    expect(parseForceRefresh('Yes')).toBe(true);
    expect(parseForceRefresh('false')).toBe(false);
    expect(parseForceRefresh(undefined)).toBe(false);
    expect(parseForceRefresh(0)).toBe(false);
  });
});
