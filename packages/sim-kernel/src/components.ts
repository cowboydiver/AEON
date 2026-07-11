/**
 * Shared continental-component labeling for the block-scale mechanisms
 * (#84 blockIsostasy, #88 crustFates, #90 marine planation).
 *
 * Labels the 4-connected components of continental crust (crustType == 1)
 * with an iterative BFS in ascending cell order — deterministic by
 * construction (fixed scan + neighbor order), and iterative because a
 * recursive flood fill would overflow on a supercontinent at N=128.
 *
 * Component area sums TRUE per-cell solid angles × R² (cellSolidAngleTable):
 * the cube-sphere warp leaves ±35% residual per-cell area distortion, enough
 * to mis-bin threshold-scale blocks near face corners if cells × mean area
 * were used (the PR #85 review finding). Accumulation order is BFS discovery
 * order, which is deterministic, so the float sum is bit-stable.
 */

import { cellCount, cellSolidAngleTable, neighborTable } from './grid';

export interface ContinentalComponents {
  /** Component label per cell; -1 for oceanic cells. */
  componentOf: Int32Array;
  /** True area per component, m² (solid angle × R²), indexed by label. */
  areasM2: number[];
}

export function labelContinentalComponents(
  crustType: Float32Array,
  N: number,
  radiusMeters: number,
): ContinentalComponents {
  const count = cellCount(N);
  const nbTable = neighborTable(N);
  const solidAngle = cellSolidAngleTable(N);
  const componentOf = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  const omegas: number[] = [];
  for (let i = 0; i < count; i++) {
    if (crustType[i] !== 1 || componentOf[i] !== -1) continue;
    const comp = omegas.length;
    let omega = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    componentOf[i] = comp;
    while (head < tail) {
      const c = queue[head++]!;
      omega += solidAngle[c]!;
      for (let k = 0; k < 4; k++) {
        const nb = nbTable[c * 4 + k]!;
        if (crustType[nb] === 1 && componentOf[nb] === -1) {
          componentOf[nb] = comp;
          queue[tail++] = nb;
        }
      }
    }
    omegas.push(omega);
  }
  // Kept as (ω · R) · R — the exact expression blockIsostasy shipped with —
  // so extracting this helper cannot move a flag-on golden by one ulp.
  return { componentOf, areasM2: omegas.map((o) => o * radiusMeters * radiusMeters) };
}
