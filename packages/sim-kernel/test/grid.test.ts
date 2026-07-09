import { describe, expect, it } from 'vitest';
import {
  cellCenterDirection,
  cellCount,
  cellSolidAngleTable,
  directionToIndex,
  eastNorthTable,
  faceRCToIndex,
  faceSTToDirection,
  indexToFaceRC,
  neighbors,
  type Vec3,
} from '../src/grid';

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Van Oosterom–Strackee solid angle of a spherical triangle (unit vectors). */
function triSolidAngle(a: Vec3, b: Vec3, c: Vec3): number {
  const numerator = Math.abs(dot(a, cross(b, c)));
  const denominator = 1 + dot(a, b) + dot(b, c) + dot(a, c);
  return 2 * Math.atan2(numerator, denominator);
}

describe('index math', () => {
  it('cellCount is 6 N^2', () => {
    expect(cellCount(8)).toBe(384);
    expect(cellCount(128)).toBe(98_304);
  });

  it('eastNorthTable gives an orthonormal, correctly-oriented tangent frame', () => {
    const N = 8;
    const t = eastNorthTable(N);
    for (let i = 0; i < cellCount(N); i++) {
      const up = cellCenterDirection(i, N);
      const east: Vec3 = [t[i * 6]!, t[i * 6 + 1]!, t[i * 6 + 2]!];
      const north: Vec3 = [t[i * 6 + 3]!, t[i * 6 + 4]!, t[i * 6 + 5]!];
      // Unit length and mutually orthogonal (with up too).
      expect(Math.hypot(...east)).toBeCloseTo(1, 12);
      expect(Math.hypot(...north)).toBeCloseTo(1, 12);
      expect(dot(east, north)).toBeCloseTo(0, 12);
      expect(dot(east, up)).toBeCloseTo(0, 12);
      expect(dot(north, up)).toBeCloseTo(0, 12);
      // east lies in the equatorial plane (no pole-axis component); north points
      // toward the +y pole (increasing latitude); right-handed east × up = north.
      expect(east[1]).toBeCloseTo(0, 12);
      expect(north[1]).toBeGreaterThanOrEqual(-1e-12);
      const eXup = cross(east, up);
      expect(dot(eXup, north)).toBeCloseTo(1, 12);
    }
  });

  it('indexToFaceRC and faceRCToIndex are inverses over the whole grid', () => {
    const N = 8;
    for (let i = 0; i < cellCount(N); i++) {
      const [face, row, col] = indexToFaceRC(i, N);
      expect(face).toBeGreaterThanOrEqual(0);
      expect(face).toBeLessThan(6);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(N);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(N);
      expect(faceRCToIndex(face, row, col, N)).toBe(i);
    }
  });
});

