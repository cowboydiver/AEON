import { Vector3, type DataTexture } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  clamp,
  cos,
  float,
  fract,
  mix,
  normalWorld,
  positionLocal,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { INITIAL_OCEAN_DEPTH_M } from 'sim-kernel';

/**
 * TSL node material for one cube face. Samples TWO keyframe texture sets (A and
 * B) and blends them with a shared `blend` uniform so the whole planet morphs
 * between bracketing keyframes entirely on the GPU:
 *
 *   - **elevation** is CONTINUOUS: `mix(A, B, blend)` drives the radial vertex
 *     displacement (relief still comes from elevation) and the ocean depth tint,
 *     so continents *morph* across a keyframe boundary instead of popping. The
 *     (N+2)² seam border is blended with the same uniform (borders live in the
 *     same textures), so no cracks open at cube-face edges mid-blend.
 *   - **biome** is CATEGORICAL (#35): picked hold/nearest with `blend < 0.5 ? A
 *     : B` and NEVER lerped, then mapped through a fixed Whittaker palette — this
 *     is the from-orbit colour ramp, replacing raw hypsometry so land reads by
 *     ecosystem (tundra/taiga/forest/grassland/desert/savanna/tropical) rather
 *     than height. Its ocean class carries the sea-level land/ocean mask, so the
 *     rendered shoreline follows `seaLevelM` for free; ocean cells take a
 *     depth-shaded blue from elevation instead of the flat palette entry.
 *   - **iceFraction** is CONTINUOUS (#33): `mix(A, B, blend)`, whitening the
 *     biome colour toward ice so polar caps and sea ice read and breathe over
 *     the timeline.
 *   - **plateId** is CATEGORICAL: picked hold/nearest, driving a subtle per-plate
 *     tint gated by `plateTint` (0 = pure biome colour). When `plateDebug` is 1 it
 *     also derives the tectonic **plate boundaries** — a texel is a boundary iff a
 *     4-neighbour texel carries a different id, the SAME rule the kernel uses
 *     (ARCHITECTURE.md "Boundary classification") — and paints them as dark lines.
 *   - **crustType** is CATEGORICAL (0 = oceanic, 1 = continental): picked
 *     hold/nearest and, under the `plateDebug` overlay, colours the whole surface
 *     by crust class (cool oceanic vs warm continental) beneath the boundary lines.
 *
 * Uniforms are shared by all six face materials.
 */

export function createPlanetUniforms() {
  return {
    /** Visual exaggeration of elevation displacement (dimensionless). */
    exaggeration: uniform(40),
    /** Unit vector toward the sun, world space. */
    sunDirection: uniform(new Vector3(1, 0.2, 0.4).normalize()),
    /** Fraction from keyframe set A (0) to set B (1); the timeline scrubber. */
    blend: uniform(0),
    /** Per-plate tint strength over the hypsometric ramp (0 = elevation only). */
    plateTint: uniform(0.12),
    /** Debug tectonic map: 0 = normal biome surface, 1 = crust-type colours
     *  (oceanic vs continental) with plate boundaries drawn as dark lines. */
    plateDebug: uniform(0),
    /** Scalar debug field: 0 = off (beauty/plate surface). 1..N selects a
     *  continuous field (temperature, precipitation, marine life, crust age),
     *  false-coloured through a viridis ramp — see `DEBUG_FIELDS`. Takes
     *  precedence over `plateDebug`. */
    debugField: uniform(0),
    /** Strength of the marine-productivity green tint on ocean cells (#38);
     *  0 = plain bathymetry, 1 = full productive-green at marineLife = 1. */
    marineTint: uniform(0.6),
  };
}

export type PlanetUniforms = ReturnType<typeof createPlanetUniforms>;

