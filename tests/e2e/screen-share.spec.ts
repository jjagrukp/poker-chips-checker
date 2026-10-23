import { expect, test } from '@playwright/test';
import { noAxeViolations, setUpReadyTournament } from './helpers';

// M12 exit (spec 08): the phone shares its clock, a separate device opens the code and follows
// the phone's controls, and stopping the share ends the screen.

test('a TV follows the phone through a shared code', async ({ page, browser }) => {
  await setUpReadyTournament(page);
  await page.getByRole('button', { name: 'Start the clock' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show on a TV' }).click();
  const code = page.getByText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await expect(code).toBeVisible();
  await expect(page.getByText('The TV link is up to date.')).toBeVisible();
  await noAxeViolations(page);
  const typed = ((await code.textContent()) ?? '').toLowerCase();

  // A separate browser context: its own storage, like another device.
  const tvContext = await browser.newContext();
  const tv = await tvContext.newPage();
  await tv.goto('/screen');
  await tv.getByLabel("Code from the host's phone").fill(typed);
  await tv.getByRole('button', { name: 'Show clock' }).click();
  await expect(tv).toHaveURL(/\/screen\/[2-9A-Z]{8}$/);
  await expect(tv.getByRole('timer', { name: 'Time left' })).toBeVisible();
  await expect(tv.getByText('Running', { exact: true })).toBeVisible();
  await expect(tv.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await noAxeViolations(tv);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(tv.getByText('Paused', { exact: true })).toBeVisible();
  await expect(tv.getByRole('timer', { name: 'Time left' })).toHaveText(
    (await page.getByRole('timer', { name: 'Time left' }).textContent()) ?? '',
  );

  await page.getByRole('button', { name: 'Stop showing on TV' }).click();
  await expect(tv.getByText(/This screen link has ended/)).toBeVisible();
  await tvContext.close();
});
