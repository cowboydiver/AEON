import { describe, expect, it } from 'vitest';
import { oceanicAgeForDepth, oceanicDepthForAge } from '../src/bathymetry';
import { CONTINENTAL_INITIAL_AGE_YEARS, OCEAN_ABYSSAL_DEPTH_M, OCEAN_RIDGE_DEPTH_M } from '../src/constants';
import { cellCenterDirection, cellCount, neighbors } from '../src/grid';
import { createInitialState, createPlanetParams } from '../src/state';
import { runSystems, twoPlateState } from './helpers';

const N = 32;

describe('age-depth relation (#15)', () => {
  it('maps age to the half-space cooling curve and back', () => {
    expect(oceanicDepthForAge(0)).toBe(OCEAN_RIDGE_DEPTH_M);
    expect(oceanicDepthForAge(25e6)).toBeCloseTo(-2500 - 0.35 * Math.sqrt(25e6), 6);
    expect(oceanicDepthForAge(500e6)).toBe(OCEAN_ABYSSAL_DEPTH_M);
    for (const depth of [-2500, -3000, -4500, -5900]) {
      expect(oceanicDepthForAge(oceanicAgeForDepth(depth))).toBeCloseTo(depth, 6);
    }
  });
});

describe('initial crust age structure (#15)', () => {
  const state = createInitialState(createPlanetParams({ seed: 42, gridN: N }));

  it('gives continental crust its shield age and oceanic crust curve-consistent age', () => {
    const { crustType, crustAge, elevation } = state.fields;
    for (let i = 0; i < crustType.length; i++) {
      if (crustType[i] === 1) {
        expect(crustAge[i]).toBe(CONTINENTAL_INITIAL_AGE_YEARS);
      } else {
        expect(crustAge[i]).toBeGreaterThanOrEqual(0);
        expect(Math.abs(elevation[i]! - oceanicDepthForAge(crustAge[i]!))).toBeLessThan(0.5);
      }
    }
  });

  it('keeps deep initial ocean older than shallow initial ocean', () => {
    const { crustType, crustAge, elevation } = state.fields;
    let deepAgeSum = 0;
    let deepCount = 0;
    let shallowAgeSum = 0;
    let shallowCount = 0;
    for (let i = 0; i < crustType.length; i++) {
      if (crustType[i] !== 0) continue;
      if (elevation[i]! < -5000) {
        deepAgeSum += crustAge[i]!;
        deepCount++;
      } else if (elevation[i]! > -3500) {
        shallowAgeSum += crustAge[i]!;
        shallowCount++;
      }
    }
    expect(deepCount).toBeGreaterThan(0);
    expect(shallowCount).toBeGreaterThan(0);
    expect(deepAgeSum / deepCount).toBeGreaterThan(shallowAgeSum / shallowCount);
  });
});

describe('seafloor spreading (#15)', () => {
  // Plate 0 (z>0) and plate 1 rotate about +X in opposite senses: their
  // boundary near [0,+1,0] opens steadily, filling with young ocean crust.
  const OMEGA = 6e-9;
  const start = (() => {
    const s = twoPlateState(N, { pole: [1, 0, 0], omega: OMEGA }, { pole: [1, 0, 0], omega: -OMEGA });
    // All crust continental at +500 m so created ocean floor is unambiguous.
    const elevation = s.fields.elevation.slice();
    elevation.fill(500);
    return { ...s, fields: { ...s.fields, elevation } };
  })();
  const end = runSystems(start, 150);

  it('ages crust everywhere, every step', () => {
    // Continental crust just ages; it started at 0 in this hand-built state.
    let continentalSeen = 0;
    for (let i = 0; i < end.fields.crustType.length; i++) {
      if (end.fields.crustType[i] === 1) {
        expect(end.fields.crustAge[i]).toBe(150e6);
        continentalSeen++;
      }
    }
    expect(continentalSeen).toBeGreaterThan(0);
  });

  it('creates ocean crust whose age increases with distance from the ridge', () => {
    // Around the opening segment near [0,1,0]: bin oceanic cells by |z|
    // (distance from the original boundary plane) — mean age must increase
    // outward, ridge-youngest at the centre.
    const bins: Array<{ sum: number; n: number }> = Array.from({ length: 4 }, () => ({ sum: 0, n: 0 }));
    for (let i = 0; i < cellCount(N); i++) {
      if (end.fields.crustType[i] !== 0) continue;
      const [x, y, z] = cellCenterDirection(i, N);
      if (y < 0.85) continue; // stay near the opening cap
      void x;
      const band = Math.min(3, Math.floor(Math.abs(z) / 0.075));
      bins[band]!.sum += end.fields.crustAge[i]!;
      bins[band]!.n++;
    }
    for (const b of bins) expect(b.n).toBeGreaterThan(0);
    const means = bins.map((b) => b.sum / b.n);
    for (let k = 1; k < means.length; k++) {
      expect(means[k]!).toBeGreaterThan(means[k - 1]!);
    }
  });

  it('keeps every cell owned (spreading leaves no holes)', () => {
    for (const p of end.fields.plateId) expect(p === 0 || p === 1).toBe(true);
  });

  it('puts ridge-adjacent ocean floor above old ocean floor', () => {
    // Boundary-cell ocean should be shallower (younger) than ocean 6+ cells
    // away within the spreading band.
    let boundaryElevSum = 0;
    let boundaryN = 0;
    let farElevSum = 0;
    let farN = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (end.fields.crustType[i] !== 0) continue;
      const [, y, z] = cellCenterDirection(i, N);
      if (y < 0.85) continue;
      let isBoundary = false;
      for (const nb of neighbors(i, N)) {
        if (end.fields.plateId[nb] !== end.fields.plateId[i]) isBoundary = true;
      }
      if (isBoundary) {
        boundaryElevSum += end.fields.elevation[i]!;
        boundaryN++;
      } else if (Math.abs(z) > 0.2) {
        farElevSum += end.fields.elevation[i]!;
        farN++;
      }
    }
    expect(boundaryN).toBeGreaterThan(0);
    expect(farN).toBeGreaterThan(0);
    expect(boundaryElevSum / boundaryN).toBeGreaterThan(farElevSum / farN + 200);
  });
});
