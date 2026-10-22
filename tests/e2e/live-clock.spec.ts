import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// M6 exit: the clock runs from derived time, stays paused across reloads, catches up after a
// "sleep" with a summary, and other tabs are read-only viewers.

async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
}

async function addChip(page: Page, index: number, colour: string, quantity: string, value: string) {
  await page.getByRole('button', { name: 'Add chip type' }).click();
  await page
    .getByRole('listitem', { name: `Chip type: Chip type ${index}` })
    .getByLabel('Colour')
    .fill(colour);
  const row = page.getByRole('listitem', { name: `Chip type: ${colour}` });
  await row.getByLabel('How many').fill(quantity);
  await row.getByLabel('Value in this tournament').fill(value);
}

async function setUpReadyTournament(page: Page) {
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  await page.goto('/');
  await page.getByRole('button', { name: 'New tournament' }).click();
  await next();
  await next();
  await addChip(page, 1, 'White', '100', '25');
  await addChip(page, 2, 'Red', '100', '100');
  await addChip(page, 3, 'Green', '50', '500');
  await addChip(page, 4, 'Black', '50', '1000');
  await page.getByRole('button', { name: 'Confirm inventory' }).click();
  await expect(page.getByText('Inventory confirmed and saved.')).toBeVisible();
  await next();
  await expect(page.getByText(/^Starting stack: /)).toBeVisible();
  await next();
  await next();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ready to play' })).toBeVisible();
}

test('runs the live clock through pause, reload, sleep and a viewer tab', async ({
  page,
  context,
  browserName,
}) => {
  // WebKit never finishes a navigation once Playwright's fake clock has been fast-forwarded
  // (reload and goto alike). Clock behaviour is covered by unit/component tests; revisit in M10.
  test.skip(browserName === 'webkit', 'WebKit navigation hangs under page.clock after fastForward');
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
