import {
  DEFAULT_KEYFRAME_INTERVAL_YEARS,
  DEFAULT_STEP_YEARS,
  EARTH_DAY_HOURS,
  EARTH_OBLIQUITY_DEG,
  EARTH_RADIUS_M,
  SOLAR_LUMINOSITY_W,
} from './constants';
import { FIELD_NAMES, type Fields } from './fields';
import { DEFAULT_GRID_N, cellCount } from './grid';
import { applyInitialTerrain } from './systems/initialTerrain';

/** Immutable per-run parameters. Same params + same seed => same history. */
export interface PlanetParams {
  seed: number;
  radiusMeters: number;
  gridN: number;
  stepYears: number;
  keyframeIntervalYears: number;
  /** Placeholder for later phases (energy balance). W. */
  starLuminosity: number;
  /** Placeholder for later phases (diurnal cycle). Hours. */
  dayLengthHours: number;
  /** Placeholder for later phases (seasons). Degrees. */
  obliquityDeg: number;
}

/** Scalar whole-planet quantities, updated by systems as they run. */
export interface Globals {
  /** Fraction of cells with elevation above the 0 m datum. */
  landFraction: number;
}

export interface PlanetState {
  timeYears: number;
  params: PlanetParams;
  globals: Globals;
  fields: Fields;
}

export function createPlanetParams(partial: Partial<PlanetParams> & { seed: number }): PlanetParams {
  return {
    radiusMeters: EARTH_RADIUS_M,
    gridN: DEFAULT_GRID_N,
    stepYears: DEFAULT_STEP_YEARS,
    keyframeIntervalYears: DEFAULT_KEYFRAME_INTERVAL_YEARS,
    starLuminosity: SOLAR_LUMINOSITY_W,
    dayLengthHours: EARTH_DAY_HOURS,
    obliquityDeg: EARTH_OBLIQUITY_DEG,
    ...partial,
  };
}

export function createInitialState(params: PlanetParams): PlanetState {
  const count = cellCount(params.gridN);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((name) => [name, new Float32Array(count)]),
  ) as Fields;

  const state: PlanetState = {
    timeYears: 0,
    params,
    globals: { landFraction: 0 },
    fields,
  };
  return applyInitialTerrain(state);
}
