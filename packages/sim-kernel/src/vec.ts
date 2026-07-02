/** Minimal 3-vector helpers shared by grid consumers and tectonics. */

import type { Vec3 } from './grid';

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize3(v: Vec3): Vec3 {
  const inv = 1 / Math.sqrt(dot3(v, v));
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}

/** Angle between two unit vectors, radians (clamped for float safety). */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot3(a, b))));
}

/** Rodrigues rotation of v about the unit axis k by `angle` radians. */
export function rotateAroundAxis(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kd = dot3(k, v) * (1 - c);
  return [
    v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * kd,
    v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * kd,
    v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * kd,
  ];
}
