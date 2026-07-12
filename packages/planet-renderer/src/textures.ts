import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
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
 *   - **Categorical** (`plateId`, `crustType`, `biome`): filtered NEAREST and
 *     picked hold/nearest (`blend < 0.5 ? A : B`) — NEVER interpolated. A lerp
 *     between plate ids 3 and 7 (or biome classes 2 and 6, or crust types 0 and
 *     1) is a meaningless in-between,
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
  /** Categorical plate id, one (N+2)² R16F texture per face 0..5 (nearest).
   *  The plate-debug view also derives boundaries from it (a texel is a
   *  boundary iff a 4-neighbour texel carries a different id). */
  plateId: DataTexture[];
  /** Categorical crust type (0 = oceanic, 1 = continental), per face (nearest).
   *  Colours the plate-debug view; never lerped (a half-integer is meaningless). */
  crustType: DataTexture[];
  /** Categorical Whittaker biome class (#35), per face (nearest). Drives the
   *  from-orbit colour ramp. */
  biome: DataTexture[];
  /** Continuous ice cover 0–1 (#33), per face (linear). Whitens the biome
   *  colour; interpolates as caps advance/retreat. */
  iceFraction: DataTexture[];
  /** Four continuous debug scalars packed into one RGBA16F texture per face
   *  (linear): R = temperature (K), G = precipitation (kg/m²/yr), B = marineLife
   *  (0–1), A = crustAge (Myr, i.e. years×`CRUST_AGE_TEXTURE_SCALE`). Packing them
   *  into one texture keeps the per-shader-stage sampled-texture count within
   *  WebGPU's 16 limit (two keyframe sets × these four fields would otherwise add
   *  eight bindings). The B channel also drives the beauty ocean tint (#38). */
  debugScalars: DataTexture[];
}

/** The fields a set can hold. The first five feed the beauty/plate render; the
 *  four `DEBUG_SCALAR_FIELDS` are packed into the RGBA `debugScalars` texture and
 *  feed the marine-life ocean tint and the debug-field colormaps. */
export type BlendFieldName = keyof Pick<
  Fields,
  | 'elevation'
  | 'plateId'
  | 'crustType'
  | 'biome'
  | 'iceFraction'
  | 'temperature'
  | 'precipitation'
  | 'marineLife'
  | 'crustAge'
>;

/** Years→Myr, so crust age fits the half-float texture; the material reads Myr. */
export const CRUST_AGE_TEXTURE_SCALE = 1e-6;

/** The four continuous scalars packed, in RGBA channel order, into `debugScalars`.
 *  `scale` pre-multiplies each value before it is stored as half-float (crustAge
 *  in years overflows half-float's ~65504 range, so it is stored in Myr). The
 *  material's channel reads and its colormap ranges MUST match this order. */
export const DEBUG_SCALAR_FIELDS: readonly { name: BlendFieldName; scale: number }[] = [
  { name: 'temperature', scale: 1 },
  { name: 'precipitation', scale: 1 },
  { name: 'marineLife', scale: 1 },
  { name: 'crustAge', scale: CRUST_AGE_TEXTURE_SCALE },
];

/** Names of the five fields that each get their own single-channel texture. */
type SingleChannelFieldName = 'elevation' | 'plateId' | 'crustType' | 'biome' | 'iceFraction';

interface FieldSpec {
  name: SingleChannelFieldName;
  categorical: boolean;
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: 'elevation', categorical: false },
  { name: 'plateId', categorical: true },
  { name: 'crustType', categorical: true },
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

