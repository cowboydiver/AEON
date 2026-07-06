import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { diffFraction, settle } from './helpers';

/**
 * Phase 2 acceptance (#29). Three checks from docs/PHASE_2_SPEC.md milestone 4:
 *
 * 1. Five timeline positions spanning the history: screenshots pairwise
 *    meaningfully different, and deterministic across (a) a cache-hydrated
 *    reload and (b) a genuinely independent second run (fresh browser context,
 *    cold IndexedDB — the app holds a live DB connection, so an in-page
 *    deleteDatabase would deadlock on `blocked`; a fresh context is the honest
 *    "two runs" anyway).
 * 2. Same-context reload hydrates from the cache with the timeline fully
 *    interactive quickly and NO worker restart (source stays 'cache').
 * 3. Scrub frame pacing measured by rAF timing while the slider animates.
 *    Under Xvfb this is Vulkan-on-SwiftShader software rasterization — the
 *    measured fps is recorded (and floored at "live, not stalled"), but the
 *    60 fps criterion itself is a real-GPU expectation; see Spike B
 *    (docs/spikes/PHASE_2_SPIKES.md) and PHASE_2_REPORT.md.
 *
 * The per-position/pixel-diff checks run on a REDUCED span (spec §5 e2e
 * budget): the scrub/blend/cache path is identical to the full 4.5 Gyr span.
 * The full-span five-position drive (the "continents visibly drift" eyeball +
 * memory high-water marks) is the `full 4.5 Gyr` test below, gated behind
 * PHASE2_FULL=1 — it streams a ~2–10 min history and is the manual acceptance,
 * not a CI gate.
 */

const ARTIFACTS_DIR = join(import.meta.dirname, 'artifacts');
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

async function waitForHistoryDone(page: Page, timeout: number): Promise<void> {
  await page.waitForSelector('[data-planet-ready="1"]', { timeout });
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout },
  );
}

/** Drive the timeline to the five acceptance fractions; screenshot each. */
async function captureFivePositions(page: Page, prefix: string): Promise<Buffer[]> {
  // Element screenshots include DOM overlaying the canvas, and the green
  // "cached" badge exists only on cache-hydrated runs — hide it so the
  // worker-run/cache-run comparison sees identical HUDs (the time/land HUD
  // text stays visible on purpose: it must reproduce across runs too).
  await page.addStyleTag({
    content: 'span[title^="Hydrated from the IndexedDB"] { display: none; }',
  });
  const slider = page.locator('[data-timeline] input[type="range"]');
  const max = Number(await slider.getAttribute('max'));
  expect(max, 'timeline has a scrubbable range').toBeGreaterThan(1);
  const shots: Buffer[] = [];
  for (const [i, f] of FRACTIONS.entries()) {
    await slider.fill(String(f * max));
    await settle(page);
    shots.push(
      await page
        .locator('canvas')
        .screenshot({ path: join(ARTIFACTS_DIR, `${prefix}-pos${i}.png`) }),
    );
  }
  return shots;
}

test('five deep-time positions differ, reproduce from cache, and reproduce across runs (#29)', async ({
  page,
  browser,
}, testInfo) => {
  testInfo.setTimeout(600_000);
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Reduced span (spec §5): 500 Myr = 51 keyframes of real tectonic history
  // (rifts and drift begin well inside it), streamed in ~1 min.
  const url = '/?until=500e6';

  // --- Run 1: stream from the worker, capture the five positions.
  await page.goto(url);
  await waitForHistoryDone(page, 240_000);
  const run1 = await captureFivePositions(page, 'accept-run1');

  // The five positions are pairwise meaningfully different — the planet
  // visibly evolves across the span (the spec's "look at them" is the
  // artifacts directory; the numbers here are the regression tripwire).
  for (let i = 0; i < run1.length; i++) {
    for (let j = i + 1; j < run1.length; j++) {
      const d = diffFraction(run1[i]!, run1[j]!);
      expect(d, `positions ${i} and ${j} differ meaningfully (${d.toFixed(4)})`).toBeGreaterThan(
        0.01,
      );
    }
  }

  // --- Same-context reload: cache hydration, timed, no worker restart.
  const t0 = Date.now();
  await page.reload();
  const root = page.locator('[data-planet-ready]');
  await expect(root).toHaveAttribute('data-history-source', 'cache', { timeout: 30_000 });
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout: 10_000 },
  );
  // Timeline is fully interactive (all keyframes present) at this point.
  const slider = page.locator('[data-timeline] input[type="range"]');
  await expect(slider).toBeVisible();
  const hydrateMs = Date.now() - t0;
  // The spec's bar is "interactive < 1 s". DOM-interactive hydration is
  // sub-second on real hardware; the assertion carries CI slack for the
  // software-raster page boot and the REAL number is recorded for the report.
  console.log(`[#29] cache hydration: reload -> full timeline in ${hydrateMs} ms`);
  expect(hydrateMs, `cache hydration ${hydrateMs} ms`).toBeLessThan(15_000);
  // No worker restart: the source attribute is 'cache', and stays so.
  await expect(root).toHaveAttribute('data-history-source', 'cache');

  // Cache-hydrated pixels reproduce run 1 exactly (same bytes, same blend).
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 90_000 });
  const cached = await captureFivePositions(page, 'accept-cache');
  for (let i = 0; i < run1.length; i++) {
    const d = diffFraction(run1[i]!, cached[i]!);
    expect(d, `cache-hydrated position ${i} reproduces run 1 (${d.toFixed(4)})`).toBeLessThan(
      0.002,
    );
  }
  await page.close();

  // --- Run 2: fresh browser context = cold IndexedDB = independent re-run.
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await page2.goto(url);
  await waitForHistoryDone(page2, 240_000);
  await expect(page2.locator('[data-planet-ready]')).toHaveAttribute(
    'data-history-source',
    'worker',
  );
  const run2 = await captureFivePositions(page2, 'accept-run2');
  for (let i = 0; i < run1.length; i++) {
    const d = diffFraction(run1[i]!, run2[i]!);
    expect(d, `position ${i} reproduces across independent runs (${d.toFixed(4)})`).toBeLessThan(
      0.002,
    );
  }
  await context2.close();
});

