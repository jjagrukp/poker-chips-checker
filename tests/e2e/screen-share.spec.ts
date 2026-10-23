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

  // Spec 10: the phone turns the hand rankings on and off beside the TV clock.
  const rankings = page.getByRole('button', { name: 'Hand rankings' });
  await rankings.click();
  await expect(rankings).toHaveAttribute('aria-pressed', 'true');
  await expect(tv.getByText('Royal flush')).toBeAttached();
  if ((tv.viewportSize()?.width ?? 0) >= 1024) {
    await expect(tv.getByRole('heading', { name: 'Hand rankings' })).toBeVisible();
    await noAxeViolations(tv);
  }
  await rankings.click();
  await expect(tv.getByText('Royal flush')).toHaveCount(0);

  // Spec 12: the phone sends a YouTube link and the TV embeds it. YouTube itself is blocked
  // here (tests stay offline), so the TV also shows that it can't reach it.
  await tvContext.route(/youtube/, (route) => route.abort());
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  // The panel opens below the controls; it scrolls to the link box, ready to paste.
  await expect(page.getByLabel('YouTube link')).toBeFocused();
  await expect(page.getByLabel('YouTube link')).toBeInViewport();
  await page.getByLabel('YouTube link').fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'Play on TV' }).click();
  await expect(page.getByText('Song playing on the TV.')).toBeVisible();
  await noAxeViolations(page);
  const player = tv.getByTitle('YouTube music player');
  await expect(player).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  await expect(tv.getByText("Can't reach YouTube right now.")).toBeVisible();
  await page.getByRole('button', { name: 'Stop music' }).click();
  await expect(player).toHaveCount(0);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(tv.getByText('Paused', { exact: true })).toBeVisible();
  await expect(tv.getByRole('timer', { name: 'Time left' })).toHaveText(
    (await page.getByRole('timer', { name: 'Time left' }).textContent()) ?? '',
  );

  await page.getByRole('button', { name: 'Stop showing on TV' }).click();
  await expect(tv.getByText(/This screen link has ended/)).toBeVisible();
  await tvContext.close();
});
