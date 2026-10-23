import { expect, test } from '@playwright/test';
import { noAxeViolations, setUpReadyTournament } from './helpers';

// M6 exit: the clock runs from derived time, stays paused across reloads, catches up after a
// "sleep" with a summary, and other tabs are read-only viewers.

test('runs the live clock through pause, reload, sleep and a viewer tab', async ({
  page,
  context,
}) => {
  // Fake time flows normally until the test fast-forwards it.
  await page.clock.install({ time: new Date('2026-10-23T19:00:00+11:00') });
  await setUpReadyTournament(page);

  await page.getByRole('button', { name: 'Start the clock' }).click();
  const heading = page.getByRole('heading', { level: 1 });
  const timer = page.getByRole('timer', { name: 'Time left' });
  await expect(heading).toHaveText('Level 1');
  await expect(timer).toHaveText(/^\d\d:00$/);
  const minutes = Number((await timer.textContent())?.slice(0, 2));

  await page.clock.fastForward('01:01');
  await expect(timer).toHaveText(`${String(minutes - 2).padStart(2, '0')}:59`);
  await noAxeViolations(page);

  // Paused stays paused, even across a reload.
  await page.keyboard.press('Space');
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  const pausedAt = (await timer.textContent()) ?? '';
  await page.clock.fastForward('10:00');
  await page.reload();
  await expect(timer).toHaveText(pausedAt);
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();

  // Resume, then sleep through more than a level: waking up catches up with a summary.
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await page.clock.fastForward(`${minutes + 1}:00`);
  // Same path as hidden-to-visible (the e2e tsconfig has no DOM lib, so pass a string).
  await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await expect(page.getByText(/^While the app was napping, .* passed\./)).toBeVisible();
  await expect(heading).not.toHaveText('Level 1');

  // A second tab views the same tournament without controls.
  const viewer = await context.newPage();
  await viewer.goto(page.url());
  await expect(
    viewer.getByText("This tournament is being run in another tab. You're viewing it here."),
  ).toBeVisible();
  await expect(viewer.getByRole('timer', { name: 'Time left' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await noAxeViolations(viewer);

  // The controller pauses; the viewer follows.
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(viewer.getByText('Paused', { exact: true })).toBeVisible();
});
