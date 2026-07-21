import { describe, expect, it } from 'vitest';
import { oceanicAgeForDepth, oceanicDepthForAge } from '../src/bathymetry';
import {
  CONTINENTAL_BUOYANCY_FACTOR,
  CONTINENTAL_ISOSTASY_DATUM_M,
  CONTINENTAL_THICKNESS_MAX_M,
  OROGENY_MAX_ELEVATION_M,
  OROGENY_RATE_M_PER_YR,
  OROGENY_STRESS_REF_M_PER_YR,
} from '../src/constants';
import { cellCenterDirection, cellCount, neighbors } from '../src/grid';
import {
  continentalElevationForThicknessM,
  foundCrustalThickness,
} from '../src/isostasy';
import { applyConvergentTopography } from '../src/systems/boundaries';
import { runSystems, twoPlateState, type TestPlateSpec } from './helpers';
import type { PlanetState } from '../src/state';

const N = 32;
const OMEGA = 4e-9;
// Plate 0 (z>0) at +ω about +X, plate 1 at −ω: converges near [0,−1,0].
const P0: TestPlateSpec = { pole: [1, 0, 0], omega: OMEGA };
const P1: TestPlateSpec = { pole: [1, 0, 0], omega: -OMEGA };
const CONVERGE_DIR: [number, number, number] = [0, -1, 0];

function inCap(i: number, dir: [number, number, number], minCos: number): boolean {
  const [x, y, z] = cellCenterDirection(i, N);
  return x * dir[0] + y * dir[1] + z * dir[2] >= minCos;
}

function isBoundary(state: PlanetState, i: number): boolean {
  for (const nb of neighbors(i, N)) {
    if (state.fields.plateId[nb] !== state.fields.plateId[i]) return true;
  }
  return false;
}

describe('continent-continent collision (#16)', () => {
  const start = ((): PlanetState => {
    const s = twoPlateState(N, P0, P1); // helper default: all continental
    const elevation = s.fields.elevation.slice();
    elevation.fill(200);
    return { ...s, fields: { ...s.fields, elevation } };
  })();

  it('raises elevation at the convergent boundary monotonically up to the cap', () => {
    let state = start;
    const means: number[] = [];
    for (let round = 0; round < 10; round++) {
      state = runSystems(state, 5);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < cellCount(N); i++) {
        if (!inCap(i, CONVERGE_DIR, 0.93) || !isBoundary(state, i)) continue;
        sum += state.fields.elevation[i]!;
        n++;
      }
      expect(n).toBeGreaterThan(0);
      means.push(sum / n);
    }
    // Monotone non-decreasing throughout; strictly rising while below the
    // ceiling (head-on full-speed collision is allowed to saturate at 9 km).
    for (let k = 1; k < means.length; k++) {
      expect(means[k]!).toBeGreaterThanOrEqual(means[k - 1]!);
      if (means[k - 1]! < OROGENY_MAX_ELEVATION_M * 0.95) {
        expect(means[k]!).toBeGreaterThan(means[k - 1]!);
      }
    }
    // 50 Myr of collision must have built real mountains, capped sanely.
    expect(means[means.length - 1]!).toBeGreaterThan(2000);
    for (const e of state.fields.elevation) expect(e).toBeLessThanOrEqual(OROGENY_MAX_ELEVATION_M);
  });

  it('uplifts both sides of the suture', () => {
    const state = runSystems(start, 50);
    for (const plate of [0, 1]) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < cellCount(N); i++) {
        if (!inCap(i, CONVERGE_DIR, 0.93) || !isBoundary(state, i)) continue;
        if (state.fields.plateId[i] !== plate) continue;
        sum += state.fields.elevation[i]!;
        n++;
      }
      expect(n).toBeGreaterThan(0);
      expect(sum / n).toBeGreaterThan(1500);
    }
  });
});

/**
 * Stage C3 (proposal §5 sites 7/12): under crustalColumns, collision and
 * orogeny are crustal-shortening THICKNESS additions — the same rate
 * constant read as rock, the surface answering k·ΔT — and the 9 km
 * elevation ceilings retire in favor of the 70 km gravitational-collapse
 * thickness cap (counted in `columnsThicknessCapBinds`).
 */
