import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge } from '../src/bathymetry';
import { MICROCONTINENT_FOUNDER_ELEVATION_M } from '../src/constants';
import { faceRCToIndex } from '../src/grid';
import { runSystems, twoPlateState } from './helpers';
import type { PlanetState } from '../src/state';

const N = 16;
const MID = N / 2;

/**
 * Margin-consolidation invariants (#67). The pass pair-flips stray one-cell
 * continental islands (zero continental 4-neighbors) against enclosed ocean
 * holes (>= 3 continental 4-neighbors), ascending cell order, conserving
 * continental cell count exactly. Worlds here are static (both plates at
 * zero angular velocity) so tectonics runs no advection and no convergent
 * topography — the consolidation pass is the only crustType writer.
 */

const continentalCells = (crustType: Float32Array): number => {
  let n = 0;
  for (const c of crustType) if (c === 1) n++;
  return n;
};

/**
 * All-continental two-plate world with an island at the center of face 0:
 * a Chebyshev-radius-2 square of ocean whose center cell stays continental.
 * The square's border ocean cells have at most 2 continental neighbors, so
 * the island is the only island and the square contains no hole.
 */
function paintIsland(state: PlanetState): { state: PlanetState; island: number } {
  const crustType = state.fields.crustType.slice();
  const elevation = state.fields.elevation.slice();
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const i = faceRCToIndex(0, MID + dr, MID + dc, N);
      crustType[i] = 0;
      elevation[i] = -4000;
    }
  }
  const island = faceRCToIndex(0, MID, MID, N);
  crustType[island] = 1;
  elevation[island] = 777;
  return {
    state: { ...state, fields: { ...state.fields, crustType, elevation } },
    island,
  };
}

/** One ocean hole (4 continental neighbors) well away from the island site. */
function paintHole(state: PlanetState): { state: PlanetState; hole: number } {
  const crustType = state.fields.crustType.slice();
  const elevation = state.fields.elevation.slice();
  const crustAge = state.fields.crustAge.slice();
  const sutureYears = state.fields.sutureYears.slice();
  const hole = faceRCToIndex(0, MID, MID + 6, N);
  crustType[hole] = 0;
  elevation[hole] = -2500;
  // Distinct neighbor properties: the flip must inherit the LOWEST
  // elevation, the OLDEST age, and the newest weld stamp.
  const nbs = [
    faceRCToIndex(0, MID - 1, MID + 6, N),
    faceRCToIndex(0, MID + 1, MID + 6, N),
    faceRCToIndex(0, MID, MID + 5, N),
    faceRCToIndex(0, MID, MID + 7, N),
  ];
  const elevs = [320, 480, 640, 800];
  nbs.forEach((nb, k) => {
    elevation[nb] = elevs[k]!;
  });
  crustAge[nbs[1]!] = 5e8;
  sutureYears[nbs[2]!] = 7e6;
  return {
    state: { ...state, fields: { ...state.fields, crustType, elevation, crustAge, sutureYears } },
    hole,
  };
}

const staticWorld = (): PlanetState =>
  twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 0, 1], omega: 0 });

describe('margin consolidation (#67)', () => {
  it('pair-flips an island against a hole, conserving continental cell count', () => {
    const withIsland = paintIsland(staticWorld());
    const { state, hole } = paintHole(withIsland.state);
    const island = withIsland.island;
    const before = continentalCells(state.fields.crustType);

    const end = runSystems(state, 1);

    // The island reverted to seafloor at its age-depth floor (its crustAge
    // ticked one step before the flip) and dropped its weld memory.
    expect(end.fields.crustType[island]).toBe(0);
    expect(end.fields.elevation[island]).toBeCloseTo(
      oceanicDepthForAge(state.params.stepYears),
      3,
    );
    expect(end.fields.sutureYears[island]).toBe(0);

    // The hole filled as continental basin floor: lowest neighbor elevation,
    // oldest neighbor age (also ticked), newest neighbor weld stamp.
    expect(end.fields.crustType[hole]).toBe(1);
    expect(end.fields.elevation[hole]).toBe(320);
    expect(end.fields.crustAge[hole]).toBe(5e8 + state.params.stepYears);
    expect(end.fields.sutureYears[hole]).toBe(7e6);

    // The pass is exactly area-conserving.
    expect(continentalCells(end.fields.crustType)).toBe(before);
  });

  it('an unpaired island stays continental (foundered, not deleted)', () => {
    const { state, island } = paintIsland(staticWorld());
    const before = continentalCells(state.fields.crustType);
    const end = runSystems(state, 1);
    expect(end.fields.crustType[island]).toBe(1);
    // The founder clamp pinned it below sea level, but the crust survives.
    expect(end.fields.elevation[island]).toBeLessThanOrEqual(MICROCONTINENT_FOUNDER_ELEVATION_M);
    expect(continentalCells(end.fields.crustType)).toBe(before);
  });

  it('an unpaired hole stays open water', () => {
    const { state, hole } = paintHole(staticWorld());
    const before = continentalCells(state.fields.crustType);
    const end = runSystems(state, 1);
    expect(end.fields.crustType[hole]).toBe(0);
    expect(continentalCells(end.fields.crustType)).toBe(before);
  });
});
