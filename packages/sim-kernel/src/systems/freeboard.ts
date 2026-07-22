/**
 * Freeboard regulation (the "real fix" scoped in
 * docs/SEA_LEVEL_DATUM_FINDINGS.md, "Follow-up"): continental crust floats.
 *
 * The `seaLevelDatums` prototype made the submerged-platform constants
 * correct in any sea-level regime; this mechanism changes the REGIME. Earth
 * keeps ~25% of its continental crust flooded because isostasy regulates
 * freeboard — the continental surface floats a few hundred metres above a
 * sea level pinned near the shelf edge, erosion planes land toward it, and
 * subsidence lets margins and interiors dip below it. The kernel's
 * deep-time sea level instead falls ~3 km away from continents that have no
 * downward coupling at all (measured in the findings doc): nothing ever
 * pushes continental crust toward the water. Two terms restore the
 * coupling, both pure functions of the previous step's `globals.seaLevelM`
 * (the standard explicit climate lag):
 *
 * 1. **Epeirogenic relaxation** — the cell-count mean of continental
 *    elevation relaxes toward `seaLevelM + FREEBOARD_TARGET_M` by a
 *    UNIFORM, rate-bounded shift of every continental cell
 *    (±FREEBOARD_RELAX_M_PER_YR). Uniform because it is the isostatic
 *    motion of the floating crust column, not a surface process: relief is
 *    exactly preserved, so orogeny/erosion keep full ownership of shape
 *    while freeboard owns the datum the shape rides on. Two-sided (a world
 *    whose sea RISES over its continents rebounds), though in the shipped
 *    regime the sea only falls and the shift is essentially always down.
 *    The downward shift stops at the buoyancy floor `seaLevelM +
 *    CONTINENTAL_BUOYANCY_FLOOR_M`: orogeny keeps injecting elevation into
 *    active belts, the compensating sink drags everything else down, and
 *    without the floor flooded interiors — which nothing ever lifts —
 *    ratcheted to −17 km within 2 Gyr (measured), deepening the ocean and
 *    pulling sea level down after them. Continental crust floats; it does
 *    not visit abyssal depths. Deliberately NOT conservative: like the #84
 *    founder and the orogenic root decay, vertical isostatic motion is
 *    subsidence/uplift of the column, not transport of rock.
 *
 * 2. **Passive-margin subsidence** — continental cells within
 *    PASSIVE_MARGIN_WIDTH_CELLS (BFS through continental crust) of a
 *    SAME-PLATE oceanic 4-neighbor subside toward `seaLevelM +
 *    PASSIVE_MARGIN_SHELF_M` at PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR,
 *    downward only. Same-plate ocean adjacency IS the passive-margin
 *    definition (an active margin has a plate boundary along the coast);
 *    cells under convergent stress (> ACTIVE_MARGIN_STRESS_M_PER_YR) are
 *    excluded — orogeny owns those coasts, and the two processes would
 *    otherwise fight at ~30× rate disadvantage anyway. This is post-rift
 *    thermal subsidence in prototype form: a constant mean rate (~2 km per
 *    100 Myr) instead of a per-cell rift clock, so no new field. The band
 *    is measured from oceanic crust only — flooded margin cells stay
 *    continental, so the shelf cannot creep inland; it stays a fringe of
 *    fixed cell width against true ocean.
 *
 * A third piece lives at the call sites, not here: `landDatumOffsetM`
 * (datums.ts) re-keys the land-relief constants (orogenic-root reference,
 * orogeny ceiling) to the dynamic sea level under this same flag, so
 * mountains cap and roots decay relative to the sea the continents now
 * track. See the datums.ts comment for why that re-key belongs to this
 * mechanism and not to `seaLevelDatums`.
 *
 * Why no feedback runaway: sea level is solved from the conserved water
 * volume against the hypsometry, which is dominated by the absolutely
 * anchored oceanic age-depth curve. Continents relaxing toward
 * `seaLevelM + target` READ the level but barely move it (sinking land
 * above the waterline changes no ocean volume; flooding at the margin is a
 * second-order correction with a stabilizing sign), so the pair converges —
 * unlike re-keying the age-depth curve itself, which the findings doc shows
 * is unconditionally divergent.
 *
 * Under `crustalColumns` (docs/CRUSTAL_COLUMN_PROPOSAL.md): term (1) and
 * its buoyancy floor are RETIRED on the columns path — freeboard is the
 * mass budget's output there (site 20; pulled forward from stage C5 by the
 * §9 risk 3 escalation after the C3 gate measured the servo dominating the
 * honest injectors — see CRUSTAL_COLUMN_STAGE_C3_GATE.md). Term (2)
 * remains a ΔT = Δe/k shim until C6.
 *
 * Determinism: no RNG, fixed-order scans, one BFS in ascending seed order.
 * Gated behind params.freeboard (default off) with the standard
 * freeboardOnsetYears branched-A/B contract; flag-off is byte-identical
 * (the system returns the input state untouched).
 *
 * Pipeline position: after blockIsostasy (with erosion/crustFates before
 * it), so it adjusts the fully-reworked relief and the climate stack reads
 * the adjusted elevation; before seaLevel re-solves, so each step's solve
 * sees this step's continents (the freeboard read is the previous step's
 * level — the explicit lag).
 */

import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  CONTINENTAL_BUOYANCY_FLOOR_M,
  FREEBOARD_RELAX_M_PER_YR,
  FREEBOARD_TARGET_M,
  PASSIVE_MARGIN_SHELF_M,
  PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR,
  PASSIVE_MARGIN_WIDTH_CELLS,
} from '../constants';
import { cellCount, neighborTable } from '../grid';
import {
  CONTINENTAL_FLOOR_ELEVATION_M,
  crustalColumnsActive,
  reconcileContinentalColumns,
} from '../isostasy';
import type { System } from '../step';

