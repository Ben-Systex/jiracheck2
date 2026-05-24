import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('app bootstrap', () => {
  it('GET /api/v1/healthz returns ok', async () => {
    const res = await request(createApp()).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
