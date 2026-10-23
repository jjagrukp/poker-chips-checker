import { expect, test } from '@playwright/test';
import { brand } from '../../src/app/configuration/brand';
import { noAxeViolations } from './helpers';

test('home renders the brand name and has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(brand.appName);
  await expect(page.getByRole('heading', { level: 1, name: brand.appName })).toBeVisible();

  await noAxeViolations(page);
});

test('the limitations page is public and has no axe violations', async ({ page }) => {
  await page.goto('/limitations');
  await expect(page.getByRole('heading', { level: 1, name: 'Known limitations' })).toBeVisible();
  await expect(page.getByText(/a target, not a guarantee/)).toBeVisible();
  await noAxeViolations(page);
});
