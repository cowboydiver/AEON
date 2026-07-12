import { describe, expect, it } from 'vitest';
import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  CONTINENTAL_BUOYANCY_FLOOR_M,
  FREEBOARD_RELAX_M_PER_YR,
  FREEBOARD_TARGET_M,
  OROGENIC_ROOT_DECAY_TAU_YEARS,
  OROGENIC_ROOT_REFERENCE_M,
  OROGENY_MAX_ELEVATION_M,
  PASSIVE_MARGIN_SHELF_M,
  PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR,
  PASSIVE_MARGIN_WIDTH_CELLS,
} from '../src/constants';
import { landDatumOffsetM } from '../src/datums';
import { cellCount, neighborTable } from '../src/grid';
import { createRng } from '../src/rng';
import type { PlanetState } from '../src/state';
import type { SimContext } from '../src/step';
import { erosionSystem } from '../src/systems/erosion';
import { freeboardSystem } from '../src/systems/freeboard';
import { runSystems, twoPlateState, type TestPlateSpec } from './helpers';

/**
 * Freeboard regulation (the follow-up scoped in docs/SEA_LEVEL_DATUM_FINDINGS.md):
 * continental crust floats — its cell-count-mean elevation relaxes toward a
 * target freeboard above the DYNAMIC sea level, passive margins subside toward
 * shelf depth, and the land-relief datums (orogenic-root reference, orogeny
 * ceiling) key off the sea level. Every test pins the flag-on arithmetic
 * against a hand-set fallen sea; flag-off byte-identity is pinned by the main
 * goldens (freeboard defaults off).
 */

const N = 8;
const STILL: TestPlateSpec = { pole: [0, 0, 1], omega: 0 };
const FALLEN_SEA_M = -3000;
const DT = 1e6; // twoPlateState's default stepYears

const ctx = (): SimContext => ({ rng: createRng(7).fork('sim') });

function withFreeboard(state: PlanetState, seaLevelM: number): PlanetState {
  return {
    ...state,
    params: { ...state.params, freeboard: true },
    globals: { ...state.globals, seaLevelM },
  };
}

describe('freeboard: continental relaxation', () => {
  it('flag-off: the system is identity (same state reference)', () => {
    const base = twoPlateState(N, STILL, STILL);
    const fallen = { ...base, globals: { ...base.globals, seaLevelM: FALLEN_SEA_M } };
    expect(freeboardSystem.apply(fallen, DT, ctx())).toBe(fallen);
  });

  it('sinks the whole continental stack at the rate bound, preserving relief', () => {
    const base = twoPlateState(N, STILL, STILL); // all continental, elevation 0
    base.fields.elevation[0] = 500;
    const out = runSystems(withFreeboard(base, FALLEN_SEA_M), 1, [freeboardSystem]);
    const bound = FREEBOARD_RELAX_M_PER_YR * DT;
    // Mean (~1.3 m) sits ~2.6 km above the target level (sea + target): the
    // gap far exceeds the per-step bound, so the shift is exactly the bound.
    expect(out.fields.elevation[0]).toBeCloseTo(500 - bound, 4);
    expect(out.fields.elevation[1]).toBeCloseTo(-bound, 4);
    // A uniform shift: relief is untouched.
    expect(out.fields.elevation[0]! - out.fields.elevation[1]!).toBeCloseTo(500, 4);
  });

  it('converges exactly (no overshoot) inside the rate bound, in both directions', () => {
    const base = twoPlateState(N, STILL, STILL);
    base.fields.elevation.fill(FREEBOARD_TARGET_M - 5); // 5 m below target, sea at 0
    const up = runSystems(withFreeboard(base, 0), 1, [freeboardSystem]);
    expect(up.fields.elevation[0]).toBeCloseTo(FREEBOARD_TARGET_M, 4);
    expect(up.fields.elevation[100]).toBeCloseTo(FREEBOARD_TARGET_M, 4);
  });

  it('the downward shift stops at the buoyancy floor and never lifts cells below it', () => {
    const base = twoPlateState(N, STILL, STILL); // all continental, elevation 0
    const floor = FALLEN_SEA_M + CONTINENTAL_BUOYANCY_FLOOR_M; // −5500
    base.fields.elevation[0] = floor + 5; // 5 m of room left above the floor
    base.fields.elevation[1] = floor - 100; // already below (trench debris)
    const out = runSystems(withFreeboard(base, FALLEN_SEA_M), 1, [freeboardSystem]);
    const bound = FREEBOARD_RELAX_M_PER_YR * DT;
    // Mean (~0) far above target (−2600): the shift is the full bound, down.
    expect(out.fields.elevation[2]).toBeCloseTo(-bound, 4); // ordinary cell sinks
    expect(out.fields.elevation[0]).toBeCloseTo(floor, 4); // clamped, not −5515
    expect(out.fields.elevation[1]).toBeCloseTo(floor - 100, 4); // never lifted
  });

  it('never touches oceanic cells; a different-plate ocean neighbor is not a passive margin', () => {
    const base = twoPlateState(N, STILL, STILL);
    // Plate 1's hemisphere becomes deep ocean; plate 0 stays continental at 0 m.
    for (let i = 0; i < cellCount(N); i++) {
      if (base.fields.plateId[i] === 1) {
        base.fields.crustType[i] = 0;
        base.fields.elevation[i] = -4000;
      }
    }
    const out = runSystems(withFreeboard(base, FALLEN_SEA_M), 1, [freeboardSystem]);
    const bound = FREEBOARD_RELAX_M_PER_YR * DT;
    for (let i = 0; i < cellCount(N); i++) {
      if (base.fields.crustType[i] === 0) {
        expect(out.fields.elevation[i]).toBe(-4000);
      } else {
        // Continental coast cells here face a DIFFERENT plate's ocean (the
        // plate boundary) — an active margin, no passive-margin subsidence:
        // the uniform shift is the only change.
        expect(out.fields.elevation[i]).toBeCloseTo(-bound, 4);
      }
    }
  });
});

