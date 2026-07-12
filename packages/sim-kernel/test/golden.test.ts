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
describe('golden field hashes: #88-#91 mechanism prototypes on', () => {
  const MECHS = [
    ['crustFates', { crustFates: true }],
    ['compactArcs', { compactArcs: true }],
    ['marinePlanation', { marinePlanation: true }],
    ['emergentArcTaper', { emergentArcTaper: true }],
    ['seaLevelDatums', { seaLevelDatums: true }],
    ['freeboard', { freeboard: true }],
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
