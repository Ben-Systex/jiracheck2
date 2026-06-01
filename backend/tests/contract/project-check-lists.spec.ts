// T048：project-check-lists routes contract spec
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { projectCheckListsRouter } from '../../src/routes/project-check-lists';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import { setupPoolForAdminTests, teardownAdminPool } from '../helpers/schedules-app';
import type {
  ProjectCheckListEntry,
  ProjectCheckListsRepo,
} from '../../src/db/repositories/project-check-lists';

const ADMIN_ID = 'acc-admin';
const ADMIN_USER_ID = 'user-admin';
const NON_ADMIN_USER_ID = 'user-other';

function createInMemoryProjectCheckListsRepo(): ProjectCheckListsRepo {
  const items = new Map<string, ProjectCheckListEntry>();
  let nextId = 1;
  return {
    async list() {
      return [...items.values()];
    },
    async add(args) {
      const id = `pcl-${nextId++}`;
      const e: ProjectCheckListEntry = {
        id,
        projectKey: args.projectKey,
        addedBy: args.addedBy,
        addedAt: new Date('2026-06-01T00:00:00Z'),
        note: args.note ?? null,
      };
      items.set(id, e);
      return e;
    },
    async remove(id) {
      return items.delete(id);
    },
    async getByProjectKey(projectKey) {
      for (const e of items.values()) if (e.projectKey === projectKey) return e;
      return null;
    },
    async listProjectKeys() {
      return [...items.values()].map((e) => e.projectKey);
    },
  };
}

function buildApp(userId: string, repo: ProjectCheckListsRepo): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = { userId, sid: 'test-sid' };
    next();
  });
  app.use('/api/v1', projectCheckListsRouter({ repo }));
  app.use((_req, res) => sendProblem(res, buildProblem('not_found')));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendProblem(res, buildProblem('internal', { detail: String(err) }));
  });
  return app;
}

beforeEach(() => {
  process.env.ADMIN_ACCOUNT_IDS = ADMIN_ID;
  setupPoolForAdminTests(
    new Map([
      [ADMIN_USER_ID, ADMIN_ID],
      [NON_ADMIN_USER_ID, 'acc-other'],
    ]),
  );
});

afterEach(() => {
  delete process.env.ADMIN_ACCOUNT_IDS;
  teardownAdminPool();
});

describe('GET /project-check-lists', () => {
  it('admin → 200 + items[]', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    await repo.add({ projectKey: 'PRJ', addedBy: ADMIN_USER_ID });
    const res = await request(buildApp(ADMIN_USER_ID, repo)).get('/api/v1/project-check-lists');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].projectKey).toBe('PRJ');
  });

  it('非 admin → 403', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const res = await request(buildApp(NON_ADMIN_USER_ID, repo)).get('/api/v1/project-check-lists');
    expect(res.status).toBe(403);
  });
});

describe('POST /project-check-lists', () => {
  it('新增 → 201 + entry（含 note）', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo))
      .post('/api/v1/project-check-lists')
      .send({ projectKey: 'PRJ', note: 'why' });
    expect(res.status).toBe(201);
    expect(res.body.projectKey).toBe('PRJ');
    expect(res.body.note).toBe('why');
  });

  it('重複 projectKey → 409', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    await repo.add({ projectKey: 'PRJ', addedBy: ADMIN_USER_ID });
    const res = await request(buildApp(ADMIN_USER_ID, repo))
      .post('/api/v1/project-check-lists')
      .send({ projectKey: 'PRJ' });
    expect(res.status).toBe(409);
    expect(res.body.cause).toBe('conflict');
  });

  it('壞 projectKey → 400', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo))
      .post('/api/v1/project-check-lists')
      .send({ projectKey: 'invalid-lowercase' });
    expect(res.status).toBe(400);
  });

  it('非 admin → 403', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const res = await request(buildApp(NON_ADMIN_USER_ID, repo))
      .post('/api/v1/project-check-lists')
      .send({ projectKey: 'PRJ' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /project-check-lists/:id', () => {
  it('刪除 → 204', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const e = await repo.add({ projectKey: 'PRJ', addedBy: ADMIN_USER_ID });
    const res = await request(buildApp(ADMIN_USER_ID, repo)).delete(
      `/api/v1/project-check-lists/${e.id}`,
    );
    expect(res.status).toBe(204);
  });

  it('找不到 → 404', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo)).delete(
      '/api/v1/project-check-lists/missing',
    );
    expect(res.status).toBe(404);
  });

  it('非 admin → 403', async () => {
    const repo = createInMemoryProjectCheckListsRepo();
    const res = await request(buildApp(NON_ADMIN_USER_ID, repo)).delete(
      '/api/v1/project-check-lists/x',
    );
    expect(res.status).toBe(403);
  });
});