describe('collision under crustal columns (stage C3)', () => {
  function columnsStart(): PlanetState {
    const s = twoPlateState(N, P0, P1); // all continental
    const params = { ...s.params, crustalColumns: true, crustalColumnsOnsetYears: 0 };
    const elevation = s.fields.elevation.slice();
    elevation.fill(200);
    const crustalThicknessM = foundCrustalThickness(elevation, s.fields.crustType);
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = continentalElevationForThicknessM(crustalThicknessM[i]!);
    }
    return { ...s, params, fields: { ...s.fields, elevation, crustalThicknessM } };
  }

  /** Mean elevation over convergent-cap boundary cells. */
  function beltMean(state: PlanetState): number {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (!inCap(i, CONVERGE_DIR, 0.93) || !isBoundary(state, i)) continue;
      sum += state.fields.elevation[i]!;
      n++;
    }
    expect(n).toBeGreaterThan(0);
    return sum / n;
  }

  it('site 12 in isolation: the BFS seed adds ROCK — surface rises k× the legacy uplift', () => {
    // Direct call, no advection, one full-stress seed on the seam: the C3
    // uplift is the same rate constant read as thickness, so the seed cell's
    // surface rise must be exactly k × the legacy path's rise.
    const base = columnsStart();
    const count = cellCount(N);
    let seedCell = -1;
    for (let i = 0; i < count && seedCell === -1; i++) {
      if (isBoundary(base, i) && inCap(i, CONVERGE_DIR, 0.93)) seedCell = i;
    }
    expect(seedCell).not.toBe(-1);
    const stress = new Float32Array(count);
    stress[seedCell] = OROGENY_STRESS_REF_M_PER_YR; // norm exactly 1
    const dt = 1e6;

    const elevOn = base.fields.elevation.slice();
    const thickOn = base.fields.crustalThicknessM.slice();
    applyConvergentTopography(base, stress, elevOn, base.fields.crustType.slice(), dt, thickOn);
    const onRise = elevOn[seedCell]! - base.fields.elevation[seedCell]!;

    const elevOff = base.fields.elevation.slice();
    applyConvergentTopography(base, stress, elevOff, base.fields.crustType.slice(), dt, null);
    const offRise = elevOff[seedCell]! - base.fields.elevation[seedCell]!;

    expect(offRise).toBeCloseTo(OROGENY_RATE_M_PER_YR * dt, 3); // 600 m, legacy
    expect(onRise).toBeCloseTo(CONTINENTAL_BUOYANCY_FACTOR * OROGENY_RATE_M_PER_YR * dt, 1);
    expect(thickOn[seedCell]! - base.fields.crustalThicknessM[seedCell]!).toBeCloseTo(
      OROGENY_RATE_M_PER_YR * dt,
      1,
    );
  });

  it('head-on collision: belts grow, bounded by the 4815 m ceiling instead of 9 km, coherent', () => {
    // The full system: BFS uplift at the rebound tempo PLUS site 7's column
    // stacking — the declared step change (half the displaced ~36 km column
    // is ~2.5 km of surface per overlap, far stronger than today's
    // subaerial-relief rule) — so belts grow FAST, but the ceiling is now
    // e(70 km) ≈ +4815 m instead of the legacy 9 km.
    const on = runSystems(columnsStart(), 10);
    const legacyStart = ((): PlanetState => {
      const s = twoPlateState(N, P0, P1);
      const elevation = s.fields.elevation.slice();
      elevation.fill(200);
      return { ...s, fields: { ...s.fields, elevation } };
    })();
    const off = runSystems(legacyStart, 10);
    const onGrowth = beltMean(on) - 200;
    const offGrowth = beltMean(off) - 200;
    expect(onGrowth).toBeGreaterThan(50); // mountains genuinely grow
    // The legacy arm runs to its 9 km cap; the columns arm is structurally
    // bounded 4.2 km lower.
    expect(onGrowth).toBeLessThan(offGrowth);
    // Coherence held through the tectonics writers.
    const { elevation, crustType, crustalThicknessM } = on.fields;
    for (let i = 0; i < elevation.length; i++) {
      if (crustType[i] !== 1) continue;
      expect(elevation[i]).toBe(
        Math.fround(
          CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * crustalThicknessM[i]!,
        ),
      );
    }
  });

  it('sustained collision binds the 70 km cap — counted, never exceeded, never snapped down', () => {
    // ~35.8 km columns shortened at up to 600 m/Myr of thickness reach the
    // ceiling within ~60-80 Myr of head-on convergence (runSystems runs
    // tectonics only, so root decay does not oppose here).
    const end = runSystems(columnsStart(), 120);
    expect(end.globals.columnsThicknessCapBinds).toBeGreaterThan(0);
    const eCeiling = Math.fround(
      CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * CONTINENTAL_THICKNESS_MAX_M,
    );
    let atCap = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (end.fields.crustType[i] !== 1) continue;
      expect(end.fields.crustalThicknessM[i]).toBeLessThanOrEqual(CONTINENTAL_THICKNESS_MAX_M);
      expect(end.fields.elevation[i]).toBeLessThanOrEqual(eCeiling);
      if (end.fields.crustalThicknessM[i]! === CONTINENTAL_THICKNESS_MAX_M) atCap++;
    }
    expect(atCap).toBeGreaterThan(0); // the belt genuinely saturates
  });
});

