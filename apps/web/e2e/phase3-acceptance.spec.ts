import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { diffFraction, settle } from './helpers';

/**
 * Phase 3 acceptance in the live render (#36). The kernel-side acceptance —
 * energy closes, water conserved, ice breathes, rain shadows emerge, a snowball
 * recovers — is pinned by the Vitest invariant suites and the committed
 * `docs/phase3-evidence` PNG dumps. This spec is the "looks alive from orbit"
 * half of the done-criteria: the from-orbit globe is **biome-coloured** (not raw
 * hypsometry) with **ice caps**, and it **evolves across the timeline** as the
 * climate and continents change.
 *
 * Like the Phase 2 acceptance this runs under Xvfb with Vulkan-on-SwiftShader
 * software rasterization (see scripts/run-e2e.mjs, PHASE0_REPORT.md): the pixel
 * numbers are regression tripwires and the committed screenshots are the real
 * "look at them" acceptance. The per-position/pixel checks use a REDUCED span;
 * the full 4.5 Gyr scrub (ice caps visibly breathing, mature biome belts) is the
 * PHASE3_FULL=1 manual test at the bottom.
 */

const ARTIFACTS_DIR = join(import.meta.dirname, 'artifacts');
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

interface RenderStats {
  /** Share of canvas pixels that are lit (the planet, not the void). */
  litFraction: number;
  /** Share that is chromatic — ocean blue / land greens / desert tans. */
  chromaticFraction: number;
  /** Share that reads as ice: bright and near-neutral (white/pale). */
  iceFraction: number;
  /** Ocean blue present on the globe. */
  hasOcean: boolean;
  /** Forest/vegetation green present (wet biomes). */
  hasVegetation: boolean;
  /** Arid tan present (desert/grassland — the rain-shadow / dry-interior biomes). */
  hasArid: boolean;
  /** Distinct biome hue families present among chromatic pixels (blue/green/tan). */
  hueFamilies: number;
}

/** Classify the from-orbit frame into the coarse buckets the acceptance reads. */
function analyzeFrame(buf: Buffer): RenderStats {
  const png = PNG.sync.read(buf);
  const n = png.width * png.height;
  let lit = 0;
  let chromatic = 0;
  let ice = 0;
  let blue = 0;
  let green = 0;
  let tan = 0;
  for (let i = 0; i < n; i++) {
    const r = png.data[i * 4]!;
    const g = png.data[i * 4 + 1]!;
    const b = png.data[i * 4 + 2]!;
    const sum = r + g + b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (sum <= 45) continue; // void / night side
    lit++;
    // Ice: bright and near-neutral — the ice whitening over the biome colour.
    // The tundra grey ([140,148,133]) is neither bright enough nor as neutral.
    if (min > 175 && max - min < 45) {
      ice++;
      continue;
    }
    if (max - min <= 25) continue; // low-chroma but not ice: skip for hue counts
    chromatic++;
    if (b === max && b - Math.min(r, g) > 20) blue++; // ocean
    else if (g === max && g - b > 15) green++; // forest / vegetation
    else if (r === max && g > b) tan++; // desert / grassland / bare
  }
  const hasOcean = blue > n * 0.005;
  const hasVegetation = green > n * 0.005;
  const hasArid = tan > n * 0.005;
  const hueFamilies = (hasOcean ? 1 : 0) + (hasVegetation ? 1 : 0) + (hasArid ? 1 : 0);
  return {
    litFraction: lit / n,
    chromaticFraction: chromatic / n,
    iceFraction: ice / n,
    hasOcean,
    hasVegetation,
    hasArid,
    hueFamilies,
  };
}

async function waitForHistoryDone(page: Page, timeout: number): Promise<void> {
  await page.waitForSelector('[data-planet-ready="1"]', { timeout });
  await expect(page.locator('[data-history-progress]')).toHaveAttribute(
    'data-history-progress',
    'done',
    { timeout },
  );
}

/** Assert the five position screenshots differ pairwise — the planet evolves. */
function expectPositionsDiffer(shots: Buffer[], label: string): void {
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) {
      const d = diffFraction(shots[i]!, shots[j]!);
      expect(d, `${label} positions ${i} and ${j} differ meaningfully (${d.toFixed(4)})`).toBeGreaterThan(
        0.01,
      );
    }
  }
}

