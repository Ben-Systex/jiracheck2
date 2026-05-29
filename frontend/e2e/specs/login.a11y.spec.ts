import { test } from '@playwright/test';
import { expectNoA11yViolations } from '../lib/axe';

test('login page has no critical/serious a11y violations', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /以 Atlassian 登入/ }).waitFor();
  await expectNoA11yViolations(page, 'login');
});
