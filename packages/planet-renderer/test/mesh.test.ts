import { describe, expect, it } from 'vitest';
import { cellCount, createInitialState, createPlanetParams, faceSTToDirection } from 'sim-kernel';
import { createFaceGeometry } from '../src/mesh';
import { createPlanetTextures, uploadKeyframe } from '../src/textures';

describe('createFaceGeometry', () => {
  it('places vertices on the unit sphere using the kernel grid mapping', () => {
    const N = 8;
    for (const face of [0, 3, 5]) {
      const geometry = createFaceGeometry(face, N);
      const positions = geometry.getAttribute('position');
      expect(positions.count).toBe((N + 1) * (N + 1));

      for (let row = 0; row <= N; row += 4) {
        for (let col = 0; col <= N; col += 4) {
          const vi = row * (N + 1) + col;
          const expected = faceSTToDirection(face, (col / N) * 2 - 1, (row / N) * 2 - 1);
          expect(positions.getX(vi)).toBeCloseTo(expected[0], 6);
          expect(positions.getY(vi)).toBeCloseTo(expected[1], 6);
          expect(positions.getZ(vi)).toBeCloseTo(expected[2], 6);
          expect(
            Math.hypot(positions.getX(vi), positions.getY(vi), positions.getZ(vi)),
          ).toBeCloseTo(1, 6);
        }
      }
      expect(geometry.getIndex()!.count).toBe(N * N * 6);
    }
  });
});

describe('uploadKeyframe', () => {
  it('packs each contiguous face slice of the kernel field into its texture', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16 });
    const state = createInitialState(params);
    const textures = createPlanetTextures(params.gridN);
    uploadKeyframe(textures, state.fields);

    const perFace = params.gridN * params.gridN;
    expect(state.fields.elevation.length).toBe(cellCount(params.gridN));
    for (let face = 0; face < 6; face++) {
      const data = textures.elevation[face]!.image.data as Float32Array;
      expect(data.length).toBe(perFace);
      expect(data[0]).toBe(state.fields.elevation[face * perFace]);
      expect(data[perFace - 1]).toBe(state.fields.elevation[(face + 1) * perFace - 1]);
      // needsUpdate is a write-only setter that bumps version.
      expect(textures.elevation[face]!.version).toBeGreaterThan(0);
    }
  });
});
