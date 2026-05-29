// 測試用 mini-app：手動裝 peopleRouter + 假 sessionUser，避開實際 DB / OAuth
// 與 projects-app.ts 同模式

import express, { type Express } from 'express';
import { peopleRouter, type PeopleDeps } from '../../src/routes/people';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import { JiraLruCache } from '../../src/services/jira/cache';

export interface BuildOptions {
  userId?: string;
  acquireSession: PeopleDeps['acquireSession'];
}

export function buildPeopleApp(opts: BuildOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = { userId: opts.userId ?? 'user-1', sid: 'test-sid' };
    next();
  });
  const cache = new JiraLruCache();
  app.use('/api/v1', peopleRouter({ acquireSession: opts.acquireSession, cache }));
  app.use((_req, res) => {
    sendProblem(res, buildProblem('not_found', { detail: '路由不存在' }));
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (typeof err === 'object' && err !== null && 'cause' in err) {
      sendProblem(res, err as ReturnType<typeof buildProblem>);
      return;
    }
    sendProblem(res, buildProblem('internal', { detail: String(err) }));
  });
  return app;
}
