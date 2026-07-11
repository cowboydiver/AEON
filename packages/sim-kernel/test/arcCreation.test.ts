import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge } from '../src/bathymetry';
import {
  ARC_EMERGENT_GROWTH_FACTOR,
  ARC_GROWTH_RATE_M_PER_YR,
  ARC_MAX_ELEVATION_M,
  OROGENY_STRESS_REF_M_PER_YR,
} from '../src/constants';
import { cellCount, neighbors } from '../src/grid';
import { applyConvergentTopography } from '../src/systems/boundaries';
import type { PlanetState } from '../src/state';
import { runSystems, twoPlateState, type TestPlateSpec } from './helpers';

/**
 * Arc-creation gates (#89 compact maturation, #91 emergent-growth taper).
 * The surgical tests drive applyConvergentTopography directly with a
 * hand-built stress field — one active margin cell, everything else quiet —
 * so a single cell's maturation/growth is the entire observable.
 */
const N = 32;
const OMEGA = 4e-9;
const P0: TestPlateSpec = { pole: [1, 0, 0], omega: OMEGA };
const P1: TestPlateSpec = { pole: [1, 0, 0], omega: -OMEGA };

/**
 * All-oceanic two-plate world (plate 0 young floor, plate 1 old, so plate 0
 * overrides at any convergent contact) plus one chosen boundary cell on
 * plate 0 with at least `wantP0Neighbors` same-plate neighbors.
 */
function arcWorld(wantP0Neighbors: number): { state: PlanetState; cell: number; p0nb: number[] } {
  const s = twoPlateState(N, P0, P1);
  const crustType = s.fields.crustType.slice().fill(0);
  const crustAge = s.fields.crustAge.slice();
  const elevation = s.fields.elevation.slice();
  for (let i = 0; i < cellCount(N); i++) {
    crustAge[i] = s.fields.plateId[i] === 0 ? 10e6 : 90e6;
    elevation[i] = oceanicDepthForAge(crustAge[i]!);
  }
  const state: PlanetState = { ...s, fields: { ...s.fields, crustType, crustAge, elevation } };
  for (let i = 0; i < cellCount(N); i++) {
    if (state.fields.plateId[i] !== 0) continue;
    const nbs = neighbors(i, N);
    const other = nbs.filter((nb) => state.fields.plateId[nb] === 1);
    const same = nbs.filter((nb) => state.fields.plateId[nb] === 0);
    if (other.length >= 1 && same.length >= wantP0Neighbors) {
      return { state, cell: i, p0nb: same };
    }
  }
  throw new Error('no suitable boundary cell found');
}

/** Stress field active (at the reference speed, norm = 1) on one cell only. */
function stressAt(cell: number): Float32Array {
  const stress = new Float32Array(cellCount(N));
  stress[cell] = OROGENY_STRESS_REF_M_PER_YR;
  return stress;
}

const DT = 1e6;
// N=32 is the reference grid: the arc rate carries no resolution scaling.
const FULL_GROWTH = ARC_GROWTH_RATE_M_PER_YR * DT;

describe('compact arc maturation (#89)', () => {
  function matureScenario(contNeighbors: number, compactArcs: boolean): number {
    const { state: base, cell, p0nb } = arcWorld(2);
    const crustType = base.fields.crustType.slice();
    const elevation = base.fields.elevation.slice();
    // Continental neighbors: 1 = a straight coast-parallel chain cell,
    // 2 = a bay/concavity cell.
    for (let k = 0; k < contNeighbors; k++) crustType[p0nb[k]!] = 1;
    // The arc has already built to the maturation gate.
    elevation[cell] = -400;
    const state: PlanetState = {
      ...base,
      params: { ...base.params, compactArcs },
      fields: { ...base.fields, crustType, elevation },
    };
    const workElev = state.fields.elevation.slice();
    const workCrust = state.fields.crustType.slice();
    applyConvergentTopography(state, stressAt(cell), workElev, workCrust, DT);
    return workCrust[cell]!;
  }

  it('gate off: a chain cell with 1 continental neighbor matures (belt rule only)', () => {
    expect(matureScenario(1, false)).toBe(1);
  });

  it('gate on: the same chain cell stays an oceanic arc', () => {
    expect(matureScenario(1, true)).toBe(0);
  });

  it('gate on: a concavity cell with 2 continental neighbors matures', () => {
    expect(matureScenario(2, true)).toBe(1);
  });

  it('gate on but pre-onset: chain-cell maturation is unchanged (#89 branched A/B)', () => {
    const { state: base, cell, p0nb } = arcWorld(1);
    const crustType = base.fields.crustType.slice();
    const elevation = base.fields.elevation.slice();
    crustType[p0nb[0]!] = 1;
    elevation[cell] = -400;
    const state: PlanetState = {
      ...base,
      timeYears: 5e6,
      params: { ...base.params, compactArcs: true, compactArcsOnsetYears: 10e6 },
      fields: { ...base.fields, crustType, elevation },
    };
    const workElev = state.fields.elevation.slice();
    const workCrust = state.fields.crustType.slice();
    applyConvergentTopography(state, stressAt(cell), workElev, workCrust, DT);
    expect(workCrust[cell]).toBe(1);
  });
});

