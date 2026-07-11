import { describe, expect, it } from 'vitest';
import {
  EROSION_PRECIP_REF,
  OROGENIC_ROOT_DECAY_TAU_YEARS,
  OROGENIC_ROOT_REFERENCE_M,
  SEDIMENT_SHELF_CEILING_M,
} from '../src/constants';
import { oceanicDepthForAge } from '../src/bathymetry';
import { cellCount, directionToIndex, neighbors } from '../src/grid';
import type { PlanetState } from '../src/state';
import { erosionSystem } from '../src/systems/erosion';
import { normalize3 } from '../src/vec';
import { runSystems, twoPlateState } from './helpers';

const N = 32;

/**
 * Static all-continental world with a uniform reference precipitation field —
 * erosion's precip factor is 1 everywhere, so these tests probe the diffusion /
 * export / decay machinery independent of the climate model (moisture transport,
 * #32, is exercised in its own suite). Tests that need a wet/dry contrast paint
 * `precipitation` directly.
 */
function erosionWorld(): PlanetState {
  const s = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
  const precipitation = s.fields.precipitation.slice();
  precipitation.fill(EROSION_PRECIP_REF);
  return { ...s, fields: { ...s.fields, precipitation } };
}

/**
 * erosionWorld with plate 1's hemisphere turned into submerged old ocean:
 * a real coastline for the export mechanism to work across.
 */
function coastalWorld(): PlanetState {
  const s = erosionWorld();
  const crustType = s.fields.crustType.slice();
  const crustAge = s.fields.crustAge.slice();
  const elevation = s.fields.elevation.slice();
  for (let i = 0; i < cellCount(N); i++) {
    if (s.fields.plateId[i] === 1) {
      crustType[i] = 0;
      crustAge[i] = 100e6; // old floor: age-depth curve at the abyssal clamp
      elevation[i] = oceanicDepthForAge(100e6);
    }
  }
  return { ...s, fields: { ...s.fields, crustType, crustAge, elevation } };
}

