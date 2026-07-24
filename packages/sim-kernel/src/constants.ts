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
 * 16 — Phase 4 ocean life & oxygenation (#37): the biosphere block's first two
 *     systems, `marineLife` then `oxygen`, run after `carbon` (so life reads
 *     this step's fully-solved climate and land mask) and before `biome`.
 *     `marineLife` is a new FAST diagnostic field (appended after `windV`):
 *     zero everywhere until a gated-stochastic abiogenesis onset fires (a
 *     hash-based per-step Bernoulli, keyed on (seed, quantized time) and gated
 *     on the liquid-ocean habitable fraction — deterministic and independent of
 *     any other system's PRNG consumption, exactly like the #18 rift draw), then
 *     per-ocean-cell photosynthetic productivity (light × temperature window ×
 *     shelf-nutrient proxy). `oxygen` integrates the well-mixed atmospheric O₂
 *     reservoir (a new `Globals` scalar, PAL) from mean marine productivity ×
 *     organic burial minus a volcanic-reductant sink and an oxidative sink ∝ O₂,
 *     through a `oxygenReductant` buffer (a second new global) that must be
 *     oxidized before O₂ can rise — the physical origin of the anoxic latency,
 *     so the Great Oxidation emerges as an S-curve, not a scripted date. Onset
 *     time is recorded in the `abiogenesisYear` global; the block emits the
 *     `abiogenesis` and `greatOxidation` events. The biosphere is inert at
 *     `biosphereEnabled=false` (the ablation switch, default true) and — in this
 *     milestone — feeds back into NO physical field (albedo/weathering coupling
 *     arrives with vegetation, #39), so with the biosphere enabled every
 *     pre-existing field's bytes are byte-identical to bump 15; the field-golden
 *     diff is purely the new `marineLife` entry (all-zero on any seed whose
 *     abiogenesis onset lands after the 10-step golden window). Deliberate
 *     regeneration owing this bump. Paired with it, `marineLife` joins the codec
 *     stored set so the ocean life story is `--dump`-able and render-visible
 *     (#38), bumping HISTORY_FORMAT_VERSION 2→3; the O₂/abiogenesis globals ride
 *     in `Keyframe.globals` at no per-keyframe byte cost, as `co2` already does.
 * 15 — `crustFates` (#88) and `marinePlanation` (#90) promoted to
 *     default-on (onsets stay 0 — active from formation). The default
 *     planet's history changes wholesale: small-component crust docks or
 *     retires (the #88 consolidation sweep measured in
 *     ISSUE_88_91_FINDINGS.md) and small-island planation exports into
 *     `sedimentM`. The promoted pair measured HEALTHIER than baseline over
 *     full 4.5 Gyr histories (N=64 land min ~16% vs 14% baseline, continents
 *     consolidated). `compactArcs` (#89) and `emergentArcTaper` (#91) were
 *     NOT promoted: measured together at default-on they starve continental
 *     creation into a near-waterworld (N=64 final land 2-5%, N=128 land min
 *     5.3% — far below the standing 10% sanity floor), so they stay
 *     default-off togglables. Main goldens regenerated deliberately for the
 *     new defaults; the pre-promotion kernel path is pinned unchanged by the
 *     legacy all-mechanisms-off goldens (same hashes the old main goldens
 *     carried). `blockIsostasy` (#84) stays default-off, superseded by
 *     crustFates.
 * 17 — Tectonics V2 promotion (#115, stage 5 of #109): `forceKinematics` (#111),
 *     `emergentSuture` (#112) and `tensionRift` (#113) promoted to default-on
 *     (onsets stay 0 — active from formation), with `riftSutureCooldownYears`
 *     kept at 120 Myr (the #114 measurement retained the cooldown as a
 *     mechanistically-understood hysteresis term). Plate angular velocity is now
 *     derived state from a per-step rigid-plate torque balance instead of a fixed
 *     random Euler draw; continent–continent pairs suture when force-balance
 *     collision damping stalls their closing speed (loud sutureTimeout backstop)
 *     instead of on a fixed contact countdown; and rift timing follows a physical
 *     hazard ∝ (boundary tension)² × supercontinent thermal blanket instead of the
 *     flat Bernoulli × hand-tuned size ramp. The default planet's history changes
 *     wholesale: plates speed up and slow against what they touch (census median
 *     ~6 cm/yr, poles migrate), the ocean floor stays young (median ≤56 Myr), and
 *     supercontinents assemble and disperse without the frozen-pole lock. The
 *     stack measured HEALTHIER than baseline over full 4.5 Gyr histories on seeds
 *     {1,42,1337} (N=64 + N=128 seed-42): land min ≥22.3%, dispersal ≥0.7 every
 *     Gyr bucket, monopoly 0, re-suture interval ≥140 Myr. Two honest misses are
 *     recorded in docs/TECTONICS_V2_STAGE5_GATE_RECHECK.md: the census speed
 *     median runs marginally hot (6.0–6.3 vs the 2–6 band) and the Forsyth & Uyeda
 *     speed–slab correlation is an ISOLATION-only property of `forceKinematics`
 *     (solo 0.30–0.50) that the full stack's boundary churn washes out in deep
 *     time — the gate is re-verified under solo `forceKinematics` per the owner's
 *     option-B decision on #115. Main goldens regenerated deliberately for the new
 *     defaults; the pre-promotion kernel path is pinned unchanged by BOTH the
 *     legacy all-mechanisms-off goldens and a new pre-V2-promotion default spine
 *     (the three V2 flags explicitly off, others at their defaults). The u8
 *     plateId width (256) is adequate under the V2 rift regime — measured worst
 *     case 176/256 slots at N=128 seed 42 over 4.5 Gyr (31% headroom); dead-slot
 *     reclamation is deferred as a future change, unneeded for the shipped grids.
 * 18 — Sea-level datum trio promotion (#127 item 9, the review's recommended
 *     config in TECTONICS_V2_REVIEW_FINDINGS §4): `seaLevelDatums`, `freeboard`
 *     and `bathymetryDatum` promoted to default-on (onsets stay 0 — active from
 *     formation), on top of the v17 V2 defaults. The three re-key the platform/
 *     arc/land datums, the continental freeboard regulator, and the oceanic
 *     age-depth reference to the DYNAMIC sea level instead of the fixed 0 m crust
 *     datum, so the ~3 km deep-time sea-level fall no longer strands drowned
 *     platforms as dry islands, flattens the alpine continental mean back to a
 *     realistic freeboard, and keeps mid-ocean ridge crests submerged instead of
 *     crossing the late-time oceans as emergent island chains. Measured
 *     best-in-class world shape on seeds {1,42,1337} (dispersal 95–97%, land
 *     25–31%, fewest/largest land components, monopoly 0; findings §4). Main
 *     goldens regenerated deliberately for the new defaults; the datum-off code
 *     path is pinned unchanged by the legacy all-mechanisms-off goldens AND a new
 *     pre-datum-promotion default spine (the three datum flags explicitly off,
 *     the V2 stack at its v17 defaults). `compactArcs` (#89) and `emergentArcTaper`
 *     (#91) stay default-off and are now documented as INCOMPATIBLE with the
 *     promoted defaults: each starves continental crust to 4–9% of the sphere
 *     under the V2 engine (findings §3), the opposite of their #89/#91 intent.
 * 19 — Crustal-column stage C1 (docs/CRUSTAL_COLUMN_PROPOSAL.md §6): the
 *     `crustalThicknessM` field lands, appended last and populated at init by
 *     pure inversion of the t=0 terrain (continental T = (e − C)/k, oceanic
 *     7.1 km — zero RNG), joining ADVECTED_FIELDS unconditionally. The
 *     `crustalColumns` mechanism (default OFF) + `crustalColumnsOnsetYears`
 *     carry the standard branched-A/B contract; flag-on, every continental
 *     elevation write routes through thickness via the C1 mechanical shims
 *     (ΔT = Δe/k, elevation re-derived as C + k·T — behavior distributionally
 *     today's, trajectories float-divergent) with an onset re-inversion making
 *     the onset snap exactly zero. Flag-off, every PRE-EXISTING field is
 *     byte-identical to v18 — the golden diff is purely the new field's hash
 *     lines (verified against the v18 snapshots at regeneration). Deliberate
 *     regeneration owing this bump: a new advected field is schema growth,
 *     the bump-5 `sutureYears` precedent (owner-confirmed cadence: C1 and the
 *     C7 promotion bump; stages C2–C6 regenerate only the flag-arm spines).
 *     Sim-only field — no codec/HISTORY_FORMAT_VERSION change.
 * 20 — Crustal-column model promotion (docs/CRUSTAL_COLUMN_STAGE_C7_GATE.md, the
 *     C7 water-sweep gate, owner-signed). Two default changes ship together:
 *     `crustalColumns` OFF→ON (the thickness-primary Airy model becomes the
 *     shipped vertical physics — continental elevation is derived C + k·T over a
 *     fixed datum, so freeboard, cratonic platforms and foundering are mass-budget
 *     consequences, not servo targets) and `waterInventoryScale` 1.0→1.5 (the C7
 *     sweep §5 measured 1.5× the derived endowment to give the Earth-like
 *     coastline regime — flooded shelves, ~25% submergence, in-band shallow seas
 *     — the fixed datums are calibrated for; the 1.0 world is Earth's structure on
 *     a drier coastline). Sweep evidence: monotonic freeboard/flooding on every
 *     seed across scales 0.5–2.0, 11/12 cells alive at 4.5 Gyr, the one death a
 *     pre-existing knife-edge V2 monopoly event at off-default endowment (§6).
 *     The single kernel-code change under the flag (the C7 arc-ceiling re-key,
 *     boundaries.ts) is guarded on the columns path (`crustalThicknessM !== null`),
 *     so the flag-OFF / water-1.0 path is byte-identical to v19: main goldens
 *     regenerated deliberately for the new defaults, the pre-promotion world
 *     pinned unchanged by the legacy all-off, pre-V2, pre-datum spines AND a new
 *     pre-crustal-columns default spine (`crustalColumns` off + `waterInventoryScale`
 *     1 explicit, the rest at their v18 defaults — reproduced verbatim from the
 *     v19 main hashes). Open watch item routed to #131, not blocking: the
 *     shipped N=128 grid equilibrates ~6 pts of crust fraction below the N=64
 *     calibration (§7), a founder/retirement granularity resolution-dependence.
 *     Sim-behavior change only — no schema/codec/HISTORY_FORMAT_VERSION change.
 */
export const KERNEL_BEHAVIOR_VERSION = 20;

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

/**
 * Default fraction of cells above the 0 m datum targeted by initial terrain
 * (spec: ~30%). Since #106 this is the DEFAULT of the `initialLandFraction`
 * `PlanetParams` number, not a fixed constant: initial terrain places its sea
 * quantile so this fraction of cells sit above the datum, and the conserved
 * water inventory is derived from the ocean volume below that coastline
 * (`createInitialState`), so a lower/higher land fraction re-derives a
 * self-consistent inventory automatically (t=0 sea stays exactly 0 at any
 * value). Must stay strictly below `CONTINENTAL_CRUST_FRACTION` — the 10-point
 * gap IS the initial submerged shelf (25% of continental crust flooded at the
 * default); at land fraction ≥ crust fraction every continental cell would be
 * emergent and the shelf constructions starve (the CLI clamps it). The value is
 * the literal `0.3`, so a default run's sea quantile is byte-identical to the
 * pre-#106 kernel by construction.
 */
export const DEFAULT_INITIAL_LAND_FRACTION = 0.3;

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
 *
 * Deliberately pinned at the Cogley-anchored 40% while `initialLandFraction`
 * (#106) varies (issue-106 decision (a)): the gap between this and the land
 * fraction is the initial submerged continental shelf (25% of continental
 * crust flooded at the default 0.3 land fraction, the Earth-like #101/#102
 * construction). Holding it fixed means the initial flooded share VARIES with
 * the land parameter — less land ⇒ more shelf, which is physical — and adds no
 * second knob. It is the hard upper edge for `initialLandFraction`: at land
 * fraction ≥ this every continental cell is emergent and the shelf constructions
 * starve, so the CLI validates `0 < initialLandFraction < this`.
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

/*
 * Force-balance kinematics (Tectonics V2 stage 1, #111, proposal §2.3). The
 * torque-balance driving/closure constants that make each plate's ω⃗ derived
 * state under `forceKinematics`. Each value carries the physical anchor from
 * the proposal table; they are inert (never read) until the `plateDynamics`
 * system lands in stage-1 chunk 2, and unused on the default (flag-off) path.
 */

/**
 * Net transmitted slab pull per m of trench per √(age yr). 100 Myr crust ⇒
 * 5×10¹² N/m — Schellart 2004's net slab pull (4–6×10¹², ~10% of total slab
 * buoyancy). The ∝√age law is half-space cooling — the same law as the
 * bathymetry subsidence curve.
 */
export const SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR = 5e8;

/**
 * Lithosphere younger than ~25 Myr is not reliably negatively buoyant; slab
 * pull ramps linearly 0→full over [1×, 2×] this age. Prevents a fresh
 * ridge-flank self-subduction feedback.
 */
export const SLAB_PULL_MIN_AGE_YEARS = 2.5e7;

/**
 * Fraction of a cell's slab pull applied to the *overriding* plate,
 * trench-ward (slab suction, Conrad & Lithgow-Bertelloni 2002). Makes a
 * subduction margin organize both plates, not just the subducting one.
 */
export const SLAB_SUCTION_FACTOR = 0.4;

/**
 * Ridge (GPE) push per m of divergent boundary, applied to each flank away
 * from the ridge (~½ the net slab pull; Forsyth & Uyeda 1975).
 */
export const RIDGE_PUSH_N_PER_M = 2.5e12;

/**
 * Continent–continent contact resistance per m of contact per (m/yr) of
 * closing speed. At 5 cm/yr ⇒ 1×10¹³ N/m (Gurnis & Hall 2004
 * subduction-initiation scale). Pure damping, capped — a collision can stall
 * the closing speed but never reverse it.
 */
export const COLLISION_DAMP_N_YR_PER_M2 = 2e14;

/**
 * Linear basal traction coefficient c_d in −c_d·v, N·yr/m³. The model's
 * effective "mantle viscosity" and the primary calibration lever for the
 * overall speed level.
 */
export const BASAL_DRAG_N_YR_PER_M3 = 1.2e7;

/**
 * Per-cell basal-drag multiplier on continental cells (cratonic keels drag
 * harder). Mixed plates interpolate naturally, so plate speed anticorrelates
 * with continental fraction as a *consequence*, not a rule.
 */
export const CONTINENTAL_DRAG_MULTIPLIER = 4;

/**
 * e-folding time of ω⃗ relaxing toward the torque balance's terminal velocity
 * ω⃗*, yr. Anchors: India lost ~⅔ of its speed in ~15 Myr at collision; stable
 * poles hold 10–100 Myr. Also the low-pass time constant against
 * advection-quantum torque noise (proposal §8 risk 1).
 */
export const OMEGA_RELAX_YEARS = 1e7;

/**
 * Hard cap on a plate's characteristic surface speed |ω⃗|·R, m/yr (India's
 * ~18–20 cm/yr burst is the observed ceiling). Rescales ω⃗ when exceeded;
 * protects the advection cadence and the boundary-rate clamps from a runaway
 * calibration.
 */
export const PLATE_SPEED_CAP_M_PER_YR = 0.2;

/**
 * Fraction of tr(K)/3 added to the drag tensor K's diagonal before the 3×3
 * solve. A near-point plate has a singular drag tensor along its radial axis
 * (spin-in-place is dragless); this regularizer pins that null space
 * deterministically.
 */
export const DRAG_TENSOR_REGULARIZATION = 1e-3;

/**
 * Tension-driven rift hazard (Tectonics V2 stage 3, #113, proposal §2.4).
 * Under `tensionRift` the flat Bernoulli hazard × the #61 size ramp is
 * replaced by a hazard proportional to (boundary tension)² × a supercontinent
 * thermal-blanket factor: a plate rifts *because it is being pulled apart*
 * (high opposed slab pull — gross ≫ |net| over the pull-class forces), a
 * continuous physical scalar with no knee — replacing the #66-measured-bimodal
 * size ramp. Only the rift *timing* changes; the carve machinery is
 * byte-identical (proposal §7).
 */

/**
 * Tension scale, N. A supercontinent-scale plate ringed by ~10⁷ m of opposed
 * subducting perimeter at ~3×10¹² N/m carries gross − |net| ≈ 3×10¹⁹ N, so at
 * this reference tension the hazard equals `RIFT_HAZARD_AT_REF_PER_MYR`. The
 * hazard's tension factor is min(4, (tensionN/this)²) — quadratic in the
 * fraction of the driving force that does not cancel, capped at 4× the
 * reference rate so a runaway-tension plate cannot rift every step.
 *
 * #127 item 2.1 restricted `tensionN` to the pull-class forces — slab pull on
 * the subducting side and slab suction on the overriding side (ridge push and
 * continental collision damping, both compression-side, no longer leak in).
 * This reference was already DERIVED from opposed slab pull, so it needed no
 * retune: the corrected scalar reproduces a healthy deep-time world with no
 * monopoly lock at N=16 (the phase-1 invariant) AND N=64 across seeds
 * {1,42,1337} — reorg 5.0–5.4/100 Myr, dispersal 96–100 %, land 25–37 %,
 * continental crust 0.30–0.32 of sphere — measurably cleaner dispersal than the
 * pre-change V2 default (89 %). Slab suction is the term that prevents coarse-
 * grid monopoly: a large overriding continent girdled by subduction accrues
 * radially-opposed suction tension and rifts — the physical supercontinent-
 * breakup driver the old sign-blind collision-damping tension was faking.
 */
export const RIFT_TENSION_REF_N = 3e19;

/**
 * Cap on the quadratic tension factor min(this, (tensionN/RIFT_TENSION_REF_N)²).
 * A plate at twice the reference tension already rifts at 4× the reference rate;
 * clamping there stops a runaway-tension plate from rifting every step (the
 * hazard's own monopoly safety net, analogous to RIFT_SIZE_RATE_REF_MULTIPLE in
 * the legacy scheme).
 */
export const RIFT_TENSION_MAX_FACTOR = 4;

/**
 * Rift hazard at the reference tension, per Myr. Hazard λ = this ×
 * min(4, (tensionN/RIFT_TENSION_REF_N)²) × blanketFactor; the per-step
 * acceptance probability is 1 − exp(−λ·dtMyr), drawn at the same hash site as
 * the legacy scheme. Replaces `RIFT_PROBABILITY_PER_MYR` (0.0015) × size ramp.
 * Pre-registered Plan B if tension² proves as bimodal as the ramp it replaces:
 * a soft-yield shape ∝ max(0, T−T_ref)² (graft from the mantle-proxy design).
 *
 * Stage-3 rate retune (the one allowed #66/#101 companion retune, #113): the
 * measured grid at 0.01/Myr dispersed uniformly (≥0.84 every Gyr bucket, no
 * bimodal knee — the tension² shape is validated) but rifted ~4× the legacy
 * rate (204/188/186 events over 4.5 Gyr vs 44/41/44), and because dead plate
 * slots are never reclaimed the monotonic u8 plate-ID counter reached max ID
 * 213 at seed 42 @ N=128 (83% of the 256 cap), breaching the <200 slot-budget
 * gate. Cut 0.01 → 0.0075 (−25%) to restore u8 headroom while leaving the
 * tension² shape and blanket dynamics — the mechanism's thesis — untouched.
 * A −25% cut still leaves ~3× the legacy rift rate, so dispersal is expected
 * to survive (measured, not assumed). The root cause (unreclaimed slots) is a
 * stage-5 / dedicated-change concern, out of scope for a companion retune.
 */
export const RIFT_HAZARD_AT_REF_PER_MYR = 0.0075;

/**
 * Continental fraction of the whole sphere at or above which a plate is a
 * "supercontinent" and its thermal blanket accumulates. 25% of the sphere as
 * continent on a single plate is a supercontinent-scale mass; below it the
 * blanket resets. Fraction of total cells (continental cells / count), not of
 * the plate's own area.
 */
export const BLANKET_CONTINENT_FRACTION = 0.25;

/**
 * Supercontinent thermal-blanket e-folding time, yr. `blanketYears` accrues
 * while a plate stays above `BLANKET_CONTINENT_FRACTION`; the hazard multiplier
 * is 1 + (BLANKET_MAX_FACTOR−1)(1 − e^(−blanketYears/this)) — a slow fuse that
 * approaches its ceiling over several hundred Myr. This is the one deliberately
 * *pseudo-mantle* term of the redesign, honestly labeled: it stands in for the
 * sub-continental warming a real mantle layer would produce, and is superseded
 * by `mantleAnchors` (§5 Stage 6).
 */
export const BLANKET_EFOLD_YEARS = 3e8;

/**
 * Ceiling of the supercontinent thermal-blanket hazard multiplier (see
 * `BLANKET_EFOLD_YEARS`). A long-lived supercontinent's interior heats until
 * its rift hazard is at most this many times the un-blanketed rate.
 */
export const BLANKET_MAX_FACTOR = 3;

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
 * Minimum submergence of a mid-ocean ridge crest below the DYNAMIC sea level
 * under the `bathymetryDatum` mechanism (#102), m. When the deep-time sea
 * falls below `OCEAN_RIDGE_DEPTH_M − this`, the sea-keyed age-depth curve
 * (bathymetry.ts) caps its crest at `seaLevelM − this` (the abyssal end
 * stays absolute) so spreading centers stay submerged instead of crossing
 * the ocean as emergent island chains. 500 m — deliberately equal to
 * |ARC_MATURATION_ELEVATION_M|, so fresh ridge crust is born exactly AT
 * the (sea-keyed) arc maturation gate: the #102 calibration measured that
 * a 1000 m crest starves arc-driven continental creation (−5..−7 points of
 * continental crust on two golden seeds — the baseline's emergent ridge
 * flank had been auto-maturing belt arcs), while 500 m retires the chains
 * identically (emergent young crust 1.7–2.5% vs 37–65% baseline; mean
 * crest ~0.7 km below the sea) and keeps the continental budget within
 * seed scatter. Earth's crests sit ~2.5 km down, but the sim's conserved
 * water inventory (~1.7 km global-equivalent, measured) fills only ~45%
 * of an Earth-proportioned basin: the abyss is pinned at −6000 m and the
 * equilibrium sea rides ~−3.6 km, so every metre of extra crest depth
 * costs ridge-abyss relief 1:1. See the findings doc for the volumetric
 * budget, the measured divergence of full 1:1 curve tracking, and the
 * 500-vs-1000 probe table.
 */
export const OCEAN_RIDGE_MIN_SUBMERGENCE_M = 500;

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
 * convergence but above transform noise. Also the exclusion gate for the
 * freeboard passive-margin band (freeboard.ts): a coast converging faster
 * than this is orogeny's, not thermal subsidence's.
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
 * hard-set: 1e-3 m/yr takes a 9 km orogen to the founder level in ~9 Myr (a
 * gravitational-collapse timescale) — several 1 Myr sim steps, so no
 * single-step cliff, though the full sink still fits inside about one
 * 10 Myr keyframe interval: the on-screen smoothness is the keyframe blend
 * riding this multi-step ramp, not the rate alone. On an active margin the
 * orogeny pump (OROGENY_RATE_M_PER_YR, 6e-4) works against this relax, so
 * the effective sink rate there is ~4e-4 m/yr and a still-converging block
 * sits pinned at its cap rather than below it. Subsidence only: the cap
 * never raises elevation.
 */
export const BLOCK_ISOSTASY_RELAX_M_PER_YR = 1e-3;

// --- Small-component crust fates & terrane docking (#88) ---------------------

/**
 * Continental-component area below which the component is "small" for the
 * #88 crust-fate pass — eligible to dock onto a large component or, failing
 * that, to founder as a crust record, m². Same physical premise and value as
 * BLOCK_FOUNDER_AREA_M2 (300k km² — below Madagascar, above the
 * collision-debris / rifted-sliver scale the boundary processes strand):
 * the two mechanisms attack the same population of blocks, #84 through the
 * land mask (elevation) and #88 through the crust map (crustType).
 * Deliberately a separate constant so the two prototypes can be tuned apart
 * during measurement.
 */
export const CRUST_FATE_SMALL_AREA_M2 = 3e11;

/**
 * Maximum ocean gap, in cells, across which a small component docks onto a
 * large one (#88 static half). 2 cells is the issue's spec: at N=64 that is
 * ~300 km of strait — the scale of the suture zones bounding real docked
 * terranes (Wrangellia and friends are welded across tens to a few hundred
 * km). Beyond it the fragment keeps drifting until plate motion delivers it
 * (the transport half: dock-on-arrival is what makes this consolidation
 * dynamics, not just cleanup of lucky proximity).
 */
export const CRUST_FATE_MERGE_GAP_CELLS = 2;

/**
 * Rate at which an isolated small component's relief subsides toward the
 * founder level before its crust record retires, m/yr (#88). Same
 * gravitational-collapse timescale argument as BLOCK_ISOSTASY_RELAX_M_PER_YR
 * (a 9 km splinter drowns in ~9 Myr — several sim steps, no single-step
 * cliff). The crustType → 0 flip itself fires only once the whole component
 * already sits at or below the founder level, so the visible land mask never
 * pops: retirement is bookkeeping on a block that is already underwater, and
 * the ordinary oceanic age-depth relaxation takes the platform down from
 * there at its own bounded rate.
 */
export const CRUST_FATE_SUBSIDENCE_M_PER_YR = 1e-3;

// --- Compact arc maturation (#89) ---------------------------------------------

/**
 * Minimum continental 4-neighbors (in the pre-topography crust map) for an
 * arc cell in the accretionary belt to mature into continental crust when
 * params.compactArcs is on (#89). 2 makes creation grow blobs: a cell on a
 * straight coast-parallel arc line has 1 continental neighbor and stays an
 * oceanic arc (it can mature in a later step once the continent grows
 * around it), while a bay/concavity cell has 2+ and fills in — so new
 * continent compacts the margin instead of stringing chains along it that
 * become the next generation of lace. 1 would be the old belt-only gate;
 * 3+ restricts creation to enclosed holes only, the measured-fatal #67
 * attachment-gate starvation trap.
 */
export const COMPACT_ARC_MIN_CONT_NEIGHBORS = 2;

// --- Marine planation for small components (#90) -------------------------------

/**
 * Continental-component area below which marine planation acts, m² (#90).
 * A block this small is all coastline — every interior cell within reach of
 * wave attack. The strength ramps linearly from 1 at zero area to 0 here,
 * so a growing component feels no cliff as it crosses the threshold. Same
 * 300k km² scale as the #84/#88 thresholds — the same population of blocks,
 * attacked through the erosion ledger this time (transport into sedimentM,
 * fully conservative, unlike the #84 founder's subsidence).
 */
export const MARINE_PLANATION_AREA_M2 = 3e11;

/**
 * Peak marine-planation export rate (at zero component area), m/yr (#90).
 * Wave truncation of a volcanic island to a submerged flat-topped platform
 * takes ~1–10 Myr (guyot formation timescale); 1e-3 m/yr planes a 1 km
 * island in ~1 Myr and a 9 km splinter peak in ~9 Myr — the same
 * no-keyframe-popping bound as BLOCK_ISOSTASY_RELAX_M_PER_YR. Unlike river
 * erosion the rate does not scale with precipitation (wave energy, not
 * runoff) and does not vanish at the coastline: planation grades toward the
 * shelf/founder level (MICROCONTINENT_FOUNDER_ELEVATION_M, coinciding with
 * SEDIMENT_SHELF_CEILING_M at −200 m), so a planed platform and a foundered
 * platform are the same object downstream.
 */
export const MARINE_PLANATION_RATE_M_PER_YR = 1e-3;

// --- Emergent-arc growth taper (#91) -------------------------------------------

/**
 * Factor applied to oceanic-arc elevation growth above sea level when
 * params.emergentArcTaper is on (#91). Submarine arc construction stays at
 * the full rate — the −500 m maturation gate is reached exactly as before,
 * so the continental-creation budget is untouched — but breaching the
 * surface takes sustained subduction: emergent relief is the slow subaerial
 * tip of the edifice. 0.05 puts tapered emergent growth (0.05 × the
 * N-scaled arc rate ≈ 6e-5..2.5e-4 m/yr at N=32..128, × the stress norm) in
 * the same band as OCEAN_RELIEF_RELAX_M_PER_YR (2e-4), so a margin that
 * flickers off a cell (the herringbone does this constantly) loses emergent
 * relief about as fast as it builds it — only long-lived, consistently
 * convergent margins stand +1 km Japan/Aleutians-style chains. Margin age
 * is thereby the integrator: the cap on emergent relief IS the dwell time
 * of active subduction on the cell, with no new field to advect.
 */
export const ARC_EMERGENT_GROWTH_FACTOR = 0.05;

// --- Freeboard regulation (docs/SEA_LEVEL_DATUM_FINDINGS.md follow-up) --------

/**
 * Target cell-count-mean elevation of continental crust above the DYNAMIC sea
 * level, m (the `freeboard` mechanism). Anchored two ways: the tuned initial
 * terrain measures 380–450 m across the golden seeds at t=0 (sea at 0, 25% of
 * continental crust submerged by construction), and Earth's continental crust
 * — land mean +840 m over ~75% of it, flooded shelf ~−130 m over the rest —
 * averages a few hundred metres. 400 m makes the mechanism near-inert at t=0
 * and engages it exactly as the basin-maturation sea-level fall opens a gap.
 *
 * Calibrated and kept at 400 by the #101 sweep ({400, 600, 800} × the golden
 * seeds, N=64, 4.5 Gyr, with seaLevelDatums — the designed pairing): the
 * late-time flooded share is INSENSITIVE to this target (~44–59% submerged at
 * every value; the ~2× Earth overshoot is structural, not a target question),
 * because the continental mean rides 1–2 km above any of these targets most
 * of deep time and the flooded lobe sits 2–2.5 km deep against the buoyancy
 * floor, far below a few hundred metres of datum shift. Raising it buys no
 * land and costs continental crust on seed 42 (22.6–23.3% vs 27.5% at 400).
 * Measured numbers in docs/SEA_LEVEL_DATUM_FINDINGS.md, "#101 sweep".
 */
export const FREEBOARD_TARGET_M = 400;

/**
 * Rate bound on the uniform epeirogenic shift that relaxes the continental
 * mean toward the freeboard target, m/yr. 2e-5 (20 m/Myr) is the order of the
 * early basin-maturation sea-level fall itself (~3 km over the first
 * ~200–500 Myr), so continents track the falling sea with a modest lag, and
 * it is far below the local process rates (orogeny 6e-4, founder subsidence
 * 1e-3 m/yr), so freeboard adjusts the datum the local processes work
 * against without ever outrunning them.
 */
export const FREEBOARD_RELAX_M_PER_YR = 2e-5;

/**
 * Depth below the dynamic sea level that passive-margin subsidence grades
 * toward, m. −150 m is mid-shelf (real shelves average ~−60 m and break at
 * ~−120..−200 m). Deliberately a separate constant from
 * SEDIMENT_SHELF_CEILING_M (a fill ceiling for oceanic sediment) and
 * MICROCONTINENT_FOUNDER_ELEVATION_M (a flotation clamp for continental
 * splinters) — same do-not-re-sync rule as those two.
 */
export const PASSIVE_MARGIN_SHELF_M = -150;

/**
 * Post-rift thermal-subsidence rate for the passive-margin band, m/yr.
 * Stretched margins accumulate ~2 km of thermal subsidence over ~100 Myr
 * (McKenzie 1978 half-space cooling of thinned lithosphere); a constant
 * 2e-5 m/yr (20 m/Myr) is that total over that window — the prototype takes
 * the mean rate rather than tracking a per-cell rift clock (no new field).
 */
export const PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR = 2e-5;

/**
 * How many cells inland from same-plate oceanic crust the passive-margin
 * subsidence band reaches. 2 cells is ~300–600 km at N=64..32 — real passive
 * margins are 100–500 km wide. The band cannot creep inland over time:
 * flooded margin cells stay continental crust, and the band is measured from
 * OCEANIC (crustType 0) adjacency only.
 */
export const PASSIVE_MARGIN_WIDTH_CELLS = 2;

/**
 * Deepest the epeirogenic shift may push continental crust below the dynamic
 * sea level, m — the buoyancy floor. Continental crust is too buoyant to
 * float at abyssal depth: the deepest real drowned continental platforms
 * (Zealandia's plateaus, the Kerguelen fragment) sit ~1–2.5 km below the
 * waves, far above the −6 km abyssal plains. Without this floor the
 * freeboard mean-regulation is an unbounded ratchet — orogeny keeps
 * injecting elevation into active belts, the compensating uniform sink
 * drags everything else down, and flooded interiors (which no erosive or
 * isostatic process ever lifts) measured −17 km within 2 Gyr, deepening the
 * ocean and pulling sea level down with them. The shift never pushes a cell
 * below `seaLevelM + this`; cells already below it (collision debris landed
 * in a trench) are left in place, never lifted.
 */
export const CONTINENTAL_BUOYANCY_FLOOR_M = -2500;

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
 * Hard ceiling on the plate-SLOT table size (#127 item 7). Distinct from
 * MAX_PLATES, which bounds only the LIVE count: `riftPlate` assigns each new
 * plate `newId = plates.length` and dead slots are NEVER reclaimed (the hash
 * input stays unique per rift), so the table grows monotonically over deep
 * time. The history codec stores `plateId` as a categorical Uint8
 * (`codec.ts` LEVELS_U8 = 255), so a plate id must fit [0, 255] and the table
 * must never exceed 256 entries or the codec's per-cell assertion throws
 * mid-run. `riftPlate` refuses to mint a slot at/beyond this — a graceful skip
 * in place of that loud assertion. Source: codec.ts LEVELS_U8 + 1 = 256.
 */
export const PLATE_SLOT_CODEC_LIMIT = 256;

/**
 * Warn margin below PLATE_SLOT_CODEC_LIMIT (#127 item 7): the step whose rift
 * first grows the slot table to this size emits one `plateSlotPressure` event,
 * a heads-up in the event log ~32 slots before the codec ceiling. The measured
 * deep-time slot peak is 176 across seeds/grids over 4.5 Gyr (≥31 % headroom),
 * so this is dormant on shipped worlds; it exists to make a pathological,
 * ceiling-approaching config visible long before the hard limit bites.
 */
export const PLATE_SLOT_WARN_COUNT = 224;

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
// LEGACY (flag-off `--no-emergent-suture` spine only since
// KERNEL_BEHAVIOR_VERSION 17 / stage-5 promotion): the promoted default runs
// `emergentSuture`, which *detects* the kinematic stall (net-signed shortening
// integral) instead of scheduling the merge on this fixed countdown. Still read
// on the flag-off path (and as the scaling anchor for the derived stall/timeout
// windows), so kept. The post-rift RIFT_SUTURE_COOLDOWN_YEARS lock is unchanged
// and remains active on the promoted default.
export const SUTURE_AFTER_YEARS = 60e6;

/** Minimum simultaneous cont-cont convergent boundary cells to count as contact. */
export const SUTURE_MIN_CONTACT_CELLS = 3;

/**
 * Tectonics V2 stage 2 (`emergentSuture`, #112, proposal §2.3/§2.4). Under
 * `forceKinematics` a continent–continent collision damps its own closing
 * speed toward zero in ~10–20 Myr; these constants let wilson *detect* that
 * death instead of scheduling it on the `SUTURE_AFTER_YEARS` countdown.
 *
 * A cont–cont contact is "stalled" when its *net* closing rate — the mean over
 * the pair's continental-adjacency cells of the SIGNED `boundaryStress` (m/yr,
 * + convergent), accumulated into a shortening integral and divided by the
 * elapsed window — stays below this threshold in magnitude. The net signed sum
 * (shortening-integral fallback, #112, proposal §2.4) replaced a first cut that
 * used the per-cell |speed| mean: under advection-quantum jitter that magnitude
 * mean has a noise floor that never falls below 2 mm/yr, so it measured DEAD (0
 * stalls across the acceptance grid, every suture via the 150 Myr timeout). The
 * signed sum lets jitter cancel over the contact, so a genuinely stopped
 * collision reads a net rate ≈0 even while per-cell speeds are noisy; a
 * separating pair reads a large NEGATIVE net rate and never stalls. 2 mm/yr is
 * an order below plate speeds (cm/yr) and below the 5 mm/yr
 * `ACTIVE_MARGIN_STRESS_M_PER_YR` active-margin gate — a boundary whose net
 * motion is this slow is a dead collision, not a live one. Only used when
 * `emergentSuture` is on; the flag-off path keeps the `SUTURE_AFTER_YEARS`
 * countdown byte-for-byte.
 */
export const SUTURE_STALL_SPEED_M_PER_YR = 0.002;

/**
 * `emergentSuture`: the tumbling stall-window width (#112, proposal §2.3/§2.4).
 * A cont–cont pair sutures once a full window this long has elapsed whose
 * average |net closing rate| stayed below `SUTURE_STALL_SPEED_M_PER_YR`. The
 * window is evaluated only at its boundary — the net closing is summed across
 * the whole 20 Myr before the rate test, so a lone jittering step cannot reset
 * the clock (the robustness the instantaneous criterion lacked). A window whose
 * average rate reaches threshold re-arms the anchor and starts a fresh window.
 * 20 Myr is bookkeeping on an already-dead boundary, not a countdown on a live
 * one — collision damping has stopped the plates well before this fires. The
 * derived reset tolerance is `SUTURE_STALL_SPEED_M_PER_YR × SUTURE_STALL_AFTER_
 * YEARS` (≈40 km of net shortening per window); no independent tuned constant.
 */
export const SUTURE_STALL_AFTER_YEARS = 2e7;

/**
 * `emergentSuture` stall gross-motion gate, m/yr (#127 item 2.2,
 * TECTONICS_V2_REVIEW_FINDINGS §2.2). The net-closing stall test above is
 * SIGN-BLIND to how the ≈0 net arose: a shearing continental transform (normal
 * motion ≈0, large tangential slip) and a mixed convergent/divergent contact
 * (a boundary rotating about a nearby pole, whose signed segments cancel) both
 * read net≈0 and used to weld as "stalled" after only 20 Myr — a merge class
 * impossible on the pre-V2 kernel. A genuinely stalled head-on collision is
 * near-COMOVING: its mean gross relative speed |v_own − v_other| → 0 (collision
 * damping kills the normal closing; a head-on pair has no tangential slip). A
 * transform or a rotating contact keeps a relative speed at plate scale
 * (cm/yr). Gate the stall on the mean gross speed staying below this — a genuine
 * lock passes, the two false classes do not. |v_rel| is a pure Euler-pole
 * function (no advection jitter), so this reads instantaneously without the
 * windowing the net-closing test needs. The loud SUTURE_TIMEOUT_YEARS backstop
 * is deliberately NOT gated: a contact that persists 150 Myr merges regardless,
 * so a long-lived head-on grind still sutures (tagged). Set an order below plate
 * speeds and just above the ACTIVE_MARGIN_STRESS 5 mm/yr active gate, so only
 * clearly-moving (shearing / rotating) contacts are refused.
 */
export const SUTURE_SHEAR_MAX_M_PER_YR = 0.008;

/**
 * `emergentSuture` loud backstop (margin-ledger graft, #112, proposal §2.3):
 * if a continental contact persists this long *without* ever stalling long
 * enough, merge anyway and emit a distinct `sutureTimeout` event. This surfaces
 * the stall-never-fires failure mode (a plate driven by a remote slab that
 * keeps a collision closing indefinitely) in the event log instead of as a
 * silent full-speed grind. Each `sutureTimeout` is a documented stall-criterion
 * miss to investigate; the gate keeps them rare.
 */
export const SUTURE_TIMEOUT_YEARS = 1.5e8;

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
// LEGACY (flag-off `--no-tension-rift` spine only since KERNEL_BEHAVIOR_VERSION
// 17 / stage-5 promotion): the promoted default runs `tensionRift`, which
// deletes the maturity age gate. Kept because the pinned legacy tests still
// exercise the size-ramp trigger path.
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
// LEGACY (flag-off `--no-tension-rift` spine only since KERNEL_BEHAVIOR_VERSION
// 17 / stage-5 promotion): `tensionRift` replaces this flat base rate × size
// ramp with a physical λ = RIFT_HAZARD_AT_REF_PER_MYR × tension² × blanket. Kept
// for the pinned legacy tests.
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
// LEGACY (flag-off `--no-tension-rift` spine only since KERNEL_BEHAVIOR_VERSION
// 17 / stage-5 promotion): the whole size-ramp trigger is superseded by the
// tension²+blanket hazard on the promoted default path. The carve machinery it
// fed is unchanged; only the *trigger* moved. Kept for the pinned legacy tests.
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
// LEGACY (flag-off `--no-tension-rift` spine only since KERNEL_BEHAVIOR_VERSION
// 17 / stage-5 promotion): under `tensionRift` a fragment inherits the parent's
// ω⃗/pole and the halves separate on ridge push, so the perpendicular
// translating-pole construction and this ocean-seeking azimuth fan
// (RIFT_AZIMUTH_CANDIDATES / RIFT_OCEAN_SCAN_RAD / RIFT_OCEAN_SCAN_SAMPLES) go
// dead on the default path. Kept for the pinned legacy tests.
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

// --- Biosphere: ocean life & oxygenation (#37, Phase 4) ---------------------
// The first life systems. Abiogenesis is a gated-stochastic onset (a seeded
// Bernoulli trial per step, conditional on a liquid-ocean temperature window),
// so *when* life starts is seed/climate-dependent; everything after is
// deterministic reservoir dynamics (spec §7.2). Marine photosynthetic
// productivity (`marineLife`, a fast per-ocean-cell diagnostic) drives a
// well-mixed atmospheric O₂ reservoir (`globals.oxygen`, in present-atmospheric-
// level units) that accumulates only as fast as productivity × organic burial
// outpaces oxidative sinks, and only after a reduced-species buffer
// (`globals.oxygenReductant`) is oxidized — an anoxic latency then an S-curve,
// so the **Great Oxidation emerges** (the `oxygen` crossing of
// GOE_THRESHOLD_PAL) rather than being scripted. The starting values below are
// the Milestone-0 recommendations (docs/spikes/PHASE_4_SPIKES.md), which
// measured this model over the golden seeds to 4.5 Gyr: an emergent,
// seed-dependent, reliably-completing S-curve; a stable coupled loop (O₂
// bounded, no runaway); and visibly different life stories per seed. Rates are
// per Myr, so at the default 1 Myr step they are per-step increments (dt-correct
// — a coarser `stepYears` rescales the increment, not the trajectory).

/**
 * Anoxic starting O₂, in present-atmospheric-level (PAL) units — a fraction of
 * the modern O₂ partial pressure. ~0 (Archean-like): the atmosphere is reducing
 * until photosynthesis and the reductant buffer let O₂ accumulate. Seeds
 * `globals.oxygen` at init (the `initialOxygenPAL` param default).
 */
export const INITIAL_OXYGEN_PAL = 1e-6;

/**
 * Abiogenesis onset hazard, per year — the per-year rate of the gated Bernoulli
 * trial, converted to a per-step probability `1 − exp(−rate·dt)` and multiplied
 * by the liquid-ocean habitable fraction. 8e-9/yr puts expected onset on a
 * ~10²-Myr scale on a warm ocean world, so life reliably originates well inside
 * deep time yet its timing varies with each seed's early climate. Seeds the
 * `abiogenesisRatePerYear` param default; tests raise it to force prompt onset.
 */
export const ABIOGENESIS_RATE_PER_YR = 8e-9;

/**
 * Gross photosynthetic O₂ produced per unit mean marine productivity, PAL/Myr.
 * The source term's scale: at typical productivity Π≈0.2 the gross source is
 * `0.1·0.2 = 0.02 PAL/Myr`, of which BURIAL_FRACTION survives respiration.
 */
export const OXY_SOURCE_PAL_PER_MYR = 0.1;

/**
 * Fraction of photosynthetic organic carbon that is BURIED (net O₂ that survives
 * aerobic respiration/remineralization). Photosynthesis `CO₂ + H₂O → CH₂O + O₂`
 * only leaves free O₂ behind when the reduced carbon is sequestered; the rest
 * back-reacts. 0.3 is the net-burial fraction the O₂ budget keys off (spec §5
 * redox invariant: accumulated O₂ ties to organic carbon buried). NOTE: #37
 * tracks only the O₂ side of this pair — the matching CO₂ drawdown of the buried
 * carbon is NOT subtracted from `globals.co2` (the carbon thermostat is
 * unchanged), so the O₂ budget is self-contained; wiring organic burial back into
 * the carbon cycle is deferred beyond this milestone.
 */
export const BURIAL_FRACTION = 0.3;

/**
 * Volcanic/mantle reductant draw on O₂ at the reference tectonic activity,
 * PAL/Myr — reduced volcanic gases (H₂, CO, H₂S) that consume O₂. Scaled by the
 * tectonic-activity ratio (`tectonicActivity / CO2_OUTGAS_ACTIVITY_REF_M_PER_YR`,
 * the #34 outgassing proxy), so a vigorous world degasses more reductant. This
 * is the sink the gross source must outpace before net O₂ is positive — the
 * seed-dependent lever on GOE timing.
 */
export const OXY_VOLC_SINK_PAL_PER_MYR = 0.002;

/**
 * Oxidative-sink rate, per Myr — O₂ removal proportional to O₂ itself
 * (oxidative weathering of crust, the dominant modern sink). It sets the
 * plateau: at steady state `oxygen ≈ net_source / OXY_OX_SINK_PER_MYR`. NOTE
 * (M0 caution 1): mean productivity Π — hence the plateau — is grid-sensitive
 * (a cell-count mean over ocean cells: ~1.5 PAL at N=16, ~2.2 PAL at N=32/128),
 * so the absolute plateau runs ~2× modern; raise this toward ~0.008 to centre
 * it near 1 PAL if an Earth-like absolute O₂ level matters. It does not affect
 * the qualitative S-curve or the events, which key off relative thresholds.
 */
export const OXY_OX_SINK_PER_MYR = 0.004;

/**
 * Reduced-species buffer to oxidize before atmospheric O₂ can rise, PAL — the
 * reservoir `globals.oxygenReductant` starts at. Net positive O₂ flux first
 * fills the atmosphere's oxygen demand of the reduced early crust/mantle
 * (banded-iron-formation-scale sinks); only once this buffer is spent does O₂
 * accumulate. This is the physical origin of the anoxic latency BETWEEN
 * abiogenesis and the Great Oxidation (M0 Q1) — without it O₂ would rise the
 * instant life appears, collapsing the S-curve into a step. NOT a param: a fixed
 * planetary property for Phase 4.
 */
export const REDUCTANT_BUFFER_PAL = 1.0;

/**
 * Defensive upper bound on the O₂ reservoir, PAL — a runaway tripwire, not a
 * physical target. The oxidative sink holds O₂ near ~2 PAL on default params
 * (M0: max ~2.35, never near this), so this clamp only guards a pathological
 * parameterization from producing a non-representable value. Mirrors the
 * `CO2_MAX_PPM` defensive ceiling.
 */
export const OXYGEN_MAX_PAL = 5;

/**
 * Great Oxidation threshold, PAL: the `oxygen` level whose first crossing emits
 * the `greatOxidation` event. 0.01 (≈1% PAL) is the order of the real GOE's
 * atmospheric step (from <10⁻⁵ PAL to ~10⁻²–10⁻¹ PAL, ~2.4 Ga). Well below the
 * ~2 PAL plateau, so the reservoir crosses it once, monotonically, on the way
 * up (the reductant buffer guarantees a clean one-way rise), firing the event
 * exactly once.
 */
export const GOE_THRESHOLD_PAL = 0.01;

/**
 * Marine photosynthetic productivity temperature window (a Gaussian in surface
 * temperature, zeroed outside [MIN, MAX]), K. Life needs liquid water and peaks
 * in warm-but-not-scalding seas: optimum ~20 °C, width ~22 K, cut off below
 * freezing and above ~50 °C. Shapes the per-cell `marineLife` diagnostic and,
 * via the [MIN, MAX] band, the ocean-habitability gate on abiogenesis onset.
 */
export const PROD_TEMP_OPT_K = 293;
export const PROD_TEMP_WIDTH_K = 22;
export const PROD_TEMP_MIN_K = 273;
export const PROD_TEMP_MAX_K = 323;

/**
 * Shelf/upwelling nutrient proxy for marine productivity (spec §6: a simplified
 * proxy, not a closed nutrient cycle). Productivity is nutrient-limited and
 * richest over shallow continental shelves, so the proxy ramps from
 * MARINE_NUTRIENT_MIN in the deep abyss (depth ≥ SHELF_DEPTH_M below sea level)
 * to 1 at the coastline: `nutrient = clamp(1 − depth/SHELF_DEPTH_M, MIN, 1)`.
 */
export const MARINE_NUTRIENT_SHELF_DEPTH_M = 6000;
export const MARINE_NUTRIENT_MIN = 0.25;

/** Default simulation step, years. Chosen so 10 steps fit one keyframe interval. */
export const DEFAULT_STEP_YEARS = 1e6;

/** Default keyframe interval, years (SCAFFOLD_SPEC 2.4). */
export const DEFAULT_KEYFRAME_INTERVAL_YEARS = 10e6;

/* ------------------------------------------------------------------------- *
 * Crustal-column model (docs/CRUSTAL_COLUMN_PROPOSAL.md, the `crustalColumns`
 * mechanism): the kernel's first densities. `crustalThicknessM` is the primary
 * vertical state for continental crust; surface elevation is derived by Airy
 * isostasy over a fixed datum (isostasy.ts). The oceanic branch keeps the
 * empirical age-depth machinery — these constants never re-derive it (trap T1).
 * ------------------------------------------------------------------------- */

/** Mean continental crustal density, kg/m³. Christensen & Mooney 1995 (JGR
 *  100): velocity-derived global average ≈2835 at mean thickness 39.2 km. */
export const CRUST_DENSITY_CONTINENTAL_KG_M3 = 2830;

/** Mature oceanic crust bulk density, kg/m³. Carlson & Raskin 1984 (Nature
 *  311): 2890 ± 40. v1 use: mass-ledger accounting only — oceanic ELEVATION
 *  stays the empirical age-depth curve (proposal §2.4). */
export const CRUST_DENSITY_OCEANIC_KG_M3 = 2900;

/** Uppermost lithospheric mantle density, kg/m³ (Turcotte & Schubert,
 *  Geodynamics — standard value). */
export const MANTLE_DENSITY_KG_M3 = 3300;

/** Standard seawater density, kg/m³. v1 use: documents the hydro-isostasy
 *  error bound (proposal §2.4 — the dry continental branch is deliberate);
 *  no v1 consumer in the derivation itself. */
export const SEAWATER_DENSITY_KG_M3 = 1030;

/** Compacted shelf sediment bulk density, kg/m³ (Hamilton 1976: 2200–2500
 *  typical) — the sediment↔crust mass conversion in the ledger. */
export const SEDIMENT_DENSITY_KG_M3 = 2400;

/** Normal oceanic crust thickness, m: 7.1 ± 0.8 km (White, McKenzie &
 *  O'Nions 1992, JGR 97). Every oceanic cell's `crustalThicknessM`. */
export const OCEANIC_CRUST_THICKNESS_M = 7100;

/** Global mean continental crustal thickness, m: 39.2 km (Christensen &
 *  Mooney 1995). One of the two anchors pinning the continental datum. */
export const CONTINENTAL_REFERENCE_THICKNESS_M = 39000;

/** The t=0 construction's mean continental elevation, m (measured 380–450
 *  across the golden seeds — the same anchor FREEBOARD_TARGET_M used). The
 *  second datum anchor: the reference column stands at this elevation. */
export const CONTINENTAL_REFERENCE_ELEVATION_M = 400;

/** Gravitational-collapse thickness ceiling, m: Tibet ~70–75 km is Earth's
 *  sustained maximum (England & Houseman 1989; Rey, Teyssier & Whitney 2001).
 *  Replaces the elevation caps at stage C3 (proposal §6); unused by the C1
 *  shims, declared here with the model it belongs to. */
export const CONTINENTAL_THICKNESS_MAX_M = 70000;

/** Root-decay equilibrium thickness, m — deliberately the reference thickness
 *  (one anchor, two roles; proposal §2.3). Stage C3's relaxation target. */
export const CONTINENTAL_THICKNESS_EQUILIBRIUM_M = 39000;

/** Process floor for thinning/foundering, m: below ~20 km real crust is
 *  hyperextended-margin domain transitioning to oceanic (Reston 2009 measures
 *  <10 km at breakup; deliberately conservative — proposal §8 T2). Activates
 *  as a structural floor at stage C5. */
export const CONTINENTAL_THICKNESS_MIN_M = 20000;

/** Island-arc → continental maturation thickness, m: arc crust develops
 *  continental-type middle crust from ~20 km (Suyehiro et al. 1996, Izu-Bonin;
 *  Calvert 2011). DELIBERATELY equal to CONTINENTAL_THICKNESS_MIN_M — the
 *  identity floor and the creation gate are one number (proposal §2.3).
 *  Re-keys the maturation gate at stage C4. */
export const ARC_MATURATION_THICKNESS_M = 20000;

/** v1 rift-margin stretch budget β (McKenzie 1978: typical passive margins
 *  β ≈ 1.2–2). Margins thin toward CONTINENTAL_REFERENCE_THICKNESS_M / β
 *  = 30 km — a finite stop, never the identity floor (the T2 unbounded-grind
 *  shape; proposal §5 site 21). Active since stage C6: the site-21
 *  rift-margin thinning in freeboard.ts (the model's last shim retired). */
export const MARGIN_STRETCH_FACTOR = 1.3;

/**
 * Continental buoyancy per metre of crustal thickness (dimensionless):
 * k = 1 − ρ_crust/ρ_mantle ≈ 0.1424. Airy isostasy: adding 1 km of column
 * lifts the surface k·1000 ≈ 142 m (erode 1 km, the surface drops the same —
 * the 1:7 erosion-rebound factor, proposal §2.3 closure check 1). Derived
 * expression, not a literal, so the derivation stays legible.
 */
export const CONTINENTAL_BUOYANCY_FACTOR =
  1 - CRUST_DENSITY_CONTINENTAL_KG_M3 / MANTLE_DENSITY_KG_M3;

/**
 * The continental isostasy datum, m: the elevation of a zero-thickness column
 * in kernel coordinates — the model's ONE fitted constant, pinned by the two
 * cited anchors (Earth's mean 39 km column ↦ the t=0 construction's +400 m):
 * C = 400 − k·39000 ≈ −5154.5 m. A FIXED constant, never dynamic — it does
 * not read sea level, which is what keeps the derivation T1-safe by
 * construction (proposal §2.3/§8).
 */
export const CONTINENTAL_ISOSTASY_DATUM_M =
  CONTINENTAL_REFERENCE_ELEVATION_M -
  CONTINENTAL_BUOYANCY_FACTOR * CONTINENTAL_REFERENCE_THICKNESS_M;