export const freeboardSystem: System = {
  name: 'freeboard',
  apply: (state, dtYears) => {
    if (!state.params.freeboard) return state;
    // Branched A/B: inert before the onset year. No RNG is consumed here,
    // so pre-onset history is bit-identical to a flag-off run.
    if (state.timeYears < state.params.freeboardOnsetYears) return state;

    const N = state.params.gridN;
    const count = cellCount(N);
    const nbTable = neighborTable(N);
    const { crustType, plateId, boundaryStress } = state.fields;
    const old = state.fields.elevation;
    // Previous step's sea level (the #33 explicit lag), like every other
    // cross-system read in the climate block.
    const seaLevel = state.globals.seaLevelM;
    // Crustal columns: site 20 — term (1) and its buoyancy floor — is
    // RETIRED on the columns path (pulled forward from stage C5 by the §9
    // risk 3 escalation, C3 gate record §5: with the C3-honest injectors
    // the servo dominated the vertical balance and ground the continents
    // onto its sea+400 target). Freeboard is now the mass budget's output;
    // the −17.8 km ratchet the floor guarded against is non-expressible in
    // thickness space (e ≥ C + k·T_min once C5 regularizes the shim lobe).
    // Term (2), the margin band, remains a C1 shim until C6.
    const columns = crustalColumnsActive(state);

    // --- (1) Epeirogenic relaxation: uniform shift of the continental stack.
    let sum = 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (crustType[i] === 1) {
        sum += old[i]!;
        n++;
      }
    }
    if (n === 0) return state; // waterworld: nothing floats
    const gap = seaLevel + FREEBOARD_TARGET_M - sum / n;
    const bound = FREEBOARD_RELAX_M_PER_YR * dtYears;
    const delta = Math.max(-bound, Math.min(bound, gap));

    // --- (2) Passive-margin band: BFS depth through continental crust from
    // same-plate oceanic adjacency (depth 1 = coast), up to the band width.
    // Convergent cells are excluded throughout — never seeded, expanded
    // through, or subsided (orogeny owns them).
    const depth = new Int32Array(count).fill(-1);
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1) continue;
      if (boundaryStress[i]! > ACTIVE_MARGIN_STRESS_M_PER_YR) continue;
      for (let k = 0; k < 4; k++) {
        const nb = nbTable[i * 4 + k]!;
        if (crustType[nb] === 0 && plateId[nb] === plateId[i]) {
          depth[i] = 1;
          queue[tail++] = i;
          break;
        }
      }
    }
    while (head < tail) {
      const c = queue[head++]!;
      const d = depth[c]!;
      if (d >= PASSIVE_MARGIN_WIDTH_CELLS) continue;
      for (let k = 0; k < 4; k++) {
        const nb = nbTable[c * 4 + k]!;
        if (depth[nb] !== -1 || crustType[nb] !== 1) continue;
        if (boundaryStress[nb]! > ACTIVE_MARGIN_STRESS_M_PER_YR) continue;
        depth[nb] = d + 1;
        queue[tail++] = nb;
      }
    }

    // C5 structural floor (trap T2): on the columns path the margin shim's
    // sea-keyed stop bottoms out at the identity floor e(T_min) ≈ −2306 m —
    // no columns-path process may thin a column below it. Inert whenever the
    // sea sits above e(T_min) + PASSIVE_MARGIN_SHELF_M (every measured
    // scale-1.0 sea); it binds only on the dry half of the water sweep.
    // Stage C6 replaces the whole term with the finite-β rift thinning.
    const shelfLevel = columns
      ? Math.max(seaLevel + PASSIVE_MARGIN_SHELF_M, CONTINENTAL_FLOOR_ELEVATION_M)
      : seaLevel + PASSIVE_MARGIN_SHELF_M;
    const floorLevel = seaLevel + CONTINENTAL_BUOYANCY_FLOOR_M;
    const subside = PASSIVE_MARGIN_SUBSIDENCE_M_PER_YR * dtYears;
    const elevation = old.slice();
    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1) continue;
      let e = elevation[i]!;
      // The epeirogenic shift and its buoyancy floor apply on the LEGACY
      // path only — retired on the columns path (see above). The downward
      // shift stops at the buoyancy floor (continental crust floats — see
      // CONTINENTAL_BUOYANCY_FLOOR_M for the unbounded-ratchet failure this
      // prevents); cells already below the floor are left in place, never
      // lifted. Upward shifts apply everywhere.
      if (!columns) {
        if (delta >= 0) e += delta;
        else if (e > floorLevel) e = Math.max(floorLevel, e + delta);
      }
      // Downward only, clamped at the shelf level — subsidence never raises
      // a cell and never digs the shelf past its target.
      if (depth[i] !== -1 && e > shelfLevel) e = Math.max(shelfLevel, e - subside);
      elevation[i] = e;
    }

    // Crustal columns (C1, site 21): the margin subsidence above ran with
    // today's arithmetic; reconcile its continental Δe into thickness space
    // at exit (ΔT = Δe/k — the mechanical shim). Stage C6 replaces it with
    // the finite-budget rift-margin thinning (proposal §6). Site 20
    // contributes no Δe here anymore — retired above.
    if (columns) {
      const crustalThicknessM = state.fields.crustalThicknessM.slice();
      reconcileContinentalColumns(crustType, old, elevation, crustalThicknessM);
      return { ...state, fields: { ...state.fields, elevation, crustalThicknessM } };
    }

    return { ...state, fields: { ...state.fields, elevation } };
  },
};
