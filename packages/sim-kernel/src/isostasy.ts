/**
 * Airy isostasy for the crustal-column model (docs/CRUSTAL_COLUMN_PROPOSAL.md
 * §2, the `crustalColumns` mechanism): pure helpers, no state imports beyond
 * types. Continental surface elevation is a derived cache of the primary
 * `crustalThicknessM` field:
 *
 *   e(T) = CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR · T
 *
 * (e(20 km) = −2306 m, e(39 km) = +400 m, e(70 km) = +4815 m). The datum is a
 * FIXED constant — it never reads sea level, which is what keeps the
 * derivation T1-safe by construction. The oceanic branch is deliberately NOT
 * here: oceanic elevation keeps the empirical age-depth machinery verbatim
 * (bathymetry.ts), and oceanic `crustalThicknessM` is ledger bookkeeping
 * pinned at OCEANIC_CRUST_THICKNESS_M in v1.
 *
 * The derived-cache contract (the C1 coherence invariant): every continental
 * elevation writer under the active mechanism stores thickness FIRST, then
 * re-derives elevation from the STORED (Float32-rounded) thickness — so
 * `elevation[i] === fround(C + k · crustalThicknessM[i])` holds bit-exactly
 * for every continental cell after every post-onset step. That is what the
 * derivation-coherence fixture asserts with zero tolerance.
 *
 * Shim-era validity domain (C1–C4, proposal §6) — CLOSED at stage C5: cells
 * the legacy freeboard pump held below e(T_min) inverted to unphysically
 * thin, even negative, columns; the onset re-inversion now regularizes them
 * with the one-time `T := max(T, CONTINENTAL_THICKNESS_MIN_M)` credit
 * (declared, counted in `columnsRegularizedCreditM3`). Post-onset the floor
 * is STRUCTURAL (trap T2): no columns-path process thins a continental
 * column below the identity floor, therefore no continental cell sits below
 * `CONTINENTAL_FLOOR_ELEVATION_M` = e(T_min) ≈ −2306 m — asserted as a
 * fixture, not policed by a clamp constant. The −17.8 km ratchet is
 * non-expressible.
 *
 * Determinism: every helper is closed-form arithmetic — no RNG, no loops
 * beyond fixed ascending-index sweeps, no I/O, no input mutation.
 */

import {
  CONTINENTAL_BUOYANCY_FACTOR,
  CONTINENTAL_ISOSTASY_DATUM_M,
  CONTINENTAL_THICKNESS_MIN_M,
  CRUST_DENSITY_CONTINENTAL_KG_M3,
  CRUST_DENSITY_OCEANIC_KG_M3,
  OCEANIC_CRUST_THICKNESS_M,
  SEDIMENT_DENSITY_KG_M3,
} from './constants';
import { cellCount, cellSolidAngleTable } from './grid';
import type { Fields } from './fields';
import type { PlanetState } from './state';

/** Continental branch of the derivation: surface elevation of a column, m. */
export function continentalElevationForThicknessM(thicknessM: number): number {
  return CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * thicknessM;
}

/** Inverse of the continental branch: the column thickness whose derived
 *  elevation is `elevationM` — the founding/onset/branch-flip inversion, m. */
export function continentalThicknessForElevationM(elevationM: number): number {
  return (elevationM - CONTINENTAL_ISOSTASY_DATUM_M) / CONTINENTAL_BUOYANCY_FACTOR;
}

/**
 * The structural continental floor elevation (stage C5, trap T2):
 * e(CONTINENTAL_THICKNESS_MIN_M) ≈ −2306 m — the surface of the thinnest
 * column any columns-path process may leave behind. Every sea-keyed thinning
 * stop (crustFates founder, the site-4 sliver trim, the site-21 margin shim,
 * erosion's export/planation base levels, the site-17 block cap) bottoms out
 * here on the columns path; on seas ABOVE this level the sea-keyed stop binds
 * first and the floor is inert, on seas BELOW it (the dry half of the water
 * sweep) the floor is what keeps thinning bounded.
 */
export const CONTINENTAL_FLOOR_ELEVATION_M = continentalElevationForThicknessM(
  CONTINENTAL_THICKNESS_MIN_M,
);

