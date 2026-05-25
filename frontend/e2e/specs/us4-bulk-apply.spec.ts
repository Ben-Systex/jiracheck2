// T078：US4 apply E2E — 預覽 → 確認對話框 → 套用 → polling 結果

import { test, expect } from '@playwright/test';

const me = { accountId: 'acc-self', displayName: 'Me' };
const previewResponse = {
  previewToken: 'tok.sig',
  totalCount: 2,
  items: [
    { issueKey: 'PAY-1', summary: 'a', currentValue: 'old', proposedValue: 'new', editableByUser: true },
    { issueKey: 'PAY-2', summary: 'b', currentValue: 'old', proposedValue: 'new', editableByUser: true },
  ],
};
const applyResponse = { operationId: '00000000-0000-0000-0000-000000000001' };
const opSuccess = {
  id: applyResponse.operationId,
  status: 'success',
  totalCount: 2,
  successCount: 2,
  failureCount: 0,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  items: [
    { issueKey: 'PAY-1', result: 'success', errorMessage: null, appliedAt: new Date().toISOString() },
    { issueKey: 'PAY-2', result: 'success', errorMessage: null, appliedAt: new Date().toISOString() },
  ],
};

test('US4 bulk apply golden path with confirm dialog', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/v1/bulk/preview', (r) => r.fulfill({ json: previewResponse }));
  await page.route('**/api/v1/bulk/apply', (r) => r.fulfill({ status: 202, json: applyResponse }));
  await page.route('**/api/v1/bulk/operations/**', (r) => r.fulfill({ json: opSuccess }));

  await page.goto('/bulk');
  await page.getByLabel('專案 Key').fill('PAY');
  await page.getByLabel('新值').fill('acc-new');
  await page.getByRole('button', { name: '預覽', exact: true }).click();
  await expect(page.getByText('預計影響筆數：2')).toBeVisible();

  await page.getByRole('button', { name: '套用', exact: true }).click();

  // Confirm dialog
  await expect(page.getByRole('dialog', { name: /請確認/ })).toBeVisible();
  await page.getByLabel('確認字串').fill('確認更新 2 筆');
  await page.getByRole('button', { name: '確認', exact: true }).click();

  // 結果頁
  await expect(page.getByRole('heading', { name: /套用完成/ })).toBeVisible();
  await expect(page.getByText('全部成功')).toBeVisible();
});
