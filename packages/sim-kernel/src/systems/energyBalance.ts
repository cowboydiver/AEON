/**
 * Zonal energy-balance model (#30) — the Phase 3 climate hub every other
 * climate system couples through.
 *
 * A Budyko–Sellers one-dimensional energy-balance model solved on equal-area
 * latitude bands: annual-mean insolation (shaped by `starLuminosity` and
 * `obliquityDeg`) × co-albedo, balanced against a linear outgoing-longwave
 * closure `OLR = A + B·(T − 273.15)` with a logarithmic CO₂ greenhouse forcing,
 * and meridional heat transport as North-style diffusion `D·d/dx[(1−x²)dT/dx]`
 * (x = sin lat). Linear OLR makes the balance a single deterministic
 * tridiagonal solve (Thomas algorithm, fixed sweep order — no `while
 * (!converged)`), and because diffusion is written in conservative flux form
 * the transport telescopes to zero over the sphere, so the **global net
 * top-of-atmosphere flux closes to machine precision** (the core #30
 * invariant). Same seed + params ⇒ bit-identical temperature on every machine.
 *
 * Timescale split (§0): temperature is a FAST quasi-static diagnostic — a step
 * re-solves it from the current boundary conditions, it carries no memory. The
 * two SLOW reservoirs it reads are fed to it with a one-step lag:
 *   - **ice albedo** (#33): per-cell albedo blends toward `ALBEDO_ICE` by the
 *     `iceFraction` field, which is zero until #33 populates it — the hook is
 *     live, it just reads zeros for now.
 *   - **CO₂ greenhouse** (#34): the OLR intercept drops by
 *     `CO2_FORCING_W_PER_M2·ln(co2/CO2_REFERENCE_PPM)`, reading
 *     `globals.co2`, constant at `initialCo2Ppm` until #34 drives it.
 * Both are read at the top of the step (their end-of-previous-step values),
 * which is exactly the explicit lag §3 prescribes; #33/#34 run later in the
 * pipeline and update them for the next step.
 *
 * Per-cell temperature is the zonal profile minus the elevation lapse and a
 * bounded land continentality term (§7.4): `T = zonal(lat) − lapse·max(0,elev)
 * + continentality`. Longitudinal structure enters through elevation and the
 * land mask; a full 2-D temperature field is out of scope (§6).
 */