/** The standard mechanism gate: on AND past its onset year (the branched-A/B
 *  contract — no RNG is consumed anywhere in this model, so pre-onset history
 *  is bit-identical to a flag-off run). */
export function crustalColumnsActive(state: PlanetState): boolean {
  return state.params.crustalColumns && state.timeYears >= state.params.crustalColumnsOnsetYears;
}

/**
 * Found `crustalThicknessM` by pure inversion of the current terrain:
 * continental cells invert their elevation, oceanic cells reset to 7.1 km.
 * Used unconditionally at init (state.ts — so both A/B arms carry comparable
 * field bytes) and again at the onset step (below). Writes ONLY the returned
 * thickness array; elevation is never touched here.
 */
export function foundCrustalThickness(
  elevation: Float32Array,
  crustType: Float32Array,
): Float32Array {
  const thickness = new Float32Array(elevation.length);
  for (let i = 0; i < elevation.length; i++) {
    thickness[i] =
      crustType[i] === 1
        ? continentalThicknessForElevationM(elevation[i]!)
        : OCEANIC_CRUST_THICKNESS_M;
  }
  return thickness;
}

/**
 * The onset re-inversion (proposal §2.5, the zero-snap rule): at the ONSET
 * STEP — the first step whose start time has crossed `crustalColumnsOnsetYears`
 * — re-found thickness over the CURRENT elevation and snap each continental
 * cell's elevation onto the derived manifold (`fround(C + k·T)`, a ≤ 1-ULP
 * rounding of the same value — no physical snap, elevation is continuous
 * through onset). Post-onset divergence from a flag-off run is therefore
 * purely the shims' float-level effect, which is what makes the branched A/B
 * clean at ANY onset year. Returns the input state unchanged off the onset
 * step. Runs at the top of tectonics (the first system), so the onset step's
 * own writers already see coherent columns.
 *
 * The crossing test uses this step's dt: the onset step is the one with
 * `timeYears ∈ [onset, onset + dt)` under the fixed step cadence (the final
 * partial step can only shrink dt after the crossing has already fired).
 *
 * Stage C5 adds the ONE-TIME regularization to the same pass: continental
 * cells whose inversion lands below `CONTINENTAL_THICKNESS_MIN_M` (the legacy
 * pump's flooded lobe — the shim-era validity domain) are lifted to the floor,
 * the lift counted as a declared ledger credit (`columnsRegularizedCreditM3`,
 * true areas — T7). Onset elevation is therefore continuous EXCEPT on those
 * below-floor cells, which snap up to e(T_min) ≈ −2306 m — the C3-addendum
 * measurement puts this credit ≈ nil on the shipped stack (the lobe dissipated
 * once the pump retired), and the A/B statistic reports whatever it actually
 * is (§9 risk 3's re-staging trigger if large).
 */
export function crustalColumnsOnsetReinversion(state: PlanetState, dtYears: number): PlanetState {
  if (!state.params.crustalColumns) return state;
  const onset = state.params.crustalColumnsOnsetYears;
  if (!(state.timeYears >= onset && state.timeYears - dtYears < onset)) return state;

  const crustType = state.fields.crustType;
  const elevation = state.fields.elevation.slice();
  const thickness = foundCrustalThickness(elevation, crustType);
  const solidAngle = cellSolidAngleTable(state.params.gridN);
  const r2 = state.params.radiusMeters * state.params.radiusMeters;
  let regularizedCreditM3 = 0;
  for (let i = 0; i < elevation.length; i++) {
    if (crustType[i] === 1) {
      // C5 regularization: the physical floor, applied once at onset.
      if (thickness[i]! < CONTINENTAL_THICKNESS_MIN_M) {
        regularizedCreditM3 += (CONTINENTAL_THICKNESS_MIN_M - thickness[i]!) * solidAngle[i]! * r2;
        thickness[i] = CONTINENTAL_THICKNESS_MIN_M;
      }
      // Snap onto the derived manifold: read back the STORED (f32-rounded)
      // thickness so the coherence invariant is bit-exact from here on.
      elevation[i] = continentalElevationForThicknessM(thickness[i]!);
    }
  }
  return {
    ...state,
    globals: {
      ...state.globals,
      columnsRegularizedCreditM3: state.globals.columnsRegularizedCreditM3 + regularizedCreditM3,
    },
    fields: { ...state.fields, elevation, crustalThicknessM: thickness },
  };
}