test('scrub frame pacing: rAF-timed slider animation stays live (fps recorded) (#29)', async ({
  page,
}) => {
  await page.goto('/?until=100e6');
  await waitForHistoryDone(page, 240_000);

  // Animate the slider inside one keyframe bracket every frame for ~3 s: the
  // steady-state scrub cost (uniform write only — no texture upload inside a
  // bracket, #25/Spike B), measured as presented-frame intervals.
  const frames = await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('[data-timeline] input[type="range"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const deltas: number[] = [];
    let pos = 0.1;
    const start = performance.now();
    let last = start;
    await new Promise<void>((resolve) => {
      const tick = () => {
        pos = 0.1 + ((pos - 0.1 + 0.05) % 0.8); // sweep within bracket 0..1
        setValue.call(input, String(pos));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (now - start < 3_000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return deltas;
  });

  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const fps = 1000 / mean;
  // The acceptance's 60 fps criterion is a real-GPU expectation. This Xvfb
  // path is SwiftShader software raster (~2.6 fps steady, Spike B) — assert
  // only "live, not stalled" here and RECORD the numbers; PHASE_2_REPORT.md
  // carries the budget: an in-bracket scrub adds one uniform write per frame
  // (no upload), so scrub fps == steady render fps on any adapter.
  console.log(
    `[#29] scrub pacing: ${fps.toFixed(2)} fps over ${frames.length} frames ` +
      `(mean ${mean.toFixed(0)} ms, median ${median.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms)`,
  );
  expect(fps, `scrub loop live at ${fps.toFixed(2)} fps`).toBeGreaterThan(0.4);
});

// The full-length acceptance: the real 4.5 Gyr span at N=128 — the
// "continents visibly drift" eyeball plus memory high-water marks. Streams a
// multi-minute history; run manually with PHASE2_FULL=1 (see PHASE_2_REPORT.md
// for the recorded results).
test('full 4.5 Gyr five-position drive with memory high-water marks (#29, manual)', async ({
  page,
}, testInfo) => {
  test.skip(!process.env['PHASE2_FULL'], 'set PHASE2_FULL=1 for the full-span manual acceptance');
  testInfo.setTimeout(1_800_000);
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await page.goto('/');
  await page.waitForSelector('[data-planet-ready="1"]', { timeout: 120_000 });
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout: 1_500_000 },
  );

  const shots = await captureFivePositions(page, 'accept-full');
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) {
      const d = diffFraction(shots[i]!, shots[j]!);
      expect(
        d,
        `full-span positions ${i} and ${j} differ meaningfully (${d.toFixed(4)})`,
      ).toBeGreaterThan(0.01);
    }
  }

  // Memory high-water marks for the report (#27's budget vs reality).
  const memory = await page.evaluate(async () => {
    interface PerformanceMemory {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
    }
    const mem = (performance as unknown as { memory?: PerformanceMemory }).memory;
    const estimate = await navigator.storage.estimate();
    return {
      usedJSHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
      totalJSHeapMB: mem ? Math.round(mem.totalJSHeapSize / 1e6) : null,
      storageUsageMB: estimate.usage ? Math.round(estimate.usage / 1e6) : null,
    };
  });
  console.log(`[#29] full-span memory: ${JSON.stringify(memory)}`);
});
