/**
 * Moisture transport with orographic precipitation (#32) — the Phase 3 system
 * that fills `precipitation` and retires the static latitude proxy
 * (`climateProxy`, now deleted). Rain shadows must **emerge** from the transport,
 * not be painted on (the milestone bar); dry continental interiors emerge too.
 *
 * The model is evaporate → advect → precipitate, solved as a FAST quasi-static
 * equilibrium (§0): a step re-solves the steady moisture field from the current
 * winds/temperature/elevation, it carries no memory. Three parts:
 *
 *  - **Evaporate.** Ocean cells (below the dynamic sea level, #33) inject a
 *    moisture source `E` (kg/m²/yr) scaled by a Clausius–Clapeyron factor —
 *    warm seas evaporate more. Land injects nothing: continents are watered only
 *    by what the wind carries in from the sea.
 *  - **Advect.** The atmospheric moisture column `q` is transported along the
 *    #31 wind field by a conservative upwind donor scheme: each cell sheds a
 *    wind-speed-scaled fraction of its column to the neighbours the wind points
 *    toward (`outFrac`, summing to 1). The steady state is found by a fixed
 *    number of Jacobi relaxation sweeps in fixed cell order — a deterministic
 *    schedule, never a `while (!converged)`.
 *  - **Precipitate.** Each cell rains out `q·λ`, with `λ` a base drizzle plus an
 *    **orographic** term that grows where the wind blows toward higher ground
 *    (forced ascent) and a **saturation** term where the air is too cold to hold
 *    its moisture (capacity < 1). A windward slope rains hard and depletes the
 *    column before the crest, so the lee side is left in the dried-out air — the
 *    rain shadow.
 *
 * **Water is conserved.** Transport is a donor split whose outgoing fractions
 * sum to 1, so total moisture in = total moisture out over the closed sphere;
 * the only net sources/sinks are evaporation and precipitation. After the
 * relaxation the precipitation is closed exactly to the evaporation total
 * (`Σ P = Σ E`) by a single global scale — the finite-sweep residual (moisture
 * still in transit) is distributed proportionally to where rain already falls,
 * which does not move the rain-shadow pattern (a uniform scale preserves every
 * windward/lee ratio). Pure: a function of the wind, temperature and elevation
 * fields only. Same seed + params ⇒ bit-identical precipitation on every machine.
 */

import {
  MOIST_EVAP_CC_PER_K,
  MOIST_EVAP_FACTOR_MAX,
  MOIST_EVAP_FACTOR_MIN,
  MOIST_EVAP_REF_KG_PER_M2_YR,
  MOIST_EVAP_REF_TEMP_K,
  MOIST_OROGRAPHIC_MAX,
  MOIST_OROGRAPHIC_REF_M,
  MOIST_PRECIP_BASE,
  MOIST_PRECIP_OROGRAPHIC,
  MOIST_PRECIP_SATURATION,
  MOIST_RELAX_SWEEPS_AT_REF,
  MOIST_RELAX_SWEEPS_MIN,
  MOIST_RELAX_SWEEPS_REF_N,
  MOIST_TRANSPORT_COEF,
  MOIST_TRANSPORT_REF_SPEED_M_PER_S,
  MOIST_TRANSPORT_SPEED_CAP,
} from '../constants';
import { cellCenterTable, cellCount, eastNorthTable, neighborTable } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/**
 * Evaporation temperature factor: `exp(CC·(T − ref))`, clamped. Warm oceans
 * evaporate more (saturation vapour pressure rises with temperature); the clamp
 * keeps a cold sea evaporating a little and bounds a hot one so precipitation
 * stays inside its codec range.
 */
export function evaporationFactor(tempK: number): number {
  const f = Math.exp(MOIST_EVAP_CC_PER_K * (tempK - MOIST_EVAP_REF_TEMP_K));
  return f < MOIST_EVAP_FACTOR_MIN ? MOIST_EVAP_FACTOR_MIN : f > MOIST_EVAP_FACTOR_MAX ? MOIST_EVAP_FACTOR_MAX : f;
}

/**
 * Jacobi relaxation sweep count for a grid: `round(AT_REF·N/REF_N)`, floored.
 * Scaling ∝ N keeps the moisture's information-propagation distance (one cell
 * per sweep) resolution-independent — it must reach windward → crest → lee,
 * which is more cells on a finer grid. Fixed (not a convergence test) so the
 * solve is deterministic; the exact water closure makes conservation hold
 * regardless of how far it has converged.
 */
