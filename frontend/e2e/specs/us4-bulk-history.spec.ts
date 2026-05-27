// T114：批次更新歷史 E2E（mock-only）

import { test, expect } from '@playwright/test';

const me = { accountId: 'acc-self', displayName: 'Me' };

const listResponse = {
  items: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      projectKey: 'PAY',
      targetField: 'assignee',
      totalCount: 3,
      successCount: 3,
      failureCount: 0,
      status: 'success',
      startedAt: '2026-05-25T12:00:00.000Z',
      completedAt: '2026-05-25T12:00:30.000Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      projectKey: 'BILL',
      targetField: 'label',
      totalCount: 5,
      successCount: 4,
      failureCount: 1,
      status: 'partial_failure',
      startedAt: '2026-05-26T10:00:00.000Z',
      completedAt: '2026-05-26T10:00:30.000Z',
    },
  ],
  nextCursor: null,
};

test('US4 bulk history page renders, filters by status', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));

  let lastRequest: URL | null = null;
  await page.route('**/api/v1/bulk/operations**', (r) => {
    lastRequest = new URL(r.request().url());
    return r.fulfill({ json: listResponse });
  });

  await page.goto('/bulk/history');
  await expect(page.getByRole('heading', { name: /批次更新歷史/ })).toBeVisible();
  await expect(page.getByText('PAY')).toBeVisible();
  await expect(page.getByText('BILL')).toBeVisible();
  await expect(page.getByText('success')).toBeVisible();
  await expect(page.getByText('partial_failure')).toBeVisible();

  await page.getByLabel('結果狀態（可選）').selectOption('success');
  await page.getByRole('button', { name: /套用篩選/ }).click();
  await expect.poll(() => lastRequest?.searchParams.get('status')).toBe('success');
});
