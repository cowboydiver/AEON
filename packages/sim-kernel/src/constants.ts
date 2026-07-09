/** Physical and simulation constants. Each carries its source. */

/**
 * Kernel-behavior version (#22 / Phase 2). A manually-bumped integer that
 * changes whenever the deterministic simulation output changes — i.e. **every
 * deliberate golden regeneration bumps this in the same commit** (this rule
 * joins CLAUDE.md's golden-regeneration workflow). It is the cache-invalidation
 * key for persisted keyframes (#24): a kernel behavior change can never serve
 * stale history. Distinct from HISTORY_FORMAT_VERSION (codec byte layout).
 * Started at 1 for Phase 2; the #57 rift fix and the post-rift suture cooldown
 * did not regenerate goldens, so no bump was owed there.
 * 2 — the #59 deep-time dispersal pass: fragment-carving rift kinematics +
 *     oversize rift pressure (deep-time-only; goldens untouched), and the
 *     crust-budget/coherence pass that IS golden-changing — continental
 *     conservation in advection (bulldozer push-back), accretionary arc
 *     maturation, micro-continent foundering, and rate-bounded oceanic
 *     relief relaxation all act within the 10-step golden window. Goldens
 *     regenerated deliberately in the same commit; cached histories must
 *     invalidate.
 * 3 — creation retune for the fine-grid land dip (#59 follow-up): the
 *     per-cell arc rate scales max(1, N/32) (arc flux is per unit margin
 *     length; the boundary line it lands on thins ∝ 1/N) and the base rate
 *     rose 1e-3 -> 1.25e-3. Field and codec goldens regenerated
 *     deliberately in the same commit; cached histories at every grid must
 *     invalidate.
 * 4 — continuous size-dependent rift rate (#61) replacing the oversize brake:
 *     one smooth ramp scales the rift probability (capped at the old 8× brake
 *     magnitude) and relaxes the maturity age gate (RIFT_MIN_AGE_YEARS / ramp),
 *     instead of a discontinuous jump at 0.55 of the sphere. The 10-step
 *     *golden* window is byte-identical (it never contains a plate above
 *     RIFT_SIZE_RATE_KNEE = 0.3, so the ramp is exactly 1 there — field and
 *     codec goldens were NOT regenerated), but deep-time keyframes change (the
 *     dispersed-window fraction beats the #59 baseline at N=64 for all three
 *     golden seeds), so cached full histories must invalidate.
 * 5 — suture-line memory (#60): a new advected sutureYears field records
 *     continent-continent weld lines at every suture. Recording-only — the
 *     rift carve deliberately does not read it (every measured carve
 *     weighting made deep-time continents less coherent or broke dispersal;
 *     see wilson.ts and the #60 section of PHASE_2_STAGE0_FINDINGS.md), so
 *     every pre-existing field's bytes are bit-identical at every step of
 *     every run. The field-golden snapshot gains the sutureYears entries and
 *     the PlanetState schema grew, which is a deliberate golden regeneration
 *     and owes this bump by the rule above; the stored keyframe subset
 *     (codec) is untouched, so the bump costs one benign cache miss and can
 *     never serve stale bytes.
 * 6 — erosion gets a sink (#65). Two mechanisms: (1) coastal sediment export —
 *     a continental cell's elevation above sea level crossing a
 *     continental→submerged-oceanic pair now LEAVES the continental budget
 *     and accumulates in the new sedimentM field, which the oceanic age-depth
 *     relaxation target adds on top (shelves fill toward
 *     SEDIMENT_SHELF_CEILING_M); (2) orogenic root decay — continental
 *     elevation above OROGENIC_ROOT_REFERENCE_M relaxes exponentially with
 *     time constant OROGENIC_ROOT_DECAY_TAU_YEARS, so interior mountain belts
 *     welded in by sutures finally retire instead of smearing into immortal
 *     plateaus. Elevation (and temperature via the lapse term) changes within
 *     the 10-step golden window; field and codec goldens regenerated
 *     deliberately in the same commit. The codec's stored field subset is
 *     unchanged (sedimentM is expressed through elevation).
 * 7 — Wilson-cycle clock retune toward Earth-like periods (#66): the whole
 *     trigger clock scales 4× slower together (RIFT_PROBABILITY_PER_MYR
 *     0.006→0.0015, SUTURE_AFTER_YEARS 15→60 Myr, RIFT_SUTURE_COOLDOWN_YEARS
 *     30→120 Myr, RIFT_MIN_AGE_YEARS 150→600 Myr) while the oversize safety
 *     net keeps its measured-good #59 ABSOLUTE rate by scaling
 *     RIFT_SIZE_RATE_REF_MULTIPLE 8→16 (see its comment for why 16, not 32).
 *     Mean interval between reorganizations involving the same plate rises
 *     ~45 → ~140 Myr at N=64 (measured; the sim-cli tempo line tracks it).
 *     As with bump 4, the 10-step golden window is byte-identical (no plate
 *     sits above the knee and no contact can mature inside 10 Myr, so no
 *     draw or merge differs there — field and codec goldens were NOT
 *     regenerated), but every deep-time keyframe past the first rift draw
 *     changes, so cached full histories must invalidate.
 * 8 — boundary-process coherence pass (#67), attacking the mechanisms that
 *     shredded deep-time continents into lace. Two shipped mechanisms:
 *     (1) margin consolidation — stray one-cell continental islands are
 *     pair-flipped against enclosed ocean holes (>= 3 continental
 *     neighbors), ascending cell order, conserving continental cell count
 *     exactly; (2) the continental-conservation bulldozer picks its landing
 *     cell at APPLY time against the resolved post-advection crust map,
 *     preferring oceanic ground attached to continental mass. Also arc
 *     maturation is applied in one pass after the margin loop (same-step
 *     ordering hygiene; same belt gate). Measured at N=64 over 4.5 Gyr,
 *     seeds {1, 42, 1337}: largest continental component 0.08-0.10 ->
 *     0.22-0.31 of continental area, components ~800 -> ~100, edge/area
 *     ~1.9 -> ~0.8, with land minima RISING to 14.4-19.1% and dispersal
 *     within noise of the #66 baseline (see PHASE_2_STAGE0_FINDINGS.md
 *     "#67"). A stricter attachment-gated maturation variant was measured
 *     and rejected (land cost, no shape gain). Consolidation and the push
 *     rework both act within the 10-step golden window; field and codec
 *     goldens regenerated deliberately in the same commit; cached histories
 *     must invalidate.
 * 9 — Phase 3 zonal energy-balance model (#30) replaces the Phase 0/1
 *     latitude+lapse temperature placeholder (climateProxy). Temperature is
 *     now solved by a Budyko–Sellers zonal EBM: annual-mean insolation
 *     (starLuminosity + obliquityDeg) × co-albedo (land/ocean/ice) balanced
 *     against linear OLR with a logarithmic CO₂ greenhouse and North-style
 *     meridional diffusion, then mapped per-cell as zonal − lapse·elevation +
 *     bounded land continentality. Every cell's temperature changes at t=0 and
 *     every step (cell-count-mean surface T ≈290 K at t=0 settling to ≈286–288 K
 *     as orography deepens, equator ≈303 K, pole ≈266 K vs the old ≈257 K pole),
 *     so field and codec goldens are regenerated deliberately in
 *     the same commit; cached histories must invalidate. Precipitation, ice,
 *     and biome are untouched (the precip proxy still feeds erosion until #32),
 *     so no stored-field-set change and HISTORY_FORMAT_VERSION stays 1.
 * 10 — Phase 3 prevailing wind bands (#31): two new advected-free diagnostic
 *     fields `windU`/`windV` (appended after `sedimentM`) are populated by a
 *     new `winds` system running after `energyBalance`. The wind field is a
 *     deterministic band model — cell count from `dayLengthHours` (Earth's 24 h
 *     ⇒ the three-cell Hadley/Ferrel/Polar structure), strength scaled by the
 *     #30 equator-to-pole temperature gradient — with no per-step fluid solve
 *     and no memory. It writes ONLY the two new fields: every pre-existing
 *     field's bytes are bit-identical at t=0 and every step (verified — the
 *     golden diff is purely the two added `windU`/`windV` entries). The
 *     field-golden snapshot and the PlanetState field set grew, which is a
 *     deliberate golden regeneration and owes this bump by the rule above.
 *     The codec's stored-field subset is deliberately unchanged here (winds are
 *     dumpable from the full keyframe and consumed in-kernel by #32; the §1
 *     stored-field-set bump adding them for render-time use, with
 *     HISTORY_FORMAT_VERSION 1→2, lands once with the goldens-labeled Phase 3
 *     work), so this bump costs one benign cache miss and can never serve
 *     stale bytes.
 * 11 — Phase 3 moisture transport + orographic precipitation (#32): a new
 *     `moisture` system replaces the static latitude precipitation proxy
 *     (climateProxy, now deleted) with a real evaporate → advect → precipitate
 *     solve. Ocean cells evaporate at a Clausius–Clapeyron temperature factor;
 *     the moisture column is advected along the #31 wind field by a
 *     conservative upwind donor scheme (a fixed-sweep Jacobi relaxation, cell
 *     order fixed) and rained out by a base rate plus an orographic term
 *     (windward ascent wrings moisture out; lee slopes go dry), so rain shadows
 *     EMERGE from the transport. `precipitation` is now dynamic every step and
 *     at t=0, which changes it directly and — because erosion reads it — changes
 *     `elevation` (and `temperature` via the lapse term, `windU`/`windV` via the
 *     gradient) within the 10-step golden window; field goldens regenerated
 *     deliberately in the same commit. The codec's stored-field SUBSET and its
 *     quantization are unchanged (precipitation is still not stored — the §1
 *     stored-set growth + HISTORY_FORMAT_VERSION 1→2 remains deferred as in
 *     bump 10), but the codec BYTE goldens shift because the stored elevation/
 *     temperature values changed; both are regenerated. Water mass is conserved
 *     across evaporate/transport/precipitate (Σ precipitation = Σ evaporation to
 *     float tolerance — the invariant test pins it).
 * 12 — Phase 3 sea level + ice sheets (#33): two new slow-reservoir/derived
 *     systems, `ice` then `seaLevel`, run after `moisture`. `ice` integrates the
 *     `iceFraction` field with dt from a mass balance (accumulation where cold +
 *     wet, ablation where warm), the first field in the kernel that carries
 *     genuine cross-step memory in the climate block. `seaLevel` solves the
 *     global `seaLevelM` each step from a conserved water inventory minus the
 *     grounded-ice-locked volume against the hypsometric curve (fixed-count
 *     bisection), and `landFraction` becomes emergent from it. The ice-albedo
 *     hook in the energy balance (#30) now reads real `iceFraction` — closing
 *     the feedback that makes snowballs reachable — and `energyBalance`/
 *     `moisture`/`erosion` read the previous step's `seaLevelM` for their
 *     land/ocean tests (the same explicit lag the energy balance already uses
 *     for ice/CO₂). At t=0 `seaLevelM = 0` (the inventory is calibrated from the
 *     initial coastline) and `iceFraction = 0`, so every pre-existing field is
 *     byte-identical at init; `iceFraction` first departs zero at step 1 and the
 *     coupled fields (temperature via albedo, elevation via sea-level-shifted
 *     erosion, then precipitation/winds downstream) depart from step 2, so the
 *     10-step field goldens and the codec BYTE goldens are regenerated
 *     deliberately in the same commit. The codec's stored-field SUBSET and
 *     quantization are unchanged (`iceFraction` is dumpable from the full
 *     keyframe and its render-time storage rides the deferred §1
 *     HISTORY_FORMAT_VERSION 1→2 bump, as in bumps 10/11). Total water is
 *     conserved (ocean liquid volume + grounded-ice water-equivalent = the
 *     init inventory, to float tolerance — the invariant test pins it).
 * 13 — Phase 3 carbonate–silicate CO₂ feedback (#34): a new slow-reservoir
 *     `carbon` system runs LAST in the pipeline (after `seaLevel`), integrating
 *     `globals.co2` from volcanic outgassing (tied to tectonic activity — the
 *     mean boundary |stress|) minus silicate weathering (rising with surface
 *     temperature, runoff and exposed land, gated off under ice and by the
 *     direct pCO₂ term). It is the deep-time thermostat: weathering rises with
 *     the CO₂-driven temperature, so the loop is a slow negative feedback, and
 *     its snowball failure mode is reachable under a cold perturbation and
 *     recovers as CO₂ accumulates while the land is ice-sealed. `co2` was a
 *     constant `initialCo2Ppm` before; it is now dynamic, and the energy balance
 *     reads the previous step's value (the same explicit lag as ice / sea
 *     level / CO₂ already used). At t=0 `co2 = initialCo2Ppm` and `carbon` is
 *     not run at init (like `ice`/`seaLevel`), so every field is byte-identical
 *     at init; `co2` first departs at step 1 and the coupled fields (temperature
 *     via the greenhouse from step 2, then elevation via erosion, precipitation,
 *     winds, ice, sea level downstream) depart within the 10-step golden window,
 *     so the field goldens and the codec BYTE goldens are regenerated
 *     deliberately in the same commit. The codec's stored-field SUBSET and
 *     quantization are unchanged (`co2` is a scalar global, not a stored field);
 *     the byte goldens shift only because the stored elevation/temperature values
 *     changed. `Globals` is unchanged (co2 already existed). Reference outgassing/
 *     weathering rates are calibrated so the default planet's CO₂ settles in an
 *     Earth-like band (a few hundred ppm) with temperatures inside the existing
 *     invariant bounds; the thermostat holds CO₂ far inside its [CO2_MIN_PPM,
 *     CO2_MAX_PPM] clamps over 4.5 Gyr (the invariant test pins no divergence).
 * 14 — Phase 3 Whittaker biome classification (#35): a new `biome` system runs
 *     LAST in the pipeline (after `carbon`), filling the categorical `biome`
 *     field from a Whittaker lookup over this step's (temperature, precipitation)
 *     with ocean its own class below the dynamic sea-level mask. It is a FAST
 *     diagnostic (recomputed every step, no memory) and, run at init like the
 *     other fast diagnostics, `biome` is populated at t=0 too. It writes ONLY the
 *     `biome` field — every other field's bytes are bit-identical at t=0 and
 *     every step (verified — the golden diff is purely the `biome` entry, which
 *     went from all-zero to classified) — but the field-golden snapshot changed,
 *     a deliberate regeneration owing this bump. Paired with it, the render path
 *     finally needs the climate viz fields, so this commit also carries the §1
 *     stored-field-set growth (deferred since bump 10): `precipitation`,
 *     `iceFraction`, `biome`, `windU`, `windV` join `STORED_FIELDS` and
 *     `temperature`'s codec max widens 320→330 K, bumping HISTORY_FORMAT_VERSION
 *     1→2. That is a codec-layout change (new byte goldens) but touches no
 *     simulation bytes; both version integers move together this once.
 */