describe('emergent-arc growth taper (#91)', () => {
  function grow(startElev: number, emergentArcTaper: boolean): number {
    const { state: base, cell } = arcWorld(1);
    const elevation = base.fields.elevation.slice();
    elevation[cell] = startElev;
    const state: PlanetState = {
      ...base,
      params: { ...base.params, emergentArcTaper },
      fields: { ...base.fields, elevation },
    };
    const workElev = state.fields.elevation.slice();
    const workCrust = state.fields.crustType.slice();
    applyConvergentTopography(state, stressAt(cell), workElev, workCrust, DT);
    return workElev[cell]!;
  }

  it('submarine growth is at the full rate with or without the taper', () => {
    // Deep arc: one growth quantum keeps it below sea level → identical arms,
    // so the −500 m maturation gate is reached exactly as fast (creation
    // budget untouched).
    const start = -3000;
    expect(grow(start, true)).toBe(grow(start, false));
    expect(grow(start, false)).toBeCloseTo(start + FULL_GROWTH, 6);
  });

  it('growth crossing sea level applies the taper to the emergent remainder only', () => {
    const start = -100;
    // Off: -100 + 1250 clamps at the +1 km arc ceiling.
    expect(grow(start, false)).toBe(Math.min(start + FULL_GROWTH, ARC_MAX_ELEVATION_M));
    // On: 100 m submerged at full rate, the remaining 1150 m tapered ×0.05.
    expect(grow(start, true)).toBeCloseTo((FULL_GROWTH + start) * ARC_EMERGENT_GROWTH_FACTOR, 6);
  });

  it('an already-emergent arc grows only at the tapered rate', () => {
    const start = 100;
    expect(grow(start, true)).toBeCloseTo(start + FULL_GROWTH * ARC_EMERGENT_GROWTH_FACTOR, 6);
  });

  it('keeps young margins submerged in a real subduction run', () => {
    // The convergence.test.ts ocean-ocean world: plate 0 (young) overrides
    // and builds an arc for 5 Myr. Without the taper the arc breaches and
    // races toward +1 km; with it, emergent relief accumulates at 5% per
    // active step and stays low.
    const mkStart = (emergentArcTaper: boolean): PlanetState => {
      const s = twoPlateState(N, P0, P1);
      const elevation = s.fields.elevation.slice();
      const crustType = s.fields.crustType.slice().fill(0);
      const crustAge = s.fields.crustAge.slice();
      for (let i = 0; i < cellCount(N); i++) {
        crustAge[i] = s.fields.plateId[i] === 0 ? 10e6 : 90e6;
        elevation[i] = oceanicDepthForAge(crustAge[i]!);
      }
      return {
        ...s,
        params: { ...s.params, emergentArcTaper },
        fields: { ...s.fields, elevation, crustType, crustAge },
      };
    };
    const arcMax = (state: PlanetState): number => {
      let max = -Infinity;
      for (let i = 0; i < cellCount(N); i++) {
        if (state.fields.plateId[i] === 0 && state.fields.elevation[i]! > max) {
          max = state.fields.elevation[i]!;
        }
      }
      return max;
    };
    const off = arcMax(runSystems(mkStart(false), 5));
    const on = arcMax(runSystems(mkStart(true), 5));
    expect(off).toBeGreaterThan(800); // near the flat +1 km ceiling already
    expect(on).toBeLessThan(300); // emergent tip still low
    expect(on).toBeGreaterThan(0); // ...but the margin IS emerging (long-lived)
  });
});
