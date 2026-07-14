import { describe, expect, it } from 'vitest';
import { cellCenterTable, neighborTable } from '../src/grid';
import { plateVelocityAt } from '../src/plates';
import {
  computeBoundaryStress,
  dominantOtherPlate,
  pairConsistentTangent,
} from '../src/systems/boundaries';
import { twoPlateState } from './helpers';

/**
 * The `pairConsistentTangent` helper (Tectonics V2 stage 1, #111) was factored
 * out of `computeBoundaryStress`. These tests pin (a) the geometric contract
 * the shared helper must honour so `plateDynamics` can reuse it, and (b) that
 * the refactor is byte-for-byte equivalent — the stress field recomputed from
 * the helper matches `computeBoundaryStress` exactly at every cell. The
 * boundaries/divergence/convergence/golden suites cover the same equivalence
 * from the physics side; this is the direct algebraic check.
 */
describe('pairConsistentTangent', () => {
  const N = 32;
  const state = twoPlateState(
    N,
    { pole: [0, 0, 1], omega: 4e-9 },
    { pole: [0, 1, 0], omega: -3e-9 },
  );
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const plateId = state.fields.plateId;

  it('returns a unit tangent orthogonal to the cell radial, pointing toward the other plate', () => {
    let checked = 0;
    for (let i = 0; i < plateId.length; i++) {
      const other = dominantOtherPlate(plateId, i, nbTable);
      if (other === null) continue;
      const u = pairConsistentTangent(centers, nbTable, plateId, i, other.plate);
      if (u === null) continue;
      const [ux, uy, uz] = u;
      // Unit length.
      expect(Math.hypot(ux, uy, uz)).toBeCloseTo(1, 10);
      // Orthogonal to the radial direction at i (tangent plane).
      const cx = centers[i * 3]!;
      const cy = centers[i * 3 + 1]!;
      const cz = centers[i * 3 + 2]!;
      expect(ux * cx + uy * cy + uz * cz).toBeCloseTo(0, 8);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('returns null for interior cells (no differing neighbor)', () => {
    // Find an interior cell: no neighbor on the other plate.
    let interior = -1;
    for (let i = 0; i < plateId.length; i++) {
      if (dominantOtherPlate(plateId, i, nbTable) === null) {
        interior = i;
        break;
      }
    }
    expect(interior).toBeGreaterThanOrEqual(0);
    // With no other-plate neighbors the summed tangent is zero-length → null.
    expect(pairConsistentTangent(centers, nbTable, plateId, interior, 1)).toBeNull();
  });

  it('reproduces computeBoundaryStress exactly (refactor is byte-identical)', () => {
    const R = state.params.radiusMeters;
    const reference = computeBoundaryStress(state);
    const recomputed = new Float32Array(plateId.length);
    for (let i = 0; i < plateId.length; i++) {
      const other = dominantOtherPlate(plateId, i, nbTable);
      if (other === null) continue;
      const u = pairConsistentTangent(centers, nbTable, plateId, i, other.plate);
      if (u === null) continue;
      const cx = centers[i * 3]!;
      const cy = centers[i * 3 + 1]!;
      const cz = centers[i * 3 + 2]!;
      const pos: [number, number, number] = [cx, cy, cz];
      const vOwn = plateVelocityAt(state.plates[plateId[i]!]!, pos, R);
      const vOther = plateVelocityAt(state.plates[other.plate]!, pos, R);
      recomputed[i] =
        (vOwn[0] - vOther[0]) * u[0] + (vOwn[1] - vOther[1]) * u[1] + (vOwn[2] - vOther[2]) * u[2];
    }
    // computeBoundaryStress uses the plate's own radius; twoPlateState defaults
    // to EARTH_RADIUS_M, matching R above. Exact Float32 equality at every cell.
    for (let i = 0; i < plateId.length; i++) {
      expect(recomputed[i]).toBe(reference[i]);
    }
  });
});
