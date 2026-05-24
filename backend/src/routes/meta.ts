// /me + /healthz：對應 OpenAPI Tag `meta`

import { Router } from 'express';
import { requireAuth } from '../middleware/session';
import { getPool } from '../db/pool';
import { buildProblem, sendProblem } from '../lib/problem';

export function metaRouter(): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  router.get('/me', requireAuth, async (req, res) => {
    const { rows } = await getPool().query<{
      atlassian_account_id: string;
      display_name: string;
      email: string | null;
    }>(
      `SELECT atlassian_account_id, display_name, email FROM users WHERE id = $1`,
      [req.sessionUser!.userId],
    );
    const row = rows[0];
    if (!row) {
      sendProblem(res, buildProblem('not_found'));
      return;
    }
    res.json({
      accountId: row.atlassian_account_id,
      displayName: row.display_name,
      email: row.email,
    });
  });

  return router;
}