describe('ocean-continent subduction (#16)', () => {
  // Plate 1 (z<0) becomes 30 Myr oceanic floor; plate 0 stays continental.
  const start = ((): PlanetState => {
    const s = twoPlateState(N, P0, P1);
    const elevation = s.fields.elevation.slice();
    const crustType = s.fields.crustType.slice();
    const crustAge = s.fields.crustAge.slice();
    for (let i = 0; i < cellCount(N); i++) {
      if (s.fields.plateId[i] === 1) {
        crustType[i] = 0;
        crustAge[i] = 30e6;
        elevation[i] = oceanicDepthForAge(30e6);
      } else {
        elevation[i] = 300;
      }
    }
    return { ...s, fields: { ...s.fields, elevation, crustType, crustAge } };
  })();
  const end = runSystems(start, 30);

  it('digs a trench on the subducting oceanic side', () => {
    let deepest = 0;
    let expectedFloor = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (!inCap(i, CONVERGE_DIR, 0.93)) continue;
      if (end.fields.crustType[i] !== 0 || !isBoundary(end, i)) continue;
      deepest = Math.min(deepest, end.fields.elevation[i]!);
      expectedFloor = Math.min(expectedFloor, oceanicDepthForAge(end.fields.crustAge[i]!));
    }
    // Trench: clearly below anything thermal subsidence alone produces.
    expect(deepest).toBeLessThan(expectedFloor - 1000);
  });

  it('raises a coastal range on the overriding continental side', () => {
    let coastSum = 0;
    let coastN = 0;
    let inlandSum = 0;
    let inlandN = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (!inCap(i, CONVERGE_DIR, 0.9)) continue;
      if (end.fields.crustType[i] !== 1) continue;
      // graph distance to boundary, coarse: boundary cells vs cells >= 6 away
      if (isBoundary(end, i)) {
        coastSum += end.fields.elevation[i]!;
        coastN++;
      } else {
        let far = true;
        let ring = [i];
        const seen = new Set<number>(ring);
        for (let d = 0; d < 5 && far; d++) {
          const next: number[] = [];
          for (const c of ring) {
            for (const nb of neighbors(c, N)) {
              if (end.fields.plateId[nb] !== end.fields.plateId[i]) far = false;
              if (!seen.has(nb)) {
                seen.add(nb);
                next.push(nb);
              }
            }
          }
          ring = next;
        }
        if (far) {
          inlandSum += end.fields.elevation[i]!;
          inlandN++;
        }
      }
    }
    expect(coastN).toBeGreaterThan(0);
    expect(inlandN).toBeGreaterThan(0);
    // Andes-style: the coastal range towers over the inland plain.
    expect(coastSum / coastN).toBeGreaterThan(inlandSum / inlandN + 500);
  });

  it('transfers consumed crust ownership without holes', () => {
    for (const p of end.fields.plateId) expect(p === 0 || p === 1).toBe(true);
  });

  it('grows continental area share at the expense of the subducting ocean', () => {
    let continentalStart = 0;
    let continentalEnd = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (start.fields.plateId[i] === 0) continentalStart++;
      if (end.fields.plateId[i] === 0) continentalEnd++;
    }
    expect(continentalEnd).toBeGreaterThan(continentalStart);
  });
});

describe('ocean-ocean subduction polarity (#16)', () => {
  // Both plates oceanic; plate 1's floor is much older (denser). At the
  // convergent segment the OLDER side must subduct: plate 0 (younger)
  // advances and keeps the surface.
  const start = ((): PlanetState => {
    const s = twoPlateState(N, P0, P1);
    const elevation = s.fields.elevation.slice();
    const crustType = s.fields.crustType.slice();
    const crustAge = s.fields.crustAge.slice();
    for (let i = 0; i < cellCount(N); i++) {
      crustType[i] = 0;
      crustAge[i] = s.fields.plateId[i] === 0 ? 10e6 : 90e6;
      elevation[i] = oceanicDepthForAge(crustAge[i]!);
    }
    return { ...s, fields: { ...s.fields, elevation, crustType, crustAge } };
  })();
  const end = runSystems(start, 40);

  it('advances the younger plate over the older one', () => {
    let young = 0;
    for (let i = 0; i < cellCount(N); i++) if (end.fields.plateId[i] === 0) young++;
    let youngStart = 0;
    for (let i = 0; i < cellCount(N); i++) if (start.fields.plateId[i] === 0) youngStart++;
    expect(young).toBeGreaterThan(youngStart);
  });

  it('digs the trench into the older side and builds an arc on the younger', () => {
    let olderMin = 0;
    let arcMax = -Infinity;
    for (let i = 0; i < cellCount(N); i++) {
      if (!inCap(i, CONVERGE_DIR, 0.9) || !isBoundary(end, i)) continue;
      if (end.fields.plateId[i] === 1) {
        olderMin = Math.min(olderMin, end.fields.elevation[i]!);
      } else {
        arcMax = Math.max(arcMax, end.fields.elevation[i]!);
      }
    }
    // Old floor is ~-5800; the trench must cut well below it.
    expect(olderMin).toBeLessThan(-7000);
    // The arc has been climbing off the young floor (~-3600) for 40 Myr.
    expect(arcMax).toBeGreaterThan(oceanicDepthForAge(oceanicAgeForDepth(-3600)) + 500);
  });
});
