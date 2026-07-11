import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

const ARTIFACTS_DIR = join(import.meta.dirname, 'artifacts');

/** Fraction of pixels whose summed RGB delta exceeds a small threshold — a
 *  cheap perceptual diff that ignores SwiftShader anti-aliasing jitter. */
function diffFraction(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  const n = Math.min(pa.data.length, pb.data.length) / 4;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const dr = Math.abs(pa.data[i * 4]! - pb.data[i * 4]!);
    const dg = Math.abs(pa.data[i * 4 + 1]! - pb.data[i * 4 + 1]!);
    const db = Math.abs(pa.data[i * 4 + 2]! - pb.data[i * 4 + 2]!);
    if (dr + dg + db > 24) changed++;
  }
  return changed / n;
}

/** Wait for two presented frames so a scrub's uniform/upload has rendered. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.waitForTimeout(150);
}

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

test('blends continents across a keyframe boundary (fractional scrub morphs, not pops)', async ({
  page,
}) => {
  // A short history so it streams to completion fast and deterministically; the
  // blend path is identical to the full 4.5 Gyr span.
  await page.goto('/?until=100e6');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout: 60_000 },
  );

  const slider = page.locator('[data-timeline] input[type="range"]');
  const canvas = page.locator('canvas');
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Bracket the first interval: keyframe 0 (formation, t=0) vs keyframe 1
  // (10 Myr). The midpoint must be a genuine interpolation of the two.
  await slider.fill('0');
  await settle(page);
  const shotA = await canvas.screenshot({ path: join(ARTIFACTS_DIR, 'blend-kf0.png') });

  await slider.fill('1');
  await settle(page);
  const shotB = await canvas.screenshot({ path: join(ARTIFACTS_DIR, 'blend-kf1.png') });

  await slider.fill('0.5');
  await settle(page);
  const shotMid = await canvas.screenshot({ path: join(ARTIFACTS_DIR, 'blend-mid.png') });

  const endpointDiff = diffFraction(shotA, shotB);
  const midVsA = diffFraction(shotMid, shotA);
  const midVsB = diffFraction(shotMid, shotB);

  // The two keyframes must actually differ (otherwise there is nothing to blend).
  expect(endpointDiff, `endpoints differ (${endpointDiff})`).toBeGreaterThan(0.005);
  // The fractional frame differs from BOTH endpoints — it is neither a pop to A
  // nor a pop to B, but a morph in between.
  expect(midVsA, `mid differs from kf0 (${midVsA})`).toBeGreaterThan(0.001);
  expect(midVsB, `mid differs from kf1 (${midVsB})`).toBeGreaterThan(0.001);
  // Signature of interpolation: the midpoint sits closer to each endpoint than
  // the endpoints sit to each other.
  expect(midVsA, 'mid is between the endpoints (nearer A than A↔B)').toBeLessThan(endpointDiff);
  expect(midVsB, 'mid is between the endpoints (nearer B than A↔B)').toBeLessThan(endpointDiff);

  // Determinism: scrubbing away and back to the same fraction yields the same
  // pixels (same seed → same blend → same frame).
  await slider.fill('0');
  await settle(page);
  await slider.fill('0.5');
  await settle(page);
  const shotMid2 = await canvas.screenshot();
  expect(diffFraction(shotMid, shotMid2), 'fractional scrub is deterministic').toBeLessThan(0.001);
});

test('plate-debug toggle repaints the globe with the crust-type + boundary map', async ({ page }) => {
  await page.goto('/?until=100e6');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });
  // Wait out the stream: the live view follows the newest keyframe, so a
  // screenshot taken mid-stream is a moving target (the #88/#90 default-on
  // kernel steps slower than the pre-promotion one, which surfaced exactly
  // that race — the terrain baseline landed at 0.05 Gyr, the comparison at
  // 0.10 Gyr).
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout: 60_000 },
  );

  const canvas = page.locator('canvas');
  const toggle = page.locator('[data-plate-debug]');
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Terrain view first: the normal hypsometric globe.
  await expect(toggle).not.toBeChecked();
  await settle(page);
  const terrain = await canvas.screenshot({ path: join(ARTIFACTS_DIR, 'plates-off.png') });

  // Flip the debug toggle: the surface is now coloured by crust type (teal
  // oceanic vs tan continental) with plate boundaries drawn over it, so a large
  // share of the globe changes and the frame stays chromatic.
  await toggle.check();
  await expect(toggle).toBeChecked();
  await settle(page);
  const plates = await canvas.screenshot({ path: join(ARTIFACTS_DIR, 'plates-on.png') });

  // The overlay is a wholesale surface swap, not a subtle tint — a big fraction
  // of pixels must differ from the terrain view.
  expect(diffFraction(terrain, plates), 'crust map repaints the globe').toBeGreaterThan(0.05);

  // The crust palette is two saturated colours (cool oceanic + warm continental);
  // the debug frame carries at least as much chroma as the terrain view (which is
  // mostly ocean blue + land greens).
  const chroma = (buf: Buffer): number => {
    const png = PNG.sync.read(buf);
    let colored = 0;
    const n = png.width * png.height;
    for (let i = 0; i < n; i++) {
      const r = png.data[i * 4]!;
      const g = png.data[i * 4 + 1]!;
      const b = png.data[i * 4 + 2]!;
      if (r + g + b > 45 && Math.max(r, g, b) - Math.min(r, g, b) > 25) colored++;
    }
    return colored / n;
  };
  expect(chroma(plates), 'crust map is chromatic').toBeGreaterThan(chroma(terrain) * 0.8);

  // Toggling back returns to terrain (uniform flip only — deterministic frame).
  await toggle.uncheck();
  await settle(page);
  const back = await canvas.screenshot();
  expect(diffFraction(terrain, back), 'toggling off restores terrain').toBeLessThan(0.02);
});

test('renders the dual-sample blend material without stalling (Spike B)', async ({ page }) => {
  await page.goto('/?until=100e6');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout: 60_000 },
  );

  // Pin a fractional position so both texture sets are resident and the material
  // is sampling A and B and mixing every frame — the steady dual-sample cost.
  await page.locator('[data-timeline] input[type="range"]').fill('0.5');
  await settle(page);

  // Steady render fps: count presented frames over a window (R3F renders every
  // rAF). No per-frame React churn — this is the material's raw rate, not the
  // scrubber's. Also time a single keyframe-boundary crossing (the set-swap).
  const steady = await page.evaluate(async () => {
    const durationMs = 2500;
    const start = performance.now();
    let frames = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        frames++;
        if (performance.now() - start < durationMs) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const elapsed = performance.now() - start;
    return { frames, elapsed, fps: (frames / elapsed) * 1000 };
  });

  const swapMs = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('[data-timeline] input[type="range"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    await nextFrame();
    const t0 = performance.now();
    // Cross into a new bracket (2 → 3): forces a one-set re-upload, then wait for
    // the next presented frame so the timing includes the swap + a render.
    setValue.call(input, '2.5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextFrame();
    await nextFrame();
    return performance.now() - t0;
  });

  // Record the real numbers. Under Xvfb this is Vulkan-on-SwiftShader software
  // rasterization of 6 displaced N=128 faces — NOT the fps oracle a real GPU is
  // (see docs/spikes/PHASE_2_SPIKES.md). Assert only that the loop is live, not
  // stalled, and that a set-swap does not wedge it.
  console.log(
    `[Spike B] steady fps: ${steady.fps.toFixed(2)} (${steady.frames} frames / ${steady.elapsed.toFixed(0)} ms); ` +
      `boundary-crossing swap: ${swapMs.toFixed(0)} ms`,
  );
  expect(steady.fps, `steady fps ${steady.fps.toFixed(2)}`).toBeGreaterThan(0.4);
  // A set-swap must not wedge the loop; generous bound absorbs SwiftShader jitter.
  expect(swapMs, `swap ${swapMs.toFixed(0)} ms`).toBeLessThan(15_000);
});

test('mechanism sidebar shows kernel defaults, re-simulates on toggle, and re-hydrates from cache on toggle-back', async ({ page }) => {
  await page.goto('/?until=100e6');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });
  const progress = page.locator('[data-history-progress]');
  await expect(progress).toHaveAttribute('data-history-progress', 'done', { timeout: 60_000 });

  // The sidebar lists every togglable mechanism with the kernel's default
  // state: the promoted #88/#90 pair on, the measured-negative pair and the
  // superseded #84 prototype off. This pins the product default visibly —
  // if a promotion/demotion changes it, this test changes with it.
  const sidebar = page.locator('[data-mechanism-sidebar]');
  await expect(sidebar.locator('[data-mechanism]')).toHaveCount(5);
  await expect(sidebar.locator('[data-mechanism="crustFates"]')).toBeChecked();
  await expect(sidebar.locator('[data-mechanism="marinePlanation"]')).toBeChecked();
  await expect(sidebar.locator('[data-mechanism="compactArcs"]')).not.toBeChecked();
  await expect(sidebar.locator('[data-mechanism="emergentArcTaper"]')).not.toBeChecked();
  await expect(sidebar.locator('[data-mechanism="blockIsostasy"]')).not.toBeChecked();

  // Toggling a mechanism re-simulates: a different mechanism set is a
  // different history-cache key, so this run streams from the worker (the
  // 'cached' badge must NOT be up once it completes... it was never cached).
  await sidebar.locator('[data-mechanism="crustFates"]').uncheck();
  await expect(progress).toHaveAttribute('data-history-progress', 'done', { timeout: 90_000 });
  await expect(page.locator('[data-planet-ready]')).toHaveAttribute('data-history-source', 'worker');

  // Toggling back restores the original mechanism set — the same cache key
  // the first stream wrote through, so this history re-hydrates from
  // IndexedDB without a worker run. This is the end-to-end proof that
  // mechanism toggles are correctly folded into the cache key (#24).
  await sidebar.locator('[data-mechanism="crustFates"]').check();
  await expect(progress).toHaveAttribute('data-history-progress', 'done', { timeout: 90_000 });
  await expect(page.locator('[data-planet-ready]')).toHaveAttribute('data-history-source', 'cache');
});