describe('cellCenterDirection', () => {
  it('returns unit vectors for every cell at N=8', () => {
    const N = 8;
    for (let i = 0; i < cellCount(N); i++) {
      const d = cellCenterDirection(i, N);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
    }
  });

  it('face centers point along their axes', () => {
    const N = 2; // center of a 2x2 face is the face center only in the limit;
    // use faceSTToDirection directly for the exact face centers instead.
    expect(faceSTToDirection(0, 0, 0)).toEqual([1, 0, 0]);
    expect(faceSTToDirection(1, 0, 0)).toEqual([-1, 0, 0]);
    expect(faceSTToDirection(2, 0, 0)).toEqual([0, 1, 0]);
    expect(faceSTToDirection(3, 0, 0)).toEqual([0, -1, 0]);
    expect(faceSTToDirection(4, 0, 0)).toEqual([0, 0, 1]);
    expect(faceSTToDirection(5, 0, 0)).toEqual([0, 0, -1]);
    expect(cellCount(N)).toBe(24);
  });

  it('all cell centers are distinct directions (no seam overlap)', () => {
    const N = 8;
    const seen = new Set<string>();
    for (let i = 0; i < cellCount(N); i++) {
      const d = cellCenterDirection(i, N);
      const key = d.map((c) => c.toFixed(9)).join(',');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('directionToIndex', () => {
  it('round-trips every cell center at N=8 and N=16', () => {
    for (const N of [8, 16]) {
      for (let i = 0; i < cellCount(N); i++) {
        expect(directionToIndex(cellCenterDirection(i, N), N)).toBe(i);
      }
    }
  });
});

describe('neighbors', () => {
  it('every cell has exactly 4 distinct neighbors, none itself, at N=8', () => {
    const N = 8;
    for (let i = 0; i < cellCount(N); i++) {
      const ns = neighbors(i, N);
      expect(ns).toHaveLength(4);
      expect(new Set(ns).size).toBe(4);
      expect(ns).not.toContain(i);
      for (const j of ns) {
        expect(j).toBeGreaterThanOrEqual(0);
        expect(j).toBeLessThan(cellCount(N));
      }
    }
  });

  it('is symmetric for ALL cells at N=8, corners included', () => {
    const N = 8;
    for (let i = 0; i < cellCount(N); i++) {
      for (const j of neighbors(i, N)) {
        expect(neighbors(j, N), `neighbors(${j}) must contain ${i}`).toContain(i);
      }
    }
  });

  it('is symmetric at N=3 too (odd, tiny — stresses corner mapping)', () => {
    const N = 3;
    for (let i = 0; i < cellCount(N); i++) {
      const ns = neighbors(i, N);
      expect(new Set(ns).size).toBe(4);
      for (const j of ns) {
        expect(neighbors(j, N)).toContain(i);
      }
    }
  });

  it('neighbors are geometrically close: ~one cell of arc apart', () => {
    const N = 8;
    // Max angular step between adjacent cell centers, with slack for the
    // corner-adjacent seam cells where centers sit closer/farther.
    const maxArc = (Math.PI / 2 / N) * 2.1;
    for (let i = 0; i < cellCount(N); i++) {
      const a = cellCenterDirection(i, N);
      for (const j of neighbors(i, N)) {
        const b = cellCenterDirection(j, N);
        const arc = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
        expect(arc, `cells ${i} and ${j} too far apart`).toBeLessThan(maxArc);
        expect(arc).toBeGreaterThan(0);
      }
    }
  });
});

describe('area coverage', () => {
  it('per-cell solid angles sum to 4π within 1% (and per-cell within 35% of mean)', () => {
    const N = 8;
    let total = 0;
    const mean = (4 * Math.PI) / cellCount(N);
    for (let i = 0; i < cellCount(N); i++) {
      const [face, row, col] = indexToFaceRC(i, N);
      const s0 = (col / N) * 2 - 1;
      const s1 = ((col + 1) / N) * 2 - 1;
      const t0 = (row / N) * 2 - 1;
      const t1 = ((row + 1) / N) * 2 - 1;
      const a = faceSTToDirection(face, s0, t0);
      const b = faceSTToDirection(face, s1, t0);
      const c = faceSTToDirection(face, s1, t1);
      const d = faceSTToDirection(face, s0, t1);
      const omega = triSolidAngle(a, b, c) + triSolidAngle(a, c, d);
      // The tangent-adjusted mapping keeps per-cell area distortion small.
      expect(omega).toBeGreaterThan(mean * 0.65);
      expect(omega).toBeLessThan(mean * 1.35);
      total += omega;
    }
    expect(Math.abs(total - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(0.01);
  });

  it('cellSolidAngleTable matches the corner-quad formula and sums to 4π (#84)', () => {
    const N = 8;
    const table = cellSolidAngleTable(N);
    let total = 0;
    for (let i = 0; i < cellCount(N); i++) {
      const [face, row, col] = indexToFaceRC(i, N);
      const s0 = (col / N) * 2 - 1;
      const s1 = ((col + 1) / N) * 2 - 1;
      const t0 = (row / N) * 2 - 1;
      const t1 = ((row + 1) / N) * 2 - 1;
      const a = faceSTToDirection(face, s0, t0);
      const b = faceSTToDirection(face, s1, t0);
      const c = faceSTToDirection(face, s1, t1);
      const d = faceSTToDirection(face, s0, t1);
      expect(table[i]).toBeCloseTo(triSolidAngle(a, b, c) + triSolidAngle(a, c, d), 14);
      total += table[i]!;
    }
    // Spherical quads tile the sphere exactly — the sum closes to float
    // precision, not just the 1% mapping tolerance above.
    expect(Math.abs(total - 4 * Math.PI) / (4 * Math.PI)).toBeLessThan(1e-12);
  });
});
