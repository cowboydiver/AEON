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
import { applyBiome } from './systems/biome';
import { applyEnergyBalance } from './systems/energyBalance';
import { applyInitialTerrain } from './systems/initialTerrain';
import { applyMoisture } from './systems/moisture';
import { applyWinds } from './systems/winds';

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
  /** Rotation period, hours — sets the #31 wind-band count (fast rotators get
   *  more, narrower bands; slow rotators approach single-cell circulation). */
  dayLengthHours: number;
  /** Axial tilt shaping the annual-mean latitudinal insolation profile (#30), degrees. */
  obliquityDeg: number;
  /** Atmospheric CO₂ reservoir seed (#30 greenhouse; #34 evolves it), ppm. */
  initialCo2Ppm: number;
  /**
   * Enable the crustal-block isostasy system (#84 prototype): per-component
   * elevation ceilings that founder small continental blocks. Default OFF —
   * flag-off runs are byte-identical to the pre-#84 kernel (goldens
   * unchanged); flip on via sim-cli --block-isostasy for A/B measurement.
   */
  blockIsostasy: boolean;
  /**
   * Sim year before which blockIsostasy is inert even when enabled (#84
   * branched A/B). The system consumes no RNG, so a flag-on run with onset Y
   * is bit-identical to a flag-off run until Y and diverges after Y *only*
   * by the mechanism's direct effect — paired keyframes in the window after
   * Y measure the mechanism itself, before chaotic trajectory divergence
   * (the first founder perturbing all subsequent tectonics) swamps the
   * signal, which is what defeated the whole-history on/off comparison in
   * ISSUE_84_PROTOTYPE_FINDINGS.md. Default 0: active from the start.
   */
  blockIsostasyOnsetYears: number;
}

/** Scalar whole-planet quantities, updated by systems as they run. */
export interface Globals {
  /** Fraction of cells with elevation above `seaLevelM`. Emergent from the
   *  dynamic sea level (#33): finalized by the `seaLevel` system each step
   *  (at t=0 `seaLevelM` is 0, so it equals the 0 m-datum land share). */
  landFraction: number;
  /** Atmospheric CO₂, ppm — the slow carbonate–silicate reservoir (#34); the
   *  energy balance reads it as the greenhouse forcing. Integrated each step by
   *  the `carbon` system from tectonic outgassing minus silicate weathering (the
   *  deep-time thermostat); seeded at `initialCo2Ppm` and, like the other slow
   *  reservoirs, first departs it at step 1 (carbon is not run at init). */
  co2: number;
  /** Global cell-count-mean surface temperature, K — a diagnostic for the
   *  report/HUD and the #34 snowball detector (#30). */
  meanTemperatureK: number;
  /** Global sea level relative to the fixed 0 m crust datum, m (#33). Solved
   *  each step by the `seaLevel` system from the conserved water inventory
   *  minus grounded-ice-locked volume against the hypsometric curve; a cell is
   *  ocean when `elevation < seaLevelM`. Read by `energyBalance`/`moisture`/
   *  `erosion` as the previous step's value (the explicit climate lag). 0 at
   *  t=0 by construction. */
  seaLevelM: number;
  /** Conserved total water inventory as a global-equivalent layer thickness, m
   *  (#33) — ocean liquid + grounded ice water-equivalent, spread over the
   *  whole sphere (cell-count mean). Set once at init from the initial ocean
   *  volume at the 0 m datum (so t=0 sea level is exactly 0 and the ~30% tuned
   *  initial land share is preserved), then held constant; the water-mass
   *  invariant checks `oceanVolume(seaLevelM) + lockedIce = this`. */
  waterInventoryM: number;
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
    blockIsostasy: false,
    blockIsostasyOnsetYears: 0,
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
    globals: {
      landFraction: 0,
      co2: params.initialCo2Ppm,
      meanTemperatureK: 0,
      seaLevelM: 0,
      waterInventoryM: 0,
    },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {} },
  };
  // Terrain and plates first (they set the elevation/land mask the climate
  // block reads).
  const shaped = applyInitialPlates(applyInitialTerrain(state));

  // Calibrate the conserved water inventory (#33) from the initial coastline:
  // the ocean volume at the 0 m datum, as a global-equivalent layer thickness
  // (cell-count mean of depth below the datum). This makes t=0 sea level
  // exactly 0 and preserves the ~30% land fraction the initial terrain is tuned
  // for, rather than imposing a free ocean-inventory constant that would
  // generally place the initial shoreline away from that datum. The inventory
  // is then held constant and the water-mass invariant checks it (§5).
  const elevation = shaped.fields.elevation;
  let oceanDepthSum = 0;
  for (let i = 0; i < count; i++) {
    const e = elevation[i]!;
    if (e < 0) oceanDepthSum -= e;
  }
  const calibrated: PlanetState = {
    ...shaped,
    globals: { ...shaped.globals, seaLevelM: 0, waterInventoryM: oceanDepthSum / count },
  };

  // Then the energy balance (a physical temperature field + meanTemperatureK),
  // winds (#31) from that temperature gradient, moisture (#32) advecting ocean
  // evaporation along the winds to fill `precipitation` (the erosion input), and
  // biome (#35) classifying that temperature/precipitation into `biome` — all
  // FAST diagnostics, mirroring the step pipeline order so the t=0 keyframe
  // already carries physical temperature/wind/precipitation/biome. The slow
  // reservoirs — `ice` (#33), the derived `seaLevel` (#33) and the `carbon` CO₂
  // reservoir (#34) — are deliberately NOT run at init: they carry memory and
  // start at their seed values (iceFraction 0, seaLevelM 0, co2 = initialCo2Ppm),
  // advancing over the timeline from step 1, so every pre-existing slow-reservoir
  // field stays byte-identical to the pre-#33/#34 kernel.
  return applyBiome(applyMoisture(applyWinds(applyEnergyBalance(calibrated))));
}
