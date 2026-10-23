import { expect, test } from '@playwright/test';
import { addChip, heading, next, noAxeViolations } from './helpers';

// M5 exit: the wizard reaches `ready`; back-navigation and reload keep every answer.

test('sets up a tournament from scratch to ready', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New tournament' }).click();

  await expect(heading(page, 'Basics')).toBeVisible();
  await page.getByLabel('Tournament name (optional)').fill('Friday night');
  await page.getByLabel('Players', { exact: true }).fill('7');
  await noAxeViolations(page);
  await next(page);

  await expect(heading(page, 'Length')).toBeVisible();
  await page.getByText('2h', { exact: true }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Players', { exact: true })).toHaveValue('7');
  await next(page);
  await expect(page.getByRole('radio', { name: '2h' })).toBeChecked();
  await next(page);

  await expect(heading(page, 'Chips')).toBeVisible();
  await addChip(page, 1, 'White', '100', '25');
  await addChip(page, 2, 'Red', '100', '100');
  await addChip(page, 3, 'Green', '50', '500');
  await addChip(page, 4, 'Black', '50', '1000');
  await noAxeViolations(page);
  await page.getByRole('button', { name: 'Confirm inventory' }).click();
  await expect(page.getByText('Inventory confirmed and saved.')).toBeVisible();
  await next(page);

  await expect(heading(page, 'Stack')).toBeVisible();
  await expect(page.getByText(/^Starting stack: /)).toBeVisible();
  await expect(page.getByText(/big blinds/)).toBeVisible();
  await noAxeViolations(page);

  // A reload mid-wizard resumes with everything intact.
  await page.reload();
  await expect(heading(page, 'Stack')).toBeVisible();
  await expect(page.getByText(/^Starting stack: /)).toBeVisible();
  await next(page);

  await expect(heading(page, 'Structure')).toBeVisible();
  await page.getByText('Gentle', { exact: true }).click();
  await expect(page.getByText('Estimated finish').first()).toBeVisible();
  await noAxeViolations(page);
  await next(page);

  await expect(heading(page, 'Review')).toBeVisible();
  await expect(page.getByText(/^Scheduled: .* \(target /)).toBeVisible();
  await expect(page.getByText('Friday night')).toBeVisible();
  await noAxeViolations(page);
  await page.getByRole('button', { name: 'Start' }).click();

  await expect(heading(page, 'Ready to play')).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByText('Ready to start')).toBeVisible();
});
