import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  type MagnificationTextureFilter,
} from 'three';
import { faceRCToIndex, neighbors, type Fields } from 'sim-kernel';

/**
 * Per-face data textures for one keyframe's fields. Named "A" externally because
 * the timeline scrubber pairs this with a second set ("B") and a `blend` uniform
 * (see material.ts / residency.ts); the two sets are structurally identical.
 *
 * Two kinds of field live here:
 *
 *   - **Continuous** (`elevation`): filtered LINEARLY and blended with `mix` on
 *     the GPU. Format is R16F, not R32F — WebGPU only guarantees linear
 *     filtering of 32-bit float behind the optional `float32-filterable`
 *     feature, while half-float filtering is universal. Elevation spans
 *     ±~6500 m, where half precision resolves ~4 m: invisible at display scale.
 *   - **Categorical** (`plateId`, `biome`): filtered NEAREST and picked
 *     hold/nearest (`blend < 0.5 ? A : B`) — NEVER interpolated. A lerp between
 *     plate ids 3 and 7 (or biome classes 2 and 6) is a meaningless in-between,
 *     and even linear *filtering within one set* would smear classes across cell
 *     boundaries. Small integer codes (≤ 255) are exact in half-float, so the
 *     R16F container round-trips them losslessly.
 *   - `iceFraction` is continuous like elevation (linear + `mix`): it whitens
 *     the biome colour, so it must interpolate smoothly as caps advance/retreat.
 *
 * Layout: each texture is (N+2)×(N+2) — the N×N face cells plus a 1-texel
 * border filled from the adjacent faces via the kernel's seam-aware
 * `neighbors()`. Adjacent faces therefore carry identical values along a shared
 * edge, so vertices sample across seams with no cracks. Continuous diagonal
 * border texels hold the mean of the three cells meeting at the cube corner
 * (so all three faces' corner samples agree exactly); categorical corners hold
 * the own corner cell (a valid id — averaging would fabricate a nonexistent one).
 */
export interface PlanetFieldTextures {
  gridN: number;
  /** Continuous elevation, one (N+2)² R16F texture per face 0..5 (linear). */
  elevation: DataTexture[];
  /** Categorical plate id, one (N+2)² R16F texture per face 0..5 (nearest). */
  plateId: DataTexture[];
  /** Categorical Whittaker biome class (#35), per face (nearest). Drives the
   *  from-orbit colour ramp. */
  biome: DataTexture[];
  /** Continuous ice cover 0–1 (#33), per face (linear). Whitens the biome
   *  colour; interpolates as caps advance/retreat. */
  iceFraction: DataTexture[];
}

/** The fields a set can hold; extend (temperature, crustAge) as views need them. */
export type BlendFieldName = keyof Pick<Fields, 'elevation' | 'plateId' | 'biome' | 'iceFraction'>;

interface FieldSpec {
  name: BlendFieldName;
  categorical: boolean;
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: 'elevation', categorical: false },
  { name: 'plateId', categorical: true },
  { name: 'biome', categorical: true },
  { name: 'iceFraction', categorical: false },
];

function makeFaceTextures(size: number, filter: MagnificationTextureFilter): DataTexture[] {
  return Array.from({ length: 6 }, () => {
    const tex = new DataTexture(new Uint16Array(size * size), size, size, RedFormat, HalfFloatType);
    tex.magFilter = filter;
    tex.minFilter = filter;
    return tex;
  });
}

export function createPlanetTextures(gridN: number): PlanetFieldTextures {
  const size = gridN + 2;
  return {
    gridN,
    elevation: makeFaceTextures(size, LinearFilter),
    plateId: makeFaceTextures(size, NearestFilter),
    biome: makeFaceTextures(size, NearestFilter),
    iceFraction: makeFaceTextures(size, LinearFilter),
  };
}

/**
 * Packs one field's flat cube-sphere slice (`face * N * N + row * N + col`) into
 * a bordered (N+2)² face texture. `categorical` selects the corner strategy: the
 * cross-seam *edge* borders are the neighbor cell either way (a nearest value,
 * correct for both), but continuous corners average the 3 cells at the cube
 * corner while categorical corners hold the own corner cell.
 */
function packFace(target: DataTexture, src: Float32Array, face: number, N: number, categorical: boolean): void {
  const W = N + 2;
  const data = target.image.data as Uint16Array;
  const h = DataUtils.toHalfFloat;

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

  // Diagonal corners. Continuous: mean of the 3 cells meeting at the cube corner
  // (own + its two cross-seam neighbors), so all three faces match exactly.
  // Categorical: the own corner cell — a valid id; a mean would invent one.
  const corner = (row: number, col: number, d1: number, d2: number): number => {
    const own = faceRCToIndex(face, row, col, N);
    if (categorical) return src[own]!;
    const ns = neighbors(own, N);
    return (src[own]! + src[ns[d1]!]! + src[ns[d2]!]!) / 3;
  };
  data[0] = h(corner(0, 0, 0, 2));
  data[W - 1] = h(corner(0, N - 1, 1, 2));
  data[(W - 1) * W] = h(corner(N - 1, 0, 0, 3));
  data[(W - 1) * W + W - 1] = h(corner(N - 1, N - 1, 1, 3));

  target.needsUpdate = true;
}

/**
 * Packs kernel Float32Array fields into a set's 6 bordered face textures (see
 * PlanetFieldTextures for the layout). `elevation` is required; other blend
 * fields (`plateId`) are packed when present so callers can pass a decoded
 * keyframe's partial field map directly.
 */
export function uploadKeyframe(textures: PlanetFieldTextures, fields: Partial<Pick<Fields, BlendFieldName>>): void {
  const N = textures.gridN;
  for (const spec of FIELD_SPECS) {
    const src = fields[spec.name];
    if (!src) continue;
    const faces = textures[spec.name];
    for (let face = 0; face < 6; face++) {
      packFace(faces[face]!, src, face, N, spec.categorical);
    }
  }
}
