import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

const ARTIFACTS_DIR = join(import.meta.dirname, 'artifacts');

test('renders a lit, non-black planet', async ({ page }) => {
  await page.goto('/');

  // WebGPU must be available in the test browser — this suite intentionally
  // fails (not skips) otherwise, since rendering IS what is under test.
  const hasWebGpu = await page.evaluate(() => 'gpu' in navigator);
  expect(hasWebGpu, 'navigator.gpu missing — launch args / browser problem').toBe(true);

  // Worker generates the planet, main thread uploads, scene marks ready a few
  // frames after the first presented planet frame. SwiftShader is slow.
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const canvas = page.locator('canvas');
  const screenshot = await canvas.screenshot({
    path: join(ARTIFACTS_DIR, 'planet-seed42.png'),
  });

  // Sample pixels: the planet must light up a meaningful share of the canvas.
  const png = PNG.sync.read(screenshot);
  let lit = 0;
  let colored = 0;
  const pixels = png.width * png.height;
  for (let i = 0; i < pixels; i++) {
    const r = png.data[i * 4]!;
    const g = png.data[i * 4 + 1]!;
    const b = png.data[i * 4 + 2]!;
    if (r + g + b > 45) lit++;
    // Ocean blues / land greens are chromatic; stars and void are not.
    if (Math.max(r, g, b) - Math.min(r, g, b) > 25) colored++;
  }
  const litFraction = lit / pixels;
  const coloredFraction = colored / pixels;
  expect(litFraction, `lit fraction ${litFraction}`).toBeGreaterThan(0.05);
  expect(coloredFraction, `colored fraction ${coloredFraction}`).toBeGreaterThan(0.02);
});
