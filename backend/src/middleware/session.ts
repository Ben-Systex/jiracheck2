// session middleware：解析 sid cookie → 查 sessions 表 → 在 req.user 注入
// 對 /auth/* 路由不強制；其他路由若需保護，由 requireAuth() helper 套用

import type { RequestHandler } from 'express';
import { SESSION_COOKIE_NAME, touchSession } from '../services/auth/session';
import { getPool } from '../db/pool';
import { buildProblem, sendProblem } from '../lib/problem';

declare module 'express-serve-static-core' {
  interface Request {
    sessionUser?: {
      userId: string;
      sid: string;
    };
  }
}

export const sessionMiddleware: RequestHandler = async (req, _res, next) => {
  const sid = (req as { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE_NAME];
  if (!sid) {
    next();
    return;
  }
  try {
    const record = await touchSession(getPool(), sid);
    if (record) {
      req.sessionUser = { userId: record.userId, sid: record.sid };
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** 對需要登入的 route 套此 helper */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.sessionUser) {
    sendProblem(res, buildProblem('unauthorized', { messageKey: 'auth_unauthorized' }));
    return;
  }
  next();
};