/** Six (N+2)² RGBA16F face textures for the packed debug scalars (linear). */
function makeRGBAFaceTextures(size: number): DataTexture[] {
  return Array.from({ length: 6 }, () => {
    const tex = new DataTexture(new Uint16Array(size * size * 4), size, size, RGBAFormat, HalfFloatType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    return tex;
  });
}

export function createPlanetTextures(gridN: number): PlanetFieldTextures {
  const size = gridN + 2;
  return {
    gridN,
    elevation: makeFaceTextures(size, LinearFilter),
    plateId: makeFaceTextures(size, NearestFilter),
    crustType: makeFaceTextures(size, NearestFilter),
    biome: makeFaceTextures(size, NearestFilter),
    iceFraction: makeFaceTextures(size, LinearFilter),
    debugScalars: makeRGBAFaceTextures(size),
  };
}

/**
 * Packs one field's flat cube-sphere slice (`face * N * N + row * N + col`) into
 * ONE channel of a bordered (N+2)² face texture. `data` is the target's typed
 * array, `stride` its channels-per-texel (1 for R, 4 for RGBA) and `channel` the
 * offset within a texel. `categorical` selects the corner strategy: the
 * cross-seam *edge* borders are the neighbor cell either way (a nearest value,
 * correct for both), but continuous corners average the 3 cells at the cube
 * corner while categorical corners hold the own corner cell. `scale`
 * pre-multiplies each value before the half-float store (crustAge: years→Myr).
 */
function packChannel(
  data: Uint16Array,
  stride: number,
  channel: number,
  src: Float32Array,
  face: number,
  N: number,
  categorical: boolean,
  scale: number,
): void {
  const W = N + 2;
  const at = (texel: number): number => texel * stride + channel;
  const h = (v: number): number => DataUtils.toHalfFloat(v * scale);

  for (let row = 0; row < N; row++) {
    const srcBase = face * N * N + row * N;
    const dstBase = (row + 1) * W + 1;
    for (let col = 0; col < N; col++) {
      data[at(dstBase + col)] = h(src[srcBase + col]!);
    }
  }

  // Edge borders: the cross-seam neighbor of each boundary cell.
  // neighbors() order is [col-1, col+1, row-1, row+1].
  for (let row = 0; row < N; row++) {
    data[at((row + 1) * W)] = h(src[neighbors(faceRCToIndex(face, row, 0, N), N)[0]!]!);
    data[at((row + 1) * W + W - 1)] = h(src[neighbors(faceRCToIndex(face, row, N - 1, N), N)[1]!]!);
  }
  for (let col = 0; col < N; col++) {
    data[at(col + 1)] = h(src[neighbors(faceRCToIndex(face, 0, col, N), N)[2]!]!);
    data[at((W - 1) * W + col + 1)] = h(src[neighbors(faceRCToIndex(face, N - 1, col, N), N)[3]!]!);
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
  data[at(0)] = h(corner(0, 0, 0, 2));
  data[at(W - 1)] = h(corner(0, N - 1, 1, 2));
  data[at((W - 1) * W)] = h(corner(N - 1, 0, 0, 3));
  data[at((W - 1) * W + W - 1)] = h(corner(N - 1, N - 1, 1, 3));
}

/** Pack one single-channel (R) face texture. */
function packFace(target: DataTexture, src: Float32Array, face: number, N: number, categorical: boolean): void {
  packChannel(target.image.data as Uint16Array, 1, 0, src, face, N, categorical, 1);
  target.needsUpdate = true;
}

/**
 * Packs kernel Float32Array fields into a set's bordered face textures (see
 * PlanetFieldTextures). The five single-channel fields go to their own textures;
 * the four `DEBUG_SCALAR_FIELDS` are packed, when present, into the RGBA
 * `debugScalars` texture's channels. Fields are packed when present, so a decoded
 * keyframe's partial field map can be passed directly.
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

  // Pack the four debug scalars into the RGBA texture's channels (all continuous).
  for (let face = 0; face < 6; face++) {
    const target = textures.debugScalars[face]!;
    const data = target.image.data as Uint16Array;
    let wrote = false;
    for (let c = 0; c < DEBUG_SCALAR_FIELDS.length; c++) {
      const { name, scale } = DEBUG_SCALAR_FIELDS[c]!;
      const src = fields[name];
      if (!src) continue;
      packChannel(data, 4, c, src, face, N, false, scale);
      wrote = true;
    }
    if (wrote) target.needsUpdate = true;
  }
}
