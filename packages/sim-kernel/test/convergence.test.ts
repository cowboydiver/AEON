import { describe, expect, it } from 'vitest';
import { oceanicAgeForDepth, oceanicDepthForAge } from '../src/bathymetry';
import { OROGENY_MAX_ELEVATION_M } from '../src/constants';
import { cellCenterDirection, cellCount, neighbors } from '../src/grid';
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
  const start = (() => {
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

describe('ocean-continent subduction (#16)', () => {
  // Plate 1 (z<0) becomes 30 Myr oceanic floor; plate 0 stays continental.
  const start = (() => {
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
  const start = (() => {
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
