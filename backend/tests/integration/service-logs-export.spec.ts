// T038：ServiceLogs CSV export 整合測試
// - 插入 5 筆假紀錄 → 觸發 export → 驗 CSV 行數、欄位順序、UTF-8 BOM

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
import type {
  ServiceLogsRepo,
  ServiceLogSummary,
  ServiceLogExportRow,
} from '../../src/db/repositories/service-logs';

const ADMIN_ID = 'acc-admin';
const ADMIN_USER_ID = 'user-admin';

function buildApp(repo: ServiceLogsRepo): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, _res, next) => {
    req.sessionUser = { userId: ADMIN_USER_ID, sid: 't' };
    next();
  });
  app.use('/api/v1', serviceLogsRouter({ repo }));
  app.use((_req, res) => sendProblem(res, buildProblem('not_found')));
  return app;
}

beforeEach(() => {
  process.env.ADMIN_ACCOUNT_IDS = ADMIN_ID;
  setupPoolForAdminTests(new Map([[ADMIN_USER_ID, ADMIN_ID]]));
});

afterEach(() => {
  delete process.env.ADMIN_ACCOUNT_IDS;
  teardownAdminPool();
});

/** 包 in-memory repo，額外實作 streamForExport 走 list 結果 */
function repoWithFakeList(summaries: ServiceLogSummary[]): ServiceLogsRepo {
  const base = createInMemoryServiceLogsRepo();
  return {
    ...base,
    async list() {
      return { items: summaries, nextCursor: null };
    },
    streamForExport(): AsyncIterable<ServiceLogExportRow> {
      return {
        async *[Symbol.asyncIterator]() {
          for (const it of summaries) {
            yield {
              startedAt: it.startedAt.toISOString(),
              endedAt: it.endedAt?.toISOString() ?? '',
              serviceId: it.serviceId,
              triggeredBy: it.triggeredBy,
              result: it.result,
              summary: it.summary,
              notes: '',
            };
          }
        },
      };
    },
  };
}

function mkSummary(id: string, summary: string): ServiceLogSummary {
  return {
    id,
    scheduleId: null,
    serviceId: 'CHKPROJ',
    triggeredBy: 'manual',
    startedAt: new Date(`2026-05-29T0${id}:00:00Z`),
    endedAt: new Date(`2026-05-29T0${id}:01:00Z`),
    result: 'success',
    summary,
    ruleVersion: null,
  };
}

describe('GET /service-logs/export', () => {
  it('5 筆 → CSV 含 header + 5 data rows', async () => {
    const summaries = ['1', '2', '3', '4', '5'].map((i) => mkSummary(i, `entry-${i}`));
    const repo = repoWithFakeList(summaries);
    const res = await request(buildApp(repo)).get('/api/v1/service-logs/export');
    expect(res.status).toBe(200);
    const lines = res.text.split('\n').filter((l) => l.trim());
    // 1 header + 5 data = 6
    expect(lines.length).toBe(6);
    expect(lines[0]).toMatch(/^.?startedAt,endedAt,serviceId,triggeredBy,result,summary,notes/);
  });

  it('UTF-8 BOM 在開頭', async () => {
    const summaries = [mkSummary('1', '中文摘要')];
    const repo = repoWithFakeList(summaries);
    const res = await request(buildApp(repo)).get('/api/v1/service-logs/export');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('中文摘要');
  });

  it('Content-Disposition 含 timestamp filename', async () => {
    const repo = repoWithFakeList([]);
    const res = await request(buildApp(repo)).get('/api/v1/service-logs/export');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=service-logs-.*\.csv/);
  });
});