/** Kahan sum of a field over cells passing `include`. */
function fieldSum(
  state: PlanetState,
  field: Float32Array,
  include: (i: number) => boolean,
): number {
  let sum = 0;
  let c = 0;
  for (let i = 0; i < field.length; i++) {
    if (!include(i)) continue;
    const y = field[i]! - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

function continentalSum(state: PlanetState): number {
  return fieldSum(state, state.fields.elevation, (i) => state.fields.crustType[i] === 1);
}

function sedimentSum(state: PlanetState): number {
  return fieldSum(state, state.fields.sedimentM, () => true);
}

describe('erosion (#19)', () => {
  it('conserves continental elevation exactly in a landlocked world below the decay reference', () => {
    let state = erosionWorld();
    const elevation = state.fields.elevation.slice();
    // Rough relief, all below OROGENIC_ROOT_REFERENCE_M so the (deliberately
    // non-conservative) root decay contributes nothing: with no ocean and no
    // roots, diffusion must still be pure redistribution.
    for (let i = 0; i < cellCount(N); i++) {
      elevation[i] = (i * 2654435761) % 7 === 0 ? 900 : 200;
    }
    state = { ...state, fields: { ...state.fields, elevation } };
    const before = continentalSum(state);
    const after = runSystems(state, 50, [erosionSystem]);
    expect(Math.abs(continentalSum(after) - before)).toBeLessThan(Math.abs(before) * 1e-5 + 1);
    expect(sedimentSum(after)).toBe(0); // landlocked: nothing to export to
  });

  it('spreads and lowers an isolated peak; max elevation decays monotonically', () => {
    let state = erosionWorld();
    const peak = directionToIndex(normalize3([0.2, 0.4, 0.9]), N);
    const elevation = state.fields.elevation.slice();
    elevation[peak] = 5000;
    state = { ...state, fields: { ...state.fields, elevation } };

    let lastMax = 5000;
    for (let k = 0; k < 10; k++) {
      state = runSystems(state, 5, [erosionSystem]);
      let max = -Infinity;
      for (const e of state.fields.elevation) max = Math.max(max, e);
      expect(max).toBeLessThan(lastMax);
      lastMax = max;
    }
    // The removed volume went to the peak's neighborhood.
    for (const nb of neighbors(peak, N)) {
      expect(state.fields.elevation[nb]).toBeGreaterThan(0);
    }
    expect(state.fields.elevation[peak]).toBeLessThan(5000);
    expect(state.fields.elevation[peak]).toBeGreaterThan(0);
  });

  it('erodes a wet peak faster than an identical dry peak (precip drives the rate)', () => {
    // Two identical 5 km peaks; the only difference is the precipitation painted
    // on each and its neighbourhood (the diffusion flux reads the pair mean), so
    // any difference in denudation is precipitation's doing — the coupling that
    // erosion inherits for free once moisture transport (#32) fills the field.
    let state = erosionWorld();
    const wet = directionToIndex(normalize3([0.95, 0.02, 0.3]), N);
    const dry = directionToIndex(normalize3([0.3, 0.9, 0.3]), N);
    const elevation = state.fields.elevation.slice();
    const precipitation = state.fields.precipitation.slice();
    for (const [cell, precip] of [
      [wet, 2000],
      [dry, 200],
    ] as const) {
      elevation[cell] = 5000;
      precipitation[cell] = precip;
      for (const nb of neighbors(cell, N)) precipitation[nb] = precip;
    }
    state = { ...state, fields: { ...state.fields, elevation, precipitation } };
    const end = runSystems(state, 20, [erosionSystem]);
    const wetDrop = 5000 - end.fields.elevation[wet]!;
    const dryDrop = 5000 - end.fields.elevation[dry]!;
    expect(wetDrop).toBeGreaterThan(dryDrop * 1.5);
  });

  it('never writes oceanic elevation — export lands in sedimentM instead', () => {
    let state = erosionWorld();
    const crustType = state.fields.crustType.slice();
    const elevation = state.fields.elevation.slice();
    // Make plate 1 oceanic with a marker elevation.
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.plateId[i] === 1) {
        crustType[i] = 0;
        elevation[i] = -4321;
      } else {
        elevation[i] = 2000;
      }
    }
    state = { ...state, fields: { ...state.fields, crustType, elevation } };
    const end = runSystems(state, 20, [erosionSystem]);
    let sedimentedOceanCells = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (end.fields.crustType[i] === 0) {
        expect(end.fields.elevation[i]).toBe(-4321);
        if (end.fields.sedimentM[i]! > 0) sedimentedOceanCells++;
      } else {
        expect(end.fields.sedimentM[i]).toBe(0);
      }
    }
    // The coastline did export: sediment appeared on oceanic cells.
    expect(sedimentedOceanCells).toBeGreaterThan(0);
  });
});

