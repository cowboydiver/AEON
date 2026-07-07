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
  vec3,
} from 'three/tsl';
import { INITIAL_LAND_HEIGHT_M, INITIAL_OCEAN_DEPTH_M } from 'sim-kernel';

/**
 * TSL node material for one cube face. Samples TWO keyframe texture sets (A and
 * B) and blends them with a shared `blend` uniform so the whole planet morphs
 * between bracketing keyframes entirely on the GPU:
 *
 *   - **elevation** is CONTINUOUS: `mix(A, B, blend)` drives both the radial
 *     vertex displacement and the hypsometric color ramp, so continents *morph*
 *     across a keyframe boundary instead of popping. The (N+2)² seam border is
 *     blended with the same uniform (borders live in the same textures), so no
 *     cracks open at cube-face edges mid-blend.
 *   - **plateId** is CATEGORICAL: picked hold/nearest with `blend < 0.5 ? A : B`
 *     and NEVER lerped. It drives a subtle per-plate tint gated by `plateTint`
 *     (0 = pure elevation ramp), and — when `plateDebug` is 1 — a full-strength
 *     debug overlay that paints each plate its own flat colour so the tectonic
 *     partition is legible at a glance. The nearest pick keeps plate boundaries
 *     crisp across a blend.
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
    /** Debug plate map: 0 = normal hypsometric surface, 1 = flat per-plate colours. */
    plateDebug: uniform(0),
  };
}

export type PlanetUniforms = ReturnType<typeof createPlanetUniforms>;

/** One face's textures from a single keyframe set (A or B). */
export interface FaceTextures {
  elevation: DataTexture;
  plateId: DataTexture;
}

// Color ramp anchors (linear-ish sRGB values).
const DEEP_OCEAN = vec3(0.012, 0.035, 0.18);
const SHALLOW_OCEAN = vec3(0.2, 0.45, 0.68);
const LOWLAND = vec3(0.1, 0.38, 0.15);
const UPLAND = vec3(0.5, 0.37, 0.2);
const PEAK = vec3(0.95, 0.95, 0.95);

const TAU = 6.283185307179586;
// Golden-ratio conjugate: fract(id · φ⁻¹) spreads consecutive plate ids across
// [0, 1) so neighbouring plates get well-separated hues. Keyed to the RAW
// plate id, never a live-count palette index — the kernel never renumbers or
// reclaims plate slots, so a surviving plate keeps its colour across
// reorganizations (#66); only a genuinely new rift fragment gets a fresh hue.
const PLATE_HUE_STRIDE = 0.6180339887498949;

export function createPlanetMaterial(
  a: FaceTextures,
  b: FaceTextures,
  uniforms: PlanetUniforms,
  radiusMeters: number,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const coord = uv();

  // Continuous: blend the two keyframes' elevation. Vertex displacement and the
  // color ramp both read this blended value, so relief interpolates smoothly.
  const elevation = mix(texture(a.elevation, coord).r, texture(b.elevation, coord).r, uniforms.blend);

  // Radial displacement: the mesh is a unit sphere, so scaling the position
  // by (1 + elevation/radius * exaggeration) displaces along the normal.
  const displacement = elevation.div(float(radiusMeters)).mul(uniforms.exaggeration).add(1);
  material.positionNode = positionLocal.mul(displacement);

  // Hypsometric ramp: blues below the datum, green -> brown -> white above.
  const depthT = clamp(elevation.div(-INITIAL_OCEAN_DEPTH_M), 0, 1);
  const ocean = mix(SHALLOW_OCEAN, DEEP_OCEAN, depthT);
  const heightT = clamp(elevation.div(INITIAL_LAND_HEIGHT_M), 0, 1);
  const land = mix(
    mix(LOWLAND, UPLAND, clamp(heightT.mul(2), 0, 1)),
    PEAK,
    clamp(heightT.mul(2).sub(1), 0, 1),
  );
  const albedo = select(elevation.lessThan(0), ocean, land);

  // Categorical: nearest-pick the plate id (never lerp) and modulate the albedo
  // by a stable per-plate colour. A cosine palette maps the spread hue to RGB;
  // `plateTint` scales the modulation around 1.0 (so 0 leaves albedo untouched).
  const plateId = select(uniforms.blend.lessThan(0.5), texture(a.plateId, coord).r, texture(b.plateId, coord).r);
  const hueT = fract(plateId.mul(PLATE_HUE_STRIDE));
  const plateColor = cos(vec3(hueT, hueT.add(0.33), hueT.add(0.67)).mul(TAU)).mul(0.5).add(0.5);
  const plateFactor = mix(vec3(1, 1, 1), plateColor.mul(2), uniforms.plateTint);
  const tinted = albedo.mul(plateFactor);

  // Debug plate map: swap the hypsometric surface for the flat per-plate colour
  // (each plate one crisp hue), keeping the radial displacement and shading so the
  // partition reads on the 3D globe. `plateDebug` is 0/1 so this is a clean swap.
  const surface = mix(tinted, plateColor, uniforms.plateDebug);

  // Lambert-ish: geometric (radial) normal against the sun uniform + ambient.
  const nDotL = normalWorld.dot(uniforms.sunDirection).max(0);
  material.colorNode = surface.mul(nDotL.mul(0.92).add(0.08));

  return material;
}
