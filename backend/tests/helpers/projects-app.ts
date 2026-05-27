// 測試用 mini-app：手動裝 projectsRouter 並注入「假 sessionUser」與 mock repo
// 避開實際 DB / OAuth；用於契約測試與部分整合測試。

import express, { type Express } from 'express';
import { projectsRouter, type ProjectsDeps } from '../../src/routes/projects';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import type { RecentAccessRepo, RecentAccessRow } from '../../src/db/repositories/recent-access';
import { JiraLruCache } from '../../src/services/jira/cache';

export interface BuildOptions {
  userId?: string;
  acquireSession: ProjectsDeps['acquireSession'];
  recentRepo?: RecentAccessRepo;
}

export function buildProjectsApp(opts: BuildOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = { userId: opts.userId ?? 'user-1', sid: 'test-sid' };
    next();
  });
  // 每個 spec 用獨立 cache，避免互相污染
  const cache = new JiraLruCache();
  app.use(
    '/api/v1',
    projectsRouter({
      acquireSession: opts.acquireSession,
      cache,
      ...(opts.recentRepo ? { recentRepo: opts.recentRepo } : {}),
    }),
  );
  app.use((_req, res) => {
    sendProblem(res, buildProblem('not_found', { detail: '路由不存在' }));
  });
  // 統一錯誤處理（避免測試出現 unhandled）；_next 不可省，Express 以 arity=4 判定錯誤 middleware
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (typeof err === 'object' && err !== null && 'cause' in err) {
      sendProblem(res, err as ReturnType<typeof buildProblem>);
      return;
    }
    sendProblem(res, buildProblem('internal', { detail: String(err) }));
  });
  return app;
}

export function createInMemoryRecentRepo(seed: RecentAccessRow[] = []): RecentAccessRepo {
  const byUser = new Map<string, RecentAccessRow[]>();
  byUser.set('user-1', [...seed]);
  return {
    async upsertAccess(userId, projectKey) {
      const list = byUser.get(userId) ?? [];
      const idx = list.findIndex((r) => r.projectKey === projectKey);
      const now = new Date();
      if (idx >= 0) {
        list[idx] = {
          projectKey,
          lastAccessedAt: now,
          accessCount: list[idx]!.accessCount + 1,
        };
      } else {
        list.push({ projectKey, lastAccessedAt: now, accessCount: 1 });
      }
      list.sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime());
      byUser.set(userId, list);
    },
    async listRecent(userId, limit = 5) {
      const list = [...(byUser.get(userId) ?? [])];
      list.sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime());
      return list.slice(0, limit);
    },
    async pruneOver100() {
      return 0;
    },
  };
}
