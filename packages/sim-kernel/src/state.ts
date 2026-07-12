import {
  ABIOGENESIS_RATE_PER_YR,
  DEFAULT_KEYFRAME_INTERVAL_YEARS,
  DEFAULT_NUM_PLATES,
  DEFAULT_STEP_YEARS,
  EARTH_DAY_HOURS,
  EARTH_OBLIQUITY_DEG,
  EARTH_RADIUS_M,
  INITIAL_CO2_PPM,
  INITIAL_OXYGEN_PAL,
  REDUCTANT_BUFFER_PAL,
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
  /**
   * Enable small-component crust fates + terrane docking (#88): small
   * continental components within a short ocean gap of a large component
   * weld onto it (gap cells flip continental, the terrane transfers to the
   * large component's plate — Wrangellia-style docking), and isolated small
   * components subside toward the founder level and have their crust record
   * retired (crustType → 0, the crustal-area ledger debited deliberately)
   * once fully drowned. Default ON (promoted after the branched-A/B campaign
   * in ISSUE_88_91_FINDINGS.md); flip off for the pre-#88 kernel path, which
   * stays pinned by the legacy all-mechanisms-off goldens.
   */
  crustFates: boolean;
  /** Sim year before which crustFates is inert even when enabled — the #88
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears (the
   *  system consumes no RNG). Default 0. */
  crustFatesOnsetYears: number;
  /**
   * Enable compact arc maturation (#89): an arc cell in the accretionary
   * belt matures into continental crust only when it has at least
   * COMPACT_ARC_MIN_CONT_NEIGHBORS continental 4-neighbors, so creation
   * grows blobs attached to existing continent instead of manufacturing the
   * island chains that become the next generation of lace. Default OFF —
   * measured negative (it starves continental creation; see
   * ISSUE_88_91_FINDINGS.md, and combined with emergentArcTaper it collapses
   * the default world toward a waterworld), so it was NOT promoted with the
   * #88-#91 batch. Togglable in the web sidebar / sim-cli --compact-arcs.
   */
  compactArcs: boolean;
  /** Sim year before which compactArcs is inert even when enabled — the #89
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears. Default 0. */
  compactArcsOnsetYears: number;
  /**
   * Enable marine planation for small components (#90): wave attack grades
   * small continental blocks toward the shelf/founder level, moving mass
   * into oceanic `sedimentM` (fully conservative, unlike the #84 founder)
   * and lifting the subsea erosion damping inside small components. Default
   * ON (promoted after the branched-A/B campaign in ISSUE_88_91_FINDINGS.md;
   * the legacy goldens pin the off path).
   */
  marinePlanation: boolean;
  /** Sim year before which marinePlanation is inert even when enabled — the
   *  #90 branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  marinePlanationOnsetYears: number;
  /**
   * Enable the emergent-arc growth taper (#91): oceanic arc growth above sea
   * level is scaled by ARC_EMERGENT_GROWTH_FACTOR, so young or flickering
   * margins hold submerged arcs and only long-lived subduction — sustained
   * enough to outpace the OCEAN_RELIEF_RELAX decay — builds emergent
   * Japan/Aleutians-style chains. The maturation gate (−500 m) sits below
   * sea level, so the continental-creation budget is untouched. Default OFF —
   * measured negative (N=128 land minimum collapses to 3.6% alone, and
   * combined with compactArcs the default world ends near-waterworld; see
   * ISSUE_88_91_FINDINGS.md), so it was NOT promoted with the #88-#91 batch.
   * Togglable in the web sidebar / sim-cli --emergent-arc-taper.
   */
  emergentArcTaper: boolean;
  /** Sim year before which emergentArcTaper is inert even when enabled —
   *  the #91 branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  emergentArcTaperOnsetYears: number;
  /**
   * Re-key the platform/arc datum constants to the dynamic sea level
   * (`globals.seaLevelM`, previous step's value — the standard explicit lag)
   * instead of the fixed 0 m crust datum. Affects the microcontinent founder
   * level, the sediment shelf ceiling, the arc maturation gate and island
   * ceiling, the crustFates founder/retirement levels, the marinePlanation
   * target, and the blockIsostasy cap ramp. Motivation
   * (docs/SEA_LEVEL_DATUM_FINDINGS.md): sea level falls ~3 km over the first
   * 500 Myr as the ocean basins mature, stranding every absolute-datum
   * "submerged platform" constant kilometres above the real waterline —
   * foundered fragments stand as dry islands, filled shelves as coastal
   * plain, and no continental crust stays flooded. The oceanic age-depth
   * curve deliberately stays absolute: re-keying it would make the seafloor
   * chase the falling sea level in an unbounded feedback (see the findings
   * doc). Default OFF — measurement prototype, same posture as #84/#88-#91.
   */
  seaLevelDatums: boolean;
  /** Sim year before which seaLevelDatums is inert even when enabled — the
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  seaLevelDatumsOnsetYears: number;
  /**
   * Enable freeboard regulation (the "real fix" scoped in
   * docs/SEA_LEVEL_DATUM_FINDINGS.md): continental crust floats. Three
   * coupled pieces, all keyed to the dynamic sea level: (1) the cell-count
   * mean of continental elevation relaxes toward `seaLevelM +
   * FREEBOARD_TARGET_M` by a uniform, rate-bounded epeirogenic shift — the
   * isostatic anchor that stops the deep-time sea-level fall stranding the
   * continents kilometres above the waterline; (2) passive margins
   * (continental cells within PASSIVE_MARGIN_WIDTH_CELLS of same-plate
   * oceanic crust, excluding convergent cells) subside toward `seaLevelM +
   * PASSIVE_MARGIN_SHELF_M` — post-rift thermal subsidence building
   * flooded shelves; (3) the land-relief datums (`OROGENIC_ROOT_REFERENCE_M`,
   * `OROGENY_MAX_ELEVATION_M`) become sea-level-relative via
   * `landDatumOffsetM` (datums.ts). Default OFF — measurement prototype,
   * same posture as #84/#88-#91; designed to be measured with
   * `seaLevelDatums` also on (it regulates the regime those re-keyed
   * platform datums describe).
   */
  freeboard: boolean;
  /** Sim year before which freeboard is inert even when enabled — the
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  freeboardOnsetYears: number;
  /**
   * Re-key the oceanic age-depth reference to the dynamic sea level (#102):
   * every consumer of the age-depth curve — the thermal-subsidence target,
   * trench pinning, divergent gap fill, consolidation island flips, and the
   * sediment shelf-room check — reads it through
   * `seaKeyedOceanicDepthForAge(age, bathymetryDatumOffsetM(state))`
   * (bathymetry.ts / datums.ts; the offset is the previous step's
   * `seaLevelM` — the standard explicit lag). The curve's CREST caps at
   * `OCEAN_RIDGE_MIN_SUBMERGENCE_M` below the sea while the abyssal end
   * stays absolute (the volume anchor), so ridge crests stay submerged
   * instead of standing ~1 km proud of the deep-time sea as emergent island
   * chains. Tracking the WHOLE curve 1:1 — the shape the seaLevelDatums
   * prototype excluded as divergent — was measured (#102) to diverge at the
   * ocean relief relax rate even WITH the freeboard anchor: the keyed basin
   * capacity exceeds the conserved water inventory ~2.3×, so no equilibrium
   * exists (see docs/SEA_LEVEL_DATUM_FINDINGS.md). Designed to
   * run as the third layer of the datum stack — measured with
   * `seaLevelDatums` AND `freeboard` also on; with the stack off, the
   * re-keyed floor and the absolute platform/land datums disagree by the
   * full sea-level fall (documented cross-mechanism interaction, same
   * posture as the blockElevationCap note in blockIsostasy.ts). Default
   * OFF — measurement prototype, same posture as #84/#88-#91.
   */
  bathymetryDatum: boolean;
  /** Sim year before which bathymetryDatum is inert even when enabled — the
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  bathymetryDatumOnsetYears: number;
  /**
   * Enable the biosphere (#37, Phase 4): ocean life, oxygenation, and — from
   * #39 — land vegetation. The ablation switch, **default `true`** (the
   * biosphere is a shipped feature, not a prototype). When `false` the life
   * systems are inert: `marineLife` stays 0, `globals.oxygen` holds its
   * `initialOxygenPAL` seed, `abiogenesisYear` stays −1, no biosphere events
   * fire, and — once #39 lands — the albedo/weathering hooks fall back to their
   * life-free form. Goldens run with the default; the "disable biosphere"
   * done-criterion is a separate parameterized run (mirroring Phase 3's
   * faint-star snowball test), so it does not perturb the golden hash space.
   * Unlike the #84/#88 mechanism toggles it defaults ON and needs no
   * `OnsetYears` gate — abiogenesis provides the temporal onset.
   */
  biosphereEnabled: boolean;
  /** Per-year abiogenesis onset hazard for the gated Bernoulli trial (#37),
   *  converted to a per-step probability via `dt` and gated on the liquid-ocean
   *  habitable fraction, so onset timing is seed/climate-dependent but reliably
   *  occurs within deep time. Default `ABIOGENESIS_RATE_PER_YR`. */
  abiogenesisRatePerYear: number;
  /** Anoxic starting atmospheric O₂ that seeds `globals.oxygen`, PAL (#37).
   *  Default `INITIAL_OXYGEN_PAL` (≈0). */
  initialOxygenPAL: number;
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
  /** Atmospheric O₂ as a fraction of the present atmospheric level, PAL — the
   *  slow biosphere reservoir (#37). The `oxygen` system integrates it each step
   *  from net photosynthetic O₂ flux (mean marine productivity × organic burial)
   *  minus oxidative sinks (reduced volcanic gases, oxidative crustal
   *  weathering), through the `oxygenReductant` buffer. Seeded near-zero
   *  (anoxic) at `initialOxygenPAL`; the **Great Oxidation** is its emergent
   *  crossing of `GOE_THRESHOLD_PAL`. Well-mixed, so a global (like `co2`), not
   *  a per-cell field. Not run at init: first departs its seed at step 1. */
  oxygen: number;
  /** Remaining reduced-species buffer, PAL (#37) — reduced early crust/mantle
   *  (banded-iron-formation-scale sinks) that must be oxidized before
   *  atmospheric `oxygen` can rise. Net positive O₂ flux first draws this down;
   *  only once it is spent does O₂ accumulate. The physical origin of the anoxic
   *  latency between abiogenesis and the Great Oxidation (M0 Q1). Seeded at
   *  `REDUCTANT_BUFFER_PAL`; monotonically non-increasing. */
  oxygenReductant: number;
  /** Sim time at which ocean life originated, yr, or −1 until it has (#37). Set
   *  once by the gated-stochastic abiogenesis onset (which also emits the
   *  `abiogenesis` event) and thereafter read-only — the gate that switches
   *  `marineLife` on and a marker for the report/HUD/narration. */
  abiogenesisYear: number;
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
    crustFates: true,
    crustFatesOnsetYears: 0,
    compactArcs: false,
    compactArcsOnsetYears: 0,
    marinePlanation: true,
    marinePlanationOnsetYears: 0,
    emergentArcTaper: false,
    emergentArcTaperOnsetYears: 0,
    seaLevelDatums: false,
    seaLevelDatumsOnsetYears: 0,
    freeboard: false,
    freeboardOnsetYears: 0,
    bathymetryDatum: false,
    bathymetryDatumOnsetYears: 0,
    biosphereEnabled: true,
    abiogenesisRatePerYear: ABIOGENESIS_RATE_PER_YR,
    initialOxygenPAL: INITIAL_OXYGEN_PAL,
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
      // Biosphere reservoirs (#37): anoxic O₂ seed, the full reductant buffer,
      // and no life yet. Like ice/seaLevel/carbon the biosphere systems are NOT
      // run at init — these seeds first depart at step 1, so every pre-existing
      // field stays byte-identical to the pre-Phase-4 kernel at t=0.
      oxygen: params.initialOxygenPAL,
      oxygenReductant: REDUCTANT_BUFFER_PAL,
      abiogenesisYear: -1,
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