export const KERNEL_BEHAVIOR_VERSION = 14;

/** IUGG mean Earth radius, m. */
export const EARTH_RADIUS_M = 6.371e6;

/** IAU 2015 nominal solar luminosity, W. */
export const SOLAR_LUMINOSITY_W = 3.828e26;

/** Modern Earth sidereal-ish day, hours. Placeholder until rotation matters. */
export const EARTH_DAY_HOURS = 24;

/** Modern Earth axial tilt, degrees. Placeholder until seasons matter. */
export const EARTH_OBLIQUITY_DEG = 23.44;

/** Standard atmosphere tropospheric lapse rate, K/m (ICAO: 6.5 K/km). */
export const LAPSE_RATE_K_PER_M = 0.0065;

/** Fraction of cells above the 0 m datum targeted by initial terrain (spec: ~30%). */
export const INITIAL_LAND_FRACTION = 0.3;

/** Deepest initial ocean floor below datum, m (order of Earth's abyssal plains). */
export const INITIAL_OCEAN_DEPTH_M = 6000;

/** Highest initial land elevation above datum, m (below Everest; no orogeny yet). */
export const INITIAL_LAND_HEIGHT_M = 4500;

/**
 * Base spatial frequency of initial-terrain noise on the unit sphere.
 * ~2.3 wavelengths per planet radius puts the largest features at continent
 * scale for an Earth-sized planet (tuned by eye against the seed-42 dump).
 */
export const TERRAIN_BASE_FREQUENCY = 2.3;

/** Fractal octaves for initial terrain (SCAFFOLD_SPEC 2.4 asks for 4-6). */
export const TERRAIN_OCTAVES = 5;

/**
 * Exponent shaping land elevation above sea level. >1 concentrates most land
 * at low altitude with sparse peaks, approximating Earth's hypsometric curve
 * (most continental crust sits below ~1 km).
 */
export const TERRAIN_LAND_EXPONENT = 1.6;

/**
 * Offsets added to the noise sample position so the lattice origin (and its
 * hash symmetries) never coincides with a cube-face center. Arbitrary
 * non-integer values; changing them changes every planet (golden hashes).
 */
export const TERRAIN_NOISE_OFFSET: readonly [number, number, number] = [17.13, 47.7, 89.02];

// --- Tectonics (Phase 1) ----------------------------------------------------

/**
 * Fraction of the surface that is continental crust (including submerged
 * shelves). Earth: ~41% of surface area is continental crust (Cogley 1984);
 * rounded. Initial crustType is the elevation quantile at this fraction.
 */
export const CONTINENTAL_CRUST_FRACTION = 0.4;

/** Default number of initial plates (spike #9 recommendation). */
export const DEFAULT_NUM_PLATES = 10;

/**
 * Plate seeding: minimum angular separation between seed sites is this factor
 * times sqrt(4*pi/numPlates), the mean plate angular radius (spike #9).
 */
export const PLATE_SITE_SEPARATION_FACTOR = 0.7;

/**
 * Plate seeding: flood-fill edge-cost jitter amplitude. 0 = sterile Voronoi
 * edges, 3 = noisy; 1.5 chosen by eye in spike #9.
 */
export const PLATE_FILL_JITTER = 1.5;

/**
 * Plate angular speed range, rad/yr. 1.5e-9..8e-9 rad/yr is ~1..5 cm/yr on an
 * Earth-radius sphere — the modern plate-speed range (NUVEL-1A order).
 */
export const PLATE_OMEGA_MIN_RAD_PER_YR = 1.5e-9;
export const PLATE_OMEGA_MAX_RAD_PER_YR = 8e-9;

/**
 * Depth of brand-new oceanic crust at a spreading center, m below datum.
 * Mid-ocean ridge crests sit at ~2.5 km depth (half-space cooling t=0 term,
 * Parsons & Sclater 1977). Divergent gap cells are created at this depth.
 */
export const OCEAN_RIDGE_DEPTH_M = -2500;

/**
 * Half-space cooling subsidence coefficient, m per sqrt(yr). Ocean floor
 * deepens as ridgeDepth − K·√age; Parsons & Sclater (1977) give
 * ~350 m/√Myr = 0.35 m/√yr for crust younger than ~70 Myr.
 */
export const OCEAN_SUBSIDENCE_K_M_PER_SQRT_YR = 0.35;

