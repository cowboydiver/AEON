import { describe, expect, it } from 'vitest';
import {
  PROD_TEMP_MAX_K,
  PROD_TEMP_MIN_K,
  PROD_TEMP_OPT_K,
  PROD_TEMP_WIDTH_K,
} from '../src/constants';
import { FIELD_NAMES } from '../src/fields';
import { hashFloat32Array } from '../src/hash';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import {
  abiogenesisProbability,
  gaussianWindow,
  oceanHabitableFraction,
} from '../src/systems/marineLife';

/**
 * Ocean life (#37): abiogenesis onset + marine productivity. The onset is a
 * gated-stochastic Bernoulli (deterministic, seed-dependent, independent of the
 * sim PRNG); the `marineLife` field is a fast per-ocean-cell diagnostic that is
 * 0 until life originates and 0 forever when the biosphere is disabled.
 */

function stepped(params: ReturnType<typeof createPlanetParams>, n: number): PlanetState {
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

describe('marineLife: productivity window & habitability (#37)', () => {
  it('gaussianWindow peaks at the optimum and is exactly 0 outside the band', () => {
    expect(gaussianWindow(PROD_TEMP_OPT_K, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K)).toBeCloseTo(1, 12);
    // Just below the freezing floor / just above the hot ceiling ⇒ hard zero.
    expect(gaussianWindow(PROD_TEMP_MIN_K - 0.001, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K)).toBe(0);
    expect(gaussianWindow(PROD_TEMP_MAX_K + 0.001, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K)).toBe(0);
    // Symmetric and falling away from the optimum.
    const warm = gaussianWindow(PROD_TEMP_OPT_K + 10, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K);
    const cool = gaussianWindow(PROD_TEMP_OPT_K - 10, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K);
    expect(warm).toBeCloseTo(cool, 12);
    expect(warm).toBeLessThan(1);
  });

  it('the default planet has a habitable ocean, so abiogenesis has positive hazard', () => {
    const s = createInitialState(createPlanetParams({ seed: 42, gridN: 16 }));
    const habitable = oceanHabitableFraction(s);
    expect(habitable).toBeGreaterThan(0);
    expect(habitable).toBeLessThanOrEqual(1);
    // Probability rises with the per-year rate and equals hazard×habitable in dt.
    expect(abiogenesisProbability({ ...s, params: { ...s.params, abiogenesisRatePerYear: 0 } }, 1e6)).toBe(0);
    expect(abiogenesisProbability({ ...s, params: { ...s.params, abiogenesisRatePerYear: 1e-2 } }, 1e6)).toBeGreaterThan(0);
  });
});

describe('marineLife: abiogenesis onset (#37)', () => {
  it('does not fire (and marineLife stays 0) when the hazard is 0', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 0 });
    const s = stepped(params, 10);
    expect(s.globals.abiogenesisYear).toBe(-1);
    expect(s.fields.marineLife.every((v) => v === 0)).toBe(true);
    expect(s.events.some((e) => e.kind === 'abiogenesis')).toBe(false);
  });

  it('fires within deep time and is fully deterministic (same seed ⇒ same year)', () => {
    // A high hazard forces a prompt onset so the test is fast; the year is still
    // a deterministic function of (seed, quantized time).
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 1e-2 });
    const a = stepped(params, 20);
    const b = stepped(params, 20);
    expect(a.globals.abiogenesisYear).toBeGreaterThanOrEqual(0);
    expect(b.globals.abiogenesisYear).toBe(a.globals.abiogenesisYear);
    const events = a.events.filter((e) => e.kind === 'abiogenesis');
    expect(events).toHaveLength(1);
    expect(events[0]!.timeYears).toBe(a.globals.abiogenesisYear);
  });

  it('onset timing is seed-dependent (emergent, not scripted)', () => {
    // At the default hazard the onset year varies with each seed's early climate.
    const years = [1, 42, 1337].map((seed) => {
      const params = createPlanetParams({ seed, gridN: 16, stepYears: 10e6 });
      // Run through deep time so every golden seed has originated life.
      let s = createInitialState(params);
      const ctx: SimContext = { rng: createRng(seed).fork('sim') };
      for (let i = 0; i < 450 && s.globals.abiogenesisYear < 0; i++) s = step(s, params.stepYears, ctx);
      return s.globals.abiogenesisYear;
    });
    expect(years.every((y) => y >= 0), `abiogenesis fired on all seeds (${years.join(', ')})`).toBe(true);
    expect(new Set(years).size, `distinct onset years (${years.join(', ')})`).toBeGreaterThanOrEqual(2); // not one scripted date
  });
});

describe('marineLife: the productivity field (#37)', () => {
  it('is 0 on land and positive over some ocean once life exists', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 1e-2 });
    const s = stepped(params, 20);
    expect(s.globals.abiogenesisYear).toBeGreaterThanOrEqual(0);
    const { elevation, marineLife } = s.fields;
    const seaLevel = s.globals.seaLevelM;
    let oceanPositive = 0;
    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i]! >= seaLevel) {
        expect(marineLife[i], `land cell ${i} must be barren`).toBe(0);
      } else if (marineLife[i]! > 0) {
        oceanPositive++;
      }
      // The field is a bounded 0..1 productivity.
      expect(marineLife[i]!).toBeGreaterThanOrEqual(0);
      expect(marineLife[i]!).toBeLessThanOrEqual(1);
    }
    expect(oceanPositive, 'some ocean is productive').toBeGreaterThan(0);
  });
});

describe('marineLife: the ablation is clean (#37, M0 caution 4)', () => {
  it('biosphereEnabled=false keeps marineLife 0 and abiogenesis un-fired', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16, biosphereEnabled: false, abiogenesisRatePerYear: 1e-2 });
    const s = stepped(params, 20);
    expect(s.globals.abiogenesisYear).toBe(-1);
    expect(s.globals.oxygen).toBe(params.initialOxygenPAL);
    expect(s.fields.marineLife.every((v) => v === 0)).toBe(true);
    expect(s.events.some((e) => e.kind === 'abiogenesis' || e.kind === 'greatOxidation')).toBe(false);
  });

  it('enabling the biosphere perturbs NO physical field and consumes no sim RNG', () => {
    // #37's biosphere feeds back into no physical field (albedo/weathering
    // coupling arrives with vegetation, #39) and draws abiogenesis from a hash,
    // not ctx.rng — so on vs off must be byte-identical in every field except
    // marineLife, and in every non-biosphere global. This is what makes the
    // Phase 4 ablation a causal measurement rather than measuring RNG noise.
    const on = stepped(createPlanetParams({ seed: 1337, gridN: 16 }), 12);
    const off = stepped(createPlanetParams({ seed: 1337, gridN: 16, biosphereEnabled: false }), 12);
    for (const name of FIELD_NAMES) {
      if (name === 'marineLife') continue;
      expect(hashFloat32Array(on.fields[name]), `field ${name} unchanged by the biosphere`).toBe(
        hashFloat32Array(off.fields[name]),
      );
    }
    // Non-biosphere globals identical too (the climate is untouched).
    expect(on.globals.co2).toBe(off.globals.co2);
    expect(on.globals.meanTemperatureK).toBe(off.globals.meanTemperatureK);
    expect(on.globals.seaLevelM).toBe(off.globals.seaLevelM);
    expect(on.globals.landFraction).toBe(off.globals.landFraction);
  });
});
