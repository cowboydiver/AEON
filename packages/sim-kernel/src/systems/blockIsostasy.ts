/**
 * Crustal-block isostasy (#84 prototype): small continental blocks cannot
 * hold high topography.
 *
 * The deep-time "tall-island confetti" residual (#60) is manufactured at
 * plate boundaries — arc-chain creation, quantized-advection rework,
 * collision debris — and every existing repair keys on single cells: the
 * founder clamp and margin consolidation (tectonics.ts) both test "zero
 * continental 4-neighbors", so any splinter of 2+ cells is outside every
 * mechanism. Orogeny then pumps those splinters toward the 9 km cap while
 * the subsea-damped, sea-level-graded erosion (#65) preserves their peaks
 * for gigayears.
 *
 * This system closes that gap with the isostatic argument, applied to whole
 * components instead of single cells: a continental block's elevation
 * ceiling grows with its area. Each step it labels the 4-connected
 * components of continental crust (fixed-order BFS — deterministic) and
 * relaxes elevation standing above the component's ceiling toward it at a
 * bounded rate:
 *
 *   cap(A) = FOUNDER + (OROGENY_MAX − FOUNDER) · sqrt(t),
 *   t = clamp((A − BLOCK_FOUNDER_AREA_M2) /
 *             (BLOCK_FULL_OROGENY_AREA_M2 − BLOCK_FOUNDER_AREA_M2), 0, 1)
 *
 * Below the founder area the cap is MICROCONTINENT_FOUNDER_ELEVATION_M: the
 * block founders as submerged platform — crustType is untouched, so the
 * crustal-area ledger and every conservation invariant are untouched, and a
 * foundered block can later re-accrete (Zealandia-style), exactly like the
 * one-cell founder clamp it generalizes. At and above the full-orogeny area
 * the cap equals OROGENY_MAX_ELEVATION_M and the system is inert — true
 * continents keep their mountains.
 *
 * Deliberately NON-conservative (subsidence, not transport), same
 * justification as orogenic root decay (#65). The cap never raises
 * elevation, reads only crustType + the component labels, and writes only
 * continental cells' elevation, so scan order cannot leak into the result.
 * Gated behind params.blockIsostasy (default off): flag-off runs are
 * byte-identical to the pre-#84 kernel.
 */

import {
  BLOCK_FOUNDER_AREA_M2,
  BLOCK_FULL_OROGENY_AREA_M2,
  BLOCK_ISOSTASY_RELAX_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OROGENY_MAX_ELEVATION_M,
} from '../constants';
import { cellCount, cellSolidAngleTable, neighborTable } from '../grid';
import type { System } from '../step';

/**
 * Elevation ceiling for a continental block of the given area, m. Continuous
 * and monotonic in area: founder level below BLOCK_FOUNDER_AREA_M2, the full
 * orogeny ceiling at and above BLOCK_FULL_OROGENY_AREA_M2, a sqrt ramp
 * between. Exported for the contract test.
 */
export function blockElevationCap(areaM2: number): number {
  const t =
    (areaM2 - BLOCK_FOUNDER_AREA_M2) / (BLOCK_FULL_OROGENY_AREA_M2 - BLOCK_FOUNDER_AREA_M2);
  if (t <= 0) return MICROCONTINENT_FOUNDER_ELEVATION_M;
  if (t >= 1) return OROGENY_MAX_ELEVATION_M;
  return (
    MICROCONTINENT_FOUNDER_ELEVATION_M +
    (OROGENY_MAX_ELEVATION_M - MICROCONTINENT_FOUNDER_ELEVATION_M) * Math.sqrt(t)
  );
}

export const blockIsostasySystem: System = {
  name: 'blockIsostasy',
  apply: (state, dtYears) => {
    if (!state.params.blockIsostasy) return state;
    // Branched A/B (#84): inert before the onset year. No RNG is consumed
    // here, so pre-onset history is bit-identical to a flag-off run.
    if (state.timeYears < state.params.blockIsostasyOnsetYears) return state;

    const N = state.params.gridN;
    const count = cellCount(N);
    const nbTable = neighborTable(N);
    const { crustType } = state.fields;
    const R = state.params.radiusMeters;
    // True per-cell areas: the warp leaves ±35% residual area distortion, so
    // a component's area — which sets its ceiling — sums real solid angles
    // rather than counting cells × the mean. Accumulation order is BFS
    // discovery order, which is deterministic (fixed scan + neighbor order).
    const solidAngle = cellSolidAngleTable(N);

    // Label 4-connected continental components, iterative BFS in ascending
    // cell order (recursion would overflow on a supercontinent at N=128).
    const componentOf = new Int32Array(count).fill(-1);
    const queue = new Int32Array(count);
    const componentOmega: number[] = [];
    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1 || componentOf[i] !== -1) continue;
      const comp = componentOmega.length;
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
      componentOmega.push(omega);
    }
    if (componentOmega.length === 0) return state;

    const caps = componentOmega.map((omega) => blockElevationCap(omega * R * R));

    // Rate-bounded subsidence toward the cap; never raises. The elevation
    // array is copied lazily so an all-continents-huge step (caps inert)
    // returns the input state unchanged.
    const relax = BLOCK_ISOSTASY_RELAX_M_PER_YR * dtYears;
    let elevation: Float32Array | null = null;
    for (let i = 0; i < count; i++) {
      const comp = componentOf[i]!;
      if (comp === -1) continue;
      const cap = caps[comp]!;
      const e = (elevation ?? state.fields.elevation)[i]!;
      if (e <= cap) continue;
      elevation ??= state.fields.elevation.slice();
      elevation[i] = Math.max(cap, e - relax);
    }
    if (elevation === null) return state;

    return { ...state, fields: { ...state.fields, elevation } };
  },
};
