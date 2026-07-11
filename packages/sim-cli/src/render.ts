import { PNG } from 'pngjs';
import { directionToIndex, type Vec3 } from 'sim-kernel';

/**
 * Equirectangular field rendering: for each pixel, latitude/longitude ->
 * direction -> nearest cube-sphere cell. Style is chosen per field via
 * RENDER_HINTS: hypsometric tint for elevation, categorical golden-angle
 * palette for plateId, sequential ramp (young = bright) for crustAge,
 * diverging blue-white-red for boundaryStress, grayscale for the rest.
 */

export const DUMP_WIDTH = 512;
export const DUMP_HEIGHT = 256;

type Rgb = [number, number, number];

function lerpColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Piecewise-linear ramp over [0,1]. Stops must be sorted by position. */
function ramp(stops: readonly (readonly [number, Rgb])[], t: number): Rgb {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let k = 1; k < stops.length; k++) {
    const [p1, c1] = stops[k]!;
    if (t <= p1) {
      const [p0, c0] = stops[k - 1]!;
      return lerpColor(c0, c1, (t - p0) / (p1 - p0));
    }
  }
  return stops[stops.length - 1]![1];
}

const OCEAN_STOPS = [
  [0, [8, 16, 64]],
  [0.6, [24, 60, 140]],
  [1, [110, 170, 220]],
] as const satisfies readonly (readonly [number, Rgb])[];

const LAND_STOPS = [
  [0, [34, 120, 56]],
  [0.35, [130, 156, 72]],
  [0.65, [150, 110, 66]],
  [0.85, [130, 120, 120]],
  [1, [245, 245, 245]],
] as const satisfies readonly (readonly [number, Rgb])[];

/** Hypsometric tint for elevation in meters. */
export function hypsometricColor(elevation: number, min: number, max: number): Rgb {
  if (elevation <= 0) {
    const depth = min < 0 ? Math.min(1, elevation / min) : 0; // 0 at datum, 1 at deepest
    return ramp(OCEAN_STOPS, 1 - depth);
  }
  const height = max > 0 ? Math.min(1, elevation / max) : 0;
  return ramp(LAND_STOPS, height);
}

/**
 * Per-field render style. Fields absent here fall back to grayscale, so new
 * kernel fields are dumpable before they get a bespoke palette. Field names
 * themselves still come from sim-kernel's fields.ts.
 */
// Keyed by plain string, not FieldName: plateId/boundaryStress land in the
// kernel schema in later Phase 1 issues; hints for them are inert until then.
const RENDER_HINTS: Record<string, 'hypsometric' | 'categorical' | 'sequentialReversed' | 'diverging' | 'precip' | 'ice' | 'biome' | 'life' | undefined> = {
  elevation: 'hypsometric',
  plateId: 'categorical',
  crustAge: 'sequentialReversed', // young crust = bright, per issue #11
  boundaryStress: 'diverging',
  // Signed prevailing winds (#31): diverging ramp about 0 reads the
  // easterly/westerly (windU) and equatorward/poleward (windV) band structure.
  windU: 'diverging',
  windV: 'diverging',
  // Moisture-transport precipitation (#32): a dry→wet ramp on a FIXED reference
  // (not the field's own max) so the rain shadows are not washed out by the
  // handful of very wet orographic cells — arid tan through green to wet blue.
  precipitation: 'precip',
  // Ice cover (#33), 0..1: dark open ground/ocean → white ice cap, on a FIXED
  // 0–1 scale so the caps read at the same brightness across a flipbook as they
  // advance and retreat (a per-frame min/max stretch would hide a shrinking cap).
  iceFraction: 'ice',
  // Whittaker biome class (#35): a fixed categorical palette matching the
  // renderer's, so a --dump biome PNG reads the same ecosystems the globe shows.
  biome: 'biome',
  // Marine productivity (#37), 0..1: barren dark sea → productive teal-green, on
  // a FIXED 0–1 scale so the ocean life story reads at the same brightness
  // across a flipbook (all-dark before abiogenesis, greening as productivity
  // spreads). Land is 0 → the darkest stop.
  marineLife: 'life',
};

/**
 * Whittaker biome palette, indexed by the kernel `BIOMES` code (0..7): ocean,
 * tundra, taiga, grassland, temperate forest, desert, savanna, tropical forest.
 * Mirrors `planet-renderer`'s `BIOME_COLORS` (there in 0–1, here in 0–255) so the
 * dumped field and the live globe agree; the CLASS ORDER must match `BIOMES`.
 */
const BIOME_DUMP_COLORS: readonly Rgb[] = [
  [20, 71, 128], //   0 ocean
  [140, 148, 133], // 1 tundra
  [33, 77, 51], //    2 taiga
  [133, 148, 71], //  3 grassland
  [51, 107, 51], //   4 temperate forest
  [209, 184, 122], // 5 desert
  [184, 148, 77], //  6 savanna
  [26, 115, 41], //   7 tropical forest
];

/** Look up a biome cell's colour, clamping any out-of-range code to ocean. */
export function biomeColor(id: number): Rgb {
  const k = Math.round(id);
  return BIOME_DUMP_COLORS[k] ?? BIOME_DUMP_COLORS[0]!;
}