export function relaxSweepCount(gridN: number): number {
  const s = Math.round((MOIST_RELAX_SWEEPS_AT_REF * gridN) / MOIST_RELAX_SWEEPS_REF_N);
  return s < MOIST_RELAX_SWEEPS_MIN ? MOIST_RELAX_SWEEPS_MIN : s;
}

export interface MoistureSolution {
  /** Per-cell annual precipitation, kg/m²/yr (closed to `Σ P = Σ E`). */
  readonly precipitation: Float32Array;
  /** Total evaporation over the sphere (cell-summed rate), kg/m²/yr. */
  readonly totalEvaporation: number;
  /** Total precipitation after the water closure — equals `totalEvaporation`. */
  readonly totalPrecipitation: number;
  /** Relaxation sweeps this solve ran (a function of grid N). */
  readonly sweeps: number;
}

/**
 * Solve the steady moisture field for the current state and map it to per-cell
 * precipitation. Pure: a function of `windU`/`windV` (advection), `temperature`
 * (evaporation) and `elevation` (ocean source + orography) only. Per-cell setup
 * is O(cells); the relaxation is O(sweeps·cells), sweeps ∝ N.
 */
export function solveMoisture(state: PlanetState): MoistureSolution {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const nb = neighborTable(N);
  const frame = eastNorthTable(N); // per-cell [ex,ey,ez, nx,ny,nz] tangent basis
  const { elevation, temperature, windU, windV } = state.fields;
  // Previous step's sea level (the #33 explicit lag): ocean = below it, and the
  // orographic forcing measures the climb in land height above it.
  const seaLevel = state.globals.seaLevelM;

  // Per-cell transport weight (κ), rain-out weight (λ), evaporation source (E),
  // and the downwind donor split (outFrac, 4 per cell, summing to 1 when κ > 0).
  const kappa = new Float64Array(count);
  const lambda = new Float64Array(count);
  const evap = new Float64Array(count);
  const outFrac = new Float64Array(count * 4);
  const align = new Float64Array(4); // per-cell wind→neighbour alignment scratch

  for (let i = 0; i < count; i++) {
    const ux = centers[i * 3]!;
    const uy = centers[i * 3 + 1]!; // = sin(latitude)
    const uz = centers[i * 3 + 2]!;
    const u = windU[i]!; // eastward wind, m/s
    const v = windV[i]!; // northward wind, m/s
    const speed = Math.sqrt(u * u + v * v); // |wind| (east/north basis is orthonormal)

    // Moisture-holding capacity from the Clausius–Clapeyron curve (1 at the
    // reference temperature): drives the ocean evaporation source and the
    // saturation rain-out term below.
    const capacity = evaporationFactor(temperature[i]!);
    // Evaporation source: ocean = below the (dynamic) sea level. A submerged
    // shelf evaporates like open ocean; emergent land injects nothing.
    evap[i] = elevation[i]! < seaLevel ? MOIST_EVAP_REF_KG_PER_M2_YR * capacity : 0;

    // Downwind donor split from the wind direction: assemble the 3-D wind from
    // the grid's local east/north basis and weight each neighbour by max(0,
    // alignment). A polar cell has a zero basis (no horizontal frame) and sheds
    // nothing.
    const base = i * 4;
    let totalAlign = 0;
    align[0] = align[1] = align[2] = align[3] = 0;
    const ex = frame[i * 6]!;
    const ey = frame[i * 6 + 1]!;
    const ez = frame[i * 6 + 2]!;
    if (speed > 0 && (ex !== 0 || ey !== 0 || ez !== 0)) {
      const nx = frame[i * 6 + 3]!;
      const ny = frame[i * 6 + 4]!;
      const nz = frame[i * 6 + 5]!;
      // wind3 = u·east + v·north.
      const wx = u * ex + v * nx;
      const wy = u * ey + v * ny;
      const wz = u * ez + v * nz;
      for (let k = 0; k < 4; k++) {
        const j = nb[base + k]!;
        const cjx = centers[j * 3]!;
        const cjy = centers[j * 3 + 1]!;
        const cjz = centers[j * 3 + 2]!;
        // Tangent direction at i pointing toward j (project chord onto the
        // tangent plane), then align with the wind.
        const d = cjx * ux + cjy * uy + cjz * uz;
        const tx = cjx - d * ux;
        const ty = cjy - d * uy;
        const tz = cjz - d * uz;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl < 1e-12) continue;
        const al = (wx * tx + wy * ty + wz * tz) / tl;
        if (al > 0) {
          align[k] = al;
          totalAlign += al;
        }
      }
    }

    // Normalize the split and, from it, the orographic forcing: the land the
    // departing air climbs into (downwind-ward rise in height ABOVE SEA LEVEL —
    // air over the sea sits at the datum, it only ascends emergent terrain),
    // which drives extra rain-out on windward slopes and leaves the lee dry.
    const ei = elevation[i]! - seaLevel;
    const landI = ei > 0 ? ei : 0;
    let rise = 0;
    if (totalAlign > 0) {
      for (let k = 0; k < 4; k++) {
        const f = align[k]! / totalAlign;
        outFrac[base + k] = f;
        if (f > 0) {
          const ej = elevation[nb[base + k]!]! - seaLevel;
          const dh = (ej > 0 ? ej : 0) - landI;
          if (dh > 0) rise += f * dh;
        }
      }
      // Only a cell that actually distributes its outflow may shed it — else a
      // wind with no valid downwind target (e.g. a pole) would lose moisture and
      // break conservation. Transport weight scales with wind speed, capped.
      kappa[i] =
        MOIST_TRANSPORT_COEF * Math.min(MOIST_TRANSPORT_SPEED_CAP, speed / MOIST_TRANSPORT_REF_SPEED_M_PER_S);
    }
    // Rain-out weight: base drizzle + orographic ascent + saturation (cold air,
    // capacity < 1, sheds moisture). Saturation is 0 in an isothermal world.
    const oro = Math.min(MOIST_OROGRAPHIC_MAX, rise / MOIST_OROGRAPHIC_REF_M);
    const sat = capacity < 1 ? MOIST_PRECIP_SATURATION * (1 - capacity) : 0;
    lambda[i] = MOIST_PRECIP_BASE + MOIST_PRECIP_OROGRAPHIC * oro + sat;
  }

  // --- Steady moisture column by fixed-count upwind Jacobi relaxation. --------
  // q_i = (E_i + Σ_upwind q_j·κ_j·outFrac_{j→i}) / (κ_i + λ_i). Denominator ≥
  // λ_i ≥ MOIST_PRECIP_BASE > 0, so it is always well posed. Scatter the donor
  // outflow into an inflow buffer each sweep (Jacobi: read old q, write new q).
  const sweeps = relaxSweepCount(N);
  const q = new Float64Array(count);
  const accum = new Float64Array(count);
  for (let s = 0; s < sweeps; s++) {
    accum.fill(0);
    for (let j = 0; j < count; j++) {
      const kj = kappa[j]!;
      if (kj === 0) continue;
      const out = q[j]! * kj;
      if (out === 0) continue;
      const base = j * 4;
      accum[nb[base]!]! += out * outFrac[base]!;
      accum[nb[base + 1]!]! += out * outFrac[base + 1]!;
      accum[nb[base + 2]!]! += out * outFrac[base + 2]!;
      accum[nb[base + 3]!]! += out * outFrac[base + 3]!;
    }
    for (let i = 0; i < count; i++) {
      q[i] = (evap[i]! + accum[i]!) / (kappa[i]! + lambda[i]!);
    }
  }

  // --- Precipitate and close the water budget exactly. -----------------------
  // P_i = q_i·λ_i is non-negative; a single global scale makes Σ P = Σ E, which
  // is exact at the relaxation fixed point and closes the finite-sweep residual.
  const rain = new Float64Array(count);
  let sumP = 0;
  let sumE = 0;
  for (let i = 0; i < count; i++) {
    const p = q[i]! * lambda[i]!;
    rain[i] = p;
    sumP += p;
    sumE += evap[i]!;
  }
  const scale = sumP > 0 ? sumE / sumP : 0;
  const precipitation = new Float32Array(count);
  let closedP = 0;
  for (let i = 0; i < count; i++) {
    const p = rain[i]! * scale;
    precipitation[i] = p;
    closedP += p;
  }

  return { precipitation, totalEvaporation: sumE, totalPrecipitation: closedP, sweeps };
}

/**
 * Fill `precipitation` from the moisture solve. Used both per step (the
 * `moistureSystem`, after winds) and once at state creation so the t=0 keyframe
 * already carries a physical precipitation field for erosion to read.
 */
export function applyMoisture(state: PlanetState): PlanetState {
  const sol = solveMoisture(state);
  return { ...state, fields: { ...state.fields, precipitation: sol.precipitation } };
}

export const moistureSystem: System = {
  name: 'moisture',
  apply: (state) => applyMoisture(state),
};
