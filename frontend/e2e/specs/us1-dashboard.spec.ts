// T032：US1 dashboard 黃金路徑 E2E（mock-only）
// 透過 page.route 攔截 backend：authGuard 在 ensureLoaded 後拿到 /me；
// dashboard 取 /projects/recent；搜尋 /projects/search；點卡片觸發 /projects/{key}
// 含 axe-core 0 critical/serious 斷言

import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../lib/axe';

const me = { accountId: 'acc-1', displayName: 'Test User', email: 't@example.com' };
const recent = {
  items: [
    {
      key: 'PAY',
      name: 'Payments',
      openIssueCount: 5,
      sprintProgress: { completedSP: 3, totalSP: 8, sprintName: 'Sprint 8' },
      lastAccessedAt: new Date().toISOString(),
    },
    {
      key: 'BILL',
      name: 'Billing',
      openIssueCount: 2,
      sprintProgress: null,
    },
  ],
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};
const searchPay = {
  items: [{ key: 'PAY', name: 'Payments', openIssueCount: 0, sprintProgress: null }],
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

test('US1 dashboard golden path: search, open, no a11y critical', async ({ page }) => {
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: me }));
  await page.route('**/api/v1/projects/recent**', (route) => route.fulfill({ json: recent }));
  await page.route('**/api/v1/projects/search**', (route) => route.fulfill({ json: searchPay }));
  await page.route('**/api/v1/projects/PAY', (route) =>
    route.fulfill({
      json: {
        ...recent.items[0],
        topAssignees: [],
        dataFreshness: recent.dataFreshness,
      },
    }),
  );

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /專案儀表板/ })).toBeVisible();
  await expect(page.getByText('Payments')).toBeVisible();
  await expect(page.getByText('Billing')).toBeVisible();
  await expect(page.getByText('未完成 5')).toBeVisible();

  await expectNoA11yViolations(page, 'dashboard-initial');

  // 搜尋 "pay"（debounce 500ms）
  const searchInput = page.getByLabel('搜尋專案');
  await searchInput.fill('pay');
  await expect(page.getByText('Payments')).toBeVisible();
  // 搜尋結果只剩 PAY
  await expect(page.getByText('Billing')).toHaveCount(0);

  // 點卡片：應該觸發 /projects/PAY GET 並導航
  await page.getByRole('link', { name: /開啟專案 Payments/ }).click();
  await expect(page).toHaveURL(/\/projects\/PAY$/);
});
