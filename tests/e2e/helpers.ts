import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Shared e2e steps. Every screen a spec visits gets an axe scan (spec 07 §1).

export async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
}

/** Spec 07 §3 #12: nothing wider than the viewport. */
export async function noHorizontalScroll(page: Page) {
  // Names the offenders so a failure says what to fix (the e2e tsconfig has no DOM lib).
  const offenders = await page.evaluate(`(() => {
    const width = document.documentElement.clientWidth;
    return [...document.body.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5)
      .slice(0, 5)
      .map((el) => el.tagName.toLowerCase() + ' ' + (el.getAttribute('class') ?? '').slice(0, 80) + ' "' + (el.textContent ?? '').trim().slice(0, 40) + '"');
  })()`);
  expect(offenders).toEqual([]);
}

export const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();
export const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

export async function addChip(
  page: Page,
  index: number,
  colour: string,
  quantity: string,
  value: string,
) {
  await page.getByRole('button', { name: 'Add chip type' }).click();
  await page
    .getByRole('listitem', { name: `Chip type: Chip type ${index}` })
    .getByLabel('Colour')
    .fill(colour);
  const row = page.getByRole('listitem', { name: `Chip type: ${colour}` });
  await row.getByLabel('How many').fill(quantity);
  await row.getByLabel('Value in this tournament').fill(value);
}

export async function addStandardChips(page: Page) {
  await addChip(page, 1, 'White', '100', '25');
  await addChip(page, 2, 'Red', '100', '100');
  await addChip(page, 3, 'Green', '50', '500');
  await addChip(page, 4, 'Black', '50', '1000');
  await page.getByRole('button', { name: 'Confirm inventory' }).click();
  await expect(page.getByText('Inventory confirmed and saved.')).toBeVisible();
}

/**
 * Home → wizard with defaults and four chip types → `ready`. Levels roll over on their own unless
 * `levelEnd: 'waitForHost'` (the app's default, spec 11); clock specs fast-forward across levels.
 */
export async function setUpReadyTournament(
  page: Page,
  name?: string,
  { levelEnd = 'auto' }: { levelEnd?: 'auto' | 'waitForHost' } = {},
) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New tournament' }).click();
  if (name) await page.getByLabel('Tournament name (optional)').fill(name);
  await next(page);
  await next(page);
  await addStandardChips(page);
  await next(page);
  await expect(page.getByText(/^Starting stack: /)).toBeVisible();
  await next(page);
  if (levelEnd === 'auto') {
    await page.getByText('Advanced').click();
    await page
      .getByRole('group', { name: 'When a level ends' })
      .getByLabel('Move on straight away, even mid-hand')
      .check();
  }
  await next(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(heading(page, 'Ready to play')).toBeVisible();
}

/** mm:ss (or h:mm:ss) → seconds. */
export function seconds(text: string | null): number {
  return (text ?? '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
}
