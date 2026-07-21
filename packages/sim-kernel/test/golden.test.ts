import { describe, expect, it } from 'vitest';
import { CONTINENTAL_BUOYANCY_FACTOR, CONTINENTAL_ISOSTASY_DATUM_M } from '../src/constants';
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
  emergentSuture: false,
  tensionRift: false,
  crustalColumns: false,
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
 * Pre-V2-promotion default spine: the shipped DEFAULT world with the three
 * Tectonics V2 mechanisms (#111/#112/#113) AND the datum trio (#127 item 9)
 * explicitly off, everything else at its default (crustFates + marinePlanation
 * on). These are the exact hashes the MAIN goldens carried BEFORE the
 * KERNEL_BEHAVIOR_VERSION 17 promotion (auto-populated verbatim, not
 * regenerated). Both the V2 flags and the datum trio are pinned off here so the
 * v18 datum promotion cannot silently drift this spine — it keeps pinning the
 * pre-V2 world byte-identically, proving the V2 flag-off code path is unchanged
 * on the real default world, not merely on the all-off world the legacy spine
 * covers.
 */
describe('golden field hashes: pre-V2-promotion default (V2 + datum trio off)', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: initial state and after 10 steps`, () => {
      const params = createPlanetParams({
        seed,
        forceKinematics: false,
        emergentSuture: false,
        tensionRift: false,
        seaLevelDatums: false,
        freeboard: false,
        bathymetryDatum: false,
      });
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
 * Pre-datum-promotion default spine (#127 item 9): the shipped DEFAULT world
 * with ONLY the three datum flags (`seaLevelDatums`/`freeboard`/`bathymetryDatum`)
 * explicitly off, the V2 stack at its v17 defaults (crustFates + marinePlanation
 * + forceKinematics + emergentSuture + tensionRift on). These are the exact
 * hashes the MAIN goldens above carried BEFORE the KERNEL_BEHAVIOR_VERSION 18
 * datum promotion (auto-populated verbatim, not regenerated), so they pin that
 * the promotion changed ONLY the three datum defaults — the datum-off code path
 * stays byte-identical on the real V2 default world.
 */
describe('golden field hashes: pre-datum-promotion default (seaLevelDatums/freeboard/bathymetryDatum off)', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: initial state and after 10 steps`, () => {
      const params = createPlanetParams({
        seed,
        seaLevelDatums: false,
        freeboard: false,
        bathymetryDatum: false,
      });
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

/**
 * Crustal-columns flag-arm spines (docs/CRUSTAL_COLUMN_PROPOSAL.md §6),
 * currently at stage C4 (erosion C2, the vertical injectors C3, the site-20
 * servo retirement pulled forward from C5, and the C4 creation re-key —
 * absolute maturation gate + sediment accretion — are thickness-space mass
 * transactions; margin/founder writers remain C1 shims). Regenerated at each
 * stage per the owner's KBV-cadence decision (proposal §11 answer 4): the
 * flag-off MAIN goldens are untouched, only this arm moves. Two arms: the
 * ISOLATED arm pins the path under ALL_MECHANISMS_OFF (the cleanest
 * exercise of the tectonics/boundaries/erosion writers alone); the ENGAGED
 * arm pins it riding the shipped DEFAULT stack, with the bit-exact
 * coherence assertion guarding engagement — a flag-off world fails it
 * (elevation evolves rawly), so this spine can never silently pin an inert
 * path (the #102 engaged-golden precedent). Both use onset 0. Initial
 * states are field-identical to flag-off (the founding synthesis is
 * unconditional), so only stepped hashes are pinned.
 */
describe('golden field hashes: crustalColumns (isolated + engaged)', () => {
  it('seed 42: after 10 steps, isolated under ALL_MECHANISMS_OFF', () => {
    const params = createPlanetParams({ seed: 42, ...ALL_MECHANISMS_OFF, crustalColumns: true });
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let stepped = createInitialState(params);
    for (let i = 0; i < 10; i++) {
      stepped = step(stepped, params.stepYears, ctx);
    }
    expect({
      after10Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
    }).toMatchSnapshot();
  });

  it('seed 42, N=32: after 30 steps on the DEFAULT world, derivation engaged', () => {
    const params = createPlanetParams({ seed: 42, gridN: 32, crustalColumns: true });
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let stepped = createInitialState(params);
    for (let i = 0; i < 30; i++) {
      stepped = step(stepped, params.stepYears, ctx);
    }
    // Engagement guard: every continental cell's elevation IS the derivation
    // (bit-exact) — provably not the flag-off path.
    const { elevation, crustType, crustalThicknessM } = stepped.fields;
    let incoherent = 0;
    for (let i = 0; i < elevation.length; i++) {
      if (crustType[i] !== 1) continue;
      const derived = Math.fround(
        CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * crustalThicknessM[i]!,
      );
      if (elevation[i] !== derived) incoherent++;
    }
    expect(incoherent).toBe(0);
    expect({
      after30Steps: { timeYears: stepped.timeYears, ...fieldHashes(stepped) },
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
