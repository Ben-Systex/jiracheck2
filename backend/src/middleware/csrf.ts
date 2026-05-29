// T095：CSRF double-submit cookie
// 概念：
//   - 同源 GET：servererver 在 res 設 `csrf` cookie（隨機 32-byte base64url）
//   - 任何狀態變更請求（POST/PUT/PATCH/DELETE）需在 header `X-CSRF-Token` 帶
//     與該 cookie 相同的值；不符即 403
//   - 因 cookie 只能由本站 JS 讀寫，跨站攻擊無法構造正確 header（同源策略）
//
// 套用範圍：/auth/logout、/bulk/preview、/bulk/apply
// 開發 / 測試 環境可以透過 BYPASS_CSRF=true 跳過（避免影響既有 supertest）

import type { Request, RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';
import { buildProblem, sendProblem } from '../lib/problem';

export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * issueCsrfToken：在 GET 路徑（如 /me、/projects/recent）將 csrf cookie 寫入。
 * 已存在則略過。
 */
export const issueCsrfToken: RequestHandler = (req, res, next) => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  if (!cookies[CSRF_COOKIE]) {
    const token = randomBytes(24).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
      sameSite: 'lax',
      maxAge: TOKEN_TTL_MS,
      // 注意：故意 NOT httpOnly — frontend 需 JS 讀取
      secure: process.env.NODE_ENV === 'production',
    });
  }
  next();
};

/**
 * verifyCsrfToken：對狀態變更 route 強制 header == cookie。
 * 測試環境設 BYPASS_CSRF=true 可跳過。
 */
export const verifyCsrfToken: RequestHandler = (req, res, next) => {
  if (process.env.BYPASS_CSRF === 'true') {
    next();
    return;
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.header(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    sendProblem(
      res,
      buildProblem('forbidden', { messageKey: 'auth_forbidden', detail: 'CSRF token 驗證失敗' }),
    );
    return;
  }
  next();
};
