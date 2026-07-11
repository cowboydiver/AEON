/**
 * Ocean life: abiogenesis + marine photosynthetic productivity (#37, Phase 4) —
 * the first system of the biosphere block. It runs after `carbon` (so life reads
 * this step's fully-solved climate and dynamic land/ocean mask) and before
 * `biome`, and it does two things:
 *
 *   1. **Abiogenesis** — a gated-stochastic onset (spec §7.2). While life has
 *      not yet originated (`globals.abiogenesisYear < 0`), each step draws a
 *      Bernoulli trial whose per-step probability is `(1 − exp(−rate·dt))` times
 *      the liquid-ocean habitable fraction, so *when* life starts is
 *      seed/climate-dependent yet reliably occurs within deep time. The draw is
 *      `hash2(seed', quantizedTime)` — deterministic and **independent of any
 *      other system's PRNG consumption**, exactly like the #18 rift draw (a fork
 *      taken inside a pure system would restart its stream every step; and the
 *      biosphere must consume nothing from `ctx.rng` so a `biosphereEnabled=false`
 *      ablation leaves the physical sim byte-identical — M0 caution 4). On onset
 *      it sets `abiogenesisYear` and emits the `abiogenesis` event.
 *
 *   2. **Marine productivity** — once life exists, the per-ocean-cell `marineLife`
 *      diagnostic is `light × temperatureWindow × nutrient` (0 on land): a FAST
 *      field with no memory (the O₂ *reservoir* holds the history). `light` is
 *      the annual-mean insolation profile (#30) normalized to ≈1 at the equator;
 *      the temperature window is a Gaussian in surface temperature (life needs
 *      liquid, not scalding, water); `nutrient` is a shallow-shelf/upwelling
 *      proxy (spec §6 — a simplified proxy, not a closed nutrient cycle). The
 *      mean of this field drives the `oxygen` system's O₂ source term.
 *
 * Pure `(state, dt, ctx) => state`: no `Math.random`/`Date.now`, no key-order
 * iteration, no input mutation. Inert (identity) when `biosphereEnabled` is
 * false. Not run at init (like the other reservoirs): `marineLife` is 0 and
 * `abiogenesisYear` is −1 at t=0, so life advances only from step 1.
 */

import {
  ENERGY_BALANCE_BANDS,
  MARINE_NUTRIENT_MIN,
  MARINE_NUTRIENT_SHELF_DEPTH_M,
  PROD_TEMP_MAX_K,
  PROD_TEMP_MIN_K,
  PROD_TEMP_OPT_K,
  PROD_TEMP_WIDTH_K,
  RIFT_DRAW_QUANTUM_YEARS,
} from '../constants';
import { EVENT_KINDS, type SimEvent } from '../events';
import { cellCenterTable, cellCount } from '../grid';
import { hash2, hashString } from '../hash';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { bandInsolationProfile } from './energyBalance';

/** Gaussian productivity/suitability window: peak 1 at `opt`, width `width`,
 *  hard-zeroed outside [lo, hi]. Branch-only outside the exp so it is exactly 0
 *  beyond the band (no float-tolerance ambiguity). */
export function gaussianWindow(x: number, opt: number, width: number, lo: number, hi: number): number {
  if (x < lo || x > hi) return 0;
  const z = (x - opt) / width;
  return Math.exp(-z * z);
}

/**
 * Fraction of ocean cells whose surface temperature is in the liquid-water
 * productivity window [`PROD_TEMP_MIN_K`, `PROD_TEMP_MAX_K`] — the habitability
 * gate scaling the abiogenesis onset probability. 0 for a land-only or
 * everywhere-frozen/boiling world (life cannot originate there yet).
 */
export function oceanHabitableFraction(state: PlanetState): number {
  const count = cellCount(state.params.gridN);
  const { elevation, temperature } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let warm = 0;
  let ocean = 0;
  for (let i = 0; i < count; i++) {
    if (elevation[i]! >= seaLevel) continue; // land
    ocean++;
    if (temperature[i]! >= PROD_TEMP_MIN_K && temperature[i]! <= PROD_TEMP_MAX_K) warm++;
  }
  return ocean > 0 ? warm / ocean : 0;
}

/**
 * Per-step abiogenesis probability: `(1 − exp(−rate·dt)) × habitableFraction`.
 * Exposed for the onset-gating test. Pure.
 */
