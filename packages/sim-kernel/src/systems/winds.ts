/**
 * Prevailing wind bands from rotation rate (#31) — the Phase 3 wind field that
 * moisture transport (#32) advects along and Phase 5 cloud advection reads.
 *
 * A deterministic diagnostic band model, NOT a fluid solve (§6). Two knobs set
 * the pattern:
 *
 *  - **Rotation → band count.** The number of circulation cells per hemisphere
 *    grows with rotation rate: `cells ∝ (Ω/Ω_earth)^WIND_ROTATION_EXPONENT`,
 *    Ω ∝ 1/`dayLengthHours`. Earth (24 h) sits at three cells — the
 *    Hadley/Ferrel/Polar structure — so the model reproduces trade easterlies,
 *    mid-latitude westerlies, and polar easterlies. Fast rotators get more,
 *    narrower bands (the Rhines-scale jet spacing shrinks); slow rotators
 *    collapse toward a single equator-to-pole Hadley cell.
 *  - **Temperature gradient → strength.** Winds are driven by differential
 *    heating, so the whole field scales with the equator-to-pole surface
 *    temperature contrast from the #30 energy balance (this step's
 *    `temperature`). A steep gradient (an icehouse) strengthens the circulation;
 *    a flat one (a well-mixed hothouse) weakens it.
 *
 * Per hemisphere the surface flow of each overturning cell gives a diagonal
 * prevailing wind: within the Hadley cell air spirals equatorward-and-westward
 * (the NE/SE trades), within the Ferrel cell poleward-and-eastward (the
 * SW/NW-erlies), alternating cell by cell. Both components share one half-sine
 * envelope per cell, `sin(nCells·π·|lat|/90°)`, which is zero at the equator
 * (the ITCZ doldrums), at every cell boundary (the subtropical/subpolar calms),
 * and at the poles. `windU` (zonal, + eastward) is even in latitude — easterly
 * near the equator, alternating outward; `windV` (meridional, + northward) is
 * odd — convergent toward the ITCZ at the surface.
 *
 * Timescale split (§0): the wind field is a FAST quasi-static diagnostic — a
 * step re-solves it from the current rotation and temperature, it carries no
 * memory. Pure: a function of `dayLengthHours` and the temperature field only.
 * Same seed + params ⇒ bit-identical winds on every machine.
 */