/**
 * Scalar debug fields, in the order the `debugField` uniform selects them
 * (index 1..N; 0 = off). `min`/`max` are the DISPLAY normalization range mapped
 * to the viridis ramp's [0,1] (values clamp outside it); the UI legend reads
 * these. `crustAge` is in MEGAYEARS — the texture stores years×1e-6 so the value
 * fits half-float (see textures.ts `CRUST_AGE_TEXTURE_SCALE`), so its range is in
 * Myr too. The order here MUST match the material's selection fold below.
 */
export const DEBUG_FIELDS = [
  { key: 'temperature', label: 'Temperature', unit: 'K', min: 240, max: 320 },
  { key: 'precipitation', label: 'Precipitation', unit: 'kg/m²/yr', min: 0, max: 3000 },
  { key: 'marineLife', label: 'Marine life', unit: '', min: 0, max: 1 },
  { key: 'crustAge', label: 'Crust age', unit: 'Myr', min: 0, max: 200 },
] as const;

export type DebugFieldKey = (typeof DEBUG_FIELDS)[number]['key'];

/** One face's textures from a single keyframe set (A or B). */
export interface FaceTextures {
  elevation: DataTexture;
  plateId: DataTexture;
  crustType: DataTexture;
  biome: DataTexture;
  iceFraction: DataTexture;
  /** RGBA pack of the debug scalars: R=temperature, G=precipitation, B=marineLife,
   *  A=crustAge (Myr). See textures.ts `DEBUG_SCALAR_FIELDS`. */
  debugScalars: DataTexture;
}

// Ocean depth ramp anchors (linear-ish sRGB values).
const DEEP_OCEAN = vec3(0.012, 0.035, 0.18);
const SHALLOW_OCEAN = vec3(0.2, 0.45, 0.68);

// Slightly blue-white ice, the colour `iceFraction` whitens cells toward.
const ICE_COLOR = vec3(0.9, 0.93, 0.97);

// Plate-debug crust palette: the surface is coloured by crust CLASS, not height.
// Oceanic crust (subductable) reads cool teal-blue; continental crust (buoyant,
// never subducts) reads warm tan. Both are saturated so the two classes — and
// the boundaries drawn over them — stay legible from orbit.
const OCEANIC_CRUST_COLOR = vec3(0.09, 0.32, 0.55);
const CONTINENTAL_CRUST_COLOR = vec3(0.76, 0.6, 0.32);
// Plate boundaries: near-black cartographic lines, high-contrast on both crusts.
const PLATE_BOUNDARY_COLOR = vec3(0.02, 0.02, 0.03);

// Marine-productivity tint: ocean cells green toward this as `marineLife` → 1
// (#38). A teal-leaning green that reads as "living sea" without erasing the
// bathymetric depth gradient it modulates.
const PRODUCTIVE_OCEAN = vec3(0.13, 0.5, 0.42);

// Viridis anchors (perceptually-uniform, colour-blind-safe), low→high. Used for
// every scalar debug field so "brighter/yellower = larger value" is a single
// consistent reading; the legend supplies each field's units and range.
const VIRIDIS: Vec3Node[] = [
  vec3(0.267, 0.005, 0.329), // #440154
  vec3(0.231, 0.322, 0.545), // #3b528b
  vec3(0.129, 0.565, 0.553), // #21908d
  vec3(0.365, 0.784, 0.388), // #5dc863
  vec3(0.993, 0.906, 0.144), // #fde725
];

// The general TSL node types (`Node<"vec3">` / `Node<"float">`), named via the
// return of `select` instantiated at each — a `vec3(...)` anchor (a VarNode) and
// a `select(...)` result are both assignable to these, unlike the narrower
// inferred literal types, so the palette fold below type-checks.
type Vec3Node = ReturnType<typeof select<'vec3'>>;
type FloatNode = ReturnType<typeof select<'float'>>;

