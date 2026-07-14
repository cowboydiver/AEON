import { describe, expect, it } from 'vitest';
import {
  ICE_ACCUM_SUPPLY_MAX,
  ICE_FREEZE_TEMP_K,
  ICE_FULL_COVER_BELOW_K,
} from '../src/constants';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCount } from '../src/grid';
import { createPlanetParams, type PlanetState } from '../src/state';
import { applyIce, iceEquilibriumCover, iceMoistureSupply, solveIce } from '../src/systems/ice';

const STEP = 1e6;

/**
 * Minimal state whose temperature/precipitation/elevation/iceFraction are filled
 * by a per-cell callback. Sea level defaults to 0 (ocean = elevation < 0).
 */
function climateState(
  N: number,
  fill: (i: number) => { temp: number; precip: number; elev: number; ice: number },
  seaLevelM = 0,
): PlanetState {
  const params = createPlanetParams({ seed: 7, gridN: N });
  const count = cellCount(N);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
  ) as Fields;
  for (let i = 0; i < count; i++) {
    const c = fill(i);
    fields.temperature[i] = c.temp;
    fields.precipitation[i] = c.precip;
    fields.elevation[i] = c.elev;
    fields.iceFraction[i] = c.ice;
  }
  return {
    timeYears: 0,
    params,
    globals: {
      landFraction: 0,
      co2: params.initialCo2Ppm,
      meanTemperatureK: 0,
      seaLevelM,
      waterInventoryM: 0,
      oxygen: 0,
      oxygenReductant: 0,
      abiogenesisYear: -1,
      plateSpeedMedianMPerYr: 0,
      plateSpeedMinMPerYr: 0,
      plateSpeedMaxMPerYr: 0,
      oceanicContinentalSpeedRatio: 0,
      speedContinentalityCorr: 0,
      poleStability: 0,
    },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {} },
  };
}

/** Run the ice system `n` steps, returning the ice cover at cell 0. */
function iceAtCell0After(state: PlanetState, n: number): number {
  let s = state;
  for (let k = 0; k < n; k++) s = applyIce(s, STEP);
  return s.fields.iceFraction[0]!;
}

