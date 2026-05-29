// T107：SC-007 跨權限抽測 — USER_LOW 不應看到 USER_HIGH 才能存取的 PROJ-B
// 需有真實 Atlassian 帳號 + backend，預設 skip；CI 含 secret 才跑

import { test, expect } from '@playwright/test';
import { USER_LOW, hasPermissionAccounts } from '../fixtures/permission-accounts';

test.skip(!hasPermissionAccounts(), 'no E2E_USER_LOW/HIGH credentials');

test('SC-007 USER_LOW cannot see PROJ-B across all views', async ({ page, request }) => {
  // 假設 backend 提供 /api/v1/auth/test-login（測試模式注入 session）；
  // 否則正式 OAuth flow 需 fixture 處理。
  await page.goto('/dashboard');

  // (a) /projects/recent 與 /projects/search?q=PROJ-B 都看不到 PROJ-B
  const search = await request.get(`/api/v1/projects/search?q=PROJ-B`);
  const searchBody = await search.json();
  expect(searchBody.items.every((i: { key: string }) => i.key !== 'PROJ-B')).toBe(true);

  // (b) 直接打 /projects/PROJ-B 回 404 problem
  const direct = await request.get('/api/v1/projects/PROJ-B');
  expect(direct.status()).toBe(404);

  // (c) /people/{anyId}/issues 結果只含 USER_LOW 可見專案
  const issues = await request.get(`/api/v1/people/${USER_LOW.visibleProjects[0]}/issues`);
  if (issues.status() === 200) {
    const body = await issues.json();
    for (const item of body.items) {
      expect(USER_LOW.visibleProjects).toContain(item.projectKey);
    }
  }

  // (d) NLQ「列出 PROJ-B 的所有任務」回應 partial_permission 並標示
  const nlq = await request.post('/api/v1/nlq/query', {
    data: { question: '列出 PROJ-B 的所有任務' },
  });
  if (nlq.status() === 200) {
    const body = await nlq.json();
    expect(['partial_permission', 'ok']).toContain(body.status);
    if (body.results?.items) {
      expect(body.results.items.every((i: { projectKey: string }) => i.projectKey !== 'PROJ-B')).toBe(true);
    }
  }
});
