/**
 * Ice mass balance (#33) — the first climate reservoir that carries genuine
 * cross-step memory. It fills the `iceFraction` field, and its output feeds two
 * loops: the energy balance reads `iceFraction` as the ice-albedo term (#30,
 * the feedback that makes snowballs reachable), and the `seaLevel` system
 * converts grounded ice into locked ocean water.
 *
 * SLOW reservoir (§0): unlike temperature/winds/precipitation (fast diagnostics
 * re-solved from scratch each step), ice is integrated across steps with `dt` —
 * this step's cover is the previous step's relaxed toward a target, so it
 * remembers, which is what lets caps advance/retreat gradually over the timeline.
 *
 * The model is a relaxation toward a temperature-set **equilibrium cover**:
 *   - **Equilibrium cover** `coldFrac(T)` ramps from 0 at the freezing point to
 *     1 a WIDE band below it (`ICE_FULL_COVER_BELOW_K`). The width is the whole
 *     point: a sharp ice line (full white the instant a cell drops below
 *     freezing) makes the ice-albedo feedback supercritical and snowballs the
 *     default planet; grading the target over tens of K keeps `d(albedo)/dT`
 *     small enough for a STABLE partial polar cap, while a strong cold
 *     perturbation still drives the target to 1 everywhere (snowball reachable).
 *   - **Accumulation where cold + wet.** When below its target, a cell grows ice
 *     at `ICE_ACCUM_RATE_PER_YR · supply`; `supply` is the moisture available as
 *     snow — an ocean cell over open water is saturated (1), a land cell is
 *     precipitation-limited (a rain-shadow desert grows ice slowly).
 *   - **Ablation where warm.** When above its target, a cell sheds ice at a
 *     baseline retreat rate plus a positive-degree-day term `∝ max(0, T −
 *     freeze)`, so the warm edge of the margin hugs the freezing isotherm and
 *     caps retreat briskly as the climate warms.
 *
 * The per-step change is `(target − ice) · (1 − exp(−rate·dt))`, rate-limited
 * for stability, then clamped to [0, 1]. Pure: a function of `temperature`,
 * `precipitation`, the previous `iceFraction`, and the (previous-step)
 * `seaLevelM` land/ocean mask only. dt-correct: the approach uses `dt`
 * explicitly, so a coarser `stepYears` rescales the rate, not the trajectory.
 * Same seed + params ⇒ bit-identical ice on every machine.
 */

import {
  ICE_ABLATION_RATE_PER_YR_PER_K,
  ICE_ACCUM_PRECIP_REF,
  ICE_ACCUM_RATE_PER_YR,
  ICE_ACCUM_SUPPLY_MAX,
  ICE_FREEZE_TEMP_K,
  ICE_FULL_COVER_BELOW_K,
  ICE_MAX_FRACTION_CHANGE_PER_MYR,
  ICE_MELT_RATE_PER_YR,
} from '../constants';
import { cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/**
 * Equilibrium ice cover a cell relaxes toward, purely from temperature: 0 at or
 * above freezing, ramping linearly to 1 at `ICE_FULL_COVER_BELOW_K` below it
 * (and 1 for anything colder). The deliberately wide ramp spreads the
 * ice-albedo transition over tens of K, keeping the feedback subcritical at
 * default params (see the module header).
 */
export function iceEquilibriumCover(tempK: number): number {
  const f = (ICE_FREEZE_TEMP_K - tempK) / ICE_FULL_COVER_BELOW_K;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}

/**
 * Moisture supply for snow accumulation, scaling the GROWTH rate (not the
 * equilibrium). Ocean cells sit over open water and are always saturated
 * (supply 1). Land cells are precipitation-limited — `min(precip / ref,
 * SUPPLY_MAX)` — so a cold *wet* coast grows ice fast and a cold *dry* interior
 * slowly (the "wet" half of "accumulate where cold + wet").
 */
export function iceMoistureSupply(precipitation: number, isOcean: boolean): number {
  if (isOcean) return 1;
  const s = precipitation / ICE_ACCUM_PRECIP_REF;
  return s <= 0 ? 0 : s >= ICE_ACCUM_SUPPLY_MAX ? ICE_ACCUM_SUPPLY_MAX : s;
}

/**
 * Solve the next `iceFraction` field from the current temperature, precipitation
 * and the previous ice cover. Pure; O(cells). `dtYears` scales the mass-balance
 * increment (slow reservoir).
 */
export function solveIce(state: PlanetState, dtYears: number): Float32Array {
  const N = state.params.gridN;
  const count = cellCount(N);
  const { temperature, precipitation, elevation, iceFraction } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  // Per-step change cap (stability rate-limit), scaled to this step's dt.
  const maxChange = ICE_MAX_FRACTION_CHANGE_PER_MYR * (dtYears / 1e6);

  const next = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = temperature[i]!;
    const ice = iceFraction[i]!;
    const target = iceEquilibriumCover(t);
    const gap = target - ice;

    let rate: number;
    if (gap >= 0) {
      // Growing toward the target: gated by moisture supply (cold + wet).
      const isOcean = elevation[i]! < seaLevel;
      rate = ICE_ACCUM_RATE_PER_YR * iceMoistureSupply(precipitation[i]!, isOcean);
    } else {
      // Retreating: baseline sublimation/flow plus warm-side degree-day melt.
      const warm = t > ICE_FREEZE_TEMP_K ? t - ICE_FREEZE_TEMP_K : 0;
      rate = ICE_MELT_RATE_PER_YR + ICE_ABLATION_RATE_PER_YR_PER_K * warm;
    }

    // Exponential relaxation over the step (dt-correct), then rate-limit.
    let d = gap * (1 - Math.exp(-rate * dtYears));
    if (d > maxChange) d = maxChange;
    else if (d < -maxChange) d = -maxChange;

    const v = ice + d;
    next[i] = v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  return next;
}

/** Integrate `iceFraction` one step from the mass balance. */
export function applyIce(state: PlanetState, dtYears: number): PlanetState {
  const iceFraction = solveIce(state, dtYears);
  return { ...state, fields: { ...state.fields, iceFraction } };
}

export const iceSystem: System = {
  name: 'ice',
  apply: (state, dtYears) => applyIce(state, dtYears),
};