/**
 * The shared C1 shim: reconcile a system's continental elevation writes into
 * thickness space at system exit. `entryElevation` is the system-entry
 * elevation (coherent by induction), `elevation` the working array after the
 * system applied its raw Δe exactly as the flag-off path would. For every
 * continental cell that moved: ΔT = Δe / k, then elevation re-derived from
 * the stored thickness. Intermediate arithmetic inside the system is thus
 * bit-identical to flag-off; only the stored result is snapped onto the
 * manifold (± 1 f32 ULP — the designed float-level divergence the C1
 * distributional gate accepts). Mutates `elevation` and `thickness` in place
 * (both must be working copies owned by the caller).
 */
export function reconcileContinentalColumns(
  crustType: Float32Array,
  entryElevation: Float32Array,
  elevation: Float32Array,
  thickness: Float32Array,
): void {
  for (let i = 0; i < crustType.length; i++) {
    if (crustType[i] !== 1) continue;
    const dE = elevation[i]! - entryElevation[i]!;
    if (dE === 0) continue;
    thickness[i] = thickness[i]! + dE / CONTINENTAL_BUOYANCY_FACTOR;
    elevation[i] = continentalElevationForThicknessM(thickness[i]!);
  }
}

/**
 * Branch-flip helper (oceanic → continental: arc maturation, weld bridges,
 * consolidation hole fills): found the cell's thickness by inversion of its
 * current elevation and snap the elevation onto the manifold. When the
 * maturation gate passes, the inversion is ≥ 20 km by algebra — no clamp —
 * and elevation is continuous through the flip by construction (the
 * crustFates no-pop house semantics; proposal §2.4). The assigned mass IS the
 * ledger's arc-accretion credit.
 */
export function foundColumnFromElevation(
  elevation: Float32Array,
  thickness: Float32Array,
  i: number,
): void {
  thickness[i] = continentalThicknessForElevationM(elevation[i]!);
  elevation[i] = continentalElevationForThicknessM(thickness[i]!);
}

/** One crustal mass ledger snapshot, kg (true solid angles × R² — trap T7). */
export interface CrustalMassLedger {
  /** Σ over continental cells of T·ρ_cc·area. Shim-era caveat: pump-flooded
   *  cells carry raw (possibly negative) Δ-space thickness — reported, not
   *  clamped (proposal §6 C1). */
  continentalMassKg: number;
  /** Σ over oceanic cells of T·ρ_oc·area (uniform 7.1 km columns in v1). */
  oceanicMassKg: number;
  /** Σ sedimentM·ρ_sed·area (the oceanic sediment cover). */
  sedimentMassKg: number;
}

/**
 * The mass-ledger diagnostic (proposal §5): the conserved-modulo-declared-flows
 * quantity the staged migration reports at every gate. Pure reduction over the
 * fields in ascending index order (fixed FP order — deterministic). At C1 the
 * per-term closure is NOT asserted — the shims mirror today's deliberately
 * non-conservative mechanisms — so this is a reported tripwire; per-system
 * closure fixtures activate at C2 when writers become mass transactions.
 */
export function computeCrustalMassLedger(
  fields: Pick<Fields, 'crustalThicknessM' | 'crustType' | 'sedimentM'>,
  gridN: number,
  radiusMeters: number,
): CrustalMassLedger {
  const count = cellCount(gridN);
  const solidAngle = cellSolidAngleTable(gridN);
  const r2 = radiusMeters * radiusMeters;
  const { crustalThicknessM, crustType, sedimentM } = fields;
  let cont = 0;
  let ocean = 0;
  let sed = 0;
  for (let i = 0; i < count; i++) {
    const area = solidAngle[i]! * r2;
    if (crustType[i] === 1) {
      cont += crustalThicknessM[i]! * area;
    } else {
      ocean += crustalThicknessM[i]! * area;
      sed += sedimentM[i]! * area;
    }
  }
  return {
    continentalMassKg: cont * CRUST_DENSITY_CONTINENTAL_KG_M3,
    oceanicMassKg: ocean * CRUST_DENSITY_OCEANIC_KG_M3,
    sedimentMassKg: sed * SEDIMENT_DENSITY_KG_M3,
  };
}