/**
 * Whittaker biome palette, indexed by the kernel's `BIOMES` code (0..7). Ocean
 * (index 0) is a placeholder — ocean cells are depth-shaded from elevation, not
 * this flat entry — so the meaningful colours are the seven land classes:
 * tundra, taiga, grassland, temperate forest, desert, savanna, tropical forest.
 * Kept here (a rendering concern) rather than in the zero-dep kernel, mirrored by
 * the CLI dump's `BIOME_DUMP_COLORS`; the CLASS ORDER must match `BIOMES`.
 */
const BIOME_COLORS: Vec3Node[] = [
  vec3(0.08, 0.28, 0.5), //  0 ocean (unused; depth ramp wins)
  vec3(0.55, 0.58, 0.52), // 1 tundra — greyish sage
  vec3(0.13, 0.3, 0.2), //   2 taiga — dark boreal green
  vec3(0.52, 0.58, 0.28), // 3 grassland — straw green
  vec3(0.2, 0.42, 0.2), //   4 temperate forest — mid green
  vec3(0.82, 0.72, 0.48), // 5 desert — sandy tan
  vec3(0.72, 0.58, 0.3), //  6 savanna — golden tan
  vec3(0.1, 0.45, 0.16), //  7 tropical forest — lush deep green
];

const TAU = 6.283185307179586;
// Golden-ratio conjugate: fract(id · φ⁻¹) spreads consecutive plate ids across
// [0, 1) so neighbouring plates get well-separated hues. Keyed to the RAW
// plate id, never a live-count palette index — the kernel never renumbers or
// reclaims plate slots, so a surviving plate keeps its colour across
// reorganizations (#66); only a genuinely new rift fragment gets a fresh hue.
const PLATE_HUE_STRIDE = 0.6180339887498949;

/**
 * Map a nearest-picked biome code to its palette colour as a fold of `select`s:
 * `biome < 0.5 ? C0 : biome < 1.5 ? C1 : …`. Half-integer thresholds are robust
 * to the categorical value's exact float; the last colour is the fallthrough, so
 * an out-of-range code degrades to tropical forest rather than black.
 */
function biomePalette(biome: FloatNode): Vec3Node {
  let color = BIOME_COLORS[BIOME_COLORS.length - 1]!;
  for (let i = BIOME_COLORS.length - 2; i >= 0; i--) {
    color = select(biome.lessThan(i + 0.5), BIOME_COLORS[i]!, color);
  }
  return color;
}

/**
 * Plate-boundary mask from a plate-id texture: 1.0 where the nearest cell's
 * `plateId` differs from any 4-neighbour cell, 0.0 in a plate interior — exactly
 * the kernel's boundary definition (ARCHITECTURE.md "Boundary classification"),
 * reproduced on the GPU. `texel` is one cell's width in UV (1 / (N+2)); a ±1
 * texel NEAREST sample lands on the adjacent cell centre, and the (N+2) seam
 * border already holds the cross-face neighbour ids, so boundaries stay
 * continuous across cube seams. Ids are integers exact through the R16F/codec
 * round-trip, so a half-unit threshold cleanly separates "same" from "different".
 */
function plateBoundary(plateId: DataTexture, coord: ReturnType<typeof uv>, texel: number): FloatNode {
  const center = texture(plateId, coord).r;
  const left = texture(plateId, coord.add(vec2(-texel, 0))).r;
  const right = texture(plateId, coord.add(vec2(texel, 0))).r;
  const up = texture(plateId, coord.add(vec2(0, -texel))).r;
  const down = texture(plateId, coord.add(vec2(0, texel))).r;
  const maxDiff = center
    .sub(left)
    .abs()
    .max(center.sub(right).abs())
    .max(center.sub(up).abs())
    .max(center.sub(down).abs());
  return select(maxDiff.greaterThan(0.5), float(1), float(0));
}

/**
 * Map a normalized scalar `t` ∈ [0,1] through the viridis ramp as four clamped
 * mixes across the five anchors — the same multi-stop-gradient technique the CLI
 * dump uses, on the GPU. `t` outside [0,1] is caller-clamped, so the ends hold
 * the first/last anchor.
 */