import {
  EARTH_DAY_HOURS,
  WIND_CELLS_PER_HEMISPHERE_EARTH,
  WIND_EQUATORIAL_SINLAT,
  WIND_GRADIENT_FACTOR_MAX,
  WIND_GRADIENT_FACTOR_MIN,
  WIND_MAX_CELLS_PER_HEMISPHERE,
  WIND_MAX_M_PER_S,
  WIND_MERIDIONAL_PEAK_M_PER_S,
  WIND_POLAR_SINLAT,
  WIND_ROTATION_EXPONENT,
  WIND_TEMP_GRADIENT_REF_K,
  WIND_ZONAL_PEAK_M_PER_S,
} from '../constants';
import { cellCenterTable, cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/**
 * Circulation cells per hemisphere for a rotation period, an integer ≥ 1.
 * `cells = round(3 · (24 / dayLengthHours)^EXP)`, clamped to
 * [1, `WIND_MAX_CELLS_PER_HEMISPHERE`]. Faster rotation (shorter day) ⇒ more
 * cells; a day past ~96 h rounds to a single cell (Venus-like super-rotation).
 */
export function rotationCellCount(dayLengthHours: number): number {
  const ratio = dayLengthHours > 0 ? EARTH_DAY_HOURS / dayLengthHours : Infinity;
  const raw = WIND_CELLS_PER_HEMISPHERE_EARTH * Math.pow(ratio, WIND_ROTATION_EXPONENT);
  const rounded = Math.round(raw);
  if (!(rounded >= 1)) return 1; // NaN or < 1 ⇒ single cell
  return rounded > WIND_MAX_CELLS_PER_HEMISPHERE ? WIND_MAX_CELLS_PER_HEMISPHERE : rounded;
}

/** Clamp the gradient ratio to [MIN, MAX]; also folds a NaN/negative (inverted
 *  or degenerate gradient) to the floor so a faint prevailing wind survives. */
export function windGradientFactor(gradientK: number): number {
  const f = gradientK / WIND_TEMP_GRADIENT_REF_K;
  if (!(f > WIND_GRADIENT_FACTOR_MIN)) return WIND_GRADIENT_FACTOR_MIN;
  return f > WIND_GRADIENT_FACTOR_MAX ? WIND_GRADIENT_FACTOR_MAX : f;
}

/**
 * Equator-to-pole surface temperature contrast, K: the equatorial-band mean
 * (|sin lat| < `WIND_EQUATORIAL_SINLAT`) minus the polar-band mean
 * (|sin lat| > `WIND_POLAR_SINLAT`). Cell-count means over equal-area bands —
 * both bands are ~25% of the sphere, so both are populated on every grid.
 */
export function meridionalTemperatureGradientK(state: PlanetState): number {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const temperature = state.fields.temperature;
  let eqSum = 0;
  let eqCount = 0;
  let poSum = 0;
  let poCount = 0;
  for (let i = 0; i < count; i++) {
    const y = centers[i * 3 + 1]!; // = sin(latitude)
    const a = y < 0 ? -y : y;
    if (a < WIND_EQUATORIAL_SINLAT) {
      eqSum += temperature[i]!;
      eqCount++;
    } else if (a > WIND_POLAR_SINLAT) {
      poSum += temperature[i]!;
      poCount++;
    }
  }
  const eq = eqCount > 0 ? eqSum / eqCount : 0;
  const po = poCount > 0 ? poSum / poCount : 0;
  return eq - po;
}

/** Final defensive clamp to the ±`WIND_MAX_M_PER_S` codec bound. */
function clampWind(v: number): number {
  return v < -WIND_MAX_M_PER_S ? -WIND_MAX_M_PER_S : v > WIND_MAX_M_PER_S ? WIND_MAX_M_PER_S : v;
}

/**
 * Prevailing surface wind at a latitude, m/s. `windU` is even in latitude
 * (easterly at the equator, alternating outward once per cell); `windV` is odd
 * (equatorward at the surface). Both share the `sin(nCells·π·|lat|/90°)`
 * envelope and scale with `gradientFactor`.
 */
export function windAtLatitude(
  latDeg: number,
  cellsPerHemisphere: number,
  gradientFactor: number,
): { u: number; v: number } {
  const a = latDeg < 0 ? -latDeg : latDeg; // |lat|, degrees
  const s = latDeg > 0 ? 1 : latDeg < 0 ? -1 : 0; // hemisphere sign
  const g = (cellsPerHemisphere * Math.PI * a) / 90; // cell phase: 0 at equator, nCells·π at pole
  const lobe = Math.sin(g);
  const u = -WIND_ZONAL_PEAK_M_PER_S * gradientFactor * lobe;
  const v = -WIND_MERIDIONAL_PEAK_M_PER_S * gradientFactor * s * lobe;
  return { u: clampWind(u), v: clampWind(v) };
}

export interface WindSolution {
  /** Per-cell zonal wind (+ eastward), m/s. */
  readonly windU: Float32Array;
  /** Per-cell meridional wind (+ northward), m/s. */
  readonly windV: Float32Array;
  /** Circulation cells per hemisphere for this planet's rotation. */
  readonly cellsPerHemisphere: number;
  /** Equator-to-pole surface temperature contrast this solve used, K. */
  readonly gradientK: number;
  /** The clamped gradient factor the wind speeds were scaled by. */
  readonly gradientFactor: number;
}

/**
 * Solve the prevailing wind field for the current state. Pure: a function of
 * `dayLengthHours` (band count) and the temperature field (gradient) only. The
 * per-cell pass is O(cells); the band count and gradient are O(1)/O(cells).
 */
export function solveWinds(state: PlanetState): WindSolution {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const cellsPerHemisphere = rotationCellCount(state.params.dayLengthHours);
  const gradientK = meridionalTemperatureGradientK(state);
  const gradientFactor = windGradientFactor(gradientK);

  const windU = new Float32Array(count);
  const windV = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const y = Math.max(-1, Math.min(1, centers[i * 3 + 1]!)); // = sin(latitude)
    const latDeg = (Math.asin(y) * 180) / Math.PI;
    const { u, v } = windAtLatitude(latDeg, cellsPerHemisphere, gradientFactor);
    windU[i] = u;
    windV[i] = v;
  }
  return { windU, windV, cellsPerHemisphere, gradientK, gradientFactor };
}

/**
 * Fill `windU`/`windV` from the current rotation and temperature. Used both per
 * step (the `windsSystem`) and once at state creation so the t=0 keyframe
 * already carries a prevailing wind field.
 */
export function applyWinds(state: PlanetState): PlanetState {
  const sol = solveWinds(state);
  return {
    ...state,
    fields: { ...state.fields, windU: sol.windU, windV: sol.windV },
  };
}

export const windsSystem: System = {
  name: 'winds',
  apply: (state) => applyWinds(state),
};
