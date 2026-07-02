/** Physical and simulation constants. Each carries its source. */

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
 * Island-arc crust growth rate at reference convergence, m/yr. Arcs climb
 * from abyssal depth toward the surface over ~20-30 Myr of subduction
 * (order of real arc construction timescales).
 */
export const ARC_GROWTH_RATE_M_PER_YR = 2e-4;

/** Ceiling for volcanic-arc elevation, m (island arcs, not continents). */
export const ARC_MAX_ELEVATION_M = 1000;

/**
 * An arc that has built above this elevation matures into continental
 * crust. Arc magmatism is how Earth manufactures continental crust; this is
 * also the counterweight to collision consuming continental area — without
 * it, long runs slowly lose land (seed-1337 N=16 dipped below the 10% land
 * invariant at ~1.3 Gyr).
 */
export const ARC_MATURATION_ELEVATION_M = -200;

// --- Wilson cycles (#18) -----------------------------------------------------

/** Live-plate count bounds: sutures pause at the floor, rifts at the ceiling. */
export const MIN_PLATES = 6;
export const MAX_PLATES = 16;

/**
 * Continuous continent-continent convergent contact required before the two
 * plates suture into one, yr. Real collision-to-suture times are a few tens
 * of Myr (India-Asia order).
 */
export const SUTURE_AFTER_YEARS = 25e6;

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
 */
export const RIFT_MIN_CONTINENTAL_AREA_FRACTION = 0.05;

/**
 * Rift probability per eligible plate per Myr. 0.004 gives an expected wait
 * of ~250 Myr once a plate is large, old and continental — supercontinents
 * linger, then break (real Wilson cycle periods are 300-500 Myr).
 */
export const RIFT_PROBABILITY_PER_MYR = 0.004;

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