/** Drive the timeline to the five acceptance fractions; screenshot each. */
async function captureFivePositions(page: Page, prefix: string): Promise<Buffer[]> {
  // The green "cached" badge only exists on hydrated runs; hide it so a rerun
  // comparison sees identical HUDs (matches phase2-acceptance).
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

test('the from-orbit planet is biome-coloured with ice, and evolves across the timeline (#36)', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(600_000);
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // WebGPU must be available — rendering IS what is under test (fail, not skip).
  await page.goto('/?until=500e6');
  const hasWebGpu = await page.evaluate(() => 'gpu' in navigator);
  expect(hasWebGpu, 'navigator.gpu missing — launch args / browser problem').toBe(true);

  // Reduced 500 Myr span: real tectonics + a populated climate (temperature,
  // precipitation, ice, biomes all solved every step), streamed in ~1 min.
  await waitForHistoryDone(page, 300_000);
  const shots = await captureFivePositions(page, 'phase3-accept');

  // The planet evolves across the span: the five positions differ pairwise —
  // continents drift and the climate/biome/ice fields change under them.
  expectPositionsDiffer(shots, 'reduced-span');

  // The end-of-span frame is a living, biome-coloured world (the eyeball is the
  // committed screenshot; these are the regression tripwires).
  const end = analyzeFrame(shots[shots.length - 1]!);
  console.log(`[#36] end-of-span render: ${JSON.stringify(end)}`);
  expect(end.litFraction, `lit ${end.litFraction.toFixed(3)}`).toBeGreaterThan(0.05);
  expect(end.chromaticFraction, `chromatic ${end.chromaticFraction.toFixed(3)}`).toBeGreaterThan(0.02);
  // Ocean, vegetation and arid/bare families are all present on the globe. NOTE:
  // this is a liveness/eyeball check — hue families alone do NOT distinguish a
  // biome ramp from a hypsometric one (both show blue/green/tan). That the land
  // colour is genuinely biome-driven (climate, not height) is proven
  // deterministically in the kernel: `test/invariants/phase3.test.ts` →
  // "the from-orbit colour is biome-driven, not hypsometric".
  expect(end.hueFamilies, `biome hue families ${end.hueFamilies}`).toBeGreaterThanOrEqual(2);
  // Rain shadows read in the live render THROUGH the biome ramp: the wet windward
  // margins are vegetated (green) while the dry continental interiors / mountain
  // lees are arid (tan desert & grassland). Both families present is the
  // rain-shadow signature in the from-orbit view (the field itself is the
  // committed --dump precipitation PNG; the render is biome-driven, #35).
  expect(end.hasVegetation, 'wet (green) biomes present').toBe(true);
  expect(end.hasArid, 'arid (tan) rain-shadow / dry-interior biomes present').toBe(true);
  // Ice caps are on the globe (bright near-neutral pixels), but it is not a
  // frozen white ball — a bounded share, the polar caps + montane ice.
  expect(end.iceFraction, `ice ${end.iceFraction.toFixed(4)}`).toBeGreaterThan(0);
  expect(end.iceFraction, `not a snowball ${end.iceFraction.toFixed(4)}`).toBeLessThan(0.4);
});

// The full-length acceptance: the real 4.5 Gyr span at N=128 — ice caps visibly
// breathing and mature biome belts across the scrub. Streams a multi-minute
// history; run manually with PHASE3_FULL=1.
test('full 4.5 Gyr scrub: ice caps breathe and biomes mature (#36, manual)', async ({
  page,
}, testInfo) => {
  test.skip(!process.env['PHASE3_FULL'], 'set PHASE3_FULL=1 for the full-span manual acceptance');
  testInfo.setTimeout(1_800_000);
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await page.goto('/');
  await waitForHistoryDone(page, 1_500_000);

  const shots = await captureFivePositions(page, 'phase3-accept-full');
  expectPositionsDiffer(shots, 'full-span');

  // Ice cover varies across the scrub — the caps breathe — so the per-position
  // ice fractions are not all equal (some advance, some retreat).
  const iceByPos = shots.map((s) => analyzeFrame(s).iceFraction);
  console.log(`[#36] full-span ice fractions by position: ${JSON.stringify(iceByPos.map((v) => Number(v.toFixed(4))))}`);
  const iceSpread = Math.max(...iceByPos) - Math.min(...iceByPos);
  expect(iceSpread, `ice cover varies across the timeline (${iceSpread.toFixed(4)})`).toBeGreaterThan(0.005);
});
