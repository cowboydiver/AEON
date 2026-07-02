import {
  EQUATOR_POLE_TEMPERATURE_DROP_K,
  INITIAL_LAND_FRACTION,
  INITIAL_LAND_HEIGHT_M,
  INITIAL_OCEAN_DEPTH_M,
  LAPSE_RATE_K_PER_M,
  MEAN_SIN2_LATITUDE,
  MEAN_SURFACE_TEMPERATURE_K,
  TERRAIN_BASE_FREQUENCY,
  TERRAIN_LAND_EXPONENT,
  TERRAIN_NOISE_OFFSET,
  TERRAIN_OCTAVES,
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
 * a ^TERRAIN_LAND_EXPONENT curve so most land is lowland with sparse peaks
 * (Earth-like hypsometry, throwaway physics, real plumbing).
 *
 * Also fills a trivial latitude + lapse-rate temperature so temperature dumps
 * and golden hashes exercise a second field (small, documented extension of
 * SCAFFOLD_SPEC 2.4).
 */
export function applyInitialTerrain(state: PlanetState): PlanetState {
  const { params } = state;
  const count = cellCount(params.gridN);
  const terrainSeed = hash2(params.seed >>> 0, hashString('initialTerrain'), 0);
  const [offsetX, offsetY, offsetZ] = TERRAIN_NOISE_OFFSET;

  const noise = new Float32Array(count);
  // Cache sin(latitude) (= unit-dir y) at full f64 precision for the
  // temperature pass, so it is not recomputed per cell.
  const sinLat = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = cellCenterDirection(i, params.gridN);
    sinLat[i] = y;
    noise[i] = fractalNoise3(
      terrainSeed,
      x * TERRAIN_BASE_FREQUENCY + offsetX,
      y * TERRAIN_BASE_FREQUENCY + offsetY,
      z * TERRAIN_BASE_FREQUENCY + offsetZ,
      TERRAIN_OCTAVES,
    );
  }

  // Exact land-fraction quantile as sea level. Float32Array#sort is numeric
  // ascending by spec and allocates no boxed numbers.
  const sorted = noise.slice().sort();
  const seaIndex = Math.min(count - 1, Math.floor(count * (1 - INITIAL_LAND_FRACTION)));
  const seaLevel = sorted[seaIndex]!;
  // Guard degenerate ranges (ties at the quantile on tiny/pathological
  // grids): a zero denominator would put NaN into elevation, temperature and
  // every golden hash downstream. Flat 0 m is the sane fallback.
  const landRange = sorted[count - 1]! - seaLevel;
  const oceanRange = seaLevel - sorted[0]!;

  const elevation = new Float32Array(count);
  const temperature = new Float32Array(count);
  let landCells = 0;
  for (let i = 0; i < count; i++) {
    const v = noise[i]!;
    let elev: number;
    if (v >= seaLevel) {
      elev = landRange > 0 ? INITIAL_LAND_HEIGHT_M * Math.pow((v - seaLevel) / landRange, TERRAIN_LAND_EXPONENT) : 0;
      landCells++;
    } else {
      elev = oceanRange > 0 ? (-INITIAL_OCEAN_DEPTH_M * (seaLevel - v)) / oceanRange : 0;
    }
    elevation[i] = elev;

    const s = Math.max(-1, Math.min(1, sinLat[i]!));
    temperature[i] =
      MEAN_SURFACE_TEMPERATURE_K +
      EQUATOR_POLE_TEMPERATURE_DROP_K * (MEAN_SIN2_LATITUDE - s * s) -
      LAPSE_RATE_K_PER_M * Math.max(0, elev);
  }

  return {
    ...state,
    globals: { ...state.globals, landFraction: landCells / count },
    fields: { ...state.fields, elevation, temperature },
  };
}
