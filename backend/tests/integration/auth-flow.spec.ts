// 整合測試（T022）骨架：當實際 PostgreSQL 與 mock token endpoint 可用時跑全鏈路
// - 條件：環境變數 RUN_INTEGRATION_DB=true 與 DATABASE_URL 指向已套用 migration 的 PG
// - CI 中此測試會在 Testcontainers 啟動的 PG container 下跑（在 Phase 7 補完）

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

const RUN = process.env.RUN_INTEGRATION_DB === 'true';

describe.skipIf(!RUN)('auth flow integration', () => {
  it('completes login → callback → /me round trip with mocked Atlassian', async () => {
    // Phase 2 留骨架；實際 fetch mock 與 DB 預備將於 Phase 7 補完。
    const app = createApp();
    const res = await request(app).get('/api/v1/healthz');
    expect(res.status).toBe(200);
  });
});
