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

test('scrubs the timeline back to t=0', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });

  // Let the history stream a few keyframes so there is a range to scrub, then
  // pin the view to the very start.
  const timeLabel = page.locator('[data-timeline] span');
  await expect(timeLabel).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => Number((await timeLabel.textContent())?.replace(/[^0-9.]/g, '') ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0.05); // streamed past 50 Myr

  const slider = page.locator('[data-timeline] input[type="range"]');
  await slider.fill('0'); // drag to the first keyframe
  await expect(timeLabel).toHaveText(/0\.00 Gyr/);
  // The scrub button now offers to resume live (view is pinned).
  await expect(page.locator('[data-timeline] button')).toHaveText(/Go Live/);

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.locator('canvas').screenshot({ path: join(ARTIFACTS_DIR, 'planet-scrubbed-t0.png') });
});

test('reload hydrates the history from the IndexedDB cache', async ({ page }) => {
  // A short history (via ?until) so the first run finishes — and seals a complete
  // cache manifest — quickly; the cache path is identical to the full 4.5 Gyr span.
  await page.goto('/?until=100e6');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });

  const root = page.locator('[data-planet-ready]');
  const progress = page.locator('[data-history-progress]');

  // First visit streams from the worker and writes through to the cache.
  await expect(root).toHaveAttribute('data-history-source', 'worker', { timeout: 30_000 });
  // Let the whole history finish so a complete manifest is sealed.
  await expect(progress).toHaveAttribute('data-history-progress', 'done', { timeout: 60_000 });

  // Reload within the SAME browser context. IndexedDB survives a reload (it would
  // NOT survive a fresh context, so the test reloads rather than relaunching).
  await page.reload();
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });

  // This time the timeline hydrates from cache — no worker run.
  await expect(root).toHaveAttribute('data-history-source', 'cache', { timeout: 30_000 });
  await expect(progress).toHaveAttribute('data-history-progress', 'done');

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.locator('canvas').screenshot({ path: join(ARTIFACTS_DIR, 'planet-cache-hydrated.png') });
});
