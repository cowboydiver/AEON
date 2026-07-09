/**
 * Dynamic sea level (#33) — the system that makes the coastline move. Sea level
 * is not a fixed datum any more: it floats on a conserved water inventory whose
 * partition between liquid ocean and grounded ice shifts with the climate, so
 * ice ages drop the sea and expose shelves while warm intervals flood them.
 *
 * DERIVED (§0): unlike the slow `ice`/CO₂ reservoirs it reads, `seaLevel` holds
 * no state of its own — it re-solves `seaLevelM` from the current bathymetry and
 * ice each step. The conserved quantity is the total water inventory
 * (`globals.waterInventoryM`, a global-equivalent layer thickness set once at
 * init from the initial coastline). Grounded ice withdraws its water-equivalent
 * from the ocean; the rest is liquid, and sea level is the level at which the
 * liquid exactly fills the hypsometry:
 *
 *     oceanVolume(seaLevelM) = waterInventoryM − grounded-ice water-equivalent
 *
 * Only ice on cells standing above sea level is *grounded* and locks water out;
 * floating **sea ice** (on cells below sea level) already displaces its own
 * water (Archimedes) and does not change the level — it whitens the albedo (#30)
 * but not the shoreline. The ocean-volume function is continuous and monotonic
 * in sea level, so the solve is a FIXED-count bisection (deterministic — never a
 * `while (!converged)`), and `landFraction` is recomputed as the emergent share
 * of cells standing above the solved level. Pure: a function of `elevation`, the
 * `iceFraction` field, and the conserved inventory only.
 */

import { ICE_SHEET_WATER_EQUIV_M, SEA_LEVEL_SOLVE_ITERATIONS } from '../constants';
import { cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/**
 * Mean ocean-water column for a candidate sea level, as a global-equivalent
 * layer thickness (cell-count mean of the flooded depth `max(0, seaLevel −
 * elevation)`). Monotonically increasing in `seaLevel`; the inverse of this is
 * what the solve finds.
 */
export function oceanVolumeMean(elevation: Float32Array, count: number, seaLevel: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const d = seaLevel - elevation[i]!;
    if (d > 0) sum += d;
  }
  return sum / count;
}

/**
 * Solve the sea level (m, relative to the 0 m crust datum) whose ocean volume
 * equals `targetOceanMean` (a global-equivalent layer thickness), by fixed-count
 * bisection over the elevation range. Deterministic and robust:
 *  - a non-positive target (all water locked as ice) yields the lowest cell —
 *    no liquid ocean;
 *  - a target exceeding the basin capacity to the highest peak puts sea level in
 *    the "everything submerged" regime, where ocean volume is linear
 *    (`seaLevel − meanElevation`) and the level is returned in closed form.
 *
 * Runs on a sorted copy of the elevations with prefix sums, so each bisection
 * probe is an O(log cells) query (`k·s − prefix[k]`, k = cells below s) rather
 * than an O(cells) sweep — this solve runs every step of every deep-time run, so
 * the cost matters. The sort also yields min/max/mean for the edge cases.
 */
export function solveSeaLevel(
  elevation: Float32Array,
  count: number,
  targetOceanMean: number,
): number {
  // Sorted ascending copy + prefix sums (prefix[k] = sum of the k smallest
  // elevations). Float32 ⊂ Float64, so the copy is exact; TypedArray.sort is
  // numeric-ascending and deterministic.
  const sorted = Float64Array.from(elevation);
  sorted.sort();
  const prefix = new Float64Array(count + 1);
  for (let k = 0; k < count; k++) prefix[k + 1] = prefix[k]! + sorted[k]!;
  const lo = sorted[0]!;
  const hi = sorted[count - 1]!;
  const meanElev = prefix[count]! / count;

  if (targetOceanMean <= 0) return lo; // no liquid ocean
  // At seaLevel = hi (highest peak) every cell is submerged, so ocean volume is
  // exactly hi − meanElev. Beyond that the function stays linear, so if the
  // target needs more water than that, the level is closed-form.
  if (targetOceanMean >= hi - meanElev) return targetOceanMean + meanElev;

  const targetVol = targetOceanMean * count;
  // oceanVolume(s)·count = Σ max(0, s − e) = k·s − prefix[k], k = #{cells < s},
  // found by a bounded binary search (deterministic, terminates in ≤ log₂cells
  // steps — NOT a convergence loop).
  const volTimesCount = (s: number): number => {
    let a = 0;
    let b = count;
    while (a < b) {
      const m = (a + b) >> 1;
      if (sorted[m]! < s) a = m + 1;
      else b = m;
    }
    return a * s - prefix[a]!;
  };

  // Bisect [lo, hi]: volume is 0 at lo, ≥ target at hi, and monotonic.
  let a = lo;
  let b = hi;
  for (let k = 0; k < SEA_LEVEL_SOLVE_ITERATIONS; k++) {
    const m = (a + b) / 2;
    if (volTimesCount(m) < targetVol) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

export interface SeaLevelSolution {
  /** Solved global sea level relative to the 0 m crust datum, m. */
  readonly seaLevelM: number;
  /** Emergent fraction of cells standing at or above `seaLevelM`. */
  readonly landFraction: number;
  /** Grounded-ice water-equivalent locked out of the ocean, global-equiv m. */
  readonly lockedIceEquivM: number;
  /** Liquid ocean volume at the solution, global-equiv m (≈ inventory − locked). */
  readonly oceanEquivM: number;
}

/**
 * Solve sea level and land fraction for the current state. Grounded ice is
 * classified against the previous step's `seaLevelM` (a one-step lag, like every
 * other cross-system read in the climate block) — ice sheets sit well above the
 * shoreline, so the classification is insensitive to the sea-level move it feeds.
 */
export function solveSeaLevelState(state: PlanetState): SeaLevelSolution {
  const N = state.params.gridN;
  const count = cellCount(N);
  const { elevation, iceFraction } = state.fields;
  const prevSeaLevel = state.globals.seaLevelM;

  // Water-equivalent locked in GROUNDED ice (cells above the shoreline); sea
  // ice floats and locks nothing.
  let lockedSum = 0;
  for (let i = 0; i < count; i++) {
    if (elevation[i]! >= prevSeaLevel) lockedSum += iceFraction[i]! * ICE_SHEET_WATER_EQUIV_M;
  }
  const lockedIceEquivM = lockedSum / count;
  const targetOceanMean = state.globals.waterInventoryM - lockedIceEquivM;

  const seaLevelM = solveSeaLevel(elevation, count, targetOceanMean);

  let land = 0;
  for (let i = 0; i < count; i++) if (elevation[i]! >= seaLevelM) land++;

  return {
    seaLevelM,
    landFraction: land / count,
    lockedIceEquivM,
    oceanEquivM: oceanVolumeMean(elevation, count, seaLevelM),
  };
}

/** Update `seaLevelM` and `landFraction` from the current ice and bathymetry. */
export function applySeaLevel(state: PlanetState): PlanetState {
  const sol = solveSeaLevelState(state);
  return {
    ...state,
    globals: { ...state.globals, seaLevelM: sol.seaLevelM, landFraction: sol.landFraction },
  };
}

export const seaLevelSystem: System = {
  name: 'seaLevel',
  apply: (state) => applySeaLevel(state),
};