import {
  ALBEDO_ICE,
  ALBEDO_LAND,
  ALBEDO_OCEAN,
  CO2_FORCING_W_PER_M2,
  CO2_REFERENCE_PPM,
  CONTINENTALITY_GAIN,
  CONTINENTALITY_MAX_K,
  ENERGY_BALANCE_BANDS,
  HEAT_TRANSPORT_D_W_PER_M2_K,
  INSOLATION_ORBIT_SAMPLES,
  LAPSE_RATE_K_PER_M,
  OLR_INTERCEPT_A_W_PER_M2,
  OLR_SLOPE_B_W_PER_M2_K,
  ORBITAL_DISTANCE_M,
} from '../constants';
import { cellCenterTable, cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/** Top-of-atmosphere solar constant for a star of luminosity L at 1 orbital
 *  distance, W/m^2: `L / (4π d²)`. Earth-like L ⇒ ≈1361 W/m². */
export function solarConstant(starLuminosity: number): number {
  return starLuminosity / (4 * Math.PI * ORBITAL_DISTANCE_M * ORBITAL_DISTANCE_M);
}

/**
 * Annual-mean insolation at a latitude in units of the solar constant S0 (so
 * its area-average over the sphere is exactly 1/4). Circular-orbit daily-mean
 * insolation `Q(φ,δ) = (1/π)[H0·sinφ·sinδ + cosφ·cosδ·sinH0]` with declination
 * `sinδ = sinε·sin(orbital longitude)`, averaged over a fixed set of orbital
 * longitudes. No seasonal cycle survives this — it is a one-time annual mean
 * (§7.2). Deterministic: fixed sample count, no branching on float tolerance.
 */
export function annualMeanInsolation(sinLat: number, obliquityRad: number): number {
  const s = Math.max(-1, Math.min(1, sinLat));
  const phi = Math.asin(s);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinEps = Math.sin(obliquityRad);
  let sum = 0;
  for (let k = 0; k < INSOLATION_ORBIT_SAMPLES; k++) {
    const lambda = (2 * Math.PI * k) / INSOLATION_ORBIT_SAMPLES;
    const sinDelta = sinEps * Math.sin(lambda);
    const cosDelta = Math.sqrt(Math.max(0, 1 - sinDelta * sinDelta));
    // Half-day hour angle: cosH0 = −tanφ·tanδ, clamped for polar day/night.
    const cosH0 = cosPhi === 0 || cosDelta === 0 ? 0 : -(sinPhi * sinDelta) / (cosPhi * cosDelta);
    const H0 = cosH0 <= -1 ? Math.PI : cosH0 >= 1 ? 0 : Math.acos(cosH0);
    sum += (H0 * sinPhi * sinDelta + cosPhi * cosDelta * Math.sin(H0)) / Math.PI;
  }
  return sum / INSOLATION_ORBIT_SAMPLES;
}

// Annual-mean insolation is a fixed function of obliquity and band count — it
// never changes within a run — so the per-band profile is memoized per
// (obliquity, bands), the same derived-data pattern as grid.ts's lookup tables.
// Not simulation state; pure and never mutated after build.
const INSOLATION_PROFILES = new Map<string, Float64Array>();

/** Per-band annual-mean insolation in units of S0 (area-averages to 1/4). */
export function bandInsolationProfile(obliquityDeg: number, bands: number): Float64Array {
  const key = `${obliquityDeg}:${bands}`;
  let profile = INSOLATION_PROFILES.get(key);
  if (!profile) {
    const obliquityRad = (obliquityDeg * Math.PI) / 180;
    const dx = 2 / bands;
    profile = new Float64Array(bands);
    for (let b = 0; b < bands; b++) {
      profile[b] = annualMeanInsolation(-1 + (b + 0.5) * dx, obliquityRad);
    }
    INSOLATION_PROFILES.set(key, profile);
  }
  return profile;
}

/** Planetary albedo of a cell: ice-free base keyed off the sea-level datum,
 *  blended toward ice albedo by iceFraction (the #33 hook; zero for now). */
function cellAlbedo(elevation: number, iceFraction: number): number {
  const base = elevation >= 0 ? ALBEDO_LAND : ALBEDO_OCEAN;
  const f = iceFraction <= 0 ? 0 : iceFraction >= 1 ? 1 : iceFraction;
  return base + f * (ALBEDO_ICE - base);
}

export interface EnergyBalanceSolution {
  /** Solved zonal temperature per equal-area band, K. */
  readonly bandTemp: Float64Array;
  /** Area-weighted (equal-area band) albedo per band. */
  readonly bandAlbedo: Float64Array;
  /** Global area-mean net top-of-atmosphere flux, W/m² (≈0 at the solution). */
  readonly netTopFlux: number;
  /** Per-cell surface temperature, K (zonal − lapse + continentality). */
  readonly temperature: Float32Array;
  /** Global cell-count-mean surface temperature, K. */
  readonly meanTemperatureK: number;
}

/**
 * Solve the zonal energy balance for the current state and map it to a per-cell
 * temperature field. Pure: a function of elevation, iceFraction, and the params
 * / co2 only. The band solve is O(bands); the two per-cell passes are O(cells).
 */
export function solveEnergyBalance(state: PlanetState): EnergyBalanceSolution {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const elevation = state.fields.elevation;
  const iceFraction = state.fields.iceFraction;

  const NB = ENERGY_BALANCE_BANDS;
  const dx = 2 / NB; // equal-area bands: uniform in x = sin(latitude)

  // --- Band albedo: area-weighted (cell-count) mean of per-cell albedo. ------
  const albedoSum = new Float64Array(NB);
  const bandCells = new Int32Array(NB);
  const bandOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const y = centers[i * 3 + 1]!; // = sin(latitude)
    let b = Math.floor(((y + 1) / 2) * NB);
    if (b < 0) b = 0;
    else if (b >= NB) b = NB - 1;
    bandOf[i] = b;
    albedoSum[b]! += cellAlbedo(elevation[i]!, iceFraction[i]!);
    bandCells[b]!++;
  }
  const bandAlbedo = new Float64Array(NB);
  for (let b = 0; b < NB; b++) {
    bandAlbedo[b] = bandCells[b]! > 0 ? albedoSum[b]! / bandCells[b]! : Number.NaN;
  }
  // Empty extreme bands (possible on coarse grids) inherit the nearest solved
  // band's albedo by a deterministic forward-then-backward fill.
  for (let b = 1; b < NB; b++) if (Number.isNaN(bandAlbedo[b]!)) bandAlbedo[b] = bandAlbedo[b - 1]!;
  for (let b = NB - 2; b >= 0; b--) if (Number.isNaN(bandAlbedo[b]!)) bandAlbedo[b] = bandAlbedo[b + 1]!;
  // Fully empty (degenerate) grid: fall back to ice-free ocean albedo.
  for (let b = 0; b < NB; b++) if (Number.isNaN(bandAlbedo[b]!)) bandAlbedo[b] = ALBEDO_OCEAN;

  // --- Absorbed shortwave per band, W/m². ------------------------------------
  const S0 = solarConstant(state.params.starLuminosity);
  const insolation = bandInsolationProfile(state.params.obliquityDeg, NB);
  const absorbed = new Float64Array(NB);
  for (let b = 0; b < NB; b++) {
    absorbed[b] = S0 * insolation[b]! * (1 - bandAlbedo[b]!);
  }

  // --- Linear-OLR balance with diffusive transport, one tridiagonal solve. ---
  // Per band k: absorbed_k − [A' + B·(T_k−273.15)] + D/dx²·[w_{k+½}(T_{k+1}−T_k)
  //   − w_{k−½}(T_k−T_{k−1})] = 0, with A' = A − CO2_FORCING·ln(co2/ref) and
  // w = 1 − x². Rearranged to a_k T_{k−1} + b_k T_k + c_k T_{k+1} = d_k.
  const forcing = CO2_FORCING_W_PER_M2 * Math.log(state.globals.co2 / CO2_REFERENCE_PPM);
  const Aeff = OLR_INTERCEPT_A_W_PER_M2 - forcing;
  const B = OLR_SLOPE_B_W_PER_M2_K;
  const Dcoef = HEAT_TRANSPORT_D_W_PER_M2_K / (dx * dx);
  const lower = new Float64Array(NB);
  const diag = new Float64Array(NB);
  const upper = new Float64Array(NB);
  const rhs = new Float64Array(NB);
  for (let b = 0; b < NB; b++) {
    // Interface geometric weights (1 − x²); zero at the poles ⇒ natural no-flux.
    const xLo = -1 + b * dx;
    const xHi = -1 + (b + 1) * dx;
    const wLo = b === 0 ? 0 : 1 - xLo * xLo;
    const wHi = b === NB - 1 ? 0 : 1 - xHi * xHi;
    const a = Dcoef * wLo;
    const c = Dcoef * wHi;
    lower[b] = a;
    upper[b] = c;
    diag[b] = -(a + c) - B;
    rhs[b] = -absorbed[b]! + Aeff - B * 273.15;
  }
  const bandTemp = solveTridiagonal(lower, diag, upper, rhs);

  // --- Global net TOA flux (equal-area mean of absorbed − OLR), ≈0. ----------
  let netTop = 0;
  for (let b = 0; b < NB; b++) {
    netTop += absorbed[b]! - (Aeff + B * (bandTemp[b]! - 273.15));
  }
  netTop /= NB;

  // Global mean zonal temperature (equal-area ⇒ plain band mean) — the
  // reference the land continentality term departs from.
  let zonalMean = 0;
  for (let b = 0; b < NB; b++) zonalMean += bandTemp[b]!;
  zonalMean /= NB;

  // --- Map the zonal profile to per-cell temperature. ------------------------
  const temperature = new Float32Array(count);
  let tempSum = 0;
  for (let i = 0; i < count; i++) {
    const zt = bandTemp[bandOf[i]!]!;
    const elev = elevation[i]!;
    let t = zt - LAPSE_RATE_K_PER_M * Math.max(0, elev);
    if (elev >= 0) {
      const cont = CONTINENTALITY_GAIN * (zt - zonalMean);
      t += cont < -CONTINENTALITY_MAX_K ? -CONTINENTALITY_MAX_K : cont > CONTINENTALITY_MAX_K ? CONTINENTALITY_MAX_K : cont;
    }
    temperature[i] = t;
    tempSum += t;
  }

  return {
    bandTemp,
    bandAlbedo,
    netTopFlux: netTop,
    temperature,
    meanTemperatureK: tempSum / count,
  };
}