/**
 * Old-ocean floor depth where thermal subsidence flattens out, m (Earth's
 * abyssal plains, ~age 100 Myr under the coefficient above).
 */
export const OCEAN_ABYSSAL_DEPTH_M = -6000;

/**
 * Rate at which inactive oceanic relief relaxes toward the age-depth curve,
 * m/yr (#59). Replaces the Phase-1 hard-set ("dead arcs sink instantly"):
 * excess relief (an abandoned volcanic arc) decays and deficit relief (an
 * abandoned trench) fills at this bounded rate instead of snapping to the
 * curve in one step. 2e-4 m/yr (200 m/Myr) is well above the steady
 * subsidence increment (~145 m/Myr at 1 Myr crust, falling with age), so
 * ordinary seafloor still tracks the curve to within a step — but a
 * half-built arc now survives the margin flickering off it (quantized
 * advection does this constantly — the herringbone), letting arcs finish
 * maturing. Without this memory, arc creation weakened with grid resolution
 * (margins dwell on a cell ∝ 1/N) and the continental budget starved at
 * N=128. A dead arc at +800 m now founders over ~4 Myr — a real guyot
 * timescale, not a keyframe pop.
 */
export const OCEAN_RELIEF_RELAX_M_PER_YR = 2e-4;

/**
 * Initial crustAge of continental crust, yr. Order of Archean cratons /
 * continental shields; only relevance in-kernel is being far older than any
 * oceanic crust so age comparisons never confuse the two.
 */
export const CONTINENTAL_INITIAL_AGE_YEARS = 2e9;

/**
 * Convergence speed above which a boundary cell counts as an active margin
 * (trench/arc/orogeny; oceanic cells here are exempt from the thermal
 * subsidence hard-set), m/yr. 0.005 = 0.5 cm/yr, well below any deliberate
 * convergence but above transform noise.
 */
export const ACTIVE_MARGIN_STRESS_M_PER_YR = 0.005;

/**
 * Reference convergence speed for scaling orogeny/trench/arc rates, m/yr.
 * 0.05 = 5 cm/yr, the fast end of modern plate convergence (Nazca-South
 * America order); stress/reference is clamped to [0, 1].
 */
export const OROGENY_STRESS_REF_M_PER_YR = 0.05;

/**
 * Net surface uplift rate at reference convergence, m/yr, before erosion.
 * 0.6 mm/yr sustained is the order of net orogenic surface rise (gross rock
 * uplift is a few mm/yr; syn-orogenic erosion eats most of it, and #19's
 * erosion removes more on top of this). Reaches the 9 km ceiling after
 * ~15 Myr of full-speed head-on convergence.
 */
export const OROGENY_RATE_M_PER_YR = 6e-4;

/** How many cells inland orogenic uplift spreads (linear falloff). */
export const OROGENY_WIDTH_CELLS = 3;

/** Wider uplift zone for continent-continent collision (Tibet-style). */
export const COLLISION_WIDTH_CELLS = 4;

/**
 * Elevation ceiling for orogenic uplift, m. Crustal strength / isostasy caps
 * mountains near 9 km before erosion (Everest 8.8 km).
 */
export const OROGENY_MAX_ELEVATION_M = 9000;

/**
 * Extra trench depth below the local age-depth floor at full-speed
 * subduction, m. Abyssal floor -6000 minus 2500 puts trenches at -8500 or
 * deeper — ocean trench order (Mariana ~-11 km, typical -8..-10 km).
 */
export const TRENCH_EXTRA_DEPTH_M = 2500;

/**
 * Island-arc crust growth rate at reference convergence, m/yr. ~1 mm/yr at
 * full reference speed builds an arc from abyssal depth to the maturation
 * threshold in ~10-15 Myr of sustained subduction — the fast end of real
 * arc construction (Izu-Bonin order). Raised 4e-4 -> 1e-3 in #59 to
 * rebalance creation after maturation became accretionary (continent-
 * adjacent only), then 1e-3 -> 1.25e-3 in the #59 follow-up retune: with
 * the ∝N scaling below restoring per-pass climb, N=128 deep-time land
 * still grazed 9.5-9.9% (floor 10%) — the last quarter-turn on the base
 * rate. At and below the reference grid growth is largely saturated
 * against the maturation/ARC_MAX clamps (one margin pass fully matures a
 * cell), so the increase acts mainly on fine grids.
 */
export const ARC_GROWTH_RATE_M_PER_YR = 1.25e-3;

/**
 * Reference grid for arc creation, the pivot of its two resolution
 * scalings (#59 follow-up). Both exist because creation is written in
 * per-cell terms while the physics is per-length: (1) arc magmatism
 * supplies a crust flux per unit margin length, concentrated onto a
 * one-cell-wide boundary line whose width shrinks ∝ 1/N — and a migrating
 * margin dwells on a cell for a time ∝ that width — so the per-cell
 * elevation rate scales max(1, N/reference); (2) the accretionary belt in
 * which a mature arc counts as continent-adjacent has a fixed *physical*
 * width (~one reference cell, ~300 km — the scale of real accreted
 * terrane belts), so the maturation gate radius is max(1,
 * round(N/reference)) cells. Without these, creation efficiency fell with
 * resolution — the measured deep-time land dip at fine grids (#59
 * residual: N=16 healthy at 23-28% land min, N=64 ~10%, N=128 6.6%; rate
 * scaling alone recovered ~9.5-10%, and the frontier-area term (2) is the
 * remainder: matured area per unit time goes as frontier cells × cell
 * area ∝ (N·belt)/N², which only stays resolution-independent if belt ∝
 * N). max(1, ·) because at or below the reference grid a margin pass
 * already saturates against the maturation/ARC_MAX ceilings and the belt
 * is already one cell — scaling down would only starve grids measured
 * healthy.
 */
export const ARC_CREATION_REFERENCE_GRID_N = 32;

/** Ceiling for volcanic-arc elevation, m (island arcs, not continents). */
export const ARC_MAX_ELEVATION_M = 1000;

/**
 * An arc that has built above this elevation matures into continental
 * crust. Arc magmatism is how Earth manufactures continental crust; this is
 * also the counterweight to collision consuming continental area — without
 * it, long runs slowly lose land (seed-1337 N=16 dipped below the 10% land
 * invariant at ~1.3 Gyr). Lowered -200 -> -500 in #59 alongside the
 * accretionary-maturation gate: an accreting margin terrane counts as
 * continental well before it fully emerges (real accreted terranes are
 * largely submarine), which shortens the subduction time creation needs.
 */
export const ARC_MATURATION_ELEVATION_M = -500;

/**
 * Fraction of a bulldozed continental cell's positive relief added to the
 * cell it is shoved onto when that cell is already continental (#59 /
 * direction (b)). Continental crust does not subduct: when a convergent
 * overlap displaces a continental cell, its crust is pushed one cell deeper
 * into its own plate. Onto oceanic crust it re-roots there (area conserved,
 * like a fold-and-thrust belt propagating over the foreland); onto
 * continental crust the collision shortens and THICKENS — half the
 * displaced relief piles on (India–Asia: ~50% of shortened crustal section
 * goes into thickening the plateau, the rest into lateral extrusion and
 * erosion), capped at OROGENY_MAX_ELEVATION_M. Without this, every
 * continent-continent margin destroyed one continental cell per overlap:
 * measured 4.5 Gyr N=64 runs ground continental crust from 40% of the
 * sphere to ~5-8% dust and starved the rift gates (#58's root).
 */
export const COLLISION_THICKENING_FACTOR = 0.5;

/**
 * Elevation ceiling for an isolated continental cell (no continental
 * 4-neighbor), m (#59). Such micro-continents are kept as continental crust
 * (Zealandia-style submerged fragments — the area stays in the crustal
 * budget and can later re-accrete) but are pinned below sea level: a
 * one-cell fleck is 100+ km of "land" with no cratonic root, and letting
 * stranded collision debris stand as 9 km white peaks — which the
 * subsea-damped erosion then preserves for gigayears — shredded every
 * deep-time elevation map into speckle once the world stayed tectonically
 * alive. -200 m is continental-shelf depth (real shelf breaks sit at
 * ~120-200 m): a drowned fragment is submerged continental platform, not
 * abyssal floor. Deliberately independent of ARC_MATURATION_ELEVATION_M
 * (-500 m, an accretion gate, not a flotation level) — do not re-sync them.
 */
export const MICROCONTINENT_FOUNDER_ELEVATION_M = -200;

/**
 * Minimum continental 4-neighbors for an oceanic cell to count as an
 * enclosed "hole" in the margin-consolidation pass (#67). Consolidation
 * pair-flips stray one-cell continental islands (zero continental
 * neighbors — the debris the founder clamp sinks) against such holes
 * (gap-fill scars and advection tears inside continents), in ascending cell
 * order, conserving continental cell count exactly. 3 rather than 4 so the
 * pass can eat into herringbone stripe lines (a stripe cell flanked on
 * three sides heals; a plain coastal bay, with two continental neighbors,
 * never flips) — the knob measured in the #67 pass.
 */
export const MARGIN_CONSOLIDATION_HOLE_MIN_NEIGHBORS = 3;

// --- Crustal-block isostasy (#84 prototype) ----------------------------------

/**
 * Continental-block area below which the block founders — its elevation
 * ceiling is MICROCONTINENT_FOUNDER_ELEVATION_M, m² (#84). Physical premise:
 * a small crustal block has no cratonic root and is not durably emergent
 * (Zealandia, 4.9 Mkm², is 95% submerged; the Seychelles microcontinent is
 * drowned platform). 3e11 m² = 300,000 km² sits below Madagascar (587k km²,
 * emergent) and above the collision-debris / rifted-sliver scale the
 * boundary processes strand. This generalizes the one-cell founder clamp in
 * tectonics.ts to whole components — the 2+-cell splinters that clamp and
 * margin consolidation both miss are what shredded deep-time land into
 * tall-island confetti.
 */
