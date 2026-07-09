/**
 * Carbonate–silicate CO₂ feedback (#34) — the deep-time thermostat. It closes
 * the Phase 3 climate block: `globals.co2` is a SLOW reservoir with genuine
 * cross-step memory (like `iceFraction`), and the energy balance (#30) reads it
 * as the greenhouse forcing. The `carbon` system integrates it LAST in the
 * pipeline (after `seaLevel`), so it sees this step's fully-solved climate and
 * hands the updated CO₂ to the NEXT step's energy balance — the same one-step
 * explicit lag every cross-system read in the climate block uses.
 *
 * The balance is `d(co2)/dt = outgassing − weathering`:
 *
 *   - **Outgassing** (source) is volcanic degassing, tied to tectonic activity:
 *     the mean |boundaryStress| over active boundary cells (ridges and arcs both
 *     degas, so convergence and divergence count alike), clamped to a bounded
 *     factor around the reference. Its FLOOR is > 0 — a quiet world still leaks
 *     mantle CO₂ — which is what makes snowball recovery inevitable.
 *   - **Weathering** (sink) is silicate weathering: it rises with surface
 *     temperature (activation-energy kinetics), with runoff (precipitation) and
 *     with the exposed continental area Phase-1 tectonics builds, and it needs
 *     liquid water — ice-covered land is sealed (the `1 − iceFraction` gate).
 *     It also rises directly with pCO₂, which pins a well-defined warm fixed
 *     point and keeps CO₂ from being drawn to zero.
 *
 * Warm ⇒ high weathering ⇒ CO₂ drawn down ⇒ cooling: a NEGATIVE feedback
 * (the thermostat), because temperature itself rises with CO₂ through the
 * greenhouse. Cold enough ⇒ ice seals the land ⇒ weathering shuts off ⇒ CO₂
 * accumulates from unopposed outgassing ⇒ warming ⇒ deglaciation. So a snowball
 * is reachable under a cold perturbation and recovers on its own — the classic
 * carbonate–silicate failure mode, here a feature.
 *
 * SLOW reservoir (§0), integrated with `dt` and rate-limited for stability:
 * `co2_next = clamp(co2 + clamp(dt·(outgas − weather), ±maxΔ), MIN, MAX)`, the
 * fractional per-step cap preventing the explicit-lag overshoot that would set
 * the feedback ringing (the phase's named oscillation/divergence risk). Pure:
 * a function of `boundaryStress`, `temperature`, `precipitation`, `iceFraction`,
 * `elevation`, `seaLevelM` and the current `co2` only — and, because carbon runs
 * LAST, all of those (including `seaLevelM`) are *this* step's freshly-solved
 * values, not lagged; the one-step explicit lag is on carbon's OUTPUT (the next
 * step's energy balance reads this `co2`). dt-correct — a coarser `stepYears`
 * rescales the increment, not the trajectory. Same seed + params ⇒ bit-identical
 * CO₂ on every machine.
 */

