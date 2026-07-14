import { describe, expect, it } from 'vitest';
import { FIELD_NAMES } from '../src/fields';
import { hashFloat32Array } from '../src/hash';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';

/**
 * The project's spine: FNV-1a hashes of every field at fixed checkpoints.
 * If these snapshots change, the physical history of every planet changed.
 * Regenerate ONLY on purpose, with the reason in the commit message:
 *   pnpm -F sim-kernel test -- -u
 */

const GOLDEN_SEEDS = [1, 42, 1337] as const;

/**
 * Explicit off-switches for every mechanism prototype. Since the #88-#91
 * promotion the four mechanisms default ON, so isolating one mechanism (or
 * the legacy kernel path) requires turning the others off explicitly rather
 * than relying on defaults.
 */
const ALL_MECHANISMS_OFF = {
  blockIsostasy: false,
  crustFates: false,
  compactArcs: false,
  marinePlanation: false,
  emergentArcTaper: false,
  seaLevelDatums: false,
  freeboard: false,
  bathymetryDatum: false,
  forceKinematics: false,
} as const;

function fieldHashes(state: PlanetState): Record<string, string> {
  return Object.fromEntries(
    FIELD_NAMES.map((name) => [name, hashFloat32Array(state.fields[name]).toString(16).padStart(8, '0')]),
  );
}

/** Default params — since the #88/#90 promotion that means crustFates and
 *  marinePlanation ON. This is the spine of the shipped planet. */
describe('golden field hashes', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: initial state and after 10 steps`, () => {
      const params = createPlanetParams({ seed });
      const initial = createInitialState(params);
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let stepped = initial;
      for (let i = 0; i < 10; i++) {
        stepped = step(stepped, params.stepYears, ctx);
      }
      expect({
        initial: fieldHashes(initial),
        after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
      }).toMatchSnapshot();
    });
  }
});

/**
 * Non-default golden arm for the #105 water-inventory parameter. Unlike the
 * mechanism prototypes this is a base `PlanetParams` number (like `numPlates`),
 * so it is pinned on the shipped DEFAULT world — the realistic path a
 * higher-water planet takes — with only `waterInventoryScale` changed. The
 * default 1.0 is byte-identical to the pre-#105 kernel (the multiply is exactly
 * ×1.0), so it needs no arm of its own; the MAIN goldens above pin it. This arm
 * pins scale 2.0. The scale changes only `globals.waterInventoryM` at init (not
 * a single field), so the t=0 hashes equal the default's and only the stepped
 * hashes are pinned. The `seaLevelM > 0` assertion guards ENGAGEMENT — a scale-2
 * planet floods above the 0 m datum within ten steps, where the default sea is
 * ~−900 m and falling — so this spine can never silently pin an inert path
 * (the #102 engaged-golden precedent).
 */
describe('golden field hashes: waterInventoryScale 2.0 (#105)', () => {
  it('seed 42: after 10 steps, with the sea flooded above the 0 m datum', () => {
    const params = createPlanetParams({ seed: 42, waterInventoryScale: 2 });
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let stepped = createInitialState(params);
    for (let i = 0; i < 10; i++) {
      stepped = step(stepped, params.stepYears, ctx);
    }
    expect(stepped.globals.seaLevelM).toBeGreaterThan(0);
    expect({
      after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
    }).toMatchSnapshot();
  });
});

/**
 * Non-default golden arm for the #106 initial-land-fraction parameter. Like the
 * #105 water arm this is a base `PlanetParams` number, pinned on the shipped
 * DEFAULT world with only `initialLandFraction` changed. The default 0.3 is
 * byte-identical to the pre-#106 kernel (the sea quantile uses the same `0.3`
 * literal), so the MAIN goldens above pin it and it needs no arm. This arm pins
 * an ocean-dominated 0.15 start. UNLIKE the water arm, the parameter moves the
 * t=0 elevation quantile itself, so EVERY t=0 field differs from the default —
 * hence both the initial and stepped hashes are pinned. The `landFraction ≈ 0.15`
 * assertion guards ENGAGEMENT: it proves the coastline quantile actually shifted
 * to the ocean-dominated regime (vs the default 0.30), so this spine can never
 * silently pin the default path (the #102/#105 engaged-golden precedent).
 */
describe('golden field hashes: initialLandFraction 0.15 (#106)', () => {
  it('seed 42: initial state and after 10 steps, ocean-dominated start', () => {
    const params = createPlanetParams({ seed: 42, initialLandFraction: 0.15 });
    const initial = createInitialState(params);
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let stepped = initial;
    for (let i = 0; i < 10; i++) {
      stepped = step(stepped, params.stepYears, ctx);
    }
    // Engagement: the t=0 coastline is the ocean-dominated 15%, not the default
    // 30% — the sea quantile provably moved.
    expect(initial.globals.landFraction).toBeGreaterThan(0.13);
    expect(initial.globals.landFraction).toBeLessThan(0.17);
    expect({
      initial: fieldHashes(initial),
      after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
    }).toMatchSnapshot();
  });
});

/**
 * Legacy spine: the pre-promotion kernel path with every mechanism off.
 * These hashes are the values the MAIN goldens carried before the #88-#91
 * default-on promotion (copied over verbatim, not regenerated), so they pin
 * that the promotion changed only defaults — the flag-off code path stayed
 * byte-identical.
 */
describe('golden field hashes: legacy all-mechanisms-off', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: initial state and after 10 steps`, () => {
      const params = createPlanetParams({ seed, ...ALL_MECHANISMS_OFF });
      const initial = createInitialState(params);
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let stepped = initial;
      for (let i = 0; i < 10; i++) {
        stepped = step(stepped, params.stepYears, ctx);
      }
      expect({
        initial: fieldHashes(initial),
        after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
      }).toMatchSnapshot();
    });
  }
});

