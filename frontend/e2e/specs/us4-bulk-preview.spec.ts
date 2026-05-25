// T077：US4 preview-only E2E（mock-only）+ axe + keyboard

import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../lib/axe';

const me = { accountId: 'acc-self', displayName: 'Me' };
const previewResponse = {
  previewToken: 'tok.sig',
  totalCount: 2,
  items: [
    {
      issueKey: 'PAY-1',
      summary: 'Refactor charge',
      currentValue: { accountId: 'acc-old', displayName: 'Old' },
      proposedValue: 'acc-new',
      editableByUser: true,
    },
    {
      issueKey: 'PAY-2',
      summary: 'Add unit test',
      currentValue: null,
      proposedValue: 'acc-new',
      editableByUser: false,
    },
  ],
};

test('US4 bulk preview golden path (preview-only)', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/v1/bulk/preview', (r) => r.fulfill({ json: previewResponse }));

  await page.goto('/bulk');
  await expect(page.getByRole('heading', { name: /整批更新 issue/ })).toBeVisible();

  await page.getByLabel('專案 Key').fill('PAY');
  await page.getByLabel('狀態').fill('To Do');
  await page.getByLabel('新值').fill('acc-new');
  await page.getByRole('button', { name: '預覽', exact: true }).click();

  // 預覽表
  await expect(page.getByText('PAY-1')).toBeVisible();
  await expect(page.getByText('Refactor charge')).toBeVisible();
  await expect(page.getByText('Old')).toBeVisible();
  await expect(page.getByText('acc-new').first()).toBeVisible();
  await expect(page.getByText('預計影響筆數：2')).toBeVisible();
  // editableByUser badges
  await expect(page.getByText('可編輯', { exact: true })).toBeVisible();
  await expect(page.getByText('無權限', { exact: true })).toBeVisible();

  // 可用鍵盤回上一步
  const back = page.getByRole('button', { name: '上一步' });
  await back.focus();
  await expect(back).toBeFocused();

  await expectNoA11yViolations(page, 'bulk-preview');
});
