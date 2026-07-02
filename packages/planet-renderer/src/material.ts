import { Vector3, type DataTexture } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  clamp,
  float,
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
 * TSL node material for one cube face. Samples the face's elevation texture
 * (keyframe set A) for radial vertex displacement and a hypsometric color
 * ramp, lit Lambert-ish from a sun-direction uniform. Uniforms are shared by
 * all six face materials; a second keyframe texture set and a blend uniform
 * slot in later without restructuring.
 */

export function createPlanetUniforms() {
  return {
    /** Visual exaggeration of elevation displacement (dimensionless). */
    exaggeration: uniform(40),
    /** Unit vector toward the sun, world space. */
    sunDirection: uniform(new Vector3(1, 0.2, 0.4).normalize()),
  };
}

export type PlanetUniforms = ReturnType<typeof createPlanetUniforms>;

// Color ramp anchors (linear-ish sRGB values).
const DEEP_OCEAN = vec3(0.012, 0.035, 0.18);
const SHALLOW_OCEAN = vec3(0.2, 0.45, 0.68);
const LOWLAND = vec3(0.1, 0.38, 0.15);
const UPLAND = vec3(0.5, 0.37, 0.2);
const PEAK = vec3(0.95, 0.95, 0.95);

export function createPlanetMaterial(
  elevationA: DataTexture,
  uniforms: PlanetUniforms,
  radiusMeters: number,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();

  const elevation = texture(elevationA, uv()).r;

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

  // Lambert-ish: geometric (radial) normal against the sun uniform + ambient.
  const nDotL = normalWorld.dot(uniforms.sunDirection).max(0);
  material.colorNode = albedo.mul(nDotL.mul(0.92).add(0.08));

  return material;
}
