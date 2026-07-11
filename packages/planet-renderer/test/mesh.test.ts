import { DataUtils, LinearFilter, NearestFilter } from 'three';
import { describe, expect, it } from 'vitest';
import {
  cellCount,
  createInitialState,
  createPlanetParams,
  faceRCToIndex,
  faceSTToDirection,
  neighbors,
} from 'sim-kernel';
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
  const params = createPlanetParams({ seed: 42, gridN: 16 });
  const state = createInitialState(params);
  const N = params.gridN;
  const W = N + 2;
  const half = DataUtils.toHalfFloat;

  function uploaded() {
    const textures = createPlanetTextures(N);
    uploadKeyframe(textures, state.fields);
    return textures;
  }

  it('packs each face slice into the interior of its bordered texture', () => {
    const textures = uploaded();
    expect(state.fields.elevation.length).toBe(cellCount(N));
    for (let face = 0; face < 6; face++) {
      const data = textures.elevation[face]!.image.data as Uint16Array;
      expect(data.length).toBe(W * W);
      for (const [row, col] of [
        [0, 0],
        [0, N - 1],
        [N - 1, 0],
        [7, 11],
      ] as const) {
        expect(data[(row + 1) * W + col + 1]).toBe(
          half(state.fields.elevation[faceRCToIndex(face, row, col, N)]!),
        );
      }
      // needsUpdate is a write-only setter that bumps version.
      expect(textures.elevation[face]!.version).toBeGreaterThan(0);
    }
  });

  it('fills borders with cross-seam neighbor cells so adjacent faces agree', () => {
    const textures = uploaded();
    const src = state.fields.elevation;
    for (let face = 0; face < 6; face++) {
      const data = textures.elevation[face]!.image.data as Uint16Array;
      for (let row = 0; row < N; row++) {
        const left = neighbors(faceRCToIndex(face, row, 0, N), N)[0]!;
        const right = neighbors(faceRCToIndex(face, row, N - 1, N), N)[1]!;
        expect(data[(row + 1) * W]).toBe(half(src[left]!));
        expect(data[(row + 1) * W + W - 1]).toBe(half(src[right]!));
      }
      for (let col = 0; col < N; col++) {
        const upCell = neighbors(faceRCToIndex(face, 0, col, N), N)[2]!;
        const downCell = neighbors(faceRCToIndex(face, N - 1, col, N), N)[3]!;
        expect(data[col + 1]).toBe(half(src[upCell]!));
        expect(data[(W - 1) * W + col + 1]).toBe(half(src[downCell]!));
      }
    }
  });

  it('corner texels hold the same 3-cell mean on every face sharing the cube corner', () => {
    const textures = uploaded();
    // Face 0's (row 0, col 0) corner is a cube corner shared with the faces
    // its two cross-seam neighbors live on; all three corner texels for that
    // cube corner must be the identical mean.
    const own = faceRCToIndex(0, 0, 0, N);
    const ns = neighbors(own, N);
    const expected = (textures.elevation[0]!.image.data as Uint16Array)[0]!;
    for (const cell of [ns[0]!, ns[2]!]) {
      const face = Math.floor(cell / (N * N));
      const data = textures.elevation[face]!.image.data as Uint16Array;
      const corners = [0, W - 1, (W - 1) * W, (W - 1) * W + W - 1].map((i) => data[i]!);
      expect(corners, `face ${face} should share face 0's corner mean`).toContain(expected);
    }
  });

  it('filters continuous elevation linearly and categorical plateId nearest', () => {
    const textures = uploaded();
    for (let face = 0; face < 6; face++) {
      expect(textures.elevation[face]!.magFilter).toBe(LinearFilter);
      expect(textures.elevation[face]!.minFilter).toBe(LinearFilter);
      expect(textures.plateId[face]!.magFilter).toBe(NearestFilter);
      expect(textures.plateId[face]!.minFilter).toBe(NearestFilter);
    }
  });

  it('packs plateId with exact interior and neighbor borders (categorical, never averaged)', () => {
    const textures = uploaded();
    const src = state.fields.plateId;
    const half = DataUtils.toHalfFloat;
    for (let face = 0; face < 6; face++) {
      const data = textures.plateId[face]!.image.data as Uint16Array;
      // Interior cells round-trip bit-exact (small ids are exact in half-float).
      for (const [row, col] of [
        [0, 0],
        [N - 1, N - 1],
        [7, 11],
      ] as const) {
        expect(data[(row + 1) * W + col + 1]).toBe(half(src[faceRCToIndex(face, row, col, N)]!));
      }
      // Edge border is the cross-seam neighbor id (a nearest value).
      const left = neighbors(faceRCToIndex(face, 3, 0, N), N)[0]!;
      expect(data[(3 + 1) * W]).toBe(half(src[left]!));
    }
  });

  it('packs crustType nearest with exact interior flags (categorical, 0 or 1)', () => {
    const textures = uploaded();
    const src = state.fields.crustType;
    for (let face = 0; face < 6; face++) {
      const tex = textures.crustType[face]!;
      // Crust type is categorical: filtered nearest so the 0/1 classes never smear.
      expect(tex.magFilter).toBe(NearestFilter);
      expect(tex.minFilter).toBe(NearestFilter);
      const data = tex.image.data as Uint16Array;
      for (const [row, col] of [
        [0, 0],
        [N - 1, N - 1],
        [5, 9],
      ] as const) {
        const flag = src[faceRCToIndex(face, row, col, N)]!;
        expect(flag === 0 || flag === 1, 'crust flag is 0 or 1').toBe(true);
        // Small integers round-trip bit-exact through the R16F container.
        expect(data[(row + 1) * W + col + 1]).toBe(half(flag));
      }
    }
  });

  it('categorical corners hold the own corner cell, not a fabricated mean', () => {
    const textures = uploaded();
    const src = state.fields.plateId;
    const half = DataUtils.toHalfFloat;
    for (let face = 0; face < 6; face++) {
      const data = textures.plateId[face]!.image.data as Uint16Array;
      // Each diagonal corner texel equals the face's own corner cell id — a
      // valid id — never the 3-cell average the continuous path uses.
      expect(data[0]).toBe(half(src[faceRCToIndex(face, 0, 0, N)]!));
      expect(data[W - 1]).toBe(half(src[faceRCToIndex(face, 0, N - 1, N)]!));
      expect(data[(W - 1) * W]).toBe(half(src[faceRCToIndex(face, N - 1, 0, N)]!));
      expect(data[(W - 1) * W + W - 1]).toBe(half(src[faceRCToIndex(face, N - 1, N - 1, N)]!));
    }
  });
});
