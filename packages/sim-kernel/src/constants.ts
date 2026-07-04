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
 */
export const KERNEL_BEHAVIOR_VERSION = 3;

/** IUGG mean Earth radius, m. */
export const EARTH_RADIUS_M = 6.371e6;

/** IAU 2015 nominal solar luminosity, W. */
export const SOLAR_LUMINOSITY_W = 3.828e26;

/** Modern Earth sidereal-ish day, hours. Placeholder until rotation matters. */
export const EARTH_DAY_HOURS = 24;

/** Modern Earth axial tilt, degrees. Placeholder until seasons matter. */
export const EARTH_OBLIQUITY_DEG = 23.44;

/** Global mean surface temperature of modern Earth, K (NOAA ~14 C). */
export const MEAN_SURFACE_TEMPERATURE_K = 287.15;

/** Equator-to-pole surface temperature drop, K (order of modern Earth's ~45). */
export const EQUATOR_POLE_TEMPERATURE_DROP_K = 45;

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

/**
 * Mean of sin^2(latitude) over a sphere (∫ sin^2 · cos dlat / 2 = 1/3).
 * Subtracting it centers the latitude temperature term on the global mean.
 */
export const MEAN_SIN2_LATITUDE = 1 / 3;

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
 * of Myr (India-Asia order).
 */
export const SUTURE_AFTER_YEARS = 15e6;

/** Minimum simultaneous cont-cont convergent boundary cells to count as contact. */
export const SUTURE_MIN_CONTACT_CELLS = 3;

/** A plate must be at least this old since creation/last rift to rift, yr. */
export const RIFT_MIN_AGE_YEARS = 150e6;

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
 * Rift probability per eligible plate per Myr. Gives an expected wait of
 * ~150-250 Myr once a plate is large, old and continent-carrying —
 * supercontinents linger, then break (real Wilson cycle periods are
 * 300-500 Myr). Raised from 0.004 in the #21 acceptance tuning.
 */
export const RIFT_PROBABILITY_PER_MYR = 0.006;

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
 * A plate owning more than this fraction of the sphere is oversized (#59):
 * its rift age gate (RIFT_MIN_AGE_YEARS) is waived and its per-Myr rift
 * probability is multiplied by RIFT_OVERSIZE_PROBABILITY_FACTOR. This is the
 * monopoly brake: a supercontinent's plate keeps growing by suture until one
 * plate owns ~100% of cells (plate ≠ land — land is ~20%), after which no
 * kinematics can show continents dispersing across an ocean. Physically:
 * a sphere-spanning plate has no external slab pull balancing its interior
 * heat, and real supercontinents self-break on ~100 Myr insulation
 * timescales. 0.55 keeps ordinary large plates — up to and including a clean
 * hemisphere (~50%) — on the normal draw; only genuinely monopolistic plates
 * feel the pressure, and a whole-sphere plate still drops below the
 * threshold within two fragment sheds.
 */
export const RIFT_OVERSIZE_AREA_FRACTION = 0.55;

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
 * Rift-probability multiplier for oversized plates (#59). With the base
 * 0.006/Myr draw this gives an expected shedding wait of ~20 Myr, so a
 * whole-sphere plate breaks below RIFT_OVERSIZE_AREA_FRACTION within
 * ~40-100 Myr (a few keyframes) instead of persisting for the
 * RIFT_MIN_AGE_YEARS + ~1/p ≈ 300-400 Myr normal cycle.
 */
export const RIFT_OVERSIZE_PROBABILITY_FACTOR = 8;

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
 * halt. Longer locks therefore bleed land: at 100 Myr seed 1337 fell to ~8%
 * land by 2 Gyr (below the #20 10% floor) and seed 42 to ~17%; at 30 Myr all
 * golden seeds hold their baseline ~28-33% land with no bleed, while still
 * ~tripling the dispersed-window length (~16 -> ~45 Myr, several 10-Myr
 * keyframes). Fuller "continents sail apart" drift is blocked by that grinding
 * and by whole-sphere rift kinematics, not by this constant — see
 * PHASE_2_STAGE0_FINDINGS.md.
 */
export const RIFT_SUTURE_COOLDOWN_YEARS = 30e6;

// --- Climate proxy & erosion (#19) ------------------------------------------

/**
 * Latitude-band precipitation proxy (replaced by real moisture transport in
 * Phase 3): ITCZ peak at the equator + mid-latitude storm-track bumps over a
 * dry floor, giving the classic wet-equator / dry-30° / wetter-50° / dry-pole
 * profile. Amplitudes in kg/m^2/yr (= mm/yr): equator ~1700 (tropical),
 * subtropics ~200-350 (desert belts), mid-latitudes ~800, poles ~150.
 */
export const PRECIP_ITCZ_PEAK = 1600;
export const PRECIP_ITCZ_WIDTH_DEG = 12;
export const PRECIP_STORMTRACK_PEAK = 700;
export const PRECIP_STORMTRACK_LAT_DEG = 45;
export const PRECIP_STORMTRACK_WIDTH_DEG = 16;
export const PRECIP_FLOOR = 100;

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

/** Default simulation step, years. Chosen so 10 steps fit one keyframe interval. */
export const DEFAULT_STEP_YEARS = 1e6;

/** Default keyframe interval, years (SCAFFOLD_SPEC 2.4). */
export const DEFAULT_KEYFRAME_INTERVAL_YEARS = 10e6;
