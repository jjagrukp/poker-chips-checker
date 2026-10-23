import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  addStandardChips,
  heading,
  next,
  noAxeViolations,
  noHorizontalScroll,
  seconds,
  setUpReadyTournament,
} from './helpers';

// M10: the MVP acceptance criteria (spec 07 §3) that need a real browser. The rest are proven
// by unit/integration tests (allocation, schedules, overtime, mock module) and the other specs.

test('the clock stays exact, alerts show, mute works, and it survives refresh and closing (§3 #5–7, #10)', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-23T19:00:00+11:00') });
  await setUpReadyTournament(page);
  await page.getByRole('button', { name: 'Start the clock' }).click();
  const timer = page.getByRole('timer', { name: 'Time left' });
  await expect(heading(page, 'Level 1')).toBeVisible();
  await expect(timer).toHaveText(/^\d\d:00$/);
  const level = seconds(await timer.textContent());

  // #5: most of a level later the clock is exactly where wall time says (a jump that big is a
  // gap, so its alerts are marked fired rather than replayed).
  await page.clock.fastForward(level * 1000 - 3000);
  await expect(timer).toHaveText(/^00:0[1-3]$/);
  // #10: the level change, watched live, is always visible; M mutes.
  await expect(heading(page, 'Level 2')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'The blinds are going up.' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');

  // #6: refreshing while running restores the remaining time (±1 s).
  const before = seconds(await timer.textContent());
  await page.reload();
  await expect(heading(page, 'Level 2')).toBeVisible();
  expect(Math.abs(seconds(await timer.textContent()) - before)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');

  // #7: three levels pass while the clock screen is closed → right level plus a summary.
  const url = page.url();
  await page.goto('/');
  await page.clock.fastForward(3 * level * 1000);
  await page.goto(url);
  await expect(page.getByText(/^While the app was napping, 3 levels/)).toBeVisible();
  await expect(heading(page, /^(Level 5|Break)/)).toBeVisible();
  await noAxeViolations(page);
});

test('results are saved; the preset and chip set start the next tournament (§3 #11)', async ({
  page,
}) => {
  await setUpReadyTournament(page, 'Friday night');
  await page.getByRole('button', { name: 'Start the clock' }).click();
  await expect(heading(page, 'Level 1')).toBeVisible();
  await page.getByRole('button', { name: 'End tournament' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'End tournament' }).click();

  await expect(heading(page, "That's a wrap.")).toBeVisible();
  await page.getByLabel('Name for 1st place').fill('Sam');
  await page.getByRole('button', { name: 'Save results' }).click();
  await expect(page.getByText('Results saved.')).toBeVisible();
  await page.getByLabel('Preset name').fill('Friday standard');
  await page.getByRole('button', { name: 'Save as preset' }).click();
  await expect(page.getByText('Preset saved. Find it on the home screen.')).toBeVisible();
  await noAxeViolations(page);

  await page.goto('/');
  await expect(page.getByText('Finished')).toBeVisible();
  await page.getByRole('button', { name: 'Use preset: Friday standard' }).click();
  await expect(heading(page, 'Basics')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: /^New tournament with these chips: / }).first().click();
  await expect(heading(page, 'Basics')).toBeVisible();
  await next(page);
  await next(page);
  await expect(page.getByRole('listitem', { name: 'Chip type: Black' })).toBeVisible();
});

test('Settings: tone, then export → delete everything → import restores it (§3 #11, 07 §2)', async ({
  page,
}) => {
  await setUpReadyTournament(page, 'Backup night');
  await page.goto('/');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(heading(page, 'Settings')).toBeVisible();
  await noAxeViolations(page);

  await page.getByRole('radio', { name: 'Plain' }).check();
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'Plain' })).toBeChecked();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^tournament-backup-\d{4}-\d\d-\d\d\.json$/);
  const backup = await readFile(await download.path(), 'utf8');
  expect(backup).toContain('Backup night');

  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('All data deleted.')).toBeVisible();
  await expect(page.getByText('Backup night')).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Import backup').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await expect(page.getByText(/^Backup imported\./)).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByText('Backup night')).toBeVisible();
});

test.describe('offline (§3 #13)', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works offline after the first load', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'New tournament' })).toBeVisible();
    await page.evaluate('navigator.serviceWorker.ready.then(() => true)');

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'New tournament' })).toBeVisible();
    await page.getByRole('button', { name: 'New tournament' }).click();
    await next(page);
    await next(page);
    // AI is the one thing that needs the network: the photo option stays hidden, manual entry works.
    await expect(heading(page, 'Chips')).toBeVisible();
    await expect(page.getByText('Start from a photo')).toHaveCount(0);
    await addStandardChips(page);
    await page.goto('/settings');
    await expect(heading(page, 'Settings')).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe('phone (§3 #12)', () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test('every screen fits 375 px with no axe issues', async ({ page }) => {
    await page.goto('/');
    await noHorizontalScroll(page);
    await setUpReadyTournament(page);
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: 'Start the clock' }).click();
    await expect(heading(page, 'Level 1')).toBeVisible();
    await noHorizontalScroll(page);
    await noAxeViolations(page);
    await page.goto('/settings');
    await expect(heading(page, 'Settings')).toBeVisible();
    await noHorizontalScroll(page);
  });
});

test.describe('TV (§3 #12)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the fullscreen layout is readable and accessible', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Fullscreen API is not available to iPhone emulation');
    await setUpReadyTournament(page);
    await page.getByRole('button', { name: 'Start the clock' }).click();
    await page.keyboard.press('f');
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    const timer = page.getByRole('timer', { name: 'Time left' });
    const box = await timer.boundingBox();
    // Readable at 5 m: the digits take a big share of the screen.
    expect(box?.height ?? 0).toBeGreaterThan(200);
    await noHorizontalScroll(page);
    await noAxeViolations(page);
  });
});