import {
  CO2_MAX_CHANGE_FRAC_PER_MYR,
  CO2_MAX_PPM,
  CO2_MIN_PPM,
  CO2_OUTGAS_ACTIVITY_FACTOR_MAX,
  CO2_OUTGAS_ACTIVITY_FACTOR_MIN,
  CO2_OUTGAS_ACTIVITY_REF_M_PER_YR,
  CO2_OUTGAS_REFERENCE_PPM_PER_YR,
  CO2_REFERENCE_PPM,
  CO2_WEATHER_CO2_EXPONENT,
  CO2_WEATHER_PRECIP_FACTOR_MAX,
  CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR,
  CO2_WEATHER_REF_TEMP_K,
  CO2_WEATHER_REFERENCE_PPM_PER_YR,
  CO2_WEATHER_TEMP_FACTOR_MAX,
  CO2_WEATHER_TEMP_SENSITIVITY_PER_K,
} from '../constants';
import { cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/** Boundary cells carry |boundaryStress| above this (m/yr); interiors are
 *  exactly 0 by construction, so any positive epsilon separates them. */
const BOUNDARY_STRESS_EPSILON = 1e-9;

/**
 * Tectonic activity: the mean |boundaryStress| over active boundary cells, m/yr
 * — a typical plate closing/opening speed, the vigor of ridge + arc volcanism
 * that degasses CO₂. Averaging over boundary cells only (not all cells) makes it
 * grid-independent: the share of cells that are boundaries falls ∝ 1/N, but the
 * speeds sampled at them do not. Returns 0 for a boundary-free (single-plate)
 * world.
 */
export function tectonicActivity(state: PlanetState): number {
  const boundaryStress = state.fields.boundaryStress;
  const count = cellCount(state.params.gridN);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const a = boundaryStress[i]! < 0 ? -boundaryStress[i]! : boundaryStress[i]!;
    if (a > BOUNDARY_STRESS_EPSILON) {
      sum += a;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Volcanic outgassing, ppm/yr: the reference rate scaled by tectonic activity,
 * the factor clamped to [MIN, MAX]. The floor keeps a quiet world degassing
 * (mantle leak) so CO₂ never stalls; the ceiling stops a reorganization spike
 * from running CO₂ away.
 */
export function outgassingPpmPerYr(activity: number): number {
  let f = activity / CO2_OUTGAS_ACTIVITY_REF_M_PER_YR;
  if (!(f > CO2_OUTGAS_ACTIVITY_FACTOR_MIN)) f = CO2_OUTGAS_ACTIVITY_FACTOR_MIN; // also folds NaN
  else if (f > CO2_OUTGAS_ACTIVITY_FACTOR_MAX) f = CO2_OUTGAS_ACTIVITY_FACTOR_MAX;
  return CO2_OUTGAS_REFERENCE_PPM_PER_YR * f;
}

/**
 * Weathering temperature factor: `exp(SENS·(T − ref))`, clamped to [0, MAX].
 * Rises with warmth (fast weathering) and tends to 0 in the cold — the leg that
 * makes weathering fall as CO₂-driven cooling sets in (the thermostat).
 */
export function weatheringTempFactor(tempK: number): number {
  const f = Math.exp(CO2_WEATHER_TEMP_SENSITIVITY_PER_K * (tempK - CO2_WEATHER_REF_TEMP_K));
  return f <= 0 ? 0 : f > CO2_WEATHER_TEMP_FACTOR_MAX ? CO2_WEATHER_TEMP_FACTOR_MAX : f;
}

/**
 * Weathering runoff factor: `min(precip / ref, MAX)`, floored at 0. Weathering
 * is water-limited — a dry cell barely weathers however warm.
 */
export function weatheringPrecipFactor(precipitation: number): number {
  const f = precipitation / CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR;
  return f <= 0 ? 0 : f > CO2_WEATHER_PRECIP_FACTOR_MAX ? CO2_WEATHER_PRECIP_FACTOR_MAX : f;
}

/**
 * Weathering potential: the global-equivalent (cell-count mean) of per-land-cell
 * `(1 − iceFraction)·tempFactor·precipFactor`. Ocean cells contribute nothing
 * (silicate weathering is a continental, subaerial process), so this already
 * carries the exposed-land dependence; ice-sealed and cold/dry land contribute
 * little. Dimensionless (~0.19 on the default planet), the multiplier on the
 * reference weathering rate.
 */
export function weatheringPotential(state: PlanetState): number {
  const count = cellCount(state.params.gridN);
  const { elevation, temperature, precipitation, iceFraction } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (elevation[i]! < seaLevel) continue; // ocean: no subaerial silicate weathering
    const iceFree = 1 - iceFraction[i]!;
    if (iceFree <= 0) continue;
    sum += iceFree * weatheringTempFactor(temperature[i]!) * weatheringPrecipFactor(precipitation[i]!);
  }
  return sum / count;
}

/**
 * Silicate weathering, ppm/yr: the reference rate scaled by the direct pCO₂
 * dependence and the weathering potential. The pCO₂ term keeps the warm fixed
 * point well-defined and CO₂ positive; the potential carries the temperature,
 * runoff, ice and exposed-land dependence.
 */
export function weatheringPpmPerYr(co2: number, potential: number): number {
  const co2Ratio = co2 <= 0 ? 0 : co2 / CO2_REFERENCE_PPM;
  return CO2_WEATHER_REFERENCE_PPM_PER_YR * Math.pow(co2Ratio, CO2_WEATHER_CO2_EXPONENT) * potential;
}

export interface CarbonSolution {
  /** Next atmospheric CO₂, ppm (clamped to [CO2_MIN_PPM, CO2_MAX_PPM]). */
  readonly co2: number;
  /** Volcanic outgassing this step, ppm/yr. */
  readonly outgassing: number;
  /** Silicate weathering this step, ppm/yr. */
  readonly weathering: number;
  /** Tectonic activity (mean boundary |stress|), m/yr. */
  readonly activity: number;
  /** Weathering potential (global-equivalent land weathering multiplier). */
  readonly potential: number;
}

/**
 * Solve the next CO₂ from the current climate and the current CO₂. Pure; O(cells)
 * for the two reductions, O(1) otherwise. `dtYears` scales the mass-balance
 * increment (slow reservoir) and the rate-limit cap.
 */
export function solveCarbon(state: PlanetState, dtYears: number): CarbonSolution {
  const co2 = state.globals.co2;
  const activity = tectonicActivity(state);
  const outgassing = outgassingPpmPerYr(activity);
  const potential = weatheringPotential(state);
  const weathering = weatheringPpmPerYr(co2, potential);

  // Explicit flux increment, then the fractional per-step rate limit.
  let d = dtYears * (outgassing - weathering);
  const maxChange = CO2_MAX_CHANGE_FRAC_PER_MYR * co2 * (dtYears / 1e6);
  if (d > maxChange) d = maxChange;
  else if (d < -maxChange) d = -maxChange;

  let next = co2 + d;
  if (next < CO2_MIN_PPM) next = CO2_MIN_PPM;
  else if (next > CO2_MAX_PPM) next = CO2_MAX_PPM;

  return { co2: next, outgassing, weathering, activity, potential };
}

/** Integrate `globals.co2` one step from the carbonate–silicate balance. */
export function applyCarbon(state: PlanetState, dtYears: number): PlanetState {
  const sol = solveCarbon(state, dtYears);
  return { ...state, globals: { ...state.globals, co2: sol.co2 } };
}

export const carbonSystem: System = {
  name: 'carbon',
  apply: (state, dtYears) => applyCarbon(state, dtYears),
};
