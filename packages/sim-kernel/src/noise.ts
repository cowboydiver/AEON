import { hash3 } from './hash';

/**
 * 3D value noise built on the integer position hash: lattice corners get
 * hash3-derived values in [0, 1), blended with a quintic fade (Perlin's
 * 6t^5 - 15t^4 + 10t^3) for C2-continuous trilinear interpolation.
 */

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function corner(seed: number, x: number, y: number, z: number): number {
  return hash3(seed, x, y, z) / 4294967296;
}

/** Single-octave value noise in [0, 1). */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);

  const c000 = corner(seed, x0, y0, z0);
  const c100 = corner(seed, x0 + 1, y0, z0);
  const c010 = corner(seed, x0, y0 + 1, z0);
  const c110 = corner(seed, x0 + 1, y0 + 1, z0);
  const c001 = corner(seed, x0, y0, z0 + 1);
  const c101 = corner(seed, x0 + 1, y0, z0 + 1);
  const c011 = corner(seed, x0, y0 + 1, z0 + 1);
  const c111 = corner(seed, x0 + 1, y0 + 1, z0 + 1);

  return lerp(
    lerp(lerp(c000, c100, tx), lerp(c010, c110, tx), ty),
    lerp(lerp(c001, c101, tx), lerp(c011, c111, tx), ty),
    tz,
  );
}

/**
 * Fractal (fBm) value noise: `octaves` octaves, lacunarity 2, gain 0.5, each
 * octave under a different derived seed so lattice artifacts don't align.
 * Normalized back to ~[0, 1).
 */
export function fractalNoise3(
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves: number,
): number {
  let sum = 0;
  let amplitude = 1;
  let totalAmplitude = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise3((seed + o * 0x9e3779b9) | 0, x * frequency, y * frequency, z * frequency);
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / totalAmplitude;
}
