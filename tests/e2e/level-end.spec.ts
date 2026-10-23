import { expect, test } from '@playwright/test';
import { noAxeViolations, setUpReadyTournament } from './helpers';

// M15 exit (spec 11): when a level runs out the clock waits at the next level until the host
// presses "Start Level 2"; the next level's time only starts then.

test('a level that runs out waits for the host to start the next one', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-23T19:00:00+11:00') });
  await setUpReadyTournament(page, undefined, { levelEnd: 'waitForHost' });
  await page.getByRole('button', { name: 'Start the clock' }).click();
  const timer = page.getByRole('timer', { name: 'Time left' });
  await expect(timer).toHaveText(/^\d\d:00$/);
  const minutes = Number((await timer.textContent())?.slice(0, 2));

  // Run past the end of level 1 and keep going: the table is still finishing a hand.
  await page.clock.fastForward(`${minutes + 2}:00`);
  await expect(page.getByText("Time's up — finish this hand", { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Level 2');
  await expect(page.getByText('Waiting for host', { exact: true })).toBeVisible();
  const full = (await timer.textContent()) ?? '';
  await page.clock.fastForward('01:00');
  await expect(timer).toHaveText(full);
  await noAxeViolations(page);

  await page.getByRole('button', { name: 'Start Level 2' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await expect(page.getByText("Time's up — finish this hand", { exact: true })).toHaveCount(0);
  await page.clock.fastForward('00:30');
  await expect(timer).not.toHaveText(full);
});
