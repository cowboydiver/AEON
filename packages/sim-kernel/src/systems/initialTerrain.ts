import {
  INITIAL_LAND_HEIGHT_M,
  INITIAL_OCEAN_DEPTH_M,
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
 * (1 - params.initialLandFraction) quantile of the noise so that fraction of
 * cells sit above the 0 m datum (#106; default ~30%). Ocean depth is linear
 * below the threshold; land uses a ^TERRAIN_LAND_EXPONENT curve so most land is
 * lowland with sparse peaks (Earth-like hypsometry, throwaway physics, real
 * plumbing). The land-height/ocean-depth/exponent constants are calibrated
 * against the 30% split but keep the hypsometry coherent across the tested
 * in-range {0.1, 0.3, 0.39} triple (f = 0.5 is the degenerate over-edge case —
 * docs/SEA_LEVEL_DATUM_FINDINGS.md, the #106 t=0 checks).
 *
 * Temperature is set afterwards by the Phase 3 energy balance (#30) inside
 * `createInitialState`; this pass only lays down elevation and the land count.
 */
export function applyInitialTerrain(state: PlanetState): PlanetState {
  const { params } = state;
  const count = cellCount(params.gridN);
  const terrainSeed = hash2(params.seed >>> 0, hashString('initialTerrain'), 0);
  const [offsetX, offsetY, offsetZ] = TERRAIN_NOISE_OFFSET;

  const noise = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = cellCenterDirection(i, params.gridN);
    noise[i] = fractalNoise3(
      terrainSeed,
      x * TERRAIN_BASE_FREQUENCY + offsetX,
      y * TERRAIN_BASE_FREQUENCY + offsetY,
      z * TERRAIN_BASE_FREQUENCY + offsetZ,
      TERRAIN_OCTAVES,
    );
  }

  // Exact land-fraction quantile as sea level. Float32Array#sort is numeric
  // ascending by spec and allocates no boxed numbers. At the default 0.3 the
  // computation is bit-identical to the pre-#106 constant path (same `0.3`
  // literal); at f → 0 the index clamps to count−1 (one max cell as "land"),
  // and near the crust fraction the coastline rides just below the crust
  // quantile (thin submerged shelf) — the edge cases the #106 tests pin.
  const sorted = noise.slice().sort();
  const seaIndex = Math.min(count - 1, Math.floor(count * (1 - params.initialLandFraction)));
  const seaLevel = sorted[seaIndex]!;
  // Guard degenerate ranges (ties at the quantile on tiny/pathological
  // grids): a zero denominator would put NaN into elevation, temperature and
  // every golden hash downstream. Flat 0 m is the sane fallback.
  const landRange = sorted[count - 1]! - seaLevel;
  const oceanRange = seaLevel - sorted[0]!;

  const elevation = new Float32Array(count);
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
  }

  return {
    ...state,
    globals: { ...state.globals, landFraction: landCells / count },
    fields: { ...state.fields, elevation },
  };
}