export function abiogenesisProbability(state: PlanetState, dtYears: number): number {
  const rate = state.params.abiogenesisRatePerYear;
  return (1 - Math.exp(-rate * dtYears)) * oceanHabitableFraction(state);
}

/**
 * The hash-based abiogenesis draw for this step, in [0, 1). Keyed on
 * `(seed, quantizedTime)` so it advances per step, is seed-dependent, and
 * consumes nothing from `ctx.rng` (the clean-ablation guarantee). The time
 * quantum uses `min(RIFT_DRAW_QUANTUM_YEARS, dt)` so sub-quantum steps still get
 * independent draws — the same construction the #18 rift decision uses.
 */
function abiogenesisDraw(seed: number, timeYears: number, dtYears: number): number {
  const bioSeed = hash2(seed >>> 0, hashString('abiogenesis'), 0);
  const timeQuantum = Math.round(timeYears / Math.min(RIFT_DRAW_QUANTUM_YEARS, dtYears));
  return hash2(bioSeed, timeQuantum, 0) / 4294967296;
}

/**
 * Compute the `marineLife` field from the current climate, assuming life exists.
 * Pure; O(cells). Ocean cells (`elevation < seaLevelM`) carry
 * `clamp(light × tempWindow × nutrient, 0, 1)`; land carries 0. `light` reuses
 * the #30 annual-mean insolation band profile, normalized to ≈1 at the equator.
 */
export function solveMarineLife(state: PlanetState): Float32Array {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const { elevation, temperature } = state.fields;
  const seaLevel = state.globals.seaLevelM;

  const NB = ENERGY_BALANCE_BANDS;
  const profile = bandInsolationProfile(state.params.obliquityDeg, NB);
  // Annual-mean insolation peaks at the equator for Earth-like obliquity; the
  // band straddling sin(lat)=0 is that peak. Normalize by it so `light` is ≈1 at
  // the equator and falls toward the poles (the productivity latitudinal ramp).
  const equatorInsolation = profile[Math.floor(NB / 2)]!;

  const marineLife = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const depth = seaLevel - elevation[i]!;
    if (depth <= 0) continue; // land: no marine productivity
    // Insolation band from sin(latitude) = the cell-center y component.
    const y = centers[i * 3 + 1]!;
    let b = Math.floor(((y + 1) / 2) * NB);
    if (b < 0) b = 0;
    else if (b >= NB) b = NB - 1;
    const light = profile[b]! / equatorInsolation;
    const tempWindow = gaussianWindow(temperature[i]!, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K);
    // Shelf/upwelling nutrient proxy: shallow seas near continents are richer,
    // the abyss floors at MARINE_NUTRIENT_MIN.
    let nutrient = 1 - depth / MARINE_NUTRIENT_SHELF_DEPTH_M;
    if (nutrient < MARINE_NUTRIENT_MIN) nutrient = MARINE_NUTRIENT_MIN;
    else if (nutrient > 1) nutrient = 1;
    let p = light * tempWindow * nutrient;
    if (p < 0) p = 0;
    else if (p > 1) p = 1;
    marineLife[i] = p;
  }
  return marineLife;
}

/**
 * Advance ocean life one step: run the abiogenesis onset (once), then fill
 * `marineLife` if life exists. Returns the same state (unchanged) when the
 * biosphere is disabled or life has not yet originated.
 */
export function applyMarineLife(state: PlanetState, dtYears: number): PlanetState {
  if (!state.params.biosphereEnabled) return state;

  let abiogenesisYear = state.globals.abiogenesisYear;
  let events = state.events;
  if (abiogenesisYear < 0) {
    const pOnset = abiogenesisProbability(state, dtYears);
    if (pOnset > 0 && abiogenesisDraw(state.params.seed, state.timeYears, dtYears) < pOnset) {
      abiogenesisYear = state.timeYears;
      const event: SimEvent = { timeYears: state.timeYears, kind: EVENT_KINDS.abiogenesis };
      events = [...events, event];
    }
  }

  // No life yet ⇒ nothing changed (the field stays its zero array, globals and
  // events untouched): return the input state so no allocation happens.
  if (abiogenesisYear < 0) return state;

  const marineLife = solveMarineLife(state);
  return {
    ...state,
    fields: { ...state.fields, marineLife },
    globals: { ...state.globals, abiogenesisYear },
    events,
  };
}

export const marineLifeSystem: System = {
  name: 'marineLife',
  apply: (state, dtYears) => applyMarineLife(state, dtYears),
};
