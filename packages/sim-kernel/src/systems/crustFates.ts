/**
 * Small-component crust fates + terrane docking (#88): consolidate the
 * continental-crust lace itself, not just the land mask.
 *
 * The #84 branched A/B (PR #87) measured the block-isostasy founder's limit
 * directly: it removes splinter *peaks* but the boundary-process layer
 * replaces foundered islands at the same rate (Δ land components ≈ 0), and
 * it cannot consolidate because it never touches crustType — the lace is a
 * crust-map object. This system gives whole small components the two fates
 * Earth actually hands microcontinents:
 *
 * 1. **Dock** (the consolidation half): a small component separated from a
 *    large component by ≤ CRUST_FATE_MERGE_GAP_CELLS of ocean welds onto it.
 *    The gap cells flip to continental crust (a suture-stamped weld — the
 *    isthmus of a docked terrane), and the whole terrane transfers to the
 *    large component's plate, so subsequent plate motion carries it WITH the
 *    continent instead of tearing the weld back open (Wrangellia-style
 *    accretion). Plate motion delivering fragments into range is the
 *    transport half; the weld firing on arrival is what makes this docking
 *    dynamics rather than cleanup of lucky drift.
 * 2. **Founder** (the disposal half): a small component with no large
 *    component in docking range subsides toward the founder level at a
 *    bounded rate, and once the WHOLE component sits at or below it — i.e.
 *    once it is already invisible in the land mask — its crust record
 *    retires: crustType → 0, sutureYears → 0, elevation left in place for
 *    the ordinary oceanic age-depth relaxation to take down smoothly. This
 *    is the one deliberate crustal-area ledger debit in the kernel (the #84
 *    founder keeps the ledger; this attacks the lace). Docking's gap-cell
 *    flips are the matching (small) credit. The continental-conservation
 *    invariants treat both as explicit, flag-gated exceptions.
 *
 * Determinism: component labels come from the shared fixed-order BFS
 * (components.ts); the dock-range map is a multi-source BFS from all large
 * components in ascending cell order; all decisions read the pre-pass
 * fields and are applied in ascending component order. No RNG is consumed,
 * so the crustFatesOnsetYears branched-A/B contract holds (bit-identical to
 * flag-off before the onset year). Gated behind params.crustFates (default
 * off): flag-off runs are byte-identical to the pre-#88 kernel.
 *
 * Pipeline position: after wilson, so it consolidates the post-reorg crust
 * map and never feeds wilson's contact scan a plateId/boundaryStress pair
 * from different partitions. When a dock transfers plate ownership,
 * boundaryStress is recomputed here for the same reason (the #55 review
 * rule: never pair post-change plateId with pre-change stress).
 */

import { labelContinentalComponents } from '../components';
import {
  CRUST_FATE_MERGE_GAP_CELLS,
  CRUST_FATE_SMALL_AREA_M2,
  CRUST_FATE_SUBSIDENCE_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
} from '../constants';
import { cellCount, neighborTable } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { computeBoundaryStress } from './boundaries';

