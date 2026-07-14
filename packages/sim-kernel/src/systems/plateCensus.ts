/**
 * Plate-census diagnostic (Tectonics V2 stage 0, #110; proposal §3/§5).
 *
 * A pure, RNG-free, field-preserving pass that measures the per-plate quantities
 * the force-balance gates are written against — quantities the sim-cli
 * `--plate-census` report cannot reconstruct from a keyframe alone, because
 * keyframes carry `fields`/`globals`/`events` only and NEVER plate records
 * (step.ts). The proposal's §2.2 routing correction is honoured by surfacing
 * these as a fixed set of scalar aggregates on `globals`; the field-derivable
 * census metrics (seafloor age, plateness) stay in sim-cli.
 *
 * Gated by `params.plateCensus` (default false). When off the system is exact
 * identity — no field, event, plate record, or global changes — so the main
 * goldens (FNV hashes of the fields) and every downstream consumer are
 * byte-identical to the pre-#110 kernel. When on it runs LAST in the pipeline
 * (after every physical system), so it reads this step's fully-solved
 * `plateId`/`crustType` and the current plate table.
 *
 * Metrics (all over ALIVE plates that own ≥ 1 cell; 0 when there are none):
 *  - speed distribution: a plate's characteristic surface speed is |ω|·R
 *    (`|angularVelRadPerYr|·radiusMeters`, m/yr) — the rigid-rotation speed at
 *    one radian of arc from the pole, a single scale-free number per plate;
 *  - oceanic/continental speed ratio: mean speed of ocean-dominated plates
 *    (current continental fraction < 0.5) ÷ mean speed of continent-dominated
 *    plates (≥ 0.5) — Forsyth & Uyeda's ratio (§3 target 1.5–4);
 *  - speed-vs-continentality Pearson correlation (their sign test — expected
 *    negative once the balance runs);
 *  - pole stability: count-mean cosine between this step's Euler pole and the
 *    previous census step's (`prevEulerPole`) — the seed for the stage-1
 *    autocorrelation diagnostic; exactly 1.0 on the immutable-pole baseline.
 *
 * Purity: one ascending-index O(cells) sweep for ownership, one O(plates) pass,
 * a partial-selection median, no RNG, no I/O, no input mutation (a fresh globals
 * object and, for the pole memory, a fresh plate table). Determinism: fixed
 * iteration order; same seed + params ⇒ bit-identical census on every machine.
 */

import { cellCount } from './../grid';
import type { PlanetState } from './../state';
import type { System } from './../step';
import { dot3 } from './../vec';

/** A plate is "continent-dominated" at/above this current continental fraction;
 *  below it, "ocean-dominated" — the split for the Forsyth & Uyeda ratio. */
const CONTINENT_DOMINATED_FRACTION = 0.5;

/** The six diagnostic scalars written onto `globals` (same names/units). */
export interface PlateCensus {
  readonly plateSpeedMedianMPerYr: number;
  readonly plateSpeedMinMPerYr: number;
  readonly plateSpeedMaxMPerYr: number;
  readonly oceanicContinentalSpeedRatio: number;
  readonly speedContinentalityCorr: number;
  readonly poleStability: number;
}

/** All-zero census — the value when no alive plate owns a cell (and the init
 *  value of the globals). */
const EMPTY_CENSUS: PlateCensus = {
  plateSpeedMedianMPerYr: 0,
  plateSpeedMinMPerYr: 0,
  plateSpeedMaxMPerYr: 0,
  oceanicContinentalSpeedRatio: 0,
  speedContinentalityCorr: 0,
  poleStability: 0,
};

/** Median of a numeric list (sorted copy; even length ⇒ mean of the two middle
 *  values). Caller guarantees a non-empty list. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = n >> 1;
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Pearson correlation of two equal-length series; 0 when < 2 points or either
 *  series has zero variance (a degenerate correlation is reported as "no
 *  signal", not NaN). */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom > 0 ? sxy / denom : 0;
}

