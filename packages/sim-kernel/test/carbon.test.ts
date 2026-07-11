import { describe, expect, it } from 'vitest';
import {
  CO2_MAX_PPM,
  CO2_MIN_PPM,
  CO2_OUTGAS_ACTIVITY_FACTOR_MAX,
  CO2_OUTGAS_ACTIVITY_FACTOR_MIN,
  CO2_OUTGAS_ACTIVITY_REF_M_PER_YR,
  CO2_OUTGAS_REFERENCE_PPM_PER_YR,
  CO2_REFERENCE_PPM,
  CO2_WEATHER_PRECIP_FACTOR_MAX,
  CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR,
  CO2_WEATHER_REF_TEMP_K,
  CO2_WEATHER_REFERENCE_PPM_PER_YR,
  CO2_WEATHER_TEMP_FACTOR_MAX,
} from '../src/constants';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCount } from '../src/grid';
import { createPlanetParams, type PlanetState } from '../src/state';
import {
  applyCarbon,
  outgassingPpmPerYr,
  solveCarbon,
  tectonicActivity,
  weatheringPotential,
  weatheringPpmPerYr,
  weatheringPrecipFactor,
  weatheringTempFactor,
} from '../src/systems/carbon';

const STEP = 1e6;

/**
 * Minimal state whose per-cell climate fields and scalar globals are filled by
 * callbacks. Sea level defaults to 0 (ocean = elevation < 0), co2 to the
 * reference. Everything else zero.
 */
function carbonState(
  N: number,
  fill: (i: number) => { temp?: number; precip?: number; elev?: number; ice?: number; stress?: number },
  globals?: { co2?: number; seaLevelM?: number },
): PlanetState {
  const params = createPlanetParams({ seed: 7, gridN: N });
  const count = cellCount(N);
  const fields = Object.fromEntries(FIELD_NAMES.map((n) => [n, new Float32Array(count)])) as Fields;
  for (let i = 0; i < count; i++) {
    const c = fill(i);
    fields.temperature[i] = c.temp ?? 0;
    fields.precipitation[i] = c.precip ?? 0;
    fields.elevation[i] = c.elev ?? 0;
    fields.iceFraction[i] = c.ice ?? 0;
    fields.boundaryStress[i] = c.stress ?? 0;
  }
  return {
    timeYears: 0,
    params,
    globals: {
      landFraction: 0,
      co2: globals?.co2 ?? CO2_REFERENCE_PPM,
      meanTemperatureK: 0,
      seaLevelM: globals?.seaLevelM ?? 0,
      waterInventoryM: 0,
      oxygen: 0,
      oxygenReductant: 0,
      abiogenesisYear: -1,
    },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {} },
  };
}

describe('carbon: tectonic activity (#34)', () => {
  it('averages |boundaryStress| over active boundary cells only', () => {
    // Two boundary cells (0.02, 0.01), two interior (exactly 0): mean over the
    // active pair is 0.015, NOT diluted by the interior cells.
    const s = carbonState(4, (i) => ({ stress: i === 0 ? 0.02 : i === 1 ? -0.01 : 0 }));
    expect(tectonicActivity(s)).toBeCloseTo(0.015, 9);
  });

  it('is 0 for a boundary-free (single-plate) world', () => {
    const s = carbonState(4, () => ({ stress: 0 }));
    expect(tectonicActivity(s)).toBe(0);
  });
});

describe('carbon: outgassing (#34)', () => {
  it('scales linearly with activity around the reference', () => {
    const half = outgassingPpmPerYr(CO2_OUTGAS_ACTIVITY_REF_M_PER_YR * 0.7);
    const ref = outgassingPpmPerYr(CO2_OUTGAS_ACTIVITY_REF_M_PER_YR);
    expect(ref).toBeCloseTo(CO2_OUTGAS_REFERENCE_PPM_PER_YR, 12);
    expect(half).toBeCloseTo(CO2_OUTGAS_REFERENCE_PPM_PER_YR * 0.7, 12);
  });

  it('a quiet world still degasses (the floor guarantees recovery)', () => {
    expect(outgassingPpmPerYr(0)).toBeCloseTo(
      CO2_OUTGAS_REFERENCE_PPM_PER_YR * CO2_OUTGAS_ACTIVITY_FACTOR_MIN,
      12,
    );
    // NaN activity folds to the floor, never a non-finite outgassing.
    expect(outgassingPpmPerYr(Number.NaN)).toBeCloseTo(
      CO2_OUTGAS_REFERENCE_PPM_PER_YR * CO2_OUTGAS_ACTIVITY_FACTOR_MIN,
      12,
    );
  });

  it('caps a vigorous reorganization so CO2 cannot run away', () => {
    expect(outgassingPpmPerYr(CO2_OUTGAS_ACTIVITY_REF_M_PER_YR * 100)).toBeCloseTo(
      CO2_OUTGAS_REFERENCE_PPM_PER_YR * CO2_OUTGAS_ACTIVITY_FACTOR_MAX,
      12,
    );
  });
});