describe('coastal sediment export (#65)', () => {
  it('conserves continental elevation + ocean sediment across the coastline', () => {
    let state = coastalWorld();
    const elevation = state.fields.elevation.slice();
    // Continental relief kept below the decay reference so export+diffusion
    // is the only active machinery; the invariant is Σ(cont elev) + Σ(sediment).
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.crustType[i] !== 1) continue;
      elevation[i] = (i * 2654435761) % 7 === 0 ? 900 : 300;
    }
    state = { ...state, fields: { ...state.fields, elevation } };
    const before = continentalSum(state) + sedimentSum(state);
    const after = runSystems(state, 50, [erosionSystem]);
    const exported = sedimentSum(after);
    expect(exported).toBeGreaterThan(0); // the sink actually engaged
    expect(Math.abs(continentalSum(after) + exported - before)).toBeLessThan(
      Math.abs(before) * 1e-5 + 1,
    );
  });

  it('fills the shelf toward the ceiling and stops there', () => {
    let state = coastalWorld();
    const elevation = state.fields.elevation.slice();
    const sedimentM = state.fields.sedimentM.slice();
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.crustType[i] === 1) {
        elevation[i] = 900;
      } else {
        // A shelf already filled to 20 m below the ceiling: steady coastal
        // supply must close the last 20 m and then STOP at the cap — an
        // uncapped export would blow straight past it within a few steps.
        sedimentM[i] =
          SEDIMENT_SHELF_CEILING_M - 20 - oceanicDepthForAge(state.fields.crustAge[i]!);
      }
    }
    state = { ...state, fields: { ...state.fields, elevation, sedimentM } };
    const end = runSystems(state, 200, [erosionSystem]); // 200 Myr of supply
    let saturated = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (end.fields.crustType[i] !== 0) continue;
      const target = oceanicDepthForAge(end.fields.crustAge[i]!) + end.fields.sedimentM[i]!;
      expect(target).toBeLessThanOrEqual(SEDIMENT_SHELF_CEILING_M + 1e-3);
      if (target > SEDIMENT_SHELF_CEILING_M - 1) saturated++;
    }
    expect(saturated).toBeGreaterThan(0);
  });

  it('never draws a coastal cell below sea level', () => {
    // A lone continental island: no continental pairs (no diffusion), below
    // the decay reference — export is the only term, and its flux vanishes at
    // the datum, so elevation decays toward 0 without ever crossing it.
    // marinePlanation (default on since the #88/#90 promotion) is pinned OFF
    // here: it deliberately planes small islands BELOW sea level (to the
    // −200 m shelf), and this test isolates the #65 ordinary-export term,
    // whose no-crossing property must keep holding on its own.
    let state = coastalWorld();
    state = { ...state, params: { ...state.params, marinePlanation: false } };
    const crustType = state.fields.crustType.slice();
    const crustAge = state.fields.crustAge.slice();
    const elevation = state.fields.elevation.slice();
    const island = directionToIndex(normalize3([0, -0.4, -0.9]), N); // plate 1 side
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.plateId[i] === 0) {
        crustType[i] = 0;
        crustAge[i] = 100e6;
        elevation[i] = oceanicDepthForAge(100e6);
      }
    }
    crustType[island] = 1;
    elevation[island] = 500;
    state = { ...state, fields: { ...state.fields, crustType, crustAge, elevation } };
    let last = 500;
    for (let k = 0; k < 10; k++) {
      state = runSystems(state, 50, [erosionSystem]);
      const e = state.fields.elevation[island]!;
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThan(last);
      last = e;
    }
  });
});

describe('orogenic root decay (#65)', () => {
  it('relaxes a uniform highland toward the reference with the e-folding time', () => {
    let state = erosionWorld();
    const elevation = state.fields.elevation.slice();
    elevation.fill(3000); // uniform: diffusion is exactly zero, decay isolated
    state = { ...state, fields: { ...state.fields, elevation } };
    const steps = Math.round(OROGENIC_ROOT_DECAY_TAU_YEARS / state.params.stepYears); // 1 tau
    const end = runSystems(state, steps, [erosionSystem]);
    const expected =
      OROGENIC_ROOT_REFERENCE_M + (3000 - OROGENIC_ROOT_REFERENCE_M) * Math.exp(-1);
    for (const e of end.fields.elevation) {
      expect(Math.abs(e - expected)).toBeLessThan(10);
    }
  });

  it('leaves terrain at or below the reference untouched', () => {
    let state = erosionWorld();
    const elevation = state.fields.elevation.slice();
    elevation.fill(800); // uniform and below the reference: nothing may move
    state = { ...state, fields: { ...state.fields, elevation } };
    const end = runSystems(state, 300, [erosionSystem]);
    for (const e of end.fields.elevation) expect(e).toBe(800);
  });

  it('retires an interior belt at the orogeny ceiling within a gigayear', () => {
    let state = erosionWorld();
    const elevation = state.fields.elevation.slice();
    elevation.fill(200);
    // A welded-in 3-cell-wide belt at the 9 km cap: the "old mountains never
    // die" case — pure diffusion left belts like this high for the whole run.
    const center = directionToIndex(normalize3([0.3, 0.2, 0.9]), N);
    elevation[center] = 9000;
    for (const nb of neighbors(center, N)) {
      elevation[nb] = 9000;
      for (const nb2 of neighbors(nb, N)) elevation[nb2] = 9000;
    }
    state = { ...state, fields: { ...state.fields, elevation } };
    const end = runSystems(state, 500, [erosionSystem]); // 500 Myr
    let max = -Infinity;
    for (const e of end.fields.elevation) max = Math.max(max, e);
    // Decay alone brings 9 km to ~2.5 km in 500 Myr; diffusion removes more.
    expect(max).toBeLessThan(3000);
    expect(max).toBeGreaterThan(0);
  });
});