/**
 * Compute the plate census from the current state. Pure: reads `plates`,
 * `plateId`, `crustType`, `radiusMeters`, and each alive plate's
 * `prevEulerPole` (undefined ⇒ treated as the current pole, contributing a
 * perfect 1.0 to pole stability, so the first census step reports 1.0). Does
 * NOT update `prevEulerPole` — that pole-memory advance is the system's job.
 */
export function computePlateCensus(state: PlanetState): PlateCensus {
  const plates = state.plates;
  const numPlates = plates.length;
  if (numPlates === 0) return EMPTY_CENSUS;

  const count = cellCount(state.params.gridN);
  const plateId = state.fields.plateId;
  const crustType = state.fields.crustType;

  // One ascending sweep: cells owned, and continental cells owned, per plate.
  const owned = new Int32Array(numPlates);
  const continental = new Int32Array(numPlates);
  for (let i = 0; i < count; i++) {
    const p = plateId[i]!;
    // plateId is an index into `plates` stored as a float; guard the range so a
    // stale/out-of-range id can never index past the scratch (defensive — the
    // partition keeps it in range).
    if (p >= 0 && p < numPlates) {
      owned[p]!++;
      if (crustType[i]! === 1) continental[p]!++;
    }
  }

  const R = state.params.radiusMeters;
  const speeds: number[] = [];
  const contFracs: number[] = [];
  let oceanicSum = 0;
  let oceanicN = 0;
  let continentalSum = 0;
  let continentalN = 0;
  let poleDotSum = 0;
  let poleN = 0;

  for (let p = 0; p < numPlates; p++) {
    const plate = plates[p]!;
    const own = owned[p]!;
    if (!plate.alive || own === 0) continue;

    const speed = Math.abs(plate.angularVelRadPerYr) * R;
    const frac = continental[p]! / own;
    speeds.push(speed);
    contFracs.push(frac);

    if (frac < CONTINENT_DOMINATED_FRACTION) {
      oceanicSum += speed;
      oceanicN++;
    } else {
      continentalSum += speed;
      continentalN++;
    }

    // Pole stability: cos(angle) between the current and previous poles. Both
    // are unit vectors, so the dot IS the cosine; a missing prev (first census
    // step) contributes the identity 1.0.
    const prev = plate.prevEulerPole;
    poleDotSum += prev ? dot3(plate.eulerPole, prev) : 1;
    poleN++;
  }

  if (speeds.length === 0) return EMPTY_CENSUS;

  let min = speeds[0]!;
  let max = speeds[0]!;
  for (let i = 1; i < speeds.length; i++) {
    const s = speeds[i]!;
    if (s < min) min = s;
    if (s > max) max = s;
  }

  // Ratio only when BOTH partitions are populated; otherwise it is undefined
  // (reported as 0 = "no comparison this step"), never a divide-by-zero.
  const ratio =
    oceanicN > 0 && continentalN > 0
      ? oceanicSum / oceanicN / (continentalSum / continentalN)
      : 0;

  return {
    plateSpeedMedianMPerYr: median(speeds),
    plateSpeedMinMPerYr: min,
    plateSpeedMaxMPerYr: max,
    oceanicContinentalSpeedRatio: ratio,
    speedContinentalityCorr: pearson(speeds, contFracs),
    poleStability: poleN > 0 ? poleDotSum / poleN : 0,
  };
}

/**
 * Stage-0 plate-census system: identity unless `params.plateCensus` is set, in
 * which case it writes the six census scalars onto `globals` and advances each
 * plate's `prevEulerPole` to the current pole (the memory the NEXT step's pole
 * stability reads). Field arrays are never touched, so the goldens are
 * byte-identical whether or not the census runs.
 */
export const plateCensusSystem: System = {
  name: 'plateCensus',
  apply: (state) => {
    if (!state.params.plateCensus) return state;
    const census = computePlateCensus(state);
    // Advance the pole memory for the next step's stability read. Copying the
    // pole (not aliasing) keeps the record independent of any later mutation.
    const plates = state.plates.map((plate) => ({
      ...plate,
      prevEulerPole: [plate.eulerPole[0], plate.eulerPole[1], plate.eulerPole[2]] as [
        number,
        number,
        number,
      ],
    }));
    return {
      ...state,
      globals: { ...state.globals, ...census },
      plates,
    };
  },
};
