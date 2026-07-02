import { DataTexture, FloatType, LinearFilter, RedFormat } from 'three';
import type { Fields } from 'sim-kernel';

/**
 * Per-face data textures for one keyframe's fields. Named "A" because the
 * timeline scrubber will later add a second set ("B") and a blend uniform;
 * materials are already written against this shape so that lands without
 * rework. Phase 0 carries elevation only.
 */
export interface PlanetFieldTextures {
  gridN: number;
  /** One N x N R32F texture per cube face, indexed by face 0..5. */
  elevation: DataTexture[];
}

export function createPlanetTextures(gridN: number): PlanetFieldTextures {
  const elevation = Array.from({ length: 6 }, () => {
    const tex = new DataTexture(new Float32Array(gridN * gridN), gridN, gridN, RedFormat, FloatType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    return tex;
  });
  return { gridN, elevation };
}

/**
 * Packs kernel Float32Array fields into the 6 face textures. The kernel's
 * flat cube-sphere layout (face * N * N + row * N + col) means each face is
 * a contiguous N*N slice, already in texture row order.
 */
export function uploadKeyframe(textures: PlanetFieldTextures, fields: Pick<Fields, 'elevation'>): void {
  const { gridN } = textures;
  const perFace = gridN * gridN;
  for (let face = 0; face < 6; face++) {
    const target = textures.elevation[face]!;
    (target.image.data as Float32Array).set(fields.elevation.subarray(face * perFace, (face + 1) * perFace));
    target.needsUpdate = true;
  }
}
