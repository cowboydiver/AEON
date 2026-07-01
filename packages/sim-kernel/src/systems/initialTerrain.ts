import {
  EQUATOR_POLE_TEMPERATURE_DROP_K,
  INITIAL_LAND_FRACTION,
  INITIAL_LAND_HEIGHT_M,
  INITIAL_OCEAN_DEPTH_M,
  LAPSE_RATE_K_PER_M,
  MEAN_SURFACE_TEMPERATURE_K,
} from '../constants';
import { hash2, hashString } from '../hash';
import { cellCenterDirection, cellCount } from '../grid';
import { fractalNoise3 } from '../noise';
import type { PlanetState } from '../state';

/**
 * Phase 0 placeholder terrain: seeded fractal value noise sampled at each
 * cell's center direction, with sea level chosen as the exact
 * (1 - INITIAL_LAND_FRACTION) quantile of the noise so ~30% of cells sit
 * above the 0 m datum. Ocean depth is linear below the threshold; land uses
 * a ^1.6 curve so most land is lowland with sparse peaks (Earth-like
 * hypsometry, throwaway physics, real plumbing).
 *
 * Also fills a trivial latitude + lapse-rate temperature so temperature dumps
 * and golden hashes exercise a second field (small, documented extension of
 * SCAFFOLD_SPEC 2.4).
 */

/** Base spatial frequency: ~continent-scale features on the unit sphere. */
const BASE_FREQUENCY = 2.3;
const OCTAVES = 5;

export function applyInitialTerrain(state: PlanetState): PlanetState {
  const { params } = state;
  const count = cellCount(params.gridN);
  const terrainSeed = hash2(params.seed >>> 0, hashString('initialTerrain'), 0);

  const noise = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = cellCenterDirection(i, params.gridN);
    noise[i] = fractalNoise3(
      terrainSeed,
      x * BASE_FREQUENCY + 17.13,
      y * BASE_FREQUENCY + 47.7,
      z * BASE_FREQUENCY + 89.02,
      OCTAVES,
    );
  }

  // Exact land-fraction quantile as sea level. Numeric sort is deterministic.
  const sorted = Array.from(noise).sort((a, b) => a - b);
  const seaIndex = Math.min(count - 1, Math.floor(count * (1 - INITIAL_LAND_FRACTION)));
  const seaLevel = sorted[seaIndex]!;
  const lowest = sorted[0]!;
  const highest = sorted[count - 1]!;

  const elevation = new Float32Array(count);
  const temperature = new Float32Array(count);
  let landCells = 0;
  for (let i = 0; i < count; i++) {
    const v = noise[i]!;
    let elev: number;
    if (v >= seaLevel) {
      const r = (v - seaLevel) / (highest - seaLevel);
      elev = INITIAL_LAND_HEIGHT_M * Math.pow(r, 1.6);
      landCells++;
    } else {
      elev = (-INITIAL_OCEAN_DEPTH_M * (seaLevel - v)) / (seaLevel - lowest);
    }
    elevation[i] = elev;

    const dirY = cellCenterDirection(i, params.gridN)[1];
    const sinLat = Math.max(-1, Math.min(1, dirY));
    temperature[i] =
      MEAN_SURFACE_TEMPERATURE_K +
      EQUATOR_POLE_TEMPERATURE_DROP_K * (1 / 3 - sinLat * sinLat) -
      LAPSE_RATE_K_PER_M * Math.max(0, elev);
  }

  return {
    ...state,
    globals: { ...state.globals, landFraction: landCells / count },
    fields: { ...state.fields, elevation, temperature },
  };
}