describe('carbon: weathering factors (#34)', () => {
  it('temperature factor is 1 at the reference, rises with warmth, floors cold, caps hot', () => {
    expect(weatheringTempFactor(CO2_WEATHER_REF_TEMP_K)).toBeCloseTo(1, 9);
    expect(weatheringTempFactor(CO2_WEATHER_REF_TEMP_K + 10)).toBeGreaterThan(1.9); // ~doubling/10 K
    expect(weatheringTempFactor(CO2_WEATHER_REF_TEMP_K - 40)).toBeLessThan(0.1); // near-frozen: weathering off
    expect(weatheringTempFactor(400)).toBe(CO2_WEATHER_TEMP_FACTOR_MAX); // clamped
  });

  it('temperature factor is monotonically increasing', () => {
    let prev = weatheringTempFactor(200);
    for (let t = 201; t <= 340; t++) {
      const v = weatheringTempFactor(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('runoff factor ramps with precipitation and clamps', () => {
    expect(weatheringPrecipFactor(0)).toBe(0);
    expect(weatheringPrecipFactor(CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR)).toBeCloseTo(1, 9);
    expect(weatheringPrecipFactor(1e9)).toBe(CO2_WEATHER_PRECIP_FACTOR_MAX);
    expect(weatheringPrecipFactor(300)).toBeLessThan(weatheringPrecipFactor(600));
  });
});

describe('carbon: weathering potential (#34)', () => {
  it('counts only exposed land, weighted by warmth, runoff and ice-free area', () => {
    // All cells warm/wet land at the reference: every cell contributes 1, so the
    // cell-count mean is 1.
    const allLand = carbonState(4, () => ({
      temp: CO2_WEATHER_REF_TEMP_K,
      precip: CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR,
      elev: 100,
      ice: 0,
    }));
    expect(weatheringPotential(allLand)).toBeCloseTo(1, 6);

    // Half ocean (elevation below sea level) contributes nothing.
    const halfOcean = carbonState(4, (i) => ({
      temp: CO2_WEATHER_REF_TEMP_K,
      precip: CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR,
      elev: i % 2 === 0 ? 100 : -100,
      ice: 0,
    }));
    expect(weatheringPotential(halfOcean)).toBeCloseTo(0.5, 6);
  });

  it('ice-sealed land weathers nothing; a snowball shuts the sink off', () => {
    const iced = carbonState(4, () => ({
      temp: CO2_WEATHER_REF_TEMP_K,
      precip: CO2_WEATHER_PRECIP_REF_KG_PER_M2_YR,
      elev: 100,
      ice: 1,
    }));
    expect(weatheringPotential(iced)).toBe(0);
  });

  it('scales weathering by the direct pCO2 term (exponent 0.5 ⇒ ×2 at ×4 CO2)', () => {
    expect(weatheringPpmPerYr(CO2_REFERENCE_PPM, 1)).toBeCloseTo(CO2_WEATHER_REFERENCE_PPM_PER_YR, 12);
    expect(weatheringPpmPerYr(CO2_REFERENCE_PPM * 4, 1)).toBeCloseTo(
      CO2_WEATHER_REFERENCE_PPM_PER_YR * 2,
      12,
    );
    expect(weatheringPpmPerYr(CO2_REFERENCE_PPM, 0)).toBe(0); // no land ⇒ no sink
  });
});

describe('carbon: CO2 mass balance (#34)', () => {
  it('draws CO2 DOWN when the planet is warm, wet and ice-free (weathering wins)', () => {
    // Warm wet land, active margins, CO2 above the fixed point ⇒ weathering
    // exceeds outgassing ⇒ CO2 falls.
    const s = carbonState(
      8,
      () => ({ temp: 300, precip: 1500, elev: 200, ice: 0, stress: 0.03 }),
      { co2: 2000 },
    );
    const sol = solveCarbon(s, STEP);
    expect(sol.weathering).toBeGreaterThan(sol.outgassing);
    expect(sol.co2).toBeLessThan(2000);
  });

  it('builds CO2 UP in a snowball (ice-sealed land ⇒ weathering off, outgassing unopposed)', () => {
    // Frozen: land iced, ocean iced, cold, dry — weathering ~0 while outgassing
    // continues ⇒ CO2 rises. The recovery driver.
    const s = carbonState(
      8,
      () => ({ temp: 230, precip: 50, elev: 200, ice: 1, stress: 0.02 }),
      { co2: 280 },
    );
    const sol = solveCarbon(s, STEP);
    expect(sol.weathering).toBeCloseTo(0, 9);
    expect(sol.outgassing).toBeGreaterThan(0);
    expect(sol.co2).toBeGreaterThan(280);
  });

  it('rate-limits a single step so the explicit-lag feedback cannot overshoot', () => {
    // A huge imbalance (deep snowball, low CO2) would slam CO2 up; the per-step
    // fractional cap holds the change to CO2_MAX_CHANGE_FRAC_PER_MYR·co2·dt.
    const s = carbonState(8, () => ({ temp: 220, precip: 0, elev: 200, ice: 1, stress: 0.05 }), { co2: 100 });
    const sol = solveCarbon(s, STEP);
    // 5%/Myr of 100 ppm over a 1 Myr step ⇒ at most +5 ppm.
    expect(sol.co2).toBeLessThanOrEqual(105 + 1e-6);
    expect(sol.co2).toBeGreaterThan(100);
  });

  it('clamps CO2 to [MIN, MAX]', () => {
    // Force weathering to slam a near-floor CO2 down: it stops at CO2_MIN_PPM.
    const low = carbonState(8, () => ({ temp: 320, precip: 5000, elev: 200, ice: 0, stress: 0 }), {
      co2: CO2_MIN_PPM + 0.5,
    });
    expect(solveCarbon(low, STEP).co2).toBeGreaterThanOrEqual(CO2_MIN_PPM);
    // And the ceiling holds at the top.
    const high = carbonState(8, () => ({ temp: 220, precip: 0, elev: 200, ice: 1, stress: 0.05 }), {
      co2: CO2_MAX_PPM - 1,
    });
    expect(solveCarbon(high, STEP).co2).toBeLessThanOrEqual(CO2_MAX_PPM);
  });
});

describe('carbon: dt-correctness, purity, determinism (#34)', () => {
  it('is dt-correct: two half-steps ≈ one full step (explicit-Euler consistency)', () => {
    const make = () =>
      carbonState(8, () => ({ temp: 285, precip: 900, elev: 150, ice: 0.05, stress: 0.012 }), { co2: 400 });
    const before = 400;
    const one = solveCarbon(make(), 2 * STEP).co2;
    let two = make();
    two = applyCarbon(two, STEP);
    two = applyCarbon(two, STEP);
    // Explicit forward-Euler: the two agree to the scheme's O(dt²) truncation —
    // a few percent of the step's CO2 change, NOT bit-identical. `dt` genuinely
    // scales the increment (a coarser step rescales the trajectory, not the
    // physics), which is what "dt-correct" means for this reservoir.
    expect(Math.abs(two.globals.co2 - one)).toBeLessThan(0.1 * Math.abs(one - before));
  });

  it('does not mutate the input state and is deterministic', () => {
    const s = carbonState(8, (i) => ({ temp: 280 + i, precip: 800, elev: 100, ice: 0.1, stress: 0.01 }), {
      co2: 350,
    });
    const beforeCo2 = s.globals.co2;
    const a = solveCarbon(s, STEP);
    const b = solveCarbon(s, STEP);
    expect(s.globals.co2).toBe(beforeCo2); // untouched
    expect(a.co2).toBe(b.co2); // same input ⇒ identical output
    const applied = applyCarbon(s, STEP);
    expect(applied.globals.co2).toBe(a.co2);
    expect(applied.fields).toBe(s.fields); // carbon writes no field
  });
});