export const BLOCK_FOUNDER_AREA_M2 = 3e11;

/**
 * Continental-block area at which the block's elevation ceiling reaches the
 * full OROGENY_MAX_ELEVATION_M, m² (#84) — blocks this large are true
 * continents and the cap is inert on them. Between the founder area and
 * this, the ceiling rises as sqrt of the normalized area (gravitational
 * spreading limits unsupported topography). Calibration anchor: New Guinea
 * (~0.79 Mkm²) holds ~4.9 km peaks; the sqrt ramp gives ~4.7 km there.
 */
export const BLOCK_FULL_OROGENY_AREA_M2 = 2e12;

/**
 * Rate at which elevation above a block's isostatic ceiling subsides toward
 * it, m/yr (#84). Rate-bounded like OCEAN_RELIEF_RELAX_M_PER_YR, never a
 * hard-set, so a component split by a rift or advection tear subsides over
 * ~5-10 Myr (1e-3 m/yr takes a 9 km orogen to the founder level in ~9 Myr —
 * a gravitational-collapse timescale) instead of popping between 10 Myr
 * keyframes. Subsidence only: the cap never raises elevation.
 */
export const BLOCK_ISOSTASY_RELAX_M_PER_YR = 1e-3;

// --- Wilson cycles (#18) -----------------------------------------------------

/**
 * Live-plate count bounds: sutures pause at the floor, rifts at the ceiling.
 * The floor is 2 (a suture may never leave a single-plate world in one step);
 * it was 4 until #59, when it was doing active harm: a world parked AT the
 * floor has its collisions permanently barred from suturing, so they grind
 * continent-on-continent forever (#16 consumption) — measured on seed 1,
 * which sat at the floor from ~0.25 Gyr and bled continental crust from 40%
 * of the sphere to 5.4% by 4.5 Gyr, at which point nothing could pass the
 * rift gates and the world died. A high floor was protecting timeline
 * variety before the #59 oversize rift pressure existed; now a post-suture
 * monopoly re-fragments within a few tens of Myr, so collisions can be
 * allowed to complete instead.
 */
export const MIN_PLATES = 2;
export const MAX_PLATES = 16;

/**
 * Continuous continent-continent convergent contact required before the two
 * plates suture into one, yr. Real collision-to-suture times are a few tens
 * of Myr (India-Asia has been converging ~55 Myr and is still suturing).
 * 15 -> 60 Myr in the #66 Wilson-clock retune: the whole trigger clock
 * (this, RIFT_PROBABILITY_PER_MYR, RIFT_SUTURE_COOLDOWN_YEARS,
 * RIFT_MIN_AGE_YEARS) scaled 4x slower together so reorganizations play out
 * over multi-hundred-Myr episodes instead of tens of Myr — several per
 * 10 Myr render keyframe read as flicker. Measured at N=64 over 4.5 Gyr
 * (seeds 1/42/1337): mean interval between reorganizations involving the
 * same plate ~45 -> ~140 Myr, land minimum >= 11.3% (the longer
 * continent-continent grind before each merge stays above the #20 10%
 * floor).
 */
export const SUTURE_AFTER_YEARS = 60e6;

/** Minimum simultaneous cont-cont convergent boundary cells to count as contact. */
export const SUTURE_MIN_CONTACT_CELLS = 3;

/**
 * A plate must be at least this old since creation/last rift to rift, yr.
 * 150 -> 600 Myr in the #66 clock retune (4x, with the rest of the trigger
 * clock): this is the maturity floor for ORDINARY plates — the size ramp
 * divides it away for oversize ones (600/16 = 37.5 Myr at 0.55 of the
 * sphere, ~5 Myr near whole-sphere), so the monopoly safety net keeps its
 * promptness. Scaling it with SUTURE_AFTER_YEARS also keeps the two gates'
 * ordering stable (hemisphere-scale rift gate vs suture clock), which the
 * wilson test windows are derived from.
 */
export const RIFT_MIN_AGE_YEARS = 600e6;

/** A plate must own at least this fraction of the sphere to rift. */
export const RIFT_MIN_AREA_FRACTION = 0.08;

/**
 * A plate must carry at least this much continental crust — measured as a
 * fraction of the whole sphere, not of the plate — to rift. Measuring the
 * plate-relative fraction (first attempt, 0.35) silently disabled rifting:
 * post-suture mega-plates carry proportional ocean and never qualified
 * (seed 42 produced one rift in 2 Gyr). What rifts is a plate with a big
 * continent on it, however much ocean it also drags along.
 *
 * Lowered 0.05 -> 0.02 in #59: at 0.05 the gate could dead-lock the planet —
 * a low-continent world (seed 1 fell to ~5% continental crust by ~3.5 Gyr)
 * had no rift-eligible plate, so tectonics froze, and a frozen world can
 * never rebuild crust (arc creation needs active margins). 2% of the sphere
 * is still a real continent's worth of crust (~500 cells at N=64), but the
 * gate can no longer starve the Wilson cycle to death.
 */
export const RIFT_MIN_CONTINENTAL_AREA_FRACTION = 0.02;

/**
 * Time quantization of the rift decision hash, yr. Steps shorter than this
 * would share a hash input and make consecutive draws perfectly correlated,
 * so the effective quantum is min(this, stepYears) — identical behavior for
 * all step sizes >= 10 kyr, independent draws below it.
 */
export const RIFT_DRAW_QUANTUM_YEARS = 1e4;

/**
 * Rift probability per eligible plate per Myr. 0.006 -> 0.0015 in the #66
 * clock retune (the 4x scaling's anchor): an ordinary (sub-knee) eligible
 * plate now waits ~670 Myr in expectation, and the measured mean interval
 * between reorganizations involving the same plate is ~140 Myr at N=64
 * (many plates are draw-eligible at once, and the size ramp shortens the
 * wait for large ones) — inside the ~100-300 Myr Earth-like Wilson band the
 * issue targets, vs ~45 Myr before. The old 0.006 was tuned to pass the
 * #57/#59 dispersal metrics, not to match a believable tempo.
 */
export const RIFT_PROBABILITY_PER_MYR = 0.0015;

/**
 * Fraction of the rifting plate's cells carved off as the new fragment,
 * drawn per rift in [min, max] (#59). A rift detaches a continental block —
 * a Gondwana-piece fraction of its parent, not a 50/50 bisection: splitting a
 * near-whole-sphere plate in half necessarily yields two antipodal
 * hemispheres that can only shear about their shared pole and re-suture
 * (measured: max plate area pinned at ~100% from ~1.2 Gyr with hemisphere
 * splits). A sub-half fragment on a translating pole can instead sail across
 * the remaining plate's ocean. Range chosen so a whole-sphere monopoly is
 * broken below 60% within two rifts while fragments stay above
 * RIFT_MIN_AREA_FRACTION-scale (rift-eligible themselves).
 */
export const RIFT_FRAGMENT_MIN_FRACTION = 0.2;
export const RIFT_FRAGMENT_MAX_FRACTION = 0.4;

/**
 * Continuous size-dependent rift rate (#61), replacing the #59 oversize brake
 * (which skipped the age gate and multiplied the rift probability by a fixed
 * factor the instant a plate crossed 0.55 of the sphere — a discontinuity, and
 * one coupled to MIN_PLATES because the brake only existed to compensate for the
 * lowered suture floor). Rift likelihood should rise *smoothly* with plate size
 * — a bigger plate has more internal stress and longer weak margins — so a
 * single ramp now scales the rift decision:
 *
 *     ramp(area) = 1 + (REF_MULTIPLE − 1) · max(0, (area − KNEE)/(REF − KNEE))^EXP
 *
 * It is 1 for any plate at or below RIFT_SIZE_RATE_KNEE (small plates feel no
 * size pressure — the normal Wilson draw and the golden 10-step window are
 * unchanged), passes through RIFT_SIZE_RATE_REF_MULTIPLE at
 * RIFT_SIZE_RATE_REF_FRACTION — the old #59 oversize threshold (0.55) — and
 * keeps climbing above it. The one ramp scales both halves of the old brake:
 * (1) the per-Myr rift probability is multiplied by min(REF_MULTIPLE, ramp) —
 * it rises over [KNEE, REF] then holds above 0.55, so nothing rifts faster
 * than the reference oversize rate; (2) the maturity gate RIFT_MIN_AGE_YEARS
 * is DIVIDED by the (uncapped) ramp — full below the knee, ~37.5 Myr at 0.55,
 * shrinking toward a ~5 Myr floor as a plate approaches whole-sphere (the
 * ramp is bounded so the gate never nears zero), the smooth replacement for
 * the old hard age waiver so a monopoly keeps shedding. Nothing here
 * references MIN_PLATES: retuning the suture floor no longer forces retuning
 * the monopoly brake.
 *
 * KNEE = 0.3 (the value suggested on the issue) was measured against the #59
 * dispersal metrics; see PHASE_2_STAGE0_FINDINGS.md for the #61 pass.
 *
 * REF_MULTIPLE 8 -> 16 in the #66 clock retune, and it is the retune's one
 * non-proportional knob. Scaling the base rate 4x down with the cap held at
 * 8 also slows the OVERSIZE rift rate 4x — and that safety net measurably
 * fails: the issue assumed "a slower base rate still lets a near-monopoly
 * plate rift promptly", but at N=64/4.5 Gyr the dispersed-keyframe fraction
 * collapsed on seed 42 (76% baseline -> 61% at 3x, 51% at 4x; the response
 * is bimodal — 12x gives 49%, 16x gives 93%, there is no usable middle).
 * REF_MULTIPLE = 16 sets the oversize ABSOLUTE rate to half the #59 brake
 * (0.0015·16 = 0.024/Myr vs 0.006·8 = 0.048/Myr) — the slowest oversize
 * clock that passes dispersal on all three golden seeds (93.1-93.6%
 * dispersed, every Gyr bucket >= 0.8, worst >85% monopoly window 60 Myr at
 * N=64; 32x = full #59 rate saturates dispersal at 96-99% and assemblies
 * all but vanish). Ordinary sub-knee plates still feel the full 4x
 * slowdown; the ramp just reaches the (halved) reference sooner.
 */
