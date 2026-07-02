import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from 'three';
import { faceRCToIndex, neighbors, type Fields } from 'sim-kernel';

/**
 * Per-face data textures for one keyframe's fields. Named "A" because the
 * timeline scrubber will later add a second set ("B") and a blend uniform;
 * materials are already written against this shape so that lands without
 * rework. Phase 0 carries elevation only.
 *
 * Format: R16F, not R32F — WebGPU only guarantees linear filtering of 32-bit
 * float textures behind the optional `float32-filterable` feature, while
 * half-float filtering is universal. Elevation spans ±~6500 m, where half
 * precision resolves ~4 m: invisible at display scale.
 *
 * Layout: each texture is (N+2)×(N+2) — the N×N face cells plus a 1-texel
 * border filled from the adjacent faces via the kernel's seam-aware
 * `neighbors()`. Adjacent faces therefore blend identical values along a
 * shared edge, and mesh vertices can sample with plain linear filtering with
 * no cracks at the seams. Diagonal border texels hold the mean of the three
 * cells meeting at the cube corner, which makes all three faces' corner
 * samples agree exactly.
 */
export interface PlanetFieldTextures {
  gridN: number;
  /** One (N+2)x(N+2) R16F texture per cube face, indexed by face 0..5. */
  elevation: DataTexture[];
}

export function createPlanetTextures(gridN: number): PlanetFieldTextures {
  const size = gridN + 2;
  const elevation = Array.from({ length: 6 }, () => {
    const tex = new DataTexture(new Uint16Array(size * size), size, size, RedFormat, HalfFloatType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    return tex;
  });
  return { gridN, elevation };
}

/**
 * Packs kernel Float32Array fields into the 6 bordered face textures (see
 * PlanetFieldTextures for the layout). The kernel's flat cube-sphere order
 * (face * N * N + row * N + col) makes each face's interior a contiguous
 * slice; borders come from seam-aware neighbor lookups.
 */
export function uploadKeyframe(textures: PlanetFieldTextures, fields: Pick<Fields, 'elevation'>): void {
  const N = textures.gridN;
  const W = N + 2;
  const src = fields.elevation;
  const h = DataUtils.toHalfFloat;

  for (let face = 0; face < 6; face++) {
    const target = textures.elevation[face]!;
    const data = target.image.data as Uint16Array;

    for (let row = 0; row < N; row++) {
      const srcBase = face * N * N + row * N;
      const dstBase = (row + 1) * W + 1;
      for (let col = 0; col < N; col++) {
        data[dstBase + col] = h(src[srcBase + col]!);
      }
    }

    // Edge borders: the cross-seam neighbor of each boundary cell.
    // neighbors() order is [col-1, col+1, row-1, row+1].
    for (let row = 0; row < N; row++) {
      data[(row + 1) * W] = h(src[neighbors(faceRCToIndex(face, row, 0, N), N)[0]!]!);
      data[(row + 1) * W + W - 1] = h(src[neighbors(faceRCToIndex(face, row, N - 1, N), N)[1]!]!);
    }
    for (let col = 0; col < N; col++) {
      data[col + 1] = h(src[neighbors(faceRCToIndex(face, 0, col, N), N)[2]!]!);
      data[(W - 1) * W + col + 1] = h(src[neighbors(faceRCToIndex(face, N - 1, col, N), N)[3]!]!);
    }

    // Diagonal corners: mean of the 3 cells meeting at the cube corner (own
    // corner cell + its two cross-seam neighbors). All three faces compute
    // the same trio, so corner samples match exactly across faces.
    const cornerMean = (row: number, col: number, d1: number, d2: number): number => {
      const own = faceRCToIndex(face, row, col, N);
      const ns = neighbors(own, N);
      return (src[own]! + src[ns[d1]!]! + src[ns[d2]!]!) / 3;
    };
    data[0] = h(cornerMean(0, 0, 0, 2));
    data[W - 1] = h(cornerMean(0, N - 1, 1, 2));
    data[(W - 1) * W] = h(cornerMean(N - 1, 0, 0, 3));
    data[(W - 1) * W + W - 1] = h(cornerMean(N - 1, N - 1, 1, 3));

    target.needsUpdate = true;
  }
}
