// T025：schedules routes contract spec
// 對應 OpenAPI /schedules 7 endpoints

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  buildSchedulesApp,
  setupPoolForAdminTests,
  teardownAdminPool,
} from '../helpers/schedules-app';

const ADMIN_ID = 'acc-admin';
const NON_ADMIN_ID = 'acc-user';
const ADMIN_USER_ID = 'user-admin';
const NON_ADMIN_USER_ID = 'user-other';

beforeEach(() => {
  process.env.ADMIN_ACCOUNT_IDS = ADMIN_ID;
  setupPoolForAdminTests(
    new Map([
      [ADMIN_USER_ID, ADMIN_ID],
      [NON_ADMIN_USER_ID, NON_ADMIN_ID],
    ]),
  );
});

afterEach(() => {
  delete process.env.ADMIN_ACCOUNT_IDS;
  teardownAdminPool();
});

describe('GET /schedules', () => {
  it('admin → 200 + items[]', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app).get('/api/v1/schedules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('非 admin → 403', async () => {
    const { app } = buildSchedulesApp({ userId: NON_ADMIN_USER_ID });
    const res = await request(app).get('/api/v1/schedules');
    expect(res.status).toBe(403);
    expect(res.body.cause).toBe('forbidden');
  });

  it('admin + enabled=true filter', async () => {
    const { app, repo } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    await repo.create({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: null,
      createdBy: ADMIN_USER_ID,
    });
    await repo.create({
      serviceId: 'CHKISSUE',
      frequencyType: 'daily',
      frequencyValue: '10:00',
      enabled: false,
      nextRunAt: null,
      createdBy: ADMIN_USER_ID,
    });
    const res = await request(app).get('/api/v1/schedules?enabled=true');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].serviceId).toBe('CHKPROJ');
  });
});

describe('POST /schedules', () => {
  it('合法 → 201 + 回新 schedule + nextRunAt 計算', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app)
      .post('/api/v1/schedules')
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'daily',
        frequencyValue: '09:00',
        enabled: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.serviceId).toBe('CHKPROJ');
    expect(res.body.nextRunAt).toBeTruthy();
  });

  it('壞 cron → 400 schedule_cron_invalid', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app)
      .post('/api/v1/schedules')
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'cron',
        frequencyValue: 'not-a-cron-expression',
        enabled: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.cause).toBe('validation');
  });

  it('壞 daily time → 400', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app)
      .post('/api/v1/schedules')
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'daily',
        frequencyValue: '25:00',
        enabled: true,
      });
    expect(res.status).toBe(400);
  });

  it('非 admin → 403', async () => {
    const { app } = buildSchedulesApp({ userId: NON_ADMIN_USER_ID });
    const res = await request(app)
      .post('/api/v1/schedules')
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'daily',
        frequencyValue: '09:00',
        enabled: true,
      });
    expect(res.status).toBe(403);
  });

  it('disabled → nextRunAt = null', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app)
      .post('/api/v1/schedules')
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'daily',
        frequencyValue: '09:00',
        enabled: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.nextRunAt).toBeNull();
  });
});

describe('GET /schedules/:id', () => {
  it('找到 → 200', async () => {
    const { app, repo } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const cfg = await repo.create({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: null,
      createdBy: ADMIN_USER_ID,
    });
    const res = await request(app).get(`/api/v1/schedules/${cfg.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(cfg.id);
  });

  it('找不到 → 404', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app).get('/api/v1/schedules/non-existent');
    expect(res.status).toBe(404);
    expect(res.body.cause).toBe('not_found');
  });
});

describe('PUT /schedules/:id', () => {
  it('更新 + 回新欄位 + updatedBy', async () => {
    const { app, repo } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const cfg = await repo.create({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: null,
      createdBy: ADMIN_USER_ID,
    });
    const res = await request(app)
      .put(`/api/v1/schedules/${cfg.id}`)
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'daily',
        frequencyValue: '11:00',
        enabled: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.frequencyValue).toBe('11:00');
    expect(res.body.updatedBy).toBe(ADMIN_USER_ID);
  });

  it('找不到 → 404', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app)
      .put('/api/v1/schedules/non-existent')
      .send({
        serviceId: 'CHKPROJ',
        frequencyType: 'daily',
        frequencyValue: '11:00',
        enabled: true,
      });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /schedules/:id', () => {
  it('刪除 → 204', async () => {
    const { app, repo } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const cfg = await repo.create({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: null,
      createdBy: ADMIN_USER_ID,
    });
    const res = await request(app).delete(`/api/v1/schedules/${cfg.id}`);
    expect(res.status).toBe(204);
    expect(await repo.getById(cfg.id)).toBeNull();
  });

  it('找不到 → 404', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app).delete('/api/v1/schedules/non-existent');
    expect(res.status).toBe(404);
  });
});

describe('POST /schedules/:id/trigger', () => {
  it('回 202 + serviceLogId', async () => {
    const { app, repo } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const cfg = await repo.create({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
      nextRunAt: null,
      createdBy: ADMIN_USER_ID,
    });
    const res = await request(app).post(`/api/v1/schedules/${cfg.id}/trigger`);
    expect(res.status).toBe(202);
    expect(res.body.serviceLogId).toBeDefined();
  });

  it('找不到 schedule → 404', async () => {
    const { app } = buildSchedulesApp({ userId: ADMIN_USER_ID });
    const res = await request(app).post('/api/v1/schedules/non-existent/trigger');
    expect(res.status).toBe(404);
  });
});
