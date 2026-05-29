// request-context middleware：每 request 產生一個 request-scoped logger 子實例
// 並附加到 res.locals，供下游 route / service 取用而不必傳參。

import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { getLogger } from '../lib/logger';

declare module 'express-serve-static-core' {
  interface Locals {
    requestId?: string;
    logger?: ReturnType<typeof getLogger>;
  }
}

export const requestContext: RequestHandler = (req, res, next) => {
  const requestId = (req.header('x-request-id') ?? randomUUID()) as string;
  const child = getLogger().child({ requestId, method: req.method, path: req.path });
  res.locals.requestId = requestId;
  res.locals.logger = child;
  res.setHeader('x-request-id', requestId);
  next();
};
