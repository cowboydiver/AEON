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

function fieldHashes(state: PlanetState): Record<string, string> {
  return Object.fromEntries(
    FIELD_NAMES.map((name) => [name, hashFloat32Array(state.fields[name]).toString(16).padStart(8, '0')]),
  );
}

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
 * Flag-on spine for the #84 prototype: the default-off gate keeps the main
 * goldens byte-identical, but without its own goldens the flag-on path could
 * drift silently under refactors (and a future default-on promotion would
 * have no baseline). Initial state is identical to flag-off (the system only
 * acts in steps), so only the stepped hashes are pinned.
 */
describe('golden field hashes: blockIsostasy on (#84)', () => {
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: after 10 steps`, () => {
      const params = createPlanetParams({ seed, blockIsostasy: true });
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
 * Flag-on spines for the #88/#89/#90/#91 prototypes, same rationale as the
 * #84 block above: default-off keeps the main goldens byte-identical, but
 * each flag-on path needs its own pin against silent drift (and a baseline
 * for any future default-on promotion). One seed per mechanism keeps the
 * suite's step budget flat; the onset-gating tests cover the param plumbing
 * on the others.
 */
describe('golden field hashes: #88-#91 mechanism prototypes on', () => {
  const MECHS = [
    ['crustFates', { crustFates: true }],
    ['compactArcs', { compactArcs: true }],
    ['marinePlanation', { marinePlanation: true }],
    ['emergentArcTaper', { emergentArcTaper: true }],
  ] as const;
  for (const [name, partial] of MECHS) {
    it(`${name} on, seed 42: after 10 steps`, () => {
      const params = createPlanetParams({ seed: 42, ...partial });
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
