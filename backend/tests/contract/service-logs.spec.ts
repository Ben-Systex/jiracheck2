// T037：service-logs routes contract spec
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { serviceLogsRouter } from '../../src/routes/service-logs';
import { sendProblem, buildProblem } from '../../src/lib/problem';
import {
  createInMemoryServiceLogsRepo,
  setupPoolForAdminTests,
  teardownAdminPool,
} from '../helpers/schedules-app';

const ADMIN_ID = 'acc-admin';
const ADMIN_USER_ID = 'user-admin';
const NON_ADMIN_USER_ID = 'user-other';

function buildApp(userId: string, repo: ReturnType<typeof createInMemoryServiceLogsRepo>): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = { userId, sid: 'test-sid' };
    next();
  });
  app.use('/api/v1', serviceLogsRouter({ repo }));
  app.use((_req, res) => sendProblem(res, buildProblem('not_found')));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendProblem(res, buildProblem('internal', { detail: String(err) }));
  });
  return app;
}

async function seedLogs(repo: ReturnType<typeof createInMemoryServiceLogsRepo>): Promise<void> {
  // 注意 helper 的 in-memory repo 之 list / streamForExport 並未實作；
  // 改在 spec 中以實際 service-logs.ts 為對象的測試，但我們此處走 contract（HTTP 形狀）
  // 透過 insertImmediate 注入幾筆讓 GET list 有東西
  for (let i = 0; i < 3; i++) {
    await repo.insertImmediate({
      serviceId: 'CHKPROJ',
      triggeredBy: 'manual',
      result: 'success',
      summary: `entry-${i}`,
    });
  }
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

describe('GET /service-logs', () => {
  it('非 admin → 403', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(NON_ADMIN_USER_ID, repo)).get('/api/v1/service-logs');
    expect(res.status).toBe(403);
    expect(res.body.cause).toBe('forbidden');
  });

  it('admin → 200 + items', async () => {
    const repo = createInMemoryServiceLogsRepo();
    await seedLogs(repo);
    const res = await request(buildApp(ADMIN_USER_ID, repo)).get('/api/v1/service-logs');
    // in-memory repo 的 list 預設回空（未真實實作）；驗 200 + 結構即可
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('壞 query (from 非 ISO) → 400', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo)).get(
      '/api/v1/service-logs?from=not-a-date',
    );
    expect(res.status).toBe(400);
  });

  it('合法 filter 全帶 → 200', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo)).get(
      '/api/v1/service-logs?serviceId=CHKPROJ&result=success&from=2026-04-01T00:00:00Z&to=2026-05-01T00:00:00Z&pageSize=10',
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /service-logs/:id', () => {
  it('admin + 找到 → 200', async () => {
    const repo = createInMemoryServiceLogsRepo();
    // helper repo 的 getById 一律回 null；用 detail-mode 假 repo
    const fakeRepo = {
      ...repo,
      async getById() {
        return {
          id: 'sl-1',
          scheduleId: null,
          serviceId: 'CHKPROJ' as const,
          triggeredBy: 'manual' as const,
          triggeredByUserId: ADMIN_USER_ID,
          startedAt: new Date('2026-05-29T00:00:00Z'),
          endedAt: new Date('2026-05-29T00:01:00Z'),
          result: 'success' as const,
          summary: 'detail',
          notes: { foo: 'bar' },
          ruleVersion: 'rule-v1',
        };
      },
    };
    const res = await request(buildApp(ADMIN_USER_ID, fakeRepo as unknown as ReturnType<typeof createInMemoryServiceLogsRepo>)).get(
      '/api/v1/service-logs/sl-1',
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('sl-1');
    expect(res.body.notes).toEqual({ foo: 'bar' });
    expect(res.body.ruleVersion).toBe('rule-v1');
  });

  it('找不到 → 404', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo)).get('/api/v1/service-logs/missing');
    expect(res.status).toBe(404);
    expect(res.body.cause).toBe('not_found');
  });

  it('非 admin → 403', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(NON_ADMIN_USER_ID, repo)).get('/api/v1/service-logs/x');
    expect(res.status).toBe(403);
  });
});

describe('GET /service-logs/export', () => {
  it('admin → 200 + text/csv + Content-Disposition', async () => {
    const repo = createInMemoryServiceLogsRepo();
    // helper repo 的 streamForExport 未實作；mock 一個簡單版回固定 row
    const fakeRepo = {
      ...repo,
      streamForExport(): AsyncIterable<Record<string, unknown>> {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              startedAt: '2026-05-29T00:00:00.000Z',
              endedAt: '2026-05-29T00:01:00.000Z',
              serviceId: 'CHKPROJ',
              triggeredBy: 'manual',
              result: 'success',
              summary: 'OK',
              notes: '',
            };
          },
        };
      },
    };
    const res = await request(buildApp(ADMIN_USER_ID, fakeRepo as unknown as ReturnType<typeof createInMemoryServiceLogsRepo>)).get(
      '/api/v1/service-logs/export',
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=service-logs-/);
    expect(res.text).toMatch(/startedAt,endedAt,serviceId/);
    expect(res.text).toMatch(/CHKPROJ/);
  });

  it('非 admin → 403', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(NON_ADMIN_USER_ID, repo)).get('/api/v1/service-logs/export');
    expect(res.status).toBe(403);
  });

  it('壞 query → 400', async () => {
    const repo = createInMemoryServiceLogsRepo();
    const res = await request(buildApp(ADMIN_USER_ID, repo)).get(
      '/api/v1/service-logs/export?from=not-a-date',
    );
    expect(res.status).toBe(400);
  });
});