/**
 * Isolated spine for the #84 prototype (still default-off, superseded by
 * crustFates): pinned with the other mechanisms explicitly off, so these are
 * the same hashes the block carried before the promotion. Initial state is
 * identical to flag-off (the system only acts in steps), so only the stepped
 * hashes are pinned.
 */
describe('golden field hashes: blockIsostasy on (#84)', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: after 10 steps`, () => {
      const params = createPlanetParams({ seed, ...ALL_MECHANISMS_OFF, blockIsostasy: true });
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let stepped = createInitialState(params);
      for (let i = 0; i < 10; i++) {
        stepped = step(stepped, params.stepYears, ctx);
      }
      expect({
        after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
      }).toMatchSnapshot();
    });
  }
});

/**
 * Isolated spines for the #88/#89/#90/#91 mechanisms and the
 * sea-level-anchored-datums prototype: each pinned with ONLY that mechanism
 * on (the others explicitly off), so these are the same hashes the block
 * carried before the default-on promotion and each mechanism's own path is
 * pinned against silent drift independently of the combined default world.
 * One seed per mechanism keeps the suite's step budget flat; the
 * onset-gating tests cover the param plumbing on the others.
 */
/**
 * Engaged spine for the #102 bathymetryDatum mechanism. The 10-step arm in
 * the block below pins only the pre-engagement path: the sea-keyed crest cap
 * activates once seaLevelM falls below OCEAN_RIDGE_DEPTH_M −
 * OCEAN_RIDGE_MIN_SUBMERGENCE_M (−2000 m), which takes ~40–60 Myr of basin
 * maturation — ten default steps only reach ~−900 m, where flag-on is
 * byte-identical to flag-off BY DESIGN. This run goes deep enough (N=32
 * keeps it cheap) that the sea-keyed code path provably shapes the hashes;
 * the seaLevelM assertion guards that engagement, so a future constant
 * change can never leave this spine silently pinning an inert path.
 */
describe('golden field hashes: bathymetryDatum engaged (#102)', () => {
  it('seed 42, N=32: after 100 steps, with the sea below the engagement level', () => {
    const params = createPlanetParams({
      seed: 42,
      gridN: 32,
      ...ALL_MECHANISMS_OFF,
      bathymetryDatum: true,
    });
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let stepped = createInitialState(params);
    for (let i = 0; i < 100; i++) {
      stepped = step(stepped, params.stepYears, ctx);
    }
    expect(stepped.globals.seaLevelM).toBeLessThan(-2000);
    expect({
      after100Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
    }).toMatchSnapshot();
  });
});

describe('golden field hashes: #88-#91 mechanism prototypes on', () => {
  const MECHS = [
    ['crustFates', { crustFates: true }],
    ['compactArcs', { compactArcs: true }],
    ['marinePlanation', { marinePlanation: true }],
    ['emergentArcTaper', { emergentArcTaper: true }],
    ['seaLevelDatums', { seaLevelDatums: true }],
    ['freeboard', { freeboard: true }],
    ['bathymetryDatum', { bathymetryDatum: true }],
  ] as const;
  for (const [name, partial] of MECHS) {
    it(`${name} on, seed 42: after 10 steps`, () => {
      const params = createPlanetParams({ seed: 42, ...ALL_MECHANISMS_OFF, ...partial });
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let stepped = createInitialState(params);
      for (let i = 0; i < 10; i++) {
        stepped = step(stepped, params.stepYears, ctx);
      }
      expect({
        after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
      }).toMatchSnapshot();
    });
  }
});
