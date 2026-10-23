import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// M9: the photo route with the API mocked at the network layer (no real AI calls in CI).
// Checks in a real browser that the upload is downscaled, re-encoded and free of EXIF.

const ANALYSIS = {
  schemaVersion: 1,
  status: 'ok',
  chipTypes: [
    {
      proposalId: 'c1',
      primaryColour: 'white',
      secondaryColours: [],
      pattern: null,
      printedValue: null,
      estimatedCount: 100,
      countConfidence: 'high',
      notes: null,
    },
    {
      proposalId: 'c2',
      primaryColour: 'red',
      secondaryColours: ['white'],
      pattern: 'edge spots',
      printedValue: null,
      estimatedCount: null,
      countConfidence: 'low',
      notes: null,
    },
  ],
  imageIssues: [],
  message: null,
};

/** A large camera-style JPEG made in the browser, with an EXIF (APP1) segment spliced in. */
async function photoWithExif(page: Page): Promise<Buffer> {
  // A string expression: this tsconfig has no DOM lib.
  const base64 = await page.evaluate<string>(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3200;
    canvas.height = 2400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#c62828';
    context.fillRect(0, 0, 3200, 2400);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  })()`);
  const jpeg = Buffer.from(base64, 'base64');
  const tiff = Buffer.from('4d4d002a00000008000000000000', 'hex'); // big-endian, empty IFD
  const payload = Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    tiff,
    Buffer.from('GPS-SECRET'),
  ]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]);
}

/** Width/height from the first SOF marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes.readUInt16BE(i);
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('no SOF marker');
}

async function openChips(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New tournament' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chips' })).toBeVisible();
}

test('the photo route is hidden when the feature is off', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { aiPhotoEnabled: false } }));
  await openChips(page);
  await expect(page.getByRole('button', { name: 'Add chip type' })).toBeVisible();
  await expect(page.getByText('Start from a photo')).toHaveCount(0);
});

test('a photo becomes unconfirmed rows; the upload is downscaled with EXIF removed', async ({
  page,
}) => {
  let uploaded: Buffer | null = null;
  await page.route('**/api/config', (route) => route.fulfill({ json: { aiPhotoEnabled: true } }));
  await page.route('**/api/analyse-chips', async (route) => {
    uploaded = route.request().postDataBuffer();
    await route.fulfill({ json: ANALYSIS });
  });

  await openChips(page);
  await expect(page.getByText(/isn't stored/)).toBeVisible();
  const original = await photoWithExif(page);
  expect(original.includes('Exif')).toBe(true);

  await page
    .getByLabel('Take or choose a photo')
    .setInputFiles({ name: 'chips.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(page.getByText(/Found 2 chip types/)).toBeVisible();

  const sent = uploaded as Buffer | null;
  expect(sent).not.toBeNull();
  if (!sent) return;
  expect(sent.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  expect(sent.includes('Exif')).toBe(false);
  expect(sent.includes('GPS-SECRET')).toBe(false);
  expect(sent.length).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  expect(jpegSize(sent)).toEqual({ width: 1600, height: 1200 });

  const white = page.getByRole('listitem', { name: 'Chip type: White' });
  await expect(white.getByLabel('How many')).toHaveValue('100');
  await expect(white.getByText(/count these again/)).toBeVisible();
  const red = page.getByRole('listitem', { name: 'Chip type: Red' });
  await expect(red.getByLabel('How many')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Confirm inventory' })).toBeDisabled();

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);

  // The host finishes the rows by hand and confirms as usual.
  await red.getByLabel('How many').fill('100');
  await white.getByLabel('Value in this tournament').fill('25');
  await red.getByLabel('Value in this tournament').fill('100');
  await white.getByRole('button', { name: 'White looks right' }).click();
  await red.getByRole('button', { name: 'Red looks right' }).click();
  await page.getByRole('button', { name: 'Confirm inventory' }).click();
  await expect(page.getByText('Inventory confirmed and saved.')).toBeVisible();
});

test('a failed analysis falls back to manual entry', async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ json: { aiPhotoEnabled: true } }));
  await page.route('**/api/analyse-chips', (route) =>
    route.fulfill({ status: 429, json: { error: 'rate_limited' } }),
  );
  await openChips(page);
  const photo = await photoWithExif(page);
  await page
    .getByLabel('Take or choose a photo')
    .setInputFiles({ name: 'chips.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(
    page.getByRole('region', { name: 'Start from a photo' }).getByRole('alert'),
  ).toContainText('enter your chips manually');
  await page.getByRole('button', { name: 'Enter manually' }).click();
  await expect(page.getByRole('button', { name: 'Add chip type' })).toBeVisible();
});
