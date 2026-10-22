import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { brand } from '../../src/app/configuration/brand';

test('home renders the brand name and has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(brand.appName);
  await expect(page.getByRole('heading', { level: 1, name: brand.appName })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
});
