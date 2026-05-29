// T091：oauth flow 單元測試——以 mock fetch + mock Pool 覆蓋 token / refresh 分支
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  loadOAuthConfig,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from './oauth';
import { generateKeyBase64 } from './token-crypto';

function mockClient(impl: (sql: string, params?: unknown[]) => Promise<unknown>): PoolClient {
  return {
    query: vi.fn(impl),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function mockPool(client?: PoolClient, queryImpl?: (sql: string, params?: unknown[]) => Promise<unknown>): Pool {
  return {
    connect: vi.fn(async () => client ?? mockClient(async () => ({ rows: [], rowCount: 0 }))),
    query: vi.fn(queryImpl ?? (async () => ({ rows: [], rowCount: 0 }))),
  } as unknown as Pool;
}

function jsonResponse(body: unknown, ok = true, status = 200): unknown {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

beforeEach(() => {
  process.env.TOKEN_ENC_KEY = generateKeyBase64();
});

describe('loadOAuthConfig', () => {
  it('讀取必要環境變數', () => {
    const cfg = loadOAuthConfig({
      ATLASSIAN_OAUTH_CLIENT_ID: 'cid',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'sec',
      ATLASSIAN_OAUTH_REDIRECT_URI: 'http://x/cb',
    } as NodeJS.ProcessEnv);
    expect(cfg.clientId).toBe('cid');
    expect(cfg.clientSecret).toBe('sec');
    expect(cfg.redirectUri).toBe('http://x/cb');
    expect(cfg.scopes).toContain('read:jira-work');
  });

  it('缺漏必要環境變數時擲 Error', () => {
    expect(() => loadOAuthConfig({} as NodeJS.ProcessEnv)).toThrow(/Missing env/);
  });

  it('可覆寫 scopes', () => {
    const cfg = loadOAuthConfig({
      ATLASSIAN_OAUTH_CLIENT_ID: 'a',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'b',
      ATLASSIAN_OAUTH_REDIRECT_URI: 'c',
      ATLASSIAN_OAUTH_SCOPES: 'custom',
    } as NodeJS.ProcessEnv);
    expect(cfg.scopes).toBe('custom');
  });
});

describe('buildAuthorizeUrl', () => {
  it('組出 atlassian authorize URL 含必要 query', () => {
    const url = buildAuthorizeUrl(
      { clientId: 'cid', clientSecret: 'sec', redirectUri: 'http://x/cb', scopes: 'read:jira-work' },
      'state-x',
    );
    expect(url).toMatch(/^https:\/\/auth\.atlassian\.com\/authorize\?/);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('state')).toBe('state-x');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe('http://x/cb');
  });
});

describe('exchangeCodeForTokens', () => {
  const config = {
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'http://x/cb',
    scopes: 'read:jira-work offline_access',
  };

  it('成功路徑：upsert user + token、回傳 OAuthSession', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/token')) {
        return jsonResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: config.scopes,
          token_type: 'Bearer',
        });
      }
      if (url.endsWith('/me')) {
        return jsonResponse({
          account_id: 'acc-1',
          name: 'Ben',
          email: 'ben@example.com',
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const client = mockClient(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? undefined });
      if (/INSERT INTO users/.test(sql)) {
        return { rows: [{ id: 'internal-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = mockPool(client);

    const sess = await exchangeCodeForTokens(config, 'code-x', {
      pool,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(sess.accessToken).toBe('access-1');
    expect(sess.userId).toBe('acc-1');
    expect(sess.displayName).toBe('Ben');
    expect(sess.email).toBe('ben@example.com');
    // 應 BEGIN / INSERT users / INSERT user_tokens / COMMIT
    expect(calls.map((c) => c.sql.trim().split(/\s+/)[0])).toEqual(
      expect.arrayContaining(['BEGIN', 'INSERT', 'COMMIT']),
    );
  });

  it('token endpoint 非 200 → throw', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 502));
    await expect(
      exchangeCodeForTokens(config, 'c', { pool: mockPool(), fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/token endpoint returned 502/);
  });

  it('/me endpoint 非 200 → throw + rollback', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/token'))
        return jsonResponse({ access_token: 'a', expires_in: 60, token_type: 'Bearer' });
      return jsonResponse({}, false, 403);
    });
    await expect(
      exchangeCodeForTokens(config, 'c', { pool: mockPool(), fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/me returned 403/);
  });

  it('users upsert 回傳空 → 觸發 ROLLBACK 並丟錯', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/token'))
        return jsonResponse({ access_token: 'a', expires_in: 60, token_type: 'Bearer' });
      return jsonResponse({ account_id: 'acc', name: 'B' });
    });
    const sqlSeen: string[] = [];
    const client = mockClient(async (sql: string) => {
      sqlSeen.push(sql);
      if (/INSERT INTO users/.test(sql)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    await expect(
      exchangeCodeForTokens(config, 'c', {
        pool: mockPool(client),
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/user upsert failed/);
    expect(sqlSeen).toContain('ROLLBACK');
  });
});

describe('refreshAccessToken', () => {
  const config = {
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'http://x/cb',
    scopes: 'offline_access',
  };

  it('找不到 refresh token → throw', async () => {
    const pool = mockPool(undefined, async () => ({ rows: [], rowCount: 0 }));
    await expect(
      refreshAccessToken('user-1', config, { pool, fetchFn: vi.fn() as unknown as typeof fetch }),
    ).rejects.toThrow(/refresh token not found/);
  });

  it('非 2xx → throw', async () => {
    // 寫入 dummy encrypted token，配合 token-crypto.decryptToken
    const { encryptToken } = await import('./token-crypto.js');
    const enc = encryptToken('actual-refresh');
    const pool = mockPool(undefined, async (sql: string) => {
      if (/SELECT[\s\S]*user_tokens/i.test(sql)) {
        return {
          rows: [
            {
              encrypted_refresh_token: enc.ciphertext,
              token_nonce: enc.nonce,
              token_tag: enc.tag,
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 502));
    await expect(
      refreshAccessToken('user-1', config, { pool, fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/refresh endpoint returned 502/);
  });

  it('正常路徑：回新 accessToken + 不寫回（若 refresh_token 未變）', async () => {
    const { encryptToken } = await import('./token-crypto.js');
    const enc = encryptToken('rtoken-stable');
    let updateCalls = 0;
    const pool = mockPool(undefined, async (sql: string) => {
      if (/SELECT[\s\S]*user_tokens/i.test(sql)) {
        return {
          rows: [
            {
              encrypted_refresh_token: enc.ciphertext,
              token_nonce: enc.nonce,
              token_tag: enc.tag,
            },
          ],
        };
      }
      if (/UPDATE user_tokens/i.test(sql)) {
        updateCalls += 1;
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'rtoken-stable', // 與舊一致 → 不更新
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );
    const res = await refreshAccessToken('user-1', config, {
      pool,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.accessToken).toBe('new-access');
    expect(updateCalls).toBe(0);
  });

  it('當回傳新的 refresh_token，UPDATE user_tokens 一次', async () => {
    const { encryptToken } = await import('./token-crypto.js');
    const enc = encryptToken('rtoken-old');
    let updateCalls = 0;
    const pool = mockPool(undefined, async (sql: string) => {
      if (/SELECT[\s\S]*user_tokens/i.test(sql)) {
        return {
          rows: [
            {
              encrypted_refresh_token: enc.ciphertext,
              token_nonce: enc.nonce,
              token_tag: enc.tag,
            },
          ],
        };
      }
      if (/UPDATE user_tokens/i.test(sql)) {
        updateCalls += 1;
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'rtoken-NEW',
        expires_in: 60,
        token_type: 'Bearer',
      }),
    );
    await refreshAccessToken('user-1', config, {
      pool,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(updateCalls).toBe(1);
  });
});
