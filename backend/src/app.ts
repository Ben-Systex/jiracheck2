// Express app bootstrap：Phase 2 起加入中介層、logger、problem 處理
// 注意：本檔不再直接 listen；listen 由 src/server.ts 或測試環境負責。

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import { getLogger } from './lib/logger';
import { requestContext } from './middleware/request-context';
import { sessionMiddleware } from './middleware/session';
import { issueCsrfToken } from './middleware/csrf';
import { authRouter } from './routes/auth';
import { metaRouter } from './routes/meta';
import { projectsRouter, type ProjectsDeps } from './routes/projects';
import { peopleRouter, type PeopleDeps } from './routes/people';
import { bulkRouter, type BulkDeps } from './routes/bulk';
import { nlqRouter, type NlqDeps } from './routes/nlq';
import { buildProblem, sendProblem, type ProblemDetails } from './lib/problem';

export interface AppOptions {
  /** 跳過需要 DB 的 middleware（session）— 用於不需要 DB 的單元測試 */
  skipSession?: boolean;
  /** 注入 US1 projects route 之依賴；不提供時，需以另外的 router 工廠手動掛 */
  projectsDeps?: ProjectsDeps;
  /** 注入 US3 people route 之依賴 */
  peopleDeps?: PeopleDeps;
  /** 注入 US4 bulk route 之依賴 */
  bulkDeps?: BulkDeps;
  /** 注入 US2 nlq route 之依賴（含 LLM 客戶端） */
  nlqDeps?: NlqDeps;
}

export function createApp(opts: AppOptions = {}): Express {
  const app = express();
  const logger = getLogger();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '256kb' }));
  app.use(requestContext);
  app.use(pinoHttp({ logger, customLogLevel: customLogLevel }));

  if (!opts.skipSession) app.use(sessionMiddleware);
  app.use(issueCsrfToken);

  app.use('/api/v1/auth', authRouter());
  app.use('/api/v1', metaRouter());
  if (opts.projectsDeps) {
    app.use('/api/v1', projectsRouter(opts.projectsDeps));
  }
  if (opts.peopleDeps) {
    app.use('/api/v1', peopleRouter(opts.peopleDeps));
  }
  if (opts.bulkDeps) {
    app.use('/api/v1', bulkRouter(opts.bulkDeps));
  }
  if (opts.nlqDeps) {
    app.use('/api/v1', nlqRouter(opts.nlqDeps));
  }

  // 404 fallback
  app.use((_req, res) => {
    sendProblem(res, buildProblem('not_found', { detail: '路由不存在' }));
  });

  // 統一錯誤處理 — 對 Problem 直接送出；其餘包成 internal
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const log = res.locals.logger ?? logger;
    if (isProblem(err)) {
      log.warn({ problem: err }, 'application error');
      sendProblem(res, err);
      return;
    }
    log.error({ err }, 'unexpected error');
    sendProblem(res, buildProblem('internal', { messageKey: 'error_internal' }));
  });

  return app;
}

function isProblem(x: unknown): x is ProblemDetails {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in x &&
    'title' in x &&
    'status' in x &&
    'cause' in x
  );
}

function customLogLevel(_req: Request, res: Response, err?: Error): 'info' | 'warn' | 'error' {
  if (err) return 'error';
  if (res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}