export const RIFT_SIZE_RATE_KNEE = 0.3;
export const RIFT_SIZE_RATE_REF_FRACTION = 0.55;
export const RIFT_SIZE_RATE_REF_MULTIPLE = 16;
export const RIFT_SIZE_RATE_EXPONENT = 2;

/**
 * Number of candidate travel directions scored when a rift fragment picks
 * its Euler pole (#59). Continents rift toward the ocean: each candidate
 * azimuth's forward great-circle arc is scored by how much oceanic crust
 * lies beyond the fragment's edge, and the most oceanic heading wins (ties
 * to the first candidate; the candidate fan is phase-shifted by a per-rift
 * hash draw so there is no global axis bias). Sailing into ocean instead of
 * into the parent's continent is what keeps the fragment's leading edge
 * subducting oceanic crust — continent-on-continent grinding during the
 * post-rift lock was the dominant continental-area bleed (#16, #58).
 */
export const RIFT_AZIMUTH_CANDIDATES = 8;

/**
 * How far beyond the fragment's edge each candidate heading is sampled, rad
 * (great-circle arc). ~1 rad ≈ 57° ≈ the width of a decent superocean
 * basin; shorter scans see only the rift's own margin, longer ones wrap
 * toward the antipode where every heading converges to the same terrain.
 */
export const RIFT_OCEAN_SCAN_RAD = 1.0;

/** Sample count along each scanned heading (cell-scale steps at N=64). */
export const RIFT_OCEAN_SCAN_SAMPLES = 12;

/**
 * After a rift, neither new half can suture (to anyone) for this long, yr.
 * A rift opens a passive margin that should stay passive for a while before it
 * can become convergent again. Without any lock the two halves re-sutured one
 * SUTURE_AFTER_YEARS (~15 Myr) after every breakup — the world cycled in the
 * event log yet stayed a single supercontinent at every keyframe (no visible
 * drift). Applies only to rift children; primordial plates (created at t=0 by
 * the initial partition) are never locked, so first-assembly is unchanged.
 *
 * The value is a measured tradeoff, not a physical target. A rift's halves
 * share an in-plane rotation pole, so ~half their new boundary is convergent;
 * while it can't suture, that arc grinds continent-on-continent (the #16
 * advection consumes the subducting continental cell), which suturing exists to
 * halt. Longer locks therefore bleed land, and 100 Myr was outright fatal in
 * the pre-#59 era (seed 1337 fell to ~8% land by 2 Gyr, below the #20 10%
 * floor) — but #59's ocean-seeking rift headings removed the dominant share
 * of that grinding, and the #66 retune re-measured the lock at 4x: at
 * 120 Myr all three golden seeds hold land minima of 11.3-14% over the full
 * 4.5 Gyr at N=64 (maxima ~31%), safely above the floor. 30 -> 120 Myr as
 * part of the #66 4x clock scaling: a passive margin now stays passive for
 * a geologically plausible stretch, and a breakup is followed by real drift
 * before any re-collision can weld.
 */
export const RIFT_SUTURE_COOLDOWN_YEARS = 120e6;

// --- Erosion (#19, #65) -----------------------------------------------------
// (The static latitude precipitation proxy that used to live here was retired
//  with climateProxy.ts when moisture transport (#32) took over `precipitation`;
//  erosion now reads that real field. Its constants are in the moisture section.)

/**
 * Erosion diffusion coefficient at reference precipitation, per year.
 * k·dt at 1 Myr steps is 6e-3 (stability requires << 0.125 for 4-neighbor
 * diffusion). Yields initial decay of fresh 9 km belts of ~10-25 m/Myr,
 * i.e. mm/kyr-scale denudation, softening dead orogens over 100s of Myr.
 */
export const EROSION_RATE_PER_YR = 6e-9;

/** Precipitation that gives the nominal erosion coefficient, kg/m^2/yr. */
export const EROSION_PRECIP_REF = 1000;

/** Clamp on the precipitation scaling of erosion (dry floor .. wet ceiling). */
export const EROSION_PRECIP_FACTOR_MIN = 0.05;
export const EROSION_PRECIP_FACTOR_MAX = 2;

/**
 * Erosion damping when either endpoint of a cell pair is below sea level —
 * base-level control: rivers grade to the coast and deposit there, so
 * subaerial relief drains to the shelf far slower than it smooths
 * internally. Without this, diffusion submerges coastlines planet-wide
 * (land fraction fell to 7% in 800 Myr when first integrated).
 */
export const EROSION_SUBSEA_FACTOR = 0.1;

// --- Sediment export & orogenic root decay (#65) ------------------------------

/**
 * Ceiling the shelf sediment fill saturates at, m below datum. Coastal export
 * deposits raise an oceanic cell's relaxation target (age-depth curve +
 * sedimentM) toward this level and stop there — a filled shelf is shallow
 * submerged platform, never new land. -200 m is continental-shelf depth
 * (real shelf breaks sit at ~120-200 m). Same rationale as
 * MICROCONTINENT_FOUNDER_ELEVATION_M but deliberately a separate constant:
 * this is a fill ceiling for oceanic sediment, not a flotation clamp for
 * continental crust — do not re-sync them.
 */
export const SEDIMENT_SHELF_CEILING_M = -200;

/**
 * Continental elevation above which orogenic root decay applies, m. Terrain
 * standing higher than ~1 km is held up by a thickened crustal root
 * (Airy isostasy); as the root re-equilibrates thermally the excess subsides.
 * Ordinary cratonic elevation below the reference carries no excess root and
 * must not decay — which also means the decay can never push land below sea
 * level (it relaxes toward +1 km, not toward the datum).
 */
export const OROGENIC_ROOT_REFERENCE_M = 1000;

/**
 * e-folding time of orogenic root decay, yr. Post-orogenic topography decays
 * from alpine to low relief over a few hundred Myr as the crustal root
 * re-equilibrates (the Caledonides/Appalachians are ~1 km relief after
 * 300-450 Myr, down from Himalayan heights). 300 Myr takes a welded-in 9 km
 * belt to ~2.5 km absolute in 500 Myr and ~1.3 km in 1 Gyr —
 * diffusion (#19) removes more on top — matching the #65 acceptance band,
 * while active margins stay high because orogeny injects at
 * OROGENY_RATE_M_PER_YR ≈ 20× the decay rate even at the 9 km cap.
 */
export const OROGENIC_ROOT_DECAY_TAU_YEARS = 300e6;

// --- Energy balance (#30, Phase 3) ------------------------------------------

/**
 * Planet-star distance, m (1 au, IAU 2012). Insolation is
 * `starLuminosity / (4π·d²)` — the top-of-atmosphere solar constant. Distance
 * is a fixed Earth-like 1 au for Phase 3 (a per-planet orbital-distance param
 * is a later knob); `starLuminosity` is the active insolation control, so a
 * brighter/dimmer star drives the snowball perturbation of §5.
 */
export const ORBITAL_DISTANCE_M = 1.495978707e11;

/**
 * Planetary (Bond-like, clouds folded in) albedos of the three surface classes
 * the Phase 3 energy balance distinguishes. Land/ocean is keyed off the sea-
 * level datum (elevation ≥ 0 is land), not crustType, so a submerged shelf
 * reflects like ocean and an emergent arc like land. Vegetation albedo is a
 * Phase 4 hook. Averaged over ~30% land these give a mean ≈0.29, matching
 * Earth's ~0.30 Bond albedo. Ice is the #33 feedback surface.
 */
export const ALBEDO_OCEAN = 0.28;
export const ALBEDO_LAND = 0.32;
export const ALBEDO_ICE = 0.6;

/**
 * Outgoing-longwave-radiation linear closure OLR = A + B·(T − 273.15 K),
 * W/m^2, the Budyko–Sellers energy-balance parameterization (representative
 * present-Earth fit; Budyko 1969 gives A≈203, B≈2.1). Linear OLR makes the
 * zonal balance a single deterministic tridiagonal solve and the global net
 * top-of-atmosphere flux close to machine precision (the transport term is
 * conservative, so Σ(absorbed − OLR) = 0 at the solution). At Earth insolation
 * and albedo the well-mixed sea-level balance sits at ≈292 K; the reported
 * cell-count-mean surface temperature is lower — orographic lapse cooling over
 * land pulls it to ≈290 K at t=0 and ≈286–288 K by 10 steps as mountains grow.
 */
export const OLR_INTERCEPT_A_W_PER_M2 = 202;
export const OLR_SLOPE_B_W_PER_M2_K = 2.1;

/**
 * Meridional heat-transport diffusivity in the North EBM form
 * `D·d/dx[(1−x²)·dT/dx]`, x = sin(latitude), W/m^2/K. Sets the equator-to-pole
 * gradient at fixed global mean; D/B ≈ 0.31 (North 1975) reproduces Earth's
 * ~45 K annual-mean drop. Transport only redistributes energy — it never
 * changes the global mean, so the net-TOA invariant is independent of it.
 */
export const HEAT_TRANSPORT_D_W_PER_M2_K = 0.42;

