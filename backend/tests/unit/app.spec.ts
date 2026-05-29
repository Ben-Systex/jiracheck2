import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('app bootstrap', () => {
  // 單元測試不需要 DB；skipSession 略過 session middleware（避免連 DB）
  const app = createApp({ skipSession: true });

  it('GET /api/v1/healthz returns ok', async () => {
    const res = await request(app).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('unknown path returns RFC 7807 problem with 404', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.cause).toBe('not_found');
  });

  it('exposes x-request-id header', async () => {
    const res = await request(app).get('/api/v1/healthz');
    expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/i);
  });

  it('echoes inbound x-request-id', async () => {
    const res = await request(app)
      .get('/api/v1/healthz')
      .set('x-request-id', '11111111-2222-3333-4444-555555555555');
    expect(res.headers['x-request-id']).toBe('11111111-2222-3333-4444-555555555555');
  });
});
