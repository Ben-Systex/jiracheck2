// T005：管理者判定 middleware（feature 002-scheduled-services）
// - 來源：ADMIN_ACCOUNT_IDS env（逗號分隔 Atlassian accountId 白名單；research R-002）
// - 對應 spec FR-015、quickstart step 1
//
// 流程：
//   1. 必須在 sessionMiddleware 之後使用，req.sessionUser.userId 已存在
//   2. 從 DB 取 users.atlassian_account_id（依 userId）
//   3. 比對 env 白名單；不在 → 403 Problem with messageKey=auth_forbidden_admin_only
//
// 設計取向：
//   - 不在 sessionMiddleware 內預載 accountId（避免影響 001 既有 SessionUser 型別）
//   - 每次 admin 請求查 DB 一次；admin 請求頻率低（< 10 req/min），無 perf 風險

import type { RequestHandler } from 'express';
import { getPool } from '../db/pool';
import { buildProblem, sendProblem } from '../lib/problem';

/** 從環境變數解析白名單；空值或未設 → 空 Set（一律 deny） */
export function getAdminAccountIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.ADMIN_ACCOUNT_IDS ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** 純函式：依 userId 查 DB → 取得 accountId → 判定是否為 admin */
export async function isAdminByUserId(userId: string): Promise<boolean> {
  const admins = getAdminAccountIds();
  if (admins.size === 0) return false;
  const { rows } = await getPool().query<{ atlassian_account_id: string }>(
    `SELECT atlassian_account_id FROM users WHERE id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return false;
  return admins.has(row.atlassian_account_id);
}

/** Express middleware：需在 requireAuth 之後使用 */
export const requireAdmin: RequestHandler = async (req, res, next) => {
  if (!req.sessionUser) {
    sendProblem(res, buildProblem('unauthorized', { messageKey: 'auth_unauthorized' }));
    return;
  }
  try {
    const ok = await isAdminByUserId(req.sessionUser.userId);
    if (!ok) {
      sendProblem(res, buildProblem('forbidden', { messageKey: 'auth_forbidden_admin_only' }));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
};