describe('ice: equilibrium cover (#33)', () => {
  it('is 0 at and above freezing, 1 a full band below, and graded between', () => {
    expect(iceEquilibriumCover(ICE_FREEZE_TEMP_K)).toBe(0);
    expect(iceEquilibriumCover(ICE_FREEZE_TEMP_K + 20)).toBe(0);
    expect(iceEquilibriumCover(ICE_FREEZE_TEMP_K - ICE_FULL_COVER_BELOW_K)).toBe(1);
    expect(iceEquilibriumCover(ICE_FREEZE_TEMP_K - 2 * ICE_FULL_COVER_BELOW_K)).toBe(1);
    // Half the band below freezing ⇒ half cover.
    expect(iceEquilibriumCover(ICE_FREEZE_TEMP_K - ICE_FULL_COVER_BELOW_K / 2)).toBeCloseTo(0.5, 6);
  });

  it('is monotonically non-increasing in temperature', () => {
    let prev = iceEquilibriumCover(200);
    for (let t = 201; t <= 320; t++) {
      const v = iceEquilibriumCover(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });

  it('grades the albedo transition over a WIDE band (subcritical feedback)', () => {
    // The anti-snowball design point: a cell a few K below freezing must be far
    // from full white, so d(albedo)/dT stays gentle. 5 K below ⇒ well under 1/4.
    expect(iceEquilibriumCover(ICE_FREEZE_TEMP_K - 5)).toBeLessThan(0.25);
    expect(ICE_FULL_COVER_BELOW_K).toBeGreaterThanOrEqual(25);
  });
});

describe('ice: moisture supply (#33)', () => {
  it('ocean cells are always saturated regardless of precipitation', () => {
    expect(iceMoistureSupply(0, true)).toBe(1);
    expect(iceMoistureSupply(5000, true)).toBe(1);
  });

  it('land supply scales with precipitation and clamps at the cap', () => {
    expect(iceMoistureSupply(0, false)).toBe(0);
    expect(iceMoistureSupply(1e9, false)).toBe(ICE_ACCUM_SUPPLY_MAX);
    // Monotonic in the ramp.
    expect(iceMoistureSupply(200, false)).toBeLessThan(iceMoistureSupply(400, false));
  });
});

describe('ice: mass balance (#33)', () => {
  it('accumulates where cold AND wet', () => {
    // Cold, wet, land: ice grows from bare ground over successive steps.
    const s = climateState(4, () => ({ temp: 250, precip: 1500, elev: 500, ice: 0 }));
    const after1 = iceAtCell0After(s, 1);
    const after5 = iceAtCell0After(s, 5);
    expect(after1).toBeGreaterThan(0);
    expect(after5).toBeGreaterThan(after1); // still climbing toward equilibrium
  });

  it('a cold DRY land cell accumulates far slower than a cold WET one', () => {
    const wet = climateState(4, () => ({ temp: 250, precip: 1500, elev: 500, ice: 0 }));
    const dry = climateState(4, () => ({ temp: 250, precip: 0, elev: 500, ice: 0 }));
    // Same temperature (same equilibrium target), but supply gates the RATE.
    expect(iceAtCell0After(wet, 5)).toBeGreaterThan(iceAtCell0After(dry, 5));
    expect(iceAtCell0After(dry, 5)).toBe(0); // zero precip ⇒ zero growth rate
  });

  it('grows sea ice on a cold ocean cell even with no precipitation', () => {
    // Ocean (elevation < sea level) is saturated: cold sea freezes over — the
    // snowball-relevant feedback surface, independent of precipitation.
    const s = climateState(4, () => ({ temp: 250, precip: 0, elev: -3000, ice: 0 }));
    expect(iceAtCell0After(s, 5)).toBeGreaterThan(0);
  });

  it('ablates where warm', () => {
    // Fully iced but well above freezing: the cap melts back toward zero.
    const s = climateState(4, () => ({ temp: 290, precip: 1000, elev: 500, ice: 1 }));
    const after1 = iceAtCell0After(s, 1);
    const after5 = iceAtCell0After(s, 5);
    expect(after1).toBeLessThan(1);
    expect(after5).toBeLessThan(after1);
  });

  it('relaxes toward the temperature-set equilibrium cover over long time', () => {
    const t = ICE_FREEZE_TEMP_K - ICE_FULL_COVER_BELOW_K / 2; // target ≈ 0.5
    const s = climateState(4, () => ({ temp: t, precip: 1500, elev: 500, ice: 0 }));
    // Many steps: growth and (baseline) retreat balance at the target.
    const settled = iceAtCell0After(s, 400);
    expect(settled).toBeCloseTo(iceEquilibriumCover(t), 2);
  });

  it('keeps iceFraction within [0, 1] for extreme inputs', () => {
    const cold = climateState(4, () => ({ temp: 120, precip: 5000, elev: -2000, ice: 0.9 }));
    const warm = climateState(4, () => ({ temp: 340, precip: 5000, elev: 500, ice: 0.05 }));
    for (const s of [cold, warm]) {
      let st = s;
      for (let k = 0; k < 50; k++) st = applyIce(st, STEP);
      for (const v of st.fields.iceFraction) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ice: dt-correctness, purity, determinism (#33)', () => {
  it('is dt-correct: two half-steps ≈ one full step', () => {
    const make = () => climateState(4, () => ({ temp: 255, precip: 1000, elev: 400, ice: 0.1 }));
    const one = applyIce(make(), 2 * STEP).fields.iceFraction[0]!;
    let twoState = make();
    twoState = applyIce(twoState, STEP);
    twoState = applyIce(twoState, STEP);
    // The exponential relaxation composes; equal within the linearization error.
    expect(twoState.fields.iceFraction[0]!).toBeCloseTo(one, 3);
  });

  it('does not mutate the input state and is deterministic', () => {
    const s = climateState(4, (i) => ({ temp: 250 + i, precip: 800, elev: 300, ice: 0.2 }));
    const beforeIce = s.fields.iceFraction.slice();
    const a = solveIce(s, STEP);
    const b = solveIce(s, STEP);
    expect(s.fields.iceFraction).toEqual(beforeIce); // untouched
    expect(a).toEqual(b); // same input ⇒ identical output
    expect(a).not.toBe(b); // fresh array each call
  });
});
