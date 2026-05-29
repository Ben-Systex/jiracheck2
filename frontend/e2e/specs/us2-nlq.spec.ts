// T046：US2 NLQ E2E（mock-only）
// 三條路徑：黃金（解讀 + 執行）/ clarification / partial_permission + axe-core

import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from '../lib/axe';

const me = { accountId: 'acc-self', displayName: 'Me' };

const okPayload = {
  explanationZh: '統計符合條件的任務數，專案 PAY',
  plan: { intent: 'count_issues', filters: { projectKeys: ['PAY'] } },
  status: 'ok',
  results: { count: 12 },
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

const clarification = {
  explanationZh: '系統無法解讀，請補充必要資訊',
  plan: null,
  status: 'clarification_needed',
  clarificationQuestions: ['請補充時間範圍？', '請指定專案？'],
};

const partialPermission = {
  explanationZh: '列出符合條件的任務',
  plan: { intent: 'list_issues', filters: {} },
  status: 'partial_permission',
  results: { items: [{ key: 'PAY-1', summary: 's', status: 'In Progress', projectKey: 'PAY', assignee: null }] },
};

test('US2 NLQ golden path: count_issues with freshness', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/v1/nlq/query', (r) => r.fulfill({ json: okPayload }));

  await page.goto('/nlq');
  await expect(page.getByRole('heading', { name: /自然語言查詢/ })).toBeVisible();
  await page.getByLabel('輸入您的問題').fill('PAY 已完成多少筆');
  await page.getByRole('button', { name: /送出查詢/ }).click();
  await expect(page.getByText('統計符合條件的任務數')).toBeVisible();
  await expect(page.getByText('12')).toBeVisible();
  await expect(page.getByText('即時')).toBeVisible();

  await expectNoA11yViolations(page, 'nlq-golden');
});

test('US2 NLQ clarification path', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/v1/nlq/query', (r) => r.fulfill({ json: clarification }));

  await page.goto('/nlq');
  await page.getByLabel('輸入您的問題').fill('我做了多少');
  await page.getByRole('button', { name: /送出查詢/ }).click();
  await expect(page.getByText('請補充以下資訊')).toBeVisible();
  await expect(page.getByText('請補充時間範圍？')).toBeVisible();
  await expect(page.getByText('請指定專案？')).toBeVisible();
});

test('US2 NLQ partial_permission path', async ({ page }) => {
  await page.route('**/api/v1/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/v1/nlq/query', (r) => r.fulfill({ json: partialPermission }));

  await page.goto('/nlq');
  await page.getByLabel('輸入您的問題').fill('列出 PAY 任務');
  await page.getByRole('button', { name: /送出查詢/ }).click();
  await expect(page.getByText('部分結果因權限限制未顯示')).toBeVisible();
  await expect(page.getByText('PAY-1')).toBeVisible();
});
