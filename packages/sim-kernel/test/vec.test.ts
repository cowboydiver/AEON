import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/grid';
import { dot3, perpendicular3 } from '../src/vec';

describe('perpendicular3', () => {
  const cases: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
    [3, -4, 0],
    [0.001, 0, 5], // strongly z-aligned: least-aligned axis matters
    [-2, 7, -0.5],
  ];

  it('returns a unit vector orthogonal to the input', () => {
    for (const v of cases) {
      const p = perpendicular3(v);
      expect(dot3(p, p)).toBeCloseTo(1, 12); // unit length
      expect(dot3(p, v)).toBeCloseTo(0, 12); // orthogonal
    }
  });

  it('is deterministic (pure function of the input)', () => {
    for (const v of cases) expect(perpendicular3(v)).toEqual(perpendicular3(v));
  });
});