/** Precipitation viz reference, kg/m²/yr: values at/above map to the wettest
 *  color. Fixed (not per-frame max) so dry lee / wet windward read consistently
 *  across a flipbook, and a lone 20,000 mm/yr orographic cell can't black out
 *  the desert-vs-forest structure the way a min/max grayscale stretch would. */
const PRECIP_VIZ_REF = 2500;

/** Dry → wet ramp over [0,1]: arid tan, savanna, forest green, wet blue. */
const PRECIP_STOPS = [
  [0, [200, 178, 132]],
  [0.3, [170, 175, 96]],
  [0.6, [70, 150, 84]],
  [1, [34, 94, 168]],
] as const satisfies readonly (readonly [number, Rgb])[];

/** Ice-free → ice ramp over [0,1] (#33): dark slate (no ice) through pale blue
 *  to white (full cover), so caps stand out against ocean and bare land. */
const ICE_STOPS = [
  [0, [26, 34, 48]],
  [0.5, [120, 155, 190]],
  [1, [248, 250, 255]],
] as const satisfies readonly (readonly [number, Rgb])[];

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Deterministic categorical color for small integer ids: golden-angle hue
 * steps keep any two nearby ids visually distinct; two value tiers break up
 * accidental hue near-misses between plates that end up adjacent.
 */
export function categoricalColor(id: number): Rgb {
  const k = Math.round(id);
  return hsvToRgb(k * 137.50776405003785, 0.62, k % 2 === 0 ? 0.93 : 0.68);
}

/** Sequential ramp over [0,1]: dark blue -> cyan -> pale yellow. */
const SEQUENTIAL_STOPS = [
  [0, [12, 20, 60]],
  [0.5, [40, 140, 160]],
  [1, [250, 245, 180]],
] as const satisfies readonly (readonly [number, Rgb])[];

/** Diverging ramp over [0,1] with the neutral point at 0.5 (blue-white-red). */
const DIVERGING_STOPS = [
  [0, [30, 60, 200]],
  [0.5, [245, 245, 245]],
  [1, [200, 30, 30]],
] as const satisfies readonly (readonly [number, Rgb])[];

/** Marine-productivity ramp over [0,1] (#37): near-black barren sea → deep teal
 *  → bright chlorophyll green at peak productivity. */
const LIFE_STOPS = [
  [0, [8, 18, 28]],
  [0.4, [16, 78, 92]],
  [0.75, [40, 150, 120]],
  [1, [120, 210, 90]],
] as const satisfies readonly (readonly [number, Rgb])[];

export interface FieldStats {
  min: number;
  max: number;
  mean: number;
}

export function fieldStats(field: Float32Array): FieldStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of field) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  return { min, max, mean: sum / field.length };
}

// Accepts any field name (not just FieldName) so spike prototypes can render
// candidate fields before they enter the kernel schema.
export function renderFieldPng(
  fieldName: string,
  field: Float32Array,
  gridN: number,
): PNG {
  const png = new PNG({ width: DUMP_WIDTH, height: DUMP_HEIGHT });
  const { min, max } = fieldStats(field);
  const span = max - min;
  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  const hint = RENDER_HINTS[fieldName];

  for (let y = 0; y < DUMP_HEIGHT; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / DUMP_HEIGHT) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let x = 0; x < DUMP_WIDTH; x++) {
      const lon = -Math.PI + ((x + 0.5) / DUMP_WIDTH) * 2 * Math.PI;
      const dir: Vec3 = [cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon)];
      const value = field[directionToIndex(dir, gridN)]!;

      let rgb: Rgb;
      if (hint === 'hypsometric') {
        rgb = hypsometricColor(value, min, max);
      } else if (hint === 'categorical') {
        rgb = categoricalColor(value);
      } else if (hint === 'sequentialReversed') {
        const t = span > 0 ? (value - min) / span : 0.5;
        rgb = ramp(SEQUENTIAL_STOPS, 1 - t);
      } else if (hint === 'diverging') {
        const t = maxAbs > 0 ? 0.5 + (0.5 * value) / maxAbs : 0.5;
        rgb = ramp(DIVERGING_STOPS, t);
      } else if (hint === 'precip') {
        rgb = ramp(PRECIP_STOPS, Math.min(1, Math.max(0, value / PRECIP_VIZ_REF)));
      } else if (hint === 'ice') {
        rgb = ramp(ICE_STOPS, Math.min(1, Math.max(0, value)));
      } else if (hint === 'biome') {
        rgb = biomeColor(value);
      } else if (hint === 'life') {
        rgb = ramp(LIFE_STOPS, Math.min(1, Math.max(0, value)));
      } else {
        const g = span > 0 ? ((value - min) / span) * 255 : 128;
        rgb = [g, g, g];
      }
      const o = (y * DUMP_WIDTH + x) * 4;
      png.data[o] = Math.round(rgb[0]);
      png.data[o + 1] = Math.round(rgb[1]);
      png.data[o + 2] = Math.round(rgb[2]);
      png.data[o + 3] = 255;
    }
  }
  return png;
}
