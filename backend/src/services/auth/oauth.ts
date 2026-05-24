// Atlassian OAuth 2.0 (3LO) 服務
// 流程：
//   1. /auth/login → 產生 state，重導 atlassian.com/oauth2/authorize
//   2. /auth/callback?code&state → exchangeCodeForTokens → upsert user + token
//   3. refreshAccessToken：使用儲存的 refresh_token 取新 access_token

import { z } from 'zod';
import { encryptToken, decryptToken } from './token-crypto';
import type { Pool } from 'pg';

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const USER_INFO_URL = 'https://api.atlassian.com/me';

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  token_type: z.string(),
});

const userInfoSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
});

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
}

export interface OAuthSession {
  accessToken: string;
  expiresAt: Date;
  userId: string;
  displayName: string;
  email: string | undefined;
}

export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const required = [
    'ATLASSIAN_OAUTH_CLIENT_ID',
    'ATLASSIAN_OAUTH_CLIENT_SECRET',
    'ATLASSIAN_OAUTH_REDIRECT_URI',
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`Missing env: ${missing.join(', ')}`);
  return {
    clientId: env.ATLASSIAN_OAUTH_CLIENT_ID!,
    clientSecret: env.ATLASSIAN_OAUTH_CLIENT_SECRET!,
    redirectUri: env.ATLASSIAN_OAUTH_REDIRECT_URI!,
    scopes: env.ATLASSIAN_OAUTH_SCOPES ?? 'read:jira-work read:jira-user write:jira-work offline_access',
  };
}

export function buildAuthorizeUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: config.clientId,
    scope: config.scopes,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** 注入 fetch 以便測試 mock */
export interface OAuthDeps {
  fetchFn?: typeof fetch;
  pool: Pool;
}

export async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  deps: OAuthDeps,
): Promise<OAuthSession> {
  const f = deps.fetchFn ?? fetch;
  const tokenRes = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Atlassian token endpoint returned ${tokenRes.status}`);
  }
  const tokenBody = tokenResponseSchema.parse(await tokenRes.json());

  const meRes = await f(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!meRes.ok) {
    throw new Error(`Atlassian /me returned ${meRes.status}`);
  }
  const me = userInfoSchema.parse(await meRes.json());

  const expiresAt = new Date(Date.now() + tokenBody.expires_in * 1000);

  // upsert user + token
  await persistUserAndToken({
    pool: deps.pool,
    accountId: me.account_id,
    displayName: me.name,
    email: me.email,
    refreshToken: tokenBody.refresh_token,
    scope: tokenBody.scope ?? config.scopes,
  });

  return {
    accessToken: tokenBody.access_token,
    expiresAt,
    userId: me.account_id, // 對外暫以 atlassian accountId 為 userId
    displayName: me.name,
    email: me.email,
  };
}

interface PersistArgs {
  pool: Pool;
  accountId: string;
  displayName: string;
  email: string | undefined;
  refreshToken: string | undefined;
  scope: string;
}

async function persistUserAndToken(args: PersistArgs): Promise<void> {
  const client = await args.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query<{ id: string }>(
      `INSERT INTO users (atlassian_account_id, display_name, email, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (atlassian_account_id)
       DO UPDATE SET display_name = EXCLUDED.display_name,
                     email = EXCLUDED.email,
                     updated_at = now()
       RETURNING id`,
      [args.accountId, args.displayName, args.email ?? null],
    );
    const userId = userRows[0]?.id;
    if (!userId) throw new Error('user upsert failed');

    if (args.refreshToken) {
      const enc = encryptToken(args.refreshToken);
      await client.query(
        `INSERT INTO user_tokens (user_id, encrypted_refresh_token, token_nonce, token_tag, scope, issued_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (user_id)
         DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                       token_nonce = EXCLUDED.token_nonce,
                       token_tag = EXCLUDED.token_tag,
                       scope = EXCLUDED.scope,
                       issued_at = EXCLUDED.issued_at,
                       updated_at = now()`,
        [userId, enc.ciphertext, enc.nonce, enc.tag, args.scope],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface RefreshResult {
  accessToken: string;
  expiresAt: Date;
}

/** 使用儲存的 refresh token 換新的 access token */
export async function refreshAccessToken(
  userId: string,
  config: OAuthConfig,
  deps: OAuthDeps,
): Promise<RefreshResult> {
  const f = deps.fetchFn ?? fetch;
  const { rows } = await deps.pool.query<{
    encrypted_refresh_token: Buffer;
    token_nonce: Buffer;
    token_tag: Buffer;
  }>(
    `SELECT encrypted_refresh_token, token_nonce, token_tag
     FROM user_tokens WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error('refresh token not found');
  const refreshToken = decryptToken({
    ciphertext: row.encrypted_refresh_token,
    nonce: row.token_nonce,
    tag: row.token_tag,
  });

  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Atlassian refresh endpoint returned ${res.status}`);
  }
  const body = tokenResponseSchema.parse(await res.json());

  // 若回傳新的 refresh_token，更新 DB
  if (body.refresh_token && body.refresh_token !== refreshToken) {
    const enc = encryptToken(body.refresh_token);
    await deps.pool.query(
      `UPDATE user_tokens
       SET encrypted_refresh_token = $2, token_nonce = $3, token_tag = $4, updated_at = now()
       WHERE user_id = $1`,
      [userId, enc.ciphertext, enc.nonce, enc.tag],
    );
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  };
}
