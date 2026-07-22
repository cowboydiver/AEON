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

import { labelContinentalComponents } from '../components';
import {
  BLOCK_FOUNDER_AREA_M2,
  BLOCK_FULL_OROGENY_AREA_M2,
  BLOCK_ISOSTASY_RELAX_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OROGENY_MAX_ELEVATION_M,
} from '../constants';
import { platformDatumOffsetM } from '../datums';
import { cellCount } from '../grid';
import {
  CONTINENTAL_FLOOR_ELEVATION_M,
  crustalColumnsActive,
  reconcileContinentalColumns,
} from '../isostasy';
import type { System } from '../step';

/**
 * Elevation ceiling for a continental block of the given area, m. Continuous
 * and monotonic in area: founder level below BLOCK_FOUNDER_AREA_M2, the full
 * orogeny ceiling at and above BLOCK_FULL_OROGENY_AREA_M2, a sqrt ramp
 * between. Exported for the contract test. `datumOffsetM` shifts the whole
 * ramp: the cap is physically a freeboard — the topography a block of this
 * area can hold relative to the ocean surface — so under seaLevelDatums it
 * anchors to the dynamic sea level (datums.ts); the default 0 preserves the
 * original absolute-datum behavior.
 *
 * Known mechanism interaction: the ramp takes ONE offset, and the call site
 * passes `platformDatumOffsetM` (the base of the ramp is the platform
 * founder level, which that mechanism owns). Its TOP end reuses
 * `OROGENY_MAX_ELEVATION_M`, which the `freeboard` mechanism separately
 * re-keys at the orogeny/collision cap sites via `landDatumOffsetM` — so
 * running freeboard WITHOUT seaLevelDatums leaves this cap's top absolute
 * while the orogeny ceiling rides the sea, a disagreement of `seaLevelM`.
 * Accepted: #84 is default-off and superseded by crustFates, and the two
 * datum mechanisms are designed to be enabled together (the findings doc's
 * pairing note); splitting the ramp across two offsets is not worth it for
 * a superseded prototype.
 */
export function blockElevationCap(areaM2: number, datumOffsetM = 0): number {
  const t =
    (areaM2 - BLOCK_FOUNDER_AREA_M2) / (BLOCK_FULL_OROGENY_AREA_M2 - BLOCK_FOUNDER_AREA_M2);
  if (t <= 0) return datumOffsetM + MICROCONTINENT_FOUNDER_ELEVATION_M;
  if (t >= 1) return datumOffsetM + OROGENY_MAX_ELEVATION_M;
  return (
    datumOffsetM +
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
    // Component labels + true solid-angle areas (see components.ts — the
    // shared #84/#88/#90 labeling; the warp's ±35% residual per-cell area
    // distortion is why areas are summed, not counted).
    const { componentOf, areasM2 } = labelContinentalComponents(
      state.fields.crustType,
      N,
      state.params.radiusMeters,
    );
    if (areasM2.length === 0) return state;

    // Crustal columns, C5 structural floor (trap T2 / site 17): the ramp's
    // sea-keyed base bottoms out at the identity floor e(T_min) ≈ −2306 m on
    // the columns path — this prototype may not thin a column below the
    // floor either (inert on seas above e(T_min) − MICROCONTINENT founder
    // depth; the C5 measurement scores whether thin-column foundering makes
    // the whole cap redundant there).
    const columns = crustalColumnsActive(state);
    const caps = areasM2.map((area) => {
      const cap = blockElevationCap(area, platformDatumOffsetM(state));
      return columns ? Math.max(cap, CONTINENTAL_FLOOR_ELEVATION_M) : cap;
    });

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

    // Crustal columns (C1, site 17): reconcile the cap's continental Δe into
    // thickness space at exit (this prototype is default-off; the combined
    // world still keeps the derived-cache invariant). Stage C5 measures
    // whether thin-column foundering makes this cap redundant.
    if (columns) {
      const crustalThicknessM = state.fields.crustalThicknessM.slice();
      reconcileContinentalColumns(
        state.fields.crustType,
        state.fields.elevation,
        elevation,
        crustalThicknessM,
      );
      return { ...state, fields: { ...state.fields, elevation, crustalThicknessM } };
    }

    return { ...state, fields: { ...state.fields, elevation } };
  },
};