/**
 * CO₂ radiative forcing coefficient, W/m^2 per natural-log CO₂ ratio: the
 * greenhouse hook lowers the OLR intercept by `·ln(co2 / CO2_REFERENCE_PPM)`,
 * the standard logarithmic CO₂ forcing (≈5.35·ln, Myhre et al. 1998; ≈3.7 W/m²
 * and ~2–3 K per doubling). Constant `co2 = initialCo2Ppm` until the #34
 * carbonate–silicate reservoir drives it; raising co2 warms monotonically.
 */
export const CO2_FORCING_W_PER_M2 = 5.35;

/** Preindustrial-ish reference CO₂ the greenhouse forcing is measured against, ppm. */
export const CO2_REFERENCE_PPM = 280;

/** Default atmospheric CO₂ reservoir seed, ppm (Earth preindustrial). #34 evolves it. */
export const INITIAL_CO2_PPM = 280;

/**
 * Equal-area latitude bands (uniform in sin(latitude)) the zonal profile is
 * solved on. 90 bands ≈ 2° at the equator — ample for a smooth zonal EBM, and
 * coarse enough that every band holds cells down to the N=16 invariant grid
 * (empty extreme bands, if any, inherit the nearest solved band's albedo).
 */
export const ENERGY_BALANCE_BANDS = 90;

/**
 * Deterministic annual-mean insolation: samples of solar longitude over one
 * orbit averaged per band. Fixed count (no convergence test) — the annual mean
 * is a one-time function of `obliquityDeg`, recomputed per solve but never a
 * seasonal cycle (§7.2). 360 samples = one per day-of-year equivalent.
 */
export const INSOLATION_ORBIT_SAMPLES = 360;

/**
 * Land continentality: a bounded annual-mean correction added to land cells
 * only, amplifying their departure from the global mean zonal temperature
 * (continental interiors run more extreme than the maritime zonal mean).
 * GAIN is small and the result clamped to ±MAX_K so it can never destabilize
 * the biome/erosion consumers or push a cell out of the codec range.
 */
export const CONTINENTALITY_GAIN = 0.12;
export const CONTINENTALITY_MAX_K = 6;

// --- Wind bands (#31, Phase 3) ----------------------------------------------

/**
 * Circulation cells per hemisphere at Earth's rotation rate: the
 * Hadley/Ferrel/Polar three-cell structure. The band model alternates surface
 * easterlies and westerlies once per cell, so at Earth params it reproduces the
 * trade-wind / mid-latitude-westerly / polar-easterly sequence.
 */
export const WIND_CELLS_PER_HEMISPHERE_EARTH = 3;

/**
 * Exponent tying cell count to rotation rate: `cells ∝ (Ω/Ω_earth)^EXP`, with
 * Ω ∝ 1/dayLengthHours. The Rhines scale sets the meridional jet spacing on a
 * rotating planet, L_β ∝ (U/β)^½ with β ∝ Ω, so the number of jets that fit
 * between equator and pole grows as ~Ω^½ — fast rotators get more, narrower
 * bands (Jupiter's ~10 h day and many banded jets), slow rotators collapse
 * toward single-cell (Hadley-only) circulation. ½ is the Rhines exponent; the
 * exact power is model-dependent in the literature (½–1) and this is a
 * diagnostic band model, not a fluid solve (§6).
 */
export const WIND_ROTATION_EXPONENT = 0.5;

/**
 * Cap on cells per hemisphere for very fast rotators. 8 bands over a hemisphere
 * is already finer than the N=16 invariant grid resolves cleanly; the cap keeps
 * the pattern representable and the wind bound (below) safe. Reached only below
 * a ~4 h day; Earth (24 h) sits at 3, far from the cap.
 */
export const WIND_MAX_CELLS_PER_HEMISPHERE = 8;

/**
 * Peak prevailing surface wind speeds at the reference temperature gradient,
 * m/s: zonal (trade/westerly) component and the weaker meridional (overturning)
 * component. Surface prevailing winds are ~5–10 m/s (the strong jets are aloft,
 * out of scope for a surface band model); the meridional branch of the
 * overturning is weaker still. Both scale with the equator-to-pole temperature
 * gradient (below) and are clamped so a hot/steep-gradient state stays inside
 * the ±`WIND_MAX_M_PER_S` codec bound.
 */
export const WIND_ZONAL_PEAK_M_PER_S = 10;
export const WIND_MERIDIONAL_PEAK_M_PER_S = 4;

/**
 * Equator-to-pole surface temperature contrast (equatorial-band mean minus
 * polar-band mean, K) at which the wind speeds above are realized — i.e. Earth
 * default params give a gradient factor ≈ 1. Winds are driven by differential
 * heating, so a steeper gradient strengthens the circulation and a flatter one
 * (a warm, well-mixed hothouse) weakens it. Measured from the #30 energy
 * balance at Earth params over the three golden seeds (equatorial band
 * |sin lat| < `WIND_EQUATORIAL_SINLAT`, polar band |sin lat| >
 * `WIND_POLAR_SINLAT`); ~27 K, below the ~45 K extreme-band drop the EBM
 * transport is tuned to because these are area-band means, not band extremes.
 */
export const WIND_TEMP_GRADIENT_REF_K = 27;

/** Equal-area latitude cutoffs (in |sin lat|) for the equatorial and polar
 *  bands the temperature gradient is measured across. 0.25 and 0.75 make each
 *  band a robust 25% of the sphere, so both are populated on every grid. */
export const WIND_EQUATORIAL_SINLAT = 0.25;
export const WIND_POLAR_SINLAT = 0.75;

/**
 * Clamp on the temperature-gradient factor that scales wind speed. Floor keeps
 * a faint prevailing wind even in a near-isothermal state (moisture transport
 * still needs a direction); ceiling caps a steep-gradient snowball so wind
 * stays well inside the ±`WIND_MAX_M_PER_S` bound (`WIND_ZONAL_PEAK` × 3 = 30).
 */
export const WIND_GRADIENT_FACTOR_MIN = 0.1;
export const WIND_GRADIENT_FACTOR_MAX = 3;

/**
 * Absolute wind-speed bound, m/s — the jet-stream-scale range the Phase 3 codec
 * quantizes `windU`/`windV` over (±60 m/s, §1 table). A defensive final clamp:
 * the model cannot reach it (peak × gradient ceiling = 30 m/s), but the clamp
 * guarantees a stored-field value can never fall outside the codec range.
 */
export const WIND_MAX_M_PER_S = 60;

// --- Moisture transport & orographic precipitation (#32, Phase 3) ------------

/**
 * Reference ocean evaporation flux, kg/m²/yr (= mm/yr), realized at
 * `MOIST_EVAP_REF_TEMP_K`. Open-ocean evaporation is ~1000–2000 mm/yr; this is
 * the source that feeds all precipitation. Because water mass is conserved
 * (Σ precipitation = Σ evaporation), the global-mean precipitation is this
 * times the ocean fraction (~0.7 ⇒ ~840 mm/yr, Earth-like) — land is watered
 * only by what the wind carries in from the sea.
 */
export const MOIST_EVAP_REF_KG_PER_M2_YR = 1200;

/**
 * Temperature the reference evaporation is realized at, K. Ocean evaporation
 * scales with saturation vapour pressure, so warm seas evaporate more; the
 * factor is `exp(MOIST_EVAP_CC_PER_K·(T − ref))`, clamped. ~288 K is Earth's
 * mean surface temperature, so Earth-like states sit near factor 1.
 */
export const MOIST_EVAP_REF_TEMP_K = 288;

/**
 * Clausius–Clapeyron fractional growth of evaporation with temperature, per K.
 * Saturation vapour pressure rises ~7%/K near 288 K; 0.06/K is a slightly
 * damped effective rate (not all of the C–C increase reaches the surface flux).
 */
export const MOIST_EVAP_CC_PER_K = 0.06;

/** Clamp on the evaporation temperature factor: a cold ocean still evaporates a
 *  little, a hot one is bounded so the precipitation stays inside its codec
 *  range. `exp(0.06·ΔT)` hits these at ΔT ≈ −20 K and +13 K. */
export const MOIST_EVAP_FACTOR_MIN = 0.3;
export const MOIST_EVAP_FACTOR_MAX = 2.2;

/**
 * Transport weight per unit wind speed (dimensionless), the numerator of the
 * upwind donor split: a cell sheds `q·MOIST_TRANSPORT_COEF·min(speed/ref, cap)`
 * of its moisture column downwind each relaxation sweep, distributed to the
 * neighbours the wind points toward. With `MOIST_PRECIP_BASE` below this sets
 * the moisture fetch `≈ 1 + coef/base ≈ 13` cells at reference wind — the
 * distance sea air penetrates inland before it has rained out, the mechanism
 * behind dry continental interiors.
 */
export const MOIST_TRANSPORT_COEF = 1;

/** Wind speed the transport weight is normalized by, m/s (near the #31 zonal
 *  peak), and the cap on speed/ref so a jet cannot make transport unstable. */
export const MOIST_TRANSPORT_REF_SPEED_M_PER_S = 8;
export const MOIST_TRANSPORT_SPEED_CAP = 1.5;

/**
 * Base rain-out weight (dimensionless), the moisture fraction a cell precipitates
 * per sweep independent of terrain — the drizzle that eventually returns all
 * evaporated water to the surface and bounds the moisture column. Smaller ⇒
 * longer fetch, wetter interiors.
 */
export const MOIST_PRECIP_BASE = 0.08;

/**
 * Orographic rain-out weight added when the wind blows toward higher ground.
 * The forcing is the downwind-ward elevation rise (m) the wind climbs into,
 * normalized by `MOIST_OROGRAPHIC_REF_M` and capped at `MOIST_OROGRAPHIC_MAX`:
 * a windward slope gets a large extra rain-out weight (short local fetch — the
 * air wrings out before cresting), leaving the lee side in the depleted air it
 * left behind. This is what makes rain shadows EMERGE rather than being painted.
 */