/**
 * Thomas algorithm for a tridiagonal system (`lower`,`diag`,`upper` are the
 * sub/main/super diagonals, `rhs` the right-hand side). Fixed forward-elimination
 * then back-substitution sweep — O(n), exact, no iteration count to drift.
 */
function solveTridiagonal(
  lower: Float64Array,
  diag: Float64Array,
  upper: Float64Array,
  rhs: Float64Array,
): Float64Array {
  const n = diag.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = upper[0]! / diag[0]!;
  dp[0] = rhs[0]! / diag[0]!;
  for (let i = 1; i < n; i++) {
    const m = diag[i]! - lower[i]! * cp[i - 1]!;
    cp[i] = upper[i]! / m;
    dp[i] = (rhs[i]! - lower[i]! * dp[i - 1]!) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = dp[n - 1]!;
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i]! - cp[i]! * x[i + 1]!;
  return x;
}

/**
 * Fill `temperature` from the zonal energy balance and refresh
 * `globals.meanTemperatureK`. Used both per step (the `energyBalanceSystem`)
 * and once at state creation so the t=0 keyframe is already physical.
 */
export function applyEnergyBalance(state: PlanetState): PlanetState {
  const sol = solveEnergyBalance(state);
  return {
    ...state,
    fields: { ...state.fields, temperature: sol.temperature },
    globals: { ...state.globals, meanTemperatureK: sol.meanTemperatureK },
  };
}

export const energyBalanceSystem: System = {
  name: 'energyBalance',
  apply: (state) => applyEnergyBalance(state),
};
