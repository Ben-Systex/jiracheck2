// /auth routes：login / callback / logout
// 對應 OpenAPI Tag `auth` 與 spec FR-001 + Assumptions（OAuth 2.0 3LO）

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  loadOAuthConfig,
  type OAuthConfig,
} from '../services/auth/oauth';
import {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
} from '../services/auth/session';
import { getPool } from '../db/pool';
import { buildProblem, sendProblem } from '../lib/problem';
import { verifyCsrfToken } from '../middleware/csrf';

const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;

const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export function authRouter(configOverride?: OAuthConfig): Router {
  const router = Router();

  router.get('/login', (_req, res) => {
    try {
      const config = configOverride ?? loadOAuthConfig();
      const state = randomBytes(16).toString('base64url');
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: STATE_COOKIE_TTL_MS,
      });
      res.redirect(302, buildAuthorizeUrl(config, state));
    } catch (err) {
      sendProblem(
        res,
        buildProblem('internal', { messageKey: 'error_internal', detail: (err as Error).message }),
      );
    }
  });

  router.get('/callback', async (req, res) => {
    const parsed = callbackQuery.safeParse(req.query);
    if (!parsed.success) {
      sendProblem(res, buildProblem('validation', { messageKey: 'error_validation' }));
      return;
    }
    const expected = (req as { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE];
    if (!expected || expected !== parsed.data.state) {
      sendProblem(res, buildProblem('unauthorized', { messageKey: 'auth_oauth_state_mismatch' }));
      return;
    }
    try {
      await completeCallback(req, res, parsed.data.code, configOverride);
    } catch (err) {
      sendProblem(
        res,
        buildProblem('upstream', {
          messageKey: 'upstream_jira_unavailable',
          detail: (err as Error).message,
        }),
      );
    }
  });

  async function completeCallback(
    req: import('express').Request,
    res: import('express').Response,
    code: string,
    configOverrideInner: OAuthConfig | undefined,
  ): Promise<void> {
    const config = configOverrideInner ?? loadOAuthConfig();
    const oauth = await exchangeCodeForTokens(config, code, { pool: getPool() });
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM users WHERE atlassian_account_id = $1`,
      [oauth.userId],
    );
    const internalId = rows[0]?.id;
    if (!internalId) throw new Error('internal user not found after upsert');

    const ua = req.header('user-agent');
    const ip = req.ip;
    const session = await createSession(getPool(), internalId, {
      ...(ua ? { userAgent: ua } : {}),
      ...(ip ? { ip } : {}),
    });
    res.clearCookie(STATE_COOKIE);
    res.cookie(SESSION_COOKIE_NAME, session.sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: session.expiresAt,
    });
    res.redirect(302, process.env.FRONTEND_HOME ?? 'http://localhost:4200/');
  }

  router.post('/logout', verifyCsrfToken, async (req, res) => {
    const sid = (req as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];
    if (sid) {
      try {
        await destroySession(getPool(), sid);
      } catch {
        /* 吞掉：logout 不應因 DB 失敗而失敗，仍清 cookie */
      }
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(204).end();
  });

  return router;
}