export const MOIST_PRECIP_OROGRAPHIC = 0.6;

/** Downwind rise (in land height above sea level) that yields a unit orographic
 *  rain-out weight, m (a moderate mountain flank), and the cap in those units so
 *  a cliff cannot drive the weight — and thus local precipitation — unboundedly
 *  high. Tuned so windward rain spreads across a slope over a few cells rather
 *  than dumping in the first one (which starves the rest of the windward face). */
export const MOIST_OROGRAPHIC_REF_M = 600;
export const MOIST_OROGRAPHIC_MAX = 3;

/**
 * Saturation rain-out weight, added where the air is too cold to hold its
 * moisture — the "precipitate by saturation" pathway (#32), complementing the
 * orographic "precipitate on ascent" term. Scaled by `max(0, 1 − capacity)`
 * with `capacity = evaporationFactor(T)` (the same Clausius–Clapeyron curve the
 * evaporation source uses): zero at or above `MOIST_EVAP_REF_TEMP_K` (warm air
 * retains moisture) and growing as air cools, so moist air rains out as it moves
 * poleward or is lifted (and lapse-cooled) over high terrain. Being a function
 * of temperature only, it is exactly zero in an isothermal world, so it reshapes
 * precipitation over real temperature gradients without perturbing the
 * controlled uniform-temperature rain-shadow transect used in the tests.
 */
export const MOIST_PRECIP_SATURATION = 0.25;

/**
 * Fixed relaxation schedule for the steady moisture solve: the Jacobi sweep
 * count at the reference grid, its reference grid N, and a floor. Sweeps scale
 * `∝ N` (`round(AT_REF·N/REF_N)`, floored) so information propagates a
 * resolution-independent physical distance — moisture must travel windward →
 * crest → lee, which is more cells on a finer grid. A FIXED count (not a
 * convergence test) keeps the solve deterministic; the exact water-closure
 * (below) makes conservation hold regardless of how far it has converged.
 */
export const MOIST_RELAX_SWEEPS_AT_REF = 24;
export const MOIST_RELAX_SWEEPS_REF_N = 128;
export const MOIST_RELAX_SWEEPS_MIN = 6;

// --- Sea level & ice sheets (#33, Phase 3) ----------------------------------

/**
 * Freezing point of water, K (0 °C) — the anchor of the ice mass balance. The
 * equilibrium ice cover a cell relaxes toward is 0 at (and above) this
 * temperature and grows as it cools below it; melt (ablation) acts above it.
 */
export const ICE_FREEZE_TEMP_K = 273.15;

/**
 * Temperature below freezing at which the equilibrium ice cover a cell relaxes
 * toward reaches full (fraction 1), K. Crucially WIDE (not a sharp ice line):
 * the target ramps `clamp((freeze − T)/this, 0, 1)`, so a cell 10 K below
 * freezing equilibrates near 1/4 cover, not full white. Spreading the
 * ice-albedo transition over tens of K is what keeps the ice-albedo feedback
 * (#30) SUBCRITICAL at default Earth params — a sharp saturating ice line makes
 * `d(albedo)/dT` large enough for a runaway, and measurably snowballs seeds
 * {1,42,1337} by ~1 Gyr; this graded target instead settles to stable partial
 * polar caps. A much colder perturbation (fainter star / low CO₂, #34) still
 * drives the target toward 1 everywhere, so a snowball stays reachable — the
 * bistability lives in the coupled feedback, not in a hard threshold here.
 */
export const ICE_FULL_COVER_BELOW_K = 40;

/**
 * Relaxation rate toward the (higher) equilibrium cover when a cell is growing
 * ice, per year, at unit moisture supply. Sized so a cold, well-supplied cell
 * closes most of its gap to equilibrium over ~15–25 Myr — gradual on the 10 Myr
 * keyframe cadence (caps thicken/advance over several keyframes, not in a step),
 * which keeps the explicit-lag feedback smooth rather than oscillatory.
 * dt-correct: the per-step change uses `1 − exp(−rate·dt)`, so a coarser
 * `stepYears` rescales the approach, not the trajectory.
 */
export const ICE_ACCUM_RATE_PER_YR = 7e-8;

/**
 * Precipitation giving unit snow supply on land, kg/m²/yr. Land ice growth is
 * moisture-limited — the "wet" half of "cold + wet": a bone-dry cold interior
 * (rain-shadow desert) grows ice slowly, a cold wet coast fast. Supply is
 * `min(precip / ref, SUPPLY_MAX)` and scales the growth RATE (a dry cold cell
 * still glaciates, just over far longer). Ocean cells sit over open water and
 * are always saturated (supply fixed at 1), so sea ice is temperature-limited.
 */
export const ICE_ACCUM_PRECIP_REF = 500;

/** Cap on the land moisture-supply factor, so a monsoon coast cannot grow ice
 *  arbitrarily fast; ocean supply is fixed at 1 and unaffected by this. */
export const ICE_ACCUM_SUPPLY_MAX = 1.5;

/**
 * Baseline retreat rate toward the (lower) equilibrium cover when a cell is
 * losing ice, per year — sublimation / ice flow that lets a marginal cap recede
 * even at sub-freezing air temperature. Comparable to the growth rate so caps
 * breathe symmetrically over the timeline.
 */
export const ICE_MELT_RATE_PER_YR = 6e-8;

/**
 * Extra retreat rate per K above freezing, 1/(yr·K) — the positive degree-day
 * melt law (ablation ∝ warmth). Added to `ICE_MELT_RATE_PER_YR` so a cell a few
 * K above freezing sheds ice much faster than any plausible supply builds it,
 * pinning the warm edge of the ice margin near the freezing isotherm and
 * retreating caps briskly when the climate warms. dt-correct like growth.
 */
export const ICE_ABLATION_RATE_PER_YR_PER_K = 3e-8;

/**
 * Maximum change in `iceFraction` a single step may apply, per Myr of step —
 * a stability rate-limit on the explicit-lag feedback (§5), converted to the
 * actual step with `× dt`. Ice normally moves far slower than this; the cap
 * only bites on a pathological transient (e.g. a huge coarse-grid step into a
 * just-frozen ocean), preventing a 0→1 slam that would make the albedo
 * feedback overshoot. Expressed per-Myr and scaled by dt so it stays
 * dt-consistent across step sizes.
 */
export const ICE_MAX_FRACTION_CHANGE_PER_MYR = 0.25;

/**
 * Water-equivalent thickness of a fully ice-covered (`iceFraction = 1`) land
 * cell, m — the lever that converts ice cover into locked ocean water and thus
 * a sea-level drop. A grounded ice sheet of this thickness withdraws its water
 * from the ocean (floating sea ice does not — Archimedes). 600 m over caps
 * covering ~10–15% of the surface gives an LGM-scale (~100 m) sea-level swing,
 * so the coastline visibly breathes without flooding/exposing implausibly.
 * Only ice on cells above `seaLevelM` (grounded) counts; sea ice is buoyant.
 */
export const ICE_SHEET_WATER_EQUIV_M = 600;

/**
 * Fixed bisection iteration count for the sea-level solve. The hypsometric
 * ocean-volume function is continuous and monotonic in sea level, so bisection
 * over the elevation range converges geometrically; 40 iterations pin a
 * ~20 km elevation bracket to ~2e-8 m — far below any physical or float32
 * relevance, and each iteration is a full-cell sweep, so the count is kept as
 * low as precision allows to stay inside the kernel's test-time budget. A FIXED
 * count (not a convergence test) keeps the solve deterministic — same seed +
 * params ⇒ bit-identical `seaLevelM` on every machine.
 */
export const SEA_LEVEL_SOLVE_ITERATIONS = 40;

// --- Carbonate–silicate CO₂ feedback (#34, Phase 3) -------------------------
// The deep-time thermostat. Volcanic outgassing (tied to tectonic activity)
// restores CO₂; silicate weathering (rising with temperature, runoff and
// exposed land) draws it down. The two balance at a fixed point, and because
// weathering rises with temperature — which rises with CO₂ through the #30
// greenhouse — the loop is a slow NEGATIVE feedback that regulates climate. Its
// classic failure mode is a *feature*: cool the planet enough (fainter star or
// low initial CO₂) and the #33 ice-albedo runaway tips it into a snowball, where
// ice seals the land and weathering shuts off while outgassing keeps degassing,
// so CO₂ accumulates until the greenhouse deglaciates it and the planet recovers.
// `globals.co2` is a SLOW reservoir with cross-step memory (like `iceFraction`);
// the `carbon` system integrates it last in the pipeline and the energy balance
// reads the previous step's value (the same explicit lag as ice / sea level).
// The reference rates below are calibrated so the default planet settles near
// the preindustrial CO₂_REFERENCE with Earth-like temperatures; see the #34
// section of the golden-regeneration note on KERNEL_BEHAVIOR_VERSION.

/**
 * Volcanic CO₂ outgassing at the reference tectonic activity, ppm/yr — the
 * source term. Paired with the weathering reference below (≈ this ÷ the default
 * planet's ~0.19 weathering potential) so the default planet's fixed point sits
 * near `CO2_REFERENCE_PPM`. Sized so the reservoir is SLOW: a small perturbation
 * relaxes over tens of Myr (smooth on the 10 Myr keyframe cadence), and a
 * snowball — weathering off, outgassing unopposed — rebuilds CO₂ over ~10²–10³
 * Myr rather than instantly. Deep-time outgassing continues in a snowball
 * (tectonics is climate-independent), which is what makes recovery inevitable.
 */
