import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { faceSTToDirection } from 'sim-kernel';
import { createPlanetMaterial, createPlanetUniforms, type PlanetUniforms } from './material';
import { createPlanetTextures, type PlanetFieldTextures } from './textures';

/**
 * Cube-sphere planet: 6 face meshes (one per cube face so each samples its
 * own face texture), vertices at cell corners using the SAME tangent-adjusted
 * mapping as the kernel grid (imported from sim-kernel — the dependency
 * direction allows it, and duplicating the formula is how seams are born).
 *
 * The mesh is built at unit radius in scene units; elevation displacement is
 * normalized by radiusMeters inside the material.
 */

export interface PlanetHandle {
  group: Group;
  uniforms: PlanetUniforms;
  /** Keyframe texture set A. Blended against B by `uniforms.blend` (see material.ts). */
  fieldsA: PlanetFieldTextures;
  /** Keyframe texture set B; the residency manager ping-pongs uploads between the two. */
  fieldsB: PlanetFieldTextures;
}

/** Geometry for one cube face: (N+1)^2 corner vertices, 2 N^2 triangles. */
export function createFaceGeometry(face: number, gridN: number): BufferGeometry {
  const verts = gridN + 1;
  const positions = new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);
  const indices: number[] = [];

  for (let row = 0; row < verts; row++) {
    for (let col = 0; col < verts; col++) {
      const s = (col / gridN) * 2 - 1;
      const t = (row / gridN) * 2 - 1;
      const dir = faceSTToDirection(face, s, t);
      const vi = row * verts + col;
      positions[vi * 3] = dir[0];
      positions[vi * 3 + 1] = dir[1];
      positions[vi * 3 + 2] = dir[2];
      // Face textures are (N+2) wide with a 1-texel seam border (see
      // textures.ts): corner (row, col) sits at padded texel coordinate
      // (col+1, row+1) minus half a texel, i.e. exactly between the four
      // surrounding cell centers, so linear filtering interpolates them.
      uvs[vi * 2] = (col + 1) / (gridN + 2);
      uvs[vi * 2 + 1] = (row + 1) / (gridN + 2);
    }
  }

  for (let row = 0; row < gridN; row++) {
    for (let col = 0; col < gridN; col++) {
      const a = row * verts + col;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      // All face frames satisfy uAxis x vAxis = +normal, so counter-clockwise
      // in (s, t) is outward-facing.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // Radial normals: on a unit sphere the outward normal IS the position.
  geometry.setAttribute('normal', new Float32BufferAttribute(positions.slice(), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function createPlanetMesh(gridN: number, radiusMeters: number): PlanetHandle {
  const uniforms = createPlanetUniforms();
  const fieldsA = createPlanetTextures(gridN);
  const fieldsB = createPlanetTextures(gridN);
  const group = new Group();
  group.name = 'planet';

  for (let face = 0; face < 6; face++) {
    const mesh = new Mesh(
      createFaceGeometry(face, gridN),
      createPlanetMaterial(
        { elevation: fieldsA.elevation[face]!, plateId: fieldsA.plateId[face]! },
        { elevation: fieldsB.elevation[face]!, plateId: fieldsB.plateId[face]! },
        uniforms,
        radiusMeters,
      ),
    );
    mesh.name = `planet-face-${face}`;
    mesh.frustumCulled = false; // displaced in the vertex stage
    group.add(mesh);
  }
  return { group, uniforms, fieldsA, fieldsB };
}