describe('freeboard: passive-margin subsidence', () => {
  /** One-plate world, one oceanic cell at `oceanCell`, everything else
   *  continental at exactly the freeboard target level (so the uniform
   *  relaxation delta is exactly 0 and the margin term is isolated). */
  function marginState(oceanCell: number): PlanetState {
    const base = twoPlateState(N, STILL, STILL);
    base.fields.plateId.fill(0); // same-plate ocean = passive margin
    base.fields.elevation.fill(FALLEN_SEA_M + FREEBOARD_TARGET_M);
    base.fields.crustType[oceanCell] = 0;
    base.fields.elevation[oceanCell] = -6000;
    return withFreeboard(base, FALLEN_SEA_M);
  }

  /** BFS depth from the ocean cell through continental cells (depth 1 = coast). */
  function bandDepths(state: PlanetState, oceanCell: number): Int32Array {
    const count = cellCount(N);
    const nb = neighborTable(N);
    const depth = new Int32Array(count).fill(-1);
    let frontier = [oceanCell];
    depth[oceanCell] = 0;
    for (let d = 1; frontier.length > 0; d++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let k = 0; k < 4; k++) {
          const n = nb[c * 4 + k]!;
          if (depth[n] === -1 && state.fields.crustType[n] === 1) {
            depth[n] = d;
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return depth;
  }

  it('subsides the band within PASSIVE_MARGIN_WIDTH_CELLS of same-plate ocean, and nothing beyond', () => {
    const state = marginState(0);
    const depth = bandDepths(state, 0);
    const out = runSystems(state, 1, [freeboardSystem]);
    const sub = PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR * DT;
    const level = FALLEN_SEA_M + FREEBOARD_TARGET_M;
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.crustType[i] !== 1) continue;
      if (depth[i]! >= 1 && depth[i]! <= PASSIVE_MARGIN_WIDTH_CELLS) {
        expect(out.fields.elevation[i]).toBeCloseTo(level - sub, 4);
      } else {
        expect(out.fields.elevation[i]).toBeCloseTo(level, 4);
      }
    }
  });

  it('excludes convergent (active-margin) cells from subsidence', () => {
    const state = marginState(0);
    const depth = bandDepths(state, 0);
    const coast = [];
    for (let i = 0; i < cellCount(N); i++) if (depth[i] === 1) coast.push(i);
    expect(coast.length).toBeGreaterThan(1);
    const stressed = coast[0]!;
    state.fields.boundaryStress[stressed] = 2 * ACTIVE_MARGIN_STRESS_M_PER_YR;
    const out = runSystems(state, 1, [freeboardSystem]);
    const sub = PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR * DT;
    const level = FALLEN_SEA_M + FREEBOARD_TARGET_M;
    expect(out.fields.elevation[stressed]).toBeCloseTo(level, 4); // orogeny owns this cell
    expect(out.fields.elevation[coast[1]!]).toBeCloseTo(level - sub, 4);
  });

  it('clamps at the shelf target and never raises a cell already below it', () => {
    const state = marginState(0);
    const depth = bandDepths(state, 0);
    const coast = [];
    for (let i = 0; i < cellCount(N); i++) if (depth[i] === 1) coast.push(i);
    const inland = [];
    for (let i = 0; i < cellCount(N); i++) if (depth[i]! > PASSIVE_MARGIN_WIDTH_CELLS + 1) inland.push(i);
    const shelf = FALLEN_SEA_M + PASSIVE_MARGIN_SHELF_M;
    // Deviations sum to zero so the continental mean stays exactly at the
    // target level and the uniform delta stays exactly 0.
    const justAbove = coast[0]!;
    const below = coast[1]!;
    state.fields.elevation[justAbove] = shelf + 5;
    state.fields.elevation[below] = shelf - 50;
    const level = FALLEN_SEA_M + FREEBOARD_TARGET_M;
    const dev = level - (shelf + 5) + (level - (shelf - 50));
    state.fields.elevation[inland[0]!] = level + dev;
    const out = runSystems(state, 1, [freeboardSystem]);
    expect(out.fields.elevation[justAbove]).toBeCloseTo(shelf, 4); // clamped, not overshot
    expect(out.fields.elevation[below]).toBeCloseTo(shelf - 50, 4); // never raised
  });
});

