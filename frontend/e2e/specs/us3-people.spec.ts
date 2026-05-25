// T062：US3 人員工作狀況 E2E（mock-only）
// 黃金路徑：搜尋人員 → 選擇 → issues list + 統計查詢 → 跳到專案連結存在
// 涵蓋 spec acceptance #1–#4 + axe-core 0 critical/serious

import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../lib/axe';

const me = { accountId: 'acc-self', displayName: 'Me', email: 'me@ex.com' };
const peopleSearch = {
  items: [{ accountId: 'acc-1', displayName: 'Alice', email: 'alice@ex.com' }],
};
const issues = {
  items: [
    {
      key: 'PAY-1',
      summary: 'Refactor charge flow',
      status: 'In Progress',
      projectKey: 'PAY',
      assignee: null,
      priority: null,
      dueDate: '2026-06-01',
      storyPoints: 5,
      actualStoryPoints: null,
      sprint: null,
      labels: [],
    },
  ],
  nextCursor: null,
  partialPermission: false,
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};
const stats = {
  from: '2026-04-01',
  to: '2026-04-30',
  totals: { completedCount: 3, storyPointsSum: 10, actualStoryPointsSum: 12, estimateAccuracyRatio: 0.833 },
  byProject: [
    { projectKey: 'PAY', completedCount: 2, storyPointsSum: 8, actualStoryPointsSum: 10 },
    { projectKey: 'BILL', completedCount: 1, storyPointsSum: 2, actualStoryPointsSum: 2 },
  ],
  items: [issues.items[0]],
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};
const emptyStats = {
  from: '2026-01-01',
  to: '2026-01-02',
  totals: { completedCount: 0, storyPointsSum: 0, actualStoryPointsSum: 0, estimateAccuracyRatio: null },
  byProject: [],
  items: [],
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

test('US3 people golden path: search → select → issues → stats → expand 3 months', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/v1/people/search**', (r) => r.fulfill({ json: peopleSearch }));
  await page.route('**/api/v1/people/acc-1/issues**', (r) => r.fulfill({ json: issues }));

  // 第一次：空集合（觸發「擴大到三個月」CTA）；第二次：有資料
  let statsCallCount = 0;
  await page.route('**/api/v1/people/acc-1/stats**', (r) => {
    statsCallCount += 1;
    return r.fulfill({ json: statsCallCount === 1 ? emptyStats : stats });
  });

  await page.goto('/people');
  await expect(page.getByRole('heading', { name: /人員工作狀況/ })).toBeVisible();
  await expect(page.getByText('請先選擇成員')).toBeVisible();

  // 搜尋
  await page.getByLabel('搜尋人員').fill('al');
  await page.getByRole('button', { name: /Alice/ }).click();

  // Issues
  await expect(page.getByText('Refactor charge flow')).toBeVisible();
  await expect(page.getByRole('link', { name: /跳到專案 PAY/ })).toBeVisible();

  // 套用統計 → 第一次空集合
  await page.getByRole('button', { name: /送出查詢/ }).click();
  await expect(page.getByText('此期間無工作紀錄')).toBeVisible();

  // 點「擴大到三個月」→ 第二次有結果
  await page.getByRole('button', { name: /擴大到三個月/ }).click();
  await expect(page.getByText('完成任務數')).toBeVisible();
  await expect(page.getByText('0.833')).toBeVisible();

  await expectNoA11yViolations(page, 'people-page');
});