export const crustFatesSystem: System = {
  name: 'crustFates',
  apply: (state, dtYears) => {
    if (!state.params.crustFates) return state;
    // Branched A/B (#88): inert before the onset year. No RNG is consumed
    // here, so pre-onset history is bit-identical to a flag-off run.
    if (state.timeYears < state.params.crustFatesOnsetYears) return state;

    const N = state.params.gridN;
    const count = cellCount(N);
    const nbTable = neighborTable(N);
    const { componentOf, areasM2 } = labelContinentalComponents(
      state.fields.crustType,
      N,
      state.params.radiusMeters,
    );
    const nComps = areasM2.length;
    if (nComps === 0) return state;
    const isSmall = areasM2.map((a) => a < CRUST_FATE_SMALL_AREA_M2);
    // An all-small world has no docking target, and foundering every crust
    // record would be planet-scale destruction, not consolidation — bail.
    if (!isSmall.some((s) => !s)) return state;

    // Dock-range map: multi-source BFS from every LARGE component cell,
    // expanding through OCEANIC cells only, up to the gap limit. For a
    // reached ocean cell, dist = ocean cells between it and the large
    // component (inclusive), parent = the next cell back toward it. Seeds
    // and expansion are in ascending cell order — deterministic.
    const dist = new Int32Array(count).fill(-1);
    const parent = new Int32Array(count).fill(-1);
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < count; i++) {
      const comp = componentOf[i]!;
      if (comp !== -1 && !isSmall[comp]) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const c = queue[head++]!;
      const d = dist[c]!;
      if (d >= CRUST_FATE_MERGE_GAP_CELLS) continue;
      for (let k = 0; k < 4; k++) {
        const nb = nbTable[c * 4 + k]!;
        if (dist[nb] !== -1 || componentOf[nb] !== -1) continue;
        dist[nb] = d + 1;
        parent[nb] = c;
        queue[tail++] = nb;
      }
    }

    // Member lists per small component, in ascending cell order.
    const members: number[][] = Array.from({ length: nComps }, () => []);
    for (let i = 0; i < count; i++) {
      const comp = componentOf[i]!;
      if (comp !== -1 && isSmall[comp]) members[comp]!.push(i);
    }

    // Decide each small component's fate from the PRE-pass fields; apply in
    // ascending component order (fixed order — overlapping bridge writes,
    // possible when two terranes dock across the same strait, are last-wins
    // in that order and therefore deterministic).
    const pre = state.fields;
    let elevation: Float32Array | null = null;
    let crustType: Float32Array | null = null;
    let crustAge: Float32Array | null = null;
    let sutureYears: Float32Array | null = null;
    let sedimentM: Float32Array | null = null;
    let plateId: Float32Array | null = null;

    for (let comp = 0; comp < nComps; comp++) {
      if (!isSmall[comp]) continue;
      const cells = members[comp]!;

      // Nearest dock contact: the member/ocean-neighbor pair minimizing the
      // ocean gap, ties to the lower member cell index then neighbor slot.
      let bestGap = CRUST_FATE_MERGE_GAP_CELLS + 1;
      let bestBridge = -1;
      let bestMember = -1;
      for (const m of cells) {
        for (let k = 0; k < 4; k++) {
          const nb = nbTable[m * 4 + k]!;
          const d = dist[nb]!;
          if (componentOf[nb] === -1 && d !== -1 && d < bestGap) {
            bestGap = d;
            bestBridge = nb;
            bestMember = m;
          }
        }
      }

      if (bestBridge !== -1) {
        // --- Dock. Walk the bridge back to the large component. bestBridge
        // is oceanic, so its dist is >= 1 and the walk always ends on the
        // dist-0 large-component cell the last bridge cell points to.
        const bridge: number[] = [];
        for (let c = bestBridge; dist[c]! > 0; c = parent[c]!) bridge.push(c);
        const largeEnd = parent[bridge[bridge.length - 1]!]!;
        elevation ??= pre.elevation.slice();
        crustType ??= pre.crustType.slice();
        crustAge ??= pre.crustAge.slice();
        sutureYears ??= pre.sutureYears.slice();
        sedimentM ??= pre.sedimentM.slice();
        plateId ??= pre.plateId.slice();
        const targetPlate = pre.plateId[largeEnd]!;
        // The weld strait is low ground between the two blocks: the lower of
        // the two continental endpoints (pre-pass values). Oldest endpoint
        // age wins (like the #67 hole fill); the weld line carries a fresh
        // suture stamp (docking IS a suture); accreted gap cells leave the
        // ocean sediment ledger the same way maturing arc crust does.
        const weldElev = Math.min(pre.elevation[bestMember]!, pre.elevation[largeEnd]!);
        const weldAge = Math.max(pre.crustAge[bestMember]!, pre.crustAge[largeEnd]!);
        for (const b of bridge) {
          crustType[b] = 1;
          elevation[b] = weldElev;
          crustAge[b] = weldAge;
          sutureYears[b] = state.timeYears;
          sedimentM[b] = 0;
          plateId[b] = targetPlate;
        }
        // The whole terrane transfers to the large component's plate so the
        // weld is durable under subsequent advection.
        for (const m of cells) plateId[m] = targetPlate;
        continue;
      }

      // --- Founder. Out of docking range: subside toward the founder level,
      // and retire the crust record only once the whole component (pre-pass)
      // already sits at or below it — never a visible land-mask pop.
      let maxElev = -Infinity;
      for (const m of cells) if (pre.elevation[m]! > maxElev) maxElev = pre.elevation[m]!;
      if (maxElev <= MICROCONTINENT_FOUNDER_ELEVATION_M) {
        crustType ??= pre.crustType.slice();
        sutureYears ??= pre.sutureYears.slice();
        for (const m of cells) {
          crustType[m] = 0; // the deliberate ledger debit
          sutureYears[m] = 0; // ocean carries no weld memory
          // elevation/crustAge stay: the drowned platform re-enters the
          // oceanic ledger where the age-depth relaxation (tectonics.ts)
          // takes it down at its bounded rate — no cliff.
        }
      } else {
        const relax = CRUST_FATE_SUBSIDENCE_M_PER_YR * dtYears;
        for (const m of cells) {
          const e = (elevation ?? pre.elevation)[m]!;
          if (e <= MICROCONTINENT_FOUNDER_ELEVATION_M) continue;
          elevation ??= pre.elevation.slice();
          elevation[m] = Math.max(MICROCONTINENT_FOUNDER_ELEVATION_M, e - relax);
        }
      }
    }

    if (
      elevation === null &&
      crustType === null &&
      crustAge === null &&
      sutureYears === null &&
      sedimentM === null &&
      plateId === null
    ) {
      return state;
    }

    let next: PlanetState = {
      ...state,
      fields: {
        ...state.fields,
        ...(elevation !== null ? { elevation } : {}),
        ...(crustType !== null ? { crustType } : {}),
        ...(crustAge !== null ? { crustAge } : {}),
        ...(sutureYears !== null ? { sutureYears } : {}),
        ...(sedimentM !== null ? { sedimentM } : {}),
        ...(plateId !== null ? { plateId } : {}),
      },
    };
    // A dock moved plate ownership: refresh the stress field so no keyframe
    // pairs post-dock plateId with pre-dock boundaryStress (#55 rule).
    if (plateId !== null) {
      next = {
        ...next,
        fields: { ...next.fields, boundaryStress: computeBoundaryStress(next) },
      };
    }
    return next;
  },
};
