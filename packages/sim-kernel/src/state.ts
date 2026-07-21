import {
  ABIOGENESIS_RATE_PER_YR,
  DEFAULT_INITIAL_LAND_FRACTION,
  DEFAULT_KEYFRAME_INTERVAL_YEARS,
  DEFAULT_NUM_PLATES,
  DEFAULT_STEP_YEARS,
  EARTH_DAY_HOURS,
  EARTH_OBLIQUITY_DEG,
  EARTH_RADIUS_M,
  INITIAL_CO2_PPM,
  INITIAL_OXYGEN_PAL,
  REDUCTANT_BUFFER_PAL,
  RIFT_SUTURE_COOLDOWN_YEARS,
  SOLAR_LUMINOSITY_W,
} from './constants';
import type { SimEvent } from './events';
import { FIELD_NAMES, type Fields } from './fields';
import { DEFAULT_GRID_N, cellCount } from './grid';
import { foundCrustalThickness } from './isostasy';
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
   * doc). **Default ON** since the datum-trio promotion
   * (`KERNEL_BEHAVIOR_VERSION` 18, #127 item 9); the flag-off path stays
   * byte-identical, pinned by the legacy all-off and pre-datum-promotion
   * default goldens.
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
   * `landDatumOffsetM` (datums.ts). **Default ON** since the datum-trio
   * promotion (`KERNEL_BEHAVIOR_VERSION` 18, #127 item 9); runs with
   * `seaLevelDatums` also on (it regulates the regime those re-keyed platform
   * datums describe). The flag-off path stays byte-identical, pinned by the
   * legacy all-off and pre-datum-promotion default goldens.
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
   * run as the third layer of the datum stack — runs with
   * `seaLevelDatums` AND `freeboard` also on; with the stack off, the
   * re-keyed floor and the absolute platform/land datums disagree by the
   * full sea-level fall (documented cross-mechanism interaction, same
   * posture as the blockElevationCap note in blockIsostasy.ts). **Default
   * ON** since the datum-trio promotion (`KERNEL_BEHAVIOR_VERSION` 18, #127
   * item 9); the flag-off path stays byte-identical, pinned by the legacy
   * all-off and pre-datum-promotion default goldens.
   */
  bathymetryDatum: boolean;
  /** Sim year before which bathymetryDatum is inert even when enabled — the
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  bathymetryDatumOnsetYears: number;
  /**
   * Enable force-balance plate kinematics (Tectonics V2 stage 1, #111,
   * proposal §2). When on, the `plateDynamics` system makes each plate's
   * angular velocity ω⃗ *derived state*: every step it relaxes toward the
   * terminal velocity of a boundary-integrated rigid-plate torque balance
   * (slab pull, slab suction, ridge push, collision damping, closed by basal
   * drag with a continental-keel multiplier), replacing the immutable random
   * Euler vector drawn once at creation. Zero new RNG draws. **Default ON**
   * since the Tectonics V2 promotion (`KERNEL_BEHAVIOR_VERSION` 17, #115); the
   * flag-off path is still pinned byte-identical to the pre-V2 `main` spine by
   * the carried-over legacy golden.
   */
  forceKinematics: boolean;
  /** Sim year before which forceKinematics is inert even when enabled — the
   *  #111 branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  forceKinematicsOnsetYears: number;
  /**
   * Tectonics V2 stage 2 (#112, proposal §2.4): rewrite wilson's suture
   * *trigger* so a continent–continent pair merges when its closing speed
   * *stalls* (mean |normal speed| < `SUTURE_STALL_SPEED_M_PER_YR` for
   * `SUTURE_STALL_AFTER_YEARS`), with a loud `SUTURE_TIMEOUT_YEARS` backstop —
   * instead of the fixed `SUTURE_AFTER_YEARS` contact countdown. Detects the
   * collision death `forceKinematics` produces rather than scheduling it. The
   * merged plate's ω⃗ is the drag-tensor-weighted blend (the fixed point the
   * combined plate relaxes to) and the winner's `accumulatedRadians` is
   * preserved. **Default ON** since v17 (#115); the flag-off suture path stays
   * byte-identical. Zero new RNG draws. Meaningful only with `forceKinematics`
   * on (it supplies the closing-speed collapse the stall criterion reads) — so
   * `emergentSuture` on + `forceKinematics` off is rejected at construction
   * (`validateKinematicDependencies`, #127 item 6): without the closing-speed
   * collapse every real collision grinds to the 150 Myr `SUTURE_TIMEOUT_YEARS`
   * backstop, a silently degenerate world.
   */
  emergentSuture: boolean;
  /** Sim year before which emergentSuture is inert even when enabled — the
   *  #112 branched-A/B onset, same contract as blockIsostasyOnsetYears.
   *  Default 0. */
  emergentSutureOnsetYears: number;
  /**
   * Enable tension-driven rift timing (Tectonics V2 stage 3, #113, proposal
   * §2.4). When on, the `wilson` rift hazard is λ = `RIFT_HAZARD_AT_REF_PER_MYR`
   * × min(4, (tensionN/`RIFT_TENSION_REF_N`)²) × a supercontinent thermal-blanket
   * factor, drawn at the same hash site as the legacy scheme — a plate rifts
   * because its opposed subducting perimeter is pulling it apart, continuously
   * and with no knee, replacing the flat Bernoulli hazard × the #66-bimodal size
   * ramp. The age gate and size ramp are deleted under the flag; the plate-slot
   * safety gates stay. The fragment inherits the parent's ω⃗ and separates
   * because ridge push registers on the new divergent margin (the perpendicular
   * pole + azimuth fan go dead flag-on). Requires `forceKinematics` for a
   * non-zero `tensionN`; zero new RNG draws. **Default ON** since v17 (#115);
   * the flag-off path stays byte-identical to the pre-V2 `main` spine.
   * `tensionRift` on + `forceKinematics` off is rejected at construction
   * (`validateKinematicDependencies`, #127 item 6): `tensionN` is 0 forever and
   * this flag deletes the legacy age/size rift hazard, so the planet never
   * rifts — a silently rift-dead world.
   */
  tensionRift: boolean;
  /** Sim year before which tensionRift is inert even when enabled — the #113
   *  branched-A/B onset, same contract as forceKinematicsOnsetYears. Default 0. */
  tensionRiftOnsetYears: number;
  /**
   * Post-rift suture cooldown (years) stamped onto freshly rifted halves
   * (their `sutureLockUntilYears`) **only when `tensionRift` is active**
   * (Tectonics V2 stage 4, #114, proposal §5). When `tensionRift` is off the
   * legacy constant `RIFT_SUTURE_COOLDOWN_YEARS` (120 Myr) is used unchanged,
   * so the flag-off / `main` spine stays byte-identical regardless of this
   * value. Default `RIFT_SUTURE_COOLDOWN_YEARS`: this parameterization is
   * behavior-neutral. Stage 4 sweeps it 120→30→0 Myr against the historic
   * cooldown-vs-land-min table and flips the default to 0 once the gates pass
   * — under `forceKinematics`+`tensionRift`, ridge push at the fresh divergent
   * margin separates the halves, so the timer's job (keeping rifted halves
   * from re-welding) is done by physics rather than a schedule.
   */
  riftSutureCooldownYears: number;
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
  /**
   * Fraction of cells the initial terrain places above the 0 m datum (#106):
   * the t=0 coastline, chosen instead of pinned at 30%, so a planet can start
   * ocean-dominated or land-dominated. `applyInitialTerrain` places its sea
   * quantile at `1 − initialLandFraction`; the conserved water inventory is
   * then derived from the ocean volume below that coastline (see
   * `createInitialState`), so t=0 sea level stays exactly 0 at any value and a
   * lower land fraction re-derives a larger, self-consistent inventory. This is
   * why it composes with `waterInventoryScale` (#105): land fraction shapes the
   * initial world (the derived base), water scale sets the endowment relative to
   * it (base × scale). Init-time only, no RNG, no mechanism flag/onset — a
   * `PlanetParams` number like `numPlates`. Default
   * **`DEFAULT_INITIAL_LAND_FRACTION`** (0.3, the literal): the sea quantile is
   * unchanged, so every t=0 field — and the main goldens — is byte-identical to
   * the pre-#106 kernel by construction. Must satisfy
   * `0 < initialLandFraction < CONTINENTAL_CRUST_FRACTION` (0.4): the gap to the
   * crust fraction is the initial submerged shelf, and at land fraction ≥ crust
   * fraction every continental cell is emergent and the shelf constructions
   * starve. Enforced at the boundary by the `--initial-land-fraction` CLI flag;
   * like `numPlates`, the kernel trusts the value (an out-of-range fraction is a
   * caller bug).
   */
  initialLandFraction: number;
  /**
   * Dimensionless multiplier on the derived water inventory (#105): planets
   * accumulate different amounts of water during formation, so the endowment
   * is a chosen property, not an artifact of the terrain noise. The base is
   * still derived in `createInitialState` — the ocean volume below the t=0
   * coastline, which keeps t=0 sea level exactly 0 and adapts to a companion
   * `initialLandFraction` (#106) or grid resolution — and this scales it, so
   * the two knobs compose as base × scale. Init-time only, no RNG, no mechanism
   * flag/onset: it is a `PlanetParams` number like `numPlates`. Default **1.0**
   * — the derivation multiplies by exactly 1.0, so the main goldens are
   * byte-identical by construction. Scale > 1 raises the deep-time sea (≈2.6
   * km-equiv ≈ Earth floats the ridge crests roughly awash; ≈3.4–4.7 submerges
   * them 1–2.5 km natively, making the #102 `bathymetryDatum` crest cap
   * redundant); scale < 1 gives a low-water world. Composes with
   * `bathymetryDatum` by construction — its crest cap self-disengages once the
   * sea rides above −2000 m. See docs/SEA_LEVEL_DATUM_FINDINGS.md for the
   * scale/seed sweep and the native-submergence measurement. Must be > 0 —
   * enforced at the boundary by the `--water-scale` CLI flag; like `numPlates`,
   * the kernel trusts the value (a non-positive scale is a caller bug).
   */
  waterInventoryScale: number;
  /**
   * Enable the crustal-column model, stage C1 (docs/CRUSTAL_COLUMN_PROPOSAL.md
   * §6): `crustalThicknessM` becomes the PRIMARY vertical state for
   * continental crust and elevation its derived cache — every continental
   * elevation writer routes its Δe through thickness (ΔT = Δe/k, the C1
   * mechanical shims) and re-derives elevation as C + k·T (isostasy.ts), with
   * branch-flip rules founding thickness by inversion at ocean→continent
   * flips and re-founding 7.1 km oceanic columns at continent→ocean flips.
   * At C1 behavior is distributionally today's (the shims are mechanical
   * equivalents; trajectories diverge at float level only); stages C2–C6
   * replace shims with mass-budget physics one mechanism at a time. Default
   * OFF: flag-off, every pre-existing field is byte-identical (the field
   * itself is founded at init and advected regardless of the flag, so both
   * A/B arms carry comparable bytes). Zero RNG anywhere in the model — the
   * branched-A/B contract holds by construction.
   */
  crustalColumns: boolean;
  /** Sim year before which crustalColumns is inert even when enabled — the
   *  branched-A/B onset, same contract as blockIsostasyOnsetYears. The onset
   *  step re-founds thickness by inversion over the CURRENT elevation
   *  (isostasy.ts, the zero-snap rule), so the A/B is clean at any onset
   *  year. Default 0. */
  crustalColumnsOnsetYears: number;
  /**
   * Enable the plate-census diagnostic (Tectonics V2 stage 0, #110). A pure,
   * RNG-free per-step pass (`plateCensusSystem`, runs last in the pipeline)
   * that reads the current plates + `plateId`/`crustType` fields and writes a
   * fixed set of scalar aggregates into `globals` (`plateSpeed*`,
   * `oceanicContinentalSpeedRatio`, `speedContinentalityCorr`, `poleStability`)
   * so the sim-cli `--plate-census` report can measure the force-balance gates
   * of §3/§5 without keyframes carrying plate records (they carry
   * `fields`/`globals`/`events` only — step.ts). Default **false**: when off
   * the pass is identity and every field, event, and plate record is
   * byte-identical to the pre-#110 kernel (the census scalars simply hold their
   * 0 init value), so the main goldens are untouched. Not a mechanism (no
   * onset/`--ab`): a measurement toggle like a `--dump`, kept out of
   * `MECHANISMS`. */
  plateCensus: boolean;
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
   *  volume at the 0 m datum (so t=0 sea level is exactly 0 and the
   *  `initialLandFraction` land share (#106, default ~30%) is preserved), then
   *  held constant; the water-mass invariant checks
   *  `oceanVolume(seaLevelM) + lockedIce = this`. */
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
  /**
   * Plate-census diagnostics (Tectonics V2 stage 0, #110) — written each step
   * by `plateCensusSystem` ONLY when `params.plateCensus` is set, else they
   * hold their 0 init value (the pass is identity). Diagnostic-only: nothing in
   * the kernel reads them back, they never cross the codec, and they are not in
   * the golden field hashes, so toggling the census is byte-identical to the
   * pre-#110 kernel. The sim-cli `--plate-census` report reads them off each
   * keyframe's `globals`. Speeds are a plate's characteristic surface speed
   * |ω|·R (rad/yr × radiusMeters = m/yr), aggregated over ALIVE plates that own
   * ≥1 cell; all six are 0 at t=0 (the pipeline is not run at init) and 0 on any
   * step with no such plates.
   */
  /** Median plate characteristic speed |ω|·R, m/yr (§3 target 2–6 cm/yr). */
  plateSpeedMedianMPerYr: number;
  /** Slowest plate's characteristic speed |ω|·R, m/yr. */
  plateSpeedMinMPerYr: number;
  /** Fastest plate's characteristic speed |ω|·R, m/yr. */
  plateSpeedMaxMPerYr: number;
  /** Mean speed of ocean-dominated plates (current continental fraction < 0.5)
   *  ÷ mean speed of continent-dominated plates (≥ 0.5) — the Forsyth & Uyeda
   *  ratio (§3 target 1.5–4). 0 when either partition is empty. */
  oceanicContinentalSpeedRatio: number;
  /** Pearson correlation of per-plate speed vs current continental fraction
   *  over alive owning plates (the Forsyth & Uyeda sign test — expected
   *  negative once the balance runs). 0 when < 2 plates or zero variance. */
  speedContinentalityCorr: number;
  /** Pearson correlation of per-plate speed vs attached-slab driving stress
   *  (`slabPullN`/plate area) over alive owning plates — the Forsyth & Uyeda
   *  slab-attachment test the stage-1 gate is written against (#111; want ≥
   *  +0.3). Positive ⇒ plates with more attached down-going slab move faster;
   *  unlike the continentality proxy it stays discriminating in the deep-time
   *  mixed-plate steady state. 0 when < 2 plates or zero variance (flag-off). */
  speedSlabAttachmentCorr: number;
  /** Count-mean over alive owning plates of the cosine between this step's
   *  Euler pole and the previous census step's (`prevEulerPole`) — the
   *  pole-stability seed for the stage-1 autocorrelation diagnostic (§8 risk 1).
   *  Exactly 1.0 on the immutable-pole baseline (poles never move); < 1 once
   *  `forceKinematics` steers them. 1.0 on the first census step (no prior). */
  poleStability: number;
  /** Cumulative count of #67 margin-consolidation pair-flips (stray continental
   *  island ⇄ enclosed oceanic hole) since t=0 — the boundary-churn proxy
   *  (margin-ledger graft, §5). Accumulated by the tectonics consolidation pass
   *  ONLY when `params.plateCensus` is set (else it holds 0, so the default path
   *  is untouched); the `--plate-census` report differences it between keyframes
   *  into a flips-per-100-Myr churn rate. High = margins flickering — the
   *  flicker the force balance is meant to quiet. */
  marginConsolidationFlipsTotal: number;
  /**
   * Crustal-columns C2 planation-throughput diagnostics (proposal §6 C2: the
   * measured planation rate must be reported against the 4.7 m/Myr budget on
   * BOTH the source and sink sides). All cumulative since t=0, maintained ONLY
   * while `crustalColumnsActive` (flag-off they hold 0 — the accounting is
   * byte-neutral). Diagnostic-only, like the plate census: nothing in the
   * kernel reads them back, they never cross the codec, and they are not in
   * the golden field hashes. sim-cli `--crust-stats` differences them between
   * keyframes into per-Myr rates. Volumes use true solid-angle cell areas × R²
   * (trap T7).
   */
  /** Rock volume exported from continental columns across coastlines by
   *  coastal export (#65) + marine planation (#90), m³ of continental crust —
   *  the SOURCE side of the planation budget. Interior diffusion is excluded:
   *  it redistributes within the continents and exports nothing. */
  columnsExportedRockM3: number;
  /** Coastal export/planation visits whose desired flux was bound by shelf
   *  room (including room ≤ 0) — the sink-side saturation numerator. */
  columnsExportShelfLimited: number;
  /** Coastal export/planation visits with positive desired flux — the
   *  saturation denominator. */
  columnsExportVisits: number;
  /** Sediment volume consumed when crust became continental (the tectonics
   *  maturation sweep + crustFates weld bridges — the site-22 ledger exits,
   *  shims until stage C4 accretes it as thickness), m³ of sediment. Lets the
   *  sink-side subduction throughput be inferred honestly from the sediment
   *  stock: subducted ≈ deposits − zeroed − Δstock. */
  columnsSedimentZeroedM3: number;
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
   * Wilson-cycle bookkeeping (#18, #112): when each continent-continent plate
   * pair ("a-b" with a < b) entered sustained contact. Both maps are rebuilt
   * every step from the current contact scan (never iterated by key order).
   *
   * - `contactSince`: start of the current continuous cont–cont contact. In the
   *   flag-off (`emergentSuture` off) path a pair sutures once this has lasted
   *   `SUTURE_AFTER_YEARS`; under `emergentSuture` it drives the loud
   *   `SUTURE_TIMEOUT_YEARS` backstop instead.
   * - `stallSince`: `emergentSuture` only — anchor time of the current tumbling
   *   stall window. A pair sutures once a full `SUTURE_STALL_AFTER_YEARS` window
   *   has elapsed whose *net* closing rate (below) stayed sub-threshold. Evaluated
   *   only at window boundaries (not per step): once `now − stallSince` reaches
   *   `SUTURE_STALL_AFTER_YEARS`, if the window's average |net closing rate| is at
   *   or above `SUTURE_STALL_SPEED_M_PER_YR` the window failed and the anchor
   *   re-arms to now (starting a fresh window); otherwise the pair is stalled and
   *   the suture fires. Boundary-only evaluation is what makes the detector robust
   *   to per-step advection jitter — a lone noisy step cannot veto a window,
   *   because the net closing is summed across the whole window first. Always
   *   empty on the flag-off path.
   * - `shorteningIntegral`: `emergentSuture` only — net signed continent–continent
   *   shortening (metres, + = convergent) accumulated since `stallSince[key]`.
   *   Taking the *net signed* sum (not the per-cell magnitude) is what lets a
   *   genuinely stopped collision read ≈0 even while per-cell speeds jitter with
   *   large magnitude — the signs cancel over the contact. Divided by the elapsed
   *   window it gives the average net closing rate the boundary test uses. Reset
   *   to 0 with the anchor. Always empty on the flag-off path.
   */
  wilson: {
    readonly contactSince: Readonly<Record<string, number>>;
    readonly stallSince: Readonly<Record<string, number>>;
    readonly shorteningIntegral: Readonly<Record<string, number>>;
  };
}

/**
 * Reject the degenerate Tectonics-V2 partial-flag configs (#127 item 6, review
 * finding §2.3). `tensionRift` and `emergentSuture` both read state that only
 * `forceKinematics` produces — the boundary tension `tensionN` and the
 * force-balance closing-speed collapse — so with `forceKinematics` off each is a
 * silently broken world, not a measurable one:
 *
 *  - `tensionRift` on + `forceKinematics` off ⇒ `tensionN` is 0 forever and the
 *    flag deletes the legacy age/size rift hazard, so the planet NEVER rifts:
 *    plates only merge, straight to a monopoly.
 *  - `emergentSuture` on + `forceKinematics` off ⇒ no closing-speed collapse for
 *    the stall detector to see, so every real collision grinds the full 150 Myr
 *    to the `SUTURE_TIMEOUT_YEARS` backstop.
 *
 * Both are documented in the help text but were previously unguarded, so a web
 * sidebar toggle or a stray `--no-force-kinematics` could hand the kernel a dead
 * world with no warning. We fail loudly at construction (`createPlanetParams`)
 * and at run entry (`createInitialState`) instead. The check is at the FLAG
 * level: a `forceKinematics` that is on but onset-gated (inert until its onset
 * year) satisfies the dependency — its onset-window transient self-heals and is
 * out of scope here. UIs should cascade the dependents off (see
 * `resolveMechanismDependencies`) rather than trip this.
 */
export function validateKinematicDependencies(
  params: Pick<PlanetParams, 'forceKinematics' | 'tensionRift' | 'emergentSuture'>,
): void {
  if (params.forceKinematics) return;
  const dependents: string[] = [];
  if (params.tensionRift) dependents.push('tensionRift');
  if (params.emergentSuture) dependents.push('emergentSuture');
  if (dependents.length === 0) return;
  throw new Error(
    `Degenerate tectonics config: ${dependents.join(' and ')} require forceKinematics ` +
      `(they read the boundary tension / force-balance closing speed it produces). With ` +
      `forceKinematics off, tensionRift makes a rift-dead planet and emergentSuture grinds ` +
      `every collision to the 150 Myr suture timeout. Enable forceKinematics, or disable ` +
      `${dependents.join(' and ')}. (#127 item 6, review finding §2.3)`,
  );
}

export function createPlanetParams(partial: Partial<PlanetParams> & { seed: number }): PlanetParams {
  const params: PlanetParams = {
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
    seaLevelDatums: true,
    seaLevelDatumsOnsetYears: 0,
    freeboard: true,
    freeboardOnsetYears: 0,
    bathymetryDatum: true,
    bathymetryDatumOnsetYears: 0,
    forceKinematics: true,
    forceKinematicsOnsetYears: 0,
    emergentSuture: true,
    emergentSutureOnsetYears: 0,
    tensionRift: true,
    tensionRiftOnsetYears: 0,
    riftSutureCooldownYears: RIFT_SUTURE_COOLDOWN_YEARS,
    biosphereEnabled: true,
    abiogenesisRatePerYear: ABIOGENESIS_RATE_PER_YR,
    initialOxygenPAL: INITIAL_OXYGEN_PAL,
    initialLandFraction: DEFAULT_INITIAL_LAND_FRACTION,
    waterInventoryScale: 1,
    crustalColumns: false,
    crustalColumnsOnsetYears: 0,
    plateCensus: false,
    ...partial,
  };
  validateKinematicDependencies(params);
  return params;
}

export function createInitialState(params: PlanetParams): PlanetState {
  // Backstop for callers that assemble params by other means (raw spreads, the
  // codec) and hand them straight to the step pipeline (#127 item 6).
  validateKinematicDependencies(params);
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
      // Plate-census diagnostics (#110): 0 until plateCensusSystem writes them
      // on step 1 (and only when params.plateCensus is set). Not run at init.
      plateSpeedMedianMPerYr: 0,
      plateSpeedMinMPerYr: 0,
      plateSpeedMaxMPerYr: 0,
      oceanicContinentalSpeedRatio: 0,
      speedContinentalityCorr: 0,
      speedSlabAttachmentCorr: 0,
      poleStability: 0,
      marginConsolidationFlipsTotal: 0,
      // Crustal-columns C2 planation-throughput counters: 0 until the erosion/
      // tectonics/crustFates passes accumulate them, and only under an active
      // column model — flag-off runs hold 0 forever.
      columnsExportedRockM3: 0,
      columnsExportShelfLimited: 0,
      columnsExportVisits: 0,
      columnsSedimentZeroedM3: 0,
    },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {}, stallSince: {}, shorteningIntegral: {} },
  };
  // Terrain and plates first (they set the elevation/land mask the climate
  // block reads).
  const plated = applyInitialPlates(applyInitialTerrain(state));

  // Crustal-column founding synthesis (CRUSTAL_COLUMN_PROPOSAL.md §2.5):
  // invert the derivation over the shaped t=0 terrain — continental
  // T = (e − C)/k, oceanic 7.1 km. Unconditional (not flag-gated) so both
  // branched-A/B arms carry comparable field bytes; zero RNG; writes ONLY the
  // new field, so every pre-existing field stays byte-identical at t=0. The
  // t=0 thickness DISTRIBUTION is realistic without new noise design (shelf
  // bottoms ↦ ~33 km, noise peaks ↦ ~68 km — proposal closure check 2).
  const shaped: PlanetState = {
    ...plated,
    fields: {
      ...plated.fields,
      crustalThicknessM: foundCrustalThickness(plated.fields.elevation, plated.fields.crustType),
    },
  };

  // Calibrate the conserved water inventory (#33) from the initial coastline:
  // the ocean volume at the 0 m datum, as a global-equivalent layer thickness
  // (cell-count mean of depth below the datum). This makes t=0 sea level
  // exactly 0 and preserves the `initialLandFraction` land share (#106, default
  // ~30%) the initial terrain placed, rather than imposing a free
  // ocean-inventory constant that would generally place the initial shoreline
  // away from that datum. Because the base is derived from the shaped terrain, a
  // lower land fraction (more ocean below the datum) re-derives a larger,
  // self-consistent inventory automatically — the two init knobs compose. The
  // inventory is then held constant and the water-mass invariant checks it (§5).
  //
  // `waterInventoryScale` (#105) then multiplies this derived base to give the
  // planet a chosen water endowment. At the default 1.0 the multiply is exact
  // (`x * 1.0 === x` in IEEE-754), so the inventory — and every field — is
  // byte-identical to the pre-#105 kernel and the main goldens are untouched.
  // Only the `waterInventoryM` global moves at t=0 (seaLevelM stays pinned to 0
  // here); at scale > 1 the seaLevel solve at step 1 lifts the sea above the
  // initial coastline into the early-flooding regime measured in the findings doc.
  const elevation = shaped.fields.elevation;
  let oceanDepthSum = 0;
  for (let i = 0; i < count; i++) {
    const e = elevation[i]!;
    if (e < 0) oceanDepthSum -= e;
  }
  const waterInventoryM = (oceanDepthSum / count) * params.waterInventoryScale;
  const calibrated: PlanetState = {
    ...shaped,
    globals: { ...shaped.globals, seaLevelM: 0, waterInventoryM },
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
