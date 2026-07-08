import {
  DEFAULT_KEYFRAME_INTERVAL_YEARS,
  DEFAULT_NUM_PLATES,
  DEFAULT_STEP_YEARS,
  EARTH_DAY_HOURS,
  EARTH_OBLIQUITY_DEG,
  EARTH_RADIUS_M,
  INITIAL_CO2_PPM,
  SOLAR_LUMINOSITY_W,
} from './constants';
import type { SimEvent } from './events';
import { FIELD_NAMES, type Fields } from './fields';
import { DEFAULT_GRID_N, cellCount } from './grid';
import { applyInitialPlates, type PlateRecord } from './plates';
import { applyPrecipitationProxy } from './systems/climateProxy';
import { applyEnergyBalance } from './systems/energyBalance';
import { applyInitialTerrain } from './systems/initialTerrain';

/** Immutable per-run parameters. Same params + same seed => same history. */
export interface PlanetParams {
  seed: number;
  radiusMeters: number;
  gridN: number;
  stepYears: number;
  keyframeIntervalYears: number;
  /** Number of plates in the initial partition (live count then evolves, #18). */
  numPlates: number;
  /** Stellar luminosity driving insolation (#30), W. */
  starLuminosity: number;
  /** Placeholder for later phases (wind-band count, #31). Hours. */
  dayLengthHours: number;
  /** Axial tilt shaping the annual-mean latitudinal insolation profile (#30), degrees. */
  obliquityDeg: number;
  /** Atmospheric CO₂ reservoir seed (#30 greenhouse; #34 evolves it), ppm. */
  initialCo2Ppm: number;
}

/** Scalar whole-planet quantities, updated by systems as they run. */
export interface Globals {
  /** Fraction of cells with elevation above the 0 m datum. */
  landFraction: number;
  /** Atmospheric CO₂, ppm — the slow carbonate–silicate reservoir (#34); the
   *  energy balance reads it as the greenhouse forcing. Constant at
   *  `initialCo2Ppm` until #34 lands. */
  co2: number;
  /** Global cell-count-mean surface temperature, K — a diagnostic for the
   *  report/HUD and the #34 snowball detector (#30). */
  meanTemperatureK: number;
}

export interface PlanetState {
  timeYears: number;
  params: PlanetParams;
  globals: Globals;
  fields: Fields;
  /**
   * Per-plate table, fixed order by plate index (plateId field values index
   * into it). Iterate by index only. Dead plates keep their slot (#18).
   */
  plates: readonly PlateRecord[];
  /**
   * Discrete events in simulation order. Systems append immutably
   * (see events.ts purity rule); keyframes carry a deep copy.
   */
  events: readonly SimEvent[];
  /**
   * Wilson-cycle bookkeeping (#18): when each continent-continent plate
   * pair ("a-b" with a < b) entered sustained convergent contact. Rebuilt
   * every step from the current contact scan (never iterated by key order);
   * pairs suture once contact has lasted SUTURE_AFTER_YEARS.
   */
  wilson: { readonly contactSince: Readonly<Record<string, number>> };
}

export function createPlanetParams(partial: Partial<PlanetParams> & { seed: number }): PlanetParams {
  return {
    radiusMeters: EARTH_RADIUS_M,
    gridN: DEFAULT_GRID_N,
    stepYears: DEFAULT_STEP_YEARS,
    keyframeIntervalYears: DEFAULT_KEYFRAME_INTERVAL_YEARS,
    numPlates: DEFAULT_NUM_PLATES,
    starLuminosity: SOLAR_LUMINOSITY_W,
    dayLengthHours: EARTH_DAY_HOURS,
    obliquityDeg: EARTH_OBLIQUITY_DEG,
    initialCo2Ppm: INITIAL_CO2_PPM,
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
    globals: { landFraction: 0, co2: params.initialCo2Ppm, meanTemperatureK: 0 },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {} },
  };
  // Terrain and plates first (they set the elevation/land mask the energy
  // balance reads), then the precipitation proxy (erosion input until #32),
  // then the energy balance so the t=0 keyframe already carries a physical
  // temperature field and meanTemperatureK.
  return applyEnergyBalance(applyPrecipitationProxy(applyInitialPlates(applyInitialTerrain(state))));
}
