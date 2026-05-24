// 共用 axe-core 助手；憲法 III + IV：critical / serious 0 為 CI fail gate
import { expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

export async function expectNoA11yViolations(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  const serious = results.violations.filter((v) => v.impact === 'serious');
  expect(critical, `[a11y][${name}] critical violations: ${JSON.stringify(critical, null, 2)}`).toEqual(
    [],
  );
  expect(serious, `[a11y][${name}] serious violations: ${JSON.stringify(serious, null, 2)}`).toEqual(
    [],
  );
}
