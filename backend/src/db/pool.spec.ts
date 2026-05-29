import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getPool, closePool, __setPoolForTesting } from './pool';

describe('db pool', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    __setPoolForTesting(undefined);
  });

  afterEach(async () => {
    __setPoolForTesting(undefined);
    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => getPool()).toThrowError(/DATABASE_URL/);
  });

  it('returns a singleton pool', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/testdb';
    const a = getPool();
    const b = getPool();
    expect(a).toBe(b);
    await closePool();
  });
});
