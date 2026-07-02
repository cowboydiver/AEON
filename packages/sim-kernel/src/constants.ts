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

/** Default simulation step, years. Chosen so 10 steps fit one keyframe interval. */
export const DEFAULT_STEP_YEARS = 1e6;

/** Default keyframe interval, years (SCAFFOLD_SPEC 2.4). */
export const DEFAULT_KEYFRAME_INTERVAL_YEARS = 10e6;
