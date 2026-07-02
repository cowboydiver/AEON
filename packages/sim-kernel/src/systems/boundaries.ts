/**
 * Plate-boundary classification (#14) and subduction polarity (#16).
 *
 * A cell is a boundary cell iff any of its 4 neighbors belongs to a different
 * plate. At each boundary cell the relative velocity of the two plates
 * (rigid ω × r from their Euler poles) is projected onto the local
 * boundary-normal direction, giving the signed `boundaryStress` field:
 * positive = convergent (closing), negative = divergent (opening), near-zero
 * with large tangential motion = transform. Interior cells are exactly 0.
 * Boundary *type* is derived from the sign and a tangential threshold rather
 * than stored as a second field.
 */

import { cellCenterTable, neighborTable } from '../grid';
import { plateVelocityAt } from '../plates';
import type { PlanetState } from '../state';

/**
 * The dominant other plate at boundary cell i: the most frequent differing
 * owner among the 4 neighbors (ties toward the lower plate id), plus one of
 * its cells (the first such neighbor in fixed order) for property lookups.
 * Returns null for interior cells.
 */
export function dominantOtherPlate(
  plateId: Float32Array,
  i: number,
  nbTable: Int32Array,
): { plate: number; cell: number } | null {
  const own = plateId[i]!;
  let bestPlate = -1;
  let bestVotes = 0;
  let bestCell = -1;
  for (let k = 0; k < 4; k++) {
    const nb = nbTable[i * 4 + k]!;
    const p = plateId[nb]!;
    if (p === own) continue;
    let votes = 0;
    let firstCell = -1;
    for (let m = 0; m < 4; m++) {
      const nb2 = nbTable[i * 4 + m]!;
      if (plateId[nb2] === p) {
        votes++;
        if (firstCell === -1) firstCell = nb2;
      }
    }
    if (votes > bestVotes || (votes === bestVotes && p < bestPlate)) {
      bestVotes = votes;
      bestPlate = p;
      bestCell = firstCell;
    }
  }
  return bestPlate === -1 ? null : { plate: bestPlate, cell: bestCell };
}

/**
 * Recompute the boundaryStress field for the current partition/kinematics.
 * stress(i) = (v_own − v_other) · û where û is the unit tangent direction
 * from cell i toward the dominant other plate's side — positive when the two
 * plates close on each other.
 */
export function computeBoundaryStress(state: PlanetState): Float32Array {
  const N = state.params.gridN;
  const R = state.params.radiusMeters;
  const plateId = state.fields.plateId;
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const stress = new Float32Array(plateId.length);

  for (let i = 0; i < plateId.length; i++) {
    const other = dominantOtherPlate(plateId, i, nbTable);
    if (other === null) continue;

    const cx = centers[i * 3]!;
    const cy = centers[i * 3 + 1]!;
    const cz = centers[i * 3 + 2]!;

    // Mean direction toward the differing neighbors, projected onto the
    // tangent plane at i (subtract the radial component), normalized.
    let ux = 0;
    let uy = 0;
    let uz = 0;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[i * 4 + k]!;
      if (plateId[nb] !== plateId[i]) {
        ux += centers[nb * 3]! - cx;
        uy += centers[nb * 3 + 1]! - cy;
        uz += centers[nb * 3 + 2]! - cz;
      }
    }
    const radial = ux * cx + uy * cy + uz * cz;
    ux -= radial * cx;
    uy -= radial * cy;
    uz -= radial * cz;
    const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (len === 0) continue; // opposing differing neighbors cancel: pure shear cell
    ux /= len;
    uy /= len;
    uz /= len;

    const pos: [number, number, number] = [cx, cy, cz];
    const vOwn = plateVelocityAt(state.plates[plateId[i]!]!, pos, R);
    const vOther = plateVelocityAt(state.plates[other.plate]!, pos, R);
    stress[i] = (vOwn[0] - vOther[0]) * ux + (vOwn[1] - vOther[1]) * uy + (vOwn[2] - vOther[2]) * uz;
  }
  return stress;
}

/**
 * Subduction polarity (#16): does side A override side B at a convergent
 * boundary? Continental crust is buoyant and never subducts under oceanic;
 * between two oceanic sides the older (colder, denser) subducts; ties and
 * continent–continent contacts resolve to the lower plate id (collision
 * handling itself lives with the orogeny pass — this is only the
 * deterministic ownership rule).
 */
export function overrides(
  typeA: number,
  ageA: number,
  plateA: number,
  typeB: number,
  ageB: number,
  plateB: number,
): boolean {
  if (typeA !== typeB) return typeA === 1;
  if (typeA === 0 && ageA !== ageB) return ageA < ageB;
  return plateA < plateB;
}