describe('freeboard: land-relief datum re-key', () => {
  it('landDatumOffsetM is seaLevelM when on, 0 when off or before onset', () => {
    const base = twoPlateState(N, STILL, STILL);
    const fallen = { ...base, globals: { ...base.globals, seaLevelM: FALLEN_SEA_M } };
    expect(landDatumOffsetM(fallen)).toBe(0);
    expect(landDatumOffsetM(withFreeboard(base, FALLEN_SEA_M))).toBe(FALLEN_SEA_M);
    const gated = {
      ...withFreeboard(base, FALLEN_SEA_M),
      params: { ...base.params, freeboard: true, freeboardOnsetYears: 1e9 },
    };
    expect(landDatumOffsetM(gated)).toBe(0);
  });

  it('orogenic root decay relaxes toward seaLevelM + reference when on', () => {
    // A flat all-continental world at 0 m with the sea at −3000 m: flag-off,
    // 0 m is below the +1000 m ABSOLUTE reference and nothing decays; flag-on,
    // the reference is −2000 m and the whole surface carries 2 km of excess
    // root. Uniform elevation and zero precipitation keep every other erosion
    // term at exactly zero.
    const base = twoPlateState(N, STILL, STILL);
    const off = runSystems(
      { ...base, globals: { ...base.globals, seaLevelM: FALLEN_SEA_M } },
      1,
      [erosionSystem],
    );
    expect(off.fields.elevation[0]).toBe(0);

    const on = runSystems(withFreeboard(base, FALLEN_SEA_M), 1, [erosionSystem]);
    const ref = FALLEN_SEA_M + OROGENIC_ROOT_REFERENCE_M;
    const keep = Math.exp(-DT / OROGENIC_ROOT_DECAY_TAU_YEARS);
    expect(on.fields.elevation[0]).toBeCloseTo(ref + (0 - ref) * keep, 2);
    expect(on.fields.elevation[200]).toBeCloseTo(ref + (0 - ref) * keep, 2);
  });

  it('collision uplift caps at seaLevelM + OROGENY_MAX_ELEVATION_M when on', () => {
    // The convergence-test harness: two continental plates in head-on
    // collision, started just below the re-keyed cap (−3000 + 9000 = 6000 m).
    const OMEGA = 4e-9;
    const collide = twoPlateState(
      32,
      { pole: [1, 0, 0], omega: OMEGA },
      { pole: [1, 0, 0], omega: -OMEGA },
    );
    collide.fields.elevation.fill(5800);
    const globals = { ...collide.globals, seaLevelM: FALLEN_SEA_M };
    const off = runSystems({ ...collide, globals }, 20);
    const on = runSystems(withFreeboard(collide, FALLEN_SEA_M), 20);
    const cap = FALLEN_SEA_M + OROGENY_MAX_ELEVATION_M;
    let offMax = -Infinity;
    let onMax = -Infinity;
    for (let i = 0; i < cellCount(32); i++) {
      offMax = Math.max(offMax, off.fields.elevation[i]!);
      onMax = Math.max(onMax, on.fields.elevation[i]!);
    }
    expect(offMax).toBeGreaterThan(cap + 100); // absolute cap lets it climb past
    expect(onMax).toBeLessThanOrEqual(cap + 1e-3); // re-keyed cap binds
  });
});
