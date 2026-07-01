import { PNG } from 'pngjs';
import { directionToIndex, type FieldName, type Vec3 } from 'sim-kernel';

/**
 * Equirectangular field rendering: for each pixel, latitude/longitude ->
 * direction -> nearest cube-sphere cell. Grayscale over the field's min/max,
 * except elevation which gets a hypsometric tint (blues below the datum,
 * green -> brown -> white above).
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

export function renderFieldPng(
  fieldName: FieldName,
  field: Float32Array,
  gridN: number,
): PNG {
  const png = new PNG({ width: DUMP_WIDTH, height: DUMP_HEIGHT });
  const { min, max } = fieldStats(field);
  const span = max - min;

  for (let y = 0; y < DUMP_HEIGHT; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / DUMP_HEIGHT) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let x = 0; x < DUMP_WIDTH; x++) {
      const lon = -Math.PI + ((x + 0.5) / DUMP_WIDTH) * 2 * Math.PI;
      const dir: Vec3 = [cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon)];
      const value = field[directionToIndex(dir, gridN)]!;

      let rgb: Rgb;
      if (fieldName === 'elevation') {
        rgb = hypsometricColor(value, min, max);
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