function viridis(t: FloatNode): Vec3Node {
  const s = t.mul(VIRIDIS.length - 1); // 0..4 across the anchor spans
  let color: Vec3Node = VIRIDIS[0]!;
  for (let i = 1; i < VIRIDIS.length; i++) {
    color = mix(color, VIRIDIS[i]!, clamp(s.sub(i - 1), 0, 1));
  }
  return color;
}

export function createPlanetMaterial(
  a: FaceTextures,
  b: FaceTextures,
  uniforms: PlanetUniforms,
  radiusMeters: number,
  gridN: number,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const coord = uv();
  // One cell's width in the (N+2)-wide face texture's UV space; the offset the
  // plate-boundary sampler steps to reach an adjacent cell centre.
  const texel = 1 / (gridN + 2);

  // Categorical hold/nearest pick between the two keyframe sets: sample set A when
  // blend < 0.5, else set B — NEVER lerp (a value between two class codes is
  // meaningless; see ARCHITECTURE.md). The single site of that rule, shared by
  // every categorical field (biome, plateId, crustType).
  const sampleNearest = (fromA: DataTexture, fromB: DataTexture) =>
    select(uniforms.blend.lessThan(0.5), texture(fromA, coord).r, texture(fromB, coord).r);

  // Continuous: blend the two keyframes' elevation. Vertex displacement and the
  // ocean depth tint both read this blended value, so relief interpolates smoothly.
  const elevation = mix(texture(a.elevation, coord).r, texture(b.elevation, coord).r, uniforms.blend);

  // Radial displacement: the mesh is a unit sphere, so scaling the position
  // by (1 + elevation/radius * exaggeration) displaces along the normal.
  const displacement = elevation.div(float(radiusMeters)).mul(uniforms.exaggeration).add(1);
  material.positionNode = positionLocal.mul(displacement);

  // Categorical: nearest-pick the biome class (never lerp) and map it through the
  // Whittaker palette — the from-orbit colour ramp. Ocean (class 0) instead takes
  // a depth-shaded blue from elevation, so the sea keeps its bathymetric gradient
  // and (because class 0 carries the sea-level mask) the shoreline tracks sea level.
  const biome = sampleNearest(a.biome, b.biome);
  const biomeColor = biomePalette(biome);
  const depthT = clamp(elevation.div(-INITIAL_OCEAN_DEPTH_M), 0, 1);
  const bathyColor = mix(SHALLOW_OCEAN, DEEP_OCEAN, depthT);
  // Debug scalars, blended A→B once and reused: R=temperature, G=precipitation,
  // B=marineLife, A=crustAge (Myr) — see textures.ts `DEBUG_SCALAR_FIELDS`.
  const debugA = texture(a.debugScalars, coord);
  const debugB = texture(b.debugScalars, coord);
  const debugScalars = mix(debugA, debugB, uniforms.blend);
  // Marine-productivity tint (#38): green the sea by the blended `marineLife`
  // (B channel; continuous, 0 on land so land is untouched even before the ocean
  // mask). `marineTint` scales it, so 0 restores plain bathymetry.
  const marine = clamp(debugScalars.b, 0, 1);
  const oceanColor = mix(bathyColor, PRODUCTIVE_OCEAN, marine.mul(uniforms.marineTint));
  const albedo = select(biome.lessThan(0.5), oceanColor, biomeColor);

  // Categorical: nearest-pick the plate id (never lerp) and modulate the albedo
  // by a stable per-plate colour. A cosine palette maps the spread hue to RGB;
  // `plateTint` scales the modulation around 1.0 (so 0 leaves albedo untouched).
  const plateId = sampleNearest(a.plateId, b.plateId);
  const hueT = fract(plateId.mul(PLATE_HUE_STRIDE));
  const plateColor = cos(vec3(hueT, hueT.add(0.33), hueT.add(0.67)).mul(TAU)).mul(0.5).add(0.5);
  const plateFactor = mix(vec3(1, 1, 1), plateColor.mul(2), uniforms.plateTint);
  const tinted = albedo.mul(plateFactor);

  // Continuous: whiten toward ice by the blended ice fraction (#33) — polar caps
  // and sea ice over both land biomes and ocean, breathing over the timeline.
  const ice = clamp(mix(texture(a.iceFraction, coord).r, texture(b.iceFraction, coord).r, uniforms.blend), 0, 1);
  const iced = mix(tinted, ICE_COLOR, ice);

  // Debug tectonic map: colour the surface by CRUST TYPE (oceanic vs continental)
  // and draw plate boundaries as dark lines. Both the crust class and the boundary
  // come from the SAME nearest-picked keyframe (`blend < 0.5 ? A : B`) so the map
  // stays crisp; radial displacement and shading are kept so it reads on the globe.
  const crustType = sampleNearest(a.crustType, b.crustType);
  const crustColor = select(crustType.lessThan(0.5), OCEANIC_CRUST_COLOR, CONTINENTAL_CRUST_COLOR);
  // Boundary mask from the same nearest-picked keyframe as plateId (a→b hold),
  // so the lines and the crust classes agree across a keyframe boundary.
  const boundary = select(
    uniforms.blend.lessThan(0.5),
    plateBoundary(a.plateId, coord, texel),
    plateBoundary(b.plateId, coord, texel),
  );
  const debugSurface = mix(crustColor, PLATE_BOUNDARY_COLOR, boundary);

  // `plateDebug` is 0/1, so this is a clean swap between the biome surface and the
  // crust-type + boundary map (a single uniform flip, no texture re-upload).
  const beautyOrPlate = mix(iced, debugSurface, uniforms.plateDebug);

  // Scalar debug fields: read each blended channel (R/G/B/A), normalize to the
  // DISPLAY range in DEBUG_FIELDS, and false-colour through viridis. `crustAge`
  // (A) is stored in Myr in its texture (years×1e-6, see textures.ts), so its
  // range is Myr too. One field shows at a time, picked by the `debugField`
  // uniform via a threshold fold (default = the last field; lower thresholds
  // override) — the SAME pattern as `biomePalette`. Channel order MUST match
  // DEBUG_FIELDS / textures.ts `DEBUG_SCALAR_FIELDS`.
  const norm = (value: FloatNode, lo: number, hi: number): FloatNode =>
    clamp(value.sub(lo).div(hi - lo), 0, 1);
  const tTemperature = norm(debugScalars.r, 240, 320);
  const tPrecipitation = norm(debugScalars.g, 0, 3000);
  const tMarineLife = clamp(debugScalars.b, 0, 1);
  const tCrustAge = norm(debugScalars.a, 0, 200);
  let debugT: FloatNode = tCrustAge; // 4
  debugT = select(uniforms.debugField.lessThan(3.5), tMarineLife, debugT); // 3
  debugT = select(uniforms.debugField.lessThan(2.5), tPrecipitation, debugT); // 2
  debugT = select(uniforms.debugField.lessThan(1.5), tTemperature, debugT); // 1
  const scalarSurface = viridis(debugT);

  // `debugField > 0` shows the scalar false-colour map and wins over the
  // beauty/plate surface. Displacement and shading are unchanged, so the field
  // reads as relief-lit false colour on the same globe.
  const surface = select(uniforms.debugField.greaterThan(0.5), scalarSurface, beautyOrPlate);

  // Lambert-ish: geometric (radial) normal against the sun uniform + ambient.
  const nDotL = normalWorld.dot(uniforms.sunDirection).max(0);
  material.colorNode = surface.mul(nDotL.mul(0.92).add(0.08));

  return material;
}