export const CO2_OUTGAS_REFERENCE_PPM_PER_YR = 8e-5;

/**
 * Reference tectonic activity the outgassing factor is measured against, m/yr:
 * the mean |boundaryStress| over ACTIVE boundary cells (a typical plate
 * closing/opening speed, ~1 cm/yr). Measured over the golden seeds at N=16–64
 * (grid-stable, unlike the all-cell mean, whose boundary-length share falls
 * ∝ 1/N). Ridges and arcs both degas, so |stress| (convergent and divergent
 * alike) is the vigor proxy; a boundary cell is one with |boundaryStress| above
 * a tiny epsilon (interiors are exactly 0).
 */
export const CO2_OUTGAS_ACTIVITY_REF_M_PER_YR = 1e-2;

/**
 * Clamp on the tectonic outgassing factor (activity / reference). The floor is
 * the crucial one: a tectonically quiet interval still degasses at
 * `FLOOR · reference`, so CO₂ can never stall — the guarantee behind snowball
 * recovery and against a frozen dead end. The ceiling keeps a vigorous plate
 * reorganization (a rift/suture spike) from running CO₂ — and thus climate —
 * away; the weathering thermostat absorbs the rest.
 */
export const CO2_OUTGAS_ACTIVITY_FACTOR_MIN = 0.4;
export const CO2_OUTGAS_ACTIVITY_FACTOR_MAX = 1.6;

/**
 * Silicate-weathering CO₂ drawdown at the reference state (CO₂ =
 * `CO2_REFERENCE_PPM`, and a unit weathering potential — every cell warm, wet,
 * ice-free land), ppm/yr — the sink term's scale. The actual drawdown multiplies
 * this by the CO₂ factor and the weathering potential below, the latter ≈0.19 on
 * the default planet (≈30–40% land × sub-unity temperature/runoff factors), so
 * effective weathering ≈ outgassing there. Chosen with
 * `CO2_OUTGAS_REFERENCE_PPM_PER_YR` to place the fixed point near the reference.
 */
export const CO2_WEATHER_REFERENCE_PPM_PER_YR = 5.5e-4;

/**
 * Reference surface temperature for the weathering temperature factor, K
 * (Earth's mean surface temperature). Weathering rises with warmth
 * (activation-energy kinetics + a wetter, more vigorous hydrological cycle):
 * `factor = exp(SENS·(T − ref))`, so warm land weathers fast and near-freezing
 * land slowly. This is the dominant leg of the thermostat — the leg that makes
 * weathering a decreasing function of CO₂-driven cooling.
 */
export const CO2_WEATHER_REF_TEMP_K = 288;

/**
 * Fractional growth of silicate weathering per K of surface warming, 1/K.
 * 0.07/K ⇒ weathering roughly doubles per +10 K (e^0.7 ≈ 2), the order of the
 * combined kinetic + runoff temperature dependence in weathering models
 * (an effective activation energy of a few tens of kJ/mol). The greenhouse
 * gain `dT/d(ln CO₂)` times this sets the thermostat's restoring strength.
 */
export const CO2_WEATHER_TEMP_SENSITIVITY_PER_K = 0.07;

/** Clamp on the weathering temperature factor: a frozen world still floors at 0
 *  (via 1−iceFraction and the precip factor) and a hothouse is bounded so
 *  drawdown cannot diverge. exp(0.07·ΔT)=4 at ΔT≈+20 K. */
export const CO2_WEATHER_TEMP_FACTOR_MAX = 4;

/**
 * Precipitation giving unit weathering runoff factor, kg/m²/yr (≈ Earth's mean
 * precipitation). Weathering is water-limited — a rain-shadow desert weathers
 * little however warm — so the factor is `min(precip / ref, cap)`; a bone-dry
 * cell contributes nothing. Reuses the moisture field the erosion/ice systems
 * already read.
 */
export const CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR = 1000;

/** Clamp on the weathering runoff factor, so a monsoon cell cannot draw CO₂ down
 *  arbitrarily fast. */
export const CO2_WEATHER_PRECIP_FACTOR_MAX = 3;

/**
 * Direct dependence of silicate weathering on atmospheric CO₂: the drawdown
 * scales `(co2 / CO2_REFERENCE_PPM)^EXPONENT`. 0.5 is within the WHAK range
 * (~0.2–0.5): higher pCO₂ makes soils more acidic and weathering faster. This
 * leg both sharpens the negative feedback (extra restoring force when CO₂ is
 * high) and, with the `CO2_MIN_PPM` floor, guarantees a well-defined warm fixed
 * point — as CO₂ falls the drawdown falls with it, so CO₂ can never be driven
 * to zero. In a snowball it is inert: the weathering potential is ~0 (ice-sealed
 * land), so no power of CO₂ revives the sink until the ice retreats.
 */
export const CO2_WEATHER_CO2_EXPONENT = 0.5;

/**
 * Hard bounds on the CO₂ reservoir, ppm. The floor keeps the greenhouse forcing
 * `ln(co2/ref)` finite and a faint atmosphere present; the ceiling bounds the
 * snowball buildup (weathering off, outgassing unopposed) at a large but finite
 * value so the field and the temperatures it drives stay representable. Neither
 * is a physical target — the thermostat holds CO₂ far inside this range on any
 * non-pathological planet.
 */
export const CO2_MIN_PPM = 10;
export const CO2_MAX_PPM = 1e6;

/**
 * Maximum fractional change in `co2` a single step may apply, per Myr of step —
 * a stability rate-limit on the explicit-lag feedback (§5), scaled by `× dt`.
 * As a FRACTION of the current CO₂ it gives an exponential-approach cap that is
 * gentle near the (low) fixed point and permissive during a (high-CO₂) snowball
 * recovery. The thermostat's own relaxation is far slower than this at the
 * default rates; the cap only bites on a pathological transient (a coarse step
 * into a just-frozen ocean), preventing an overshoot that could set the feedback
 * ringing — the phase's named oscillation/divergence risk.
 */
export const CO2_MAX_CHANGE_FRAC_PER_MYR = 0.05;

// --- Whittaker biome classification (#35, Phase 3) --------------------------
// The `biome` field is a categorical Whittaker-style lookup over (temperature,
// precipitation) that drives the renderer's from-orbit colour ramp (retiring
// raw hypsometry). It is a FAST diagnostic (§0): recomputed every step from the
// current climate, no memory, and — being categorical — round-trips bit-exact
// through the codec and is nearest-picked (never lerped) at render (like
// `plateId`). Ocean is its own class (below the sea-level mask); the remaining
// land classes tile the Whittaker plane by two mean-annual-temperature cutoffs
// (boreal/temperate/tropical) and precipitation cutoffs whose aridity boundary
// rises with warmth — a coarse nod to the Whittaker diagonal (higher potential
// evapotranspiration needs more rain to escape desert). Thresholds are the
// classification's only tunable knobs; the palette lives in the renderer/CLI
// (a rendering concern, like the plate hue), not here.

/**
 * Upper mean-surface-temperature bound of the TUNDRA band, °C. At or below
 * freezing (0 °C annual mean) land is treeless tundra; the coldest cells are
 * usually ice-whitened at render by `iceFraction` on top of this class.
 */
export const BIOME_TUNDRA_MAX_C = 0;

/**
 * Upper bound of the BOREAL band, °C. Between `BIOME_TUNDRA_MAX_C` and this,
 * moist land is taiga (boreal forest); dry land in the same band falls to cold
 * desert (the shared DESERT class) via `BIOME_ARID_MAX_PRECIP_COOL`.
 */
export const BIOME_BOREAL_MAX_C = 7;

/**
 * Upper bound of the TEMPERATE band, °C. Above it, land is subtropical/tropical
 * and classified with the warm aridity/savanna cutoffs; below it (and above the
 * boreal cutoff) land is temperate desert/grassland/forest by precipitation.
 */
export const BIOME_TEMPERATE_MAX_C = 20;

/**
 * Aridity cutoff in the COOL half (boreal + temperate bands), kg/m²/yr: land
 * drier than this is desert (cold steppe/shrub). ~200 mm/yr is the conventional
 * arid boundary in cool climates where evaporative demand is modest.
 */
export const BIOME_ARID_MAX_PRECIP_COOL = 200;

/**
 * Aridity cutoff in the WARM half (tropical/subtropical band), kg/m²/yr: higher
 * than the cool cutoff because hot air's larger moisture demand keeps land arid
 * up to more rainfall (subtropical desert extends past ~400 mm/yr). This lift is
 * the Whittaker diagonal in discretized form.
 */
export const BIOME_ARID_MAX_PRECIP_WARM = 400;

/**
 * Grassland/forest split in the TEMPERATE band, kg/m²/yr: non-arid temperate
 * land drier than this is grassland (prairie/steppe), wetter is temperate
 * forest. ~600 mm/yr is the rough forest threshold at temperate evaporation.
 */
export const BIOME_TEMPERATE_FOREST_MIN_PRECIP = 600;

/**
 * Savanna/rainforest split in the TROPICAL band, kg/m²/yr: non-arid tropical
 * land drier than this is savanna (seasonal grassland/woodland), wetter is
 * tropical rainforest. ~1500 mm/yr separates seasonally-dry tropics from
 * perhumid rainforest.
 */
export const BIOME_TROPICAL_FOREST_MIN_PRECIP = 1500;

/** Default simulation step, years. Chosen so 10 steps fit one keyframe interval. */
export const DEFAULT_STEP_YEARS = 1e6;

/** Default keyframe interval, years (SCAFFOLD_SPEC 2.4). */
export const DEFAULT_KEYFRAME_INTERVAL_YEARS = 10e6;
