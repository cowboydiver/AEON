import { describe, expect, it } from 'vitest';
import { GOE_THRESHOLD_PAL, OXYGEN_MAX_PAL, REDUCTANT_BUFFER_PAL } from '../src/constants';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import { meanMarineProductivity, solveOxygen } from '../src/systems/oxygen';

/**
 * Atmospheric oxygenation (#37): the O₂ reservoir integrates net photosynthetic
 * flux through the reductant buffer, so the Great Oxidation emerges as an
 * S-curve. The redox budget closes exactly, O₂ stays bounded, and higher
 * productivity lifts the plateau.
 */

function runFull(params: ReturnType<typeof createPlanetParams>, n: number): PlanetState {
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

describe('oxygen: the redox budget closes (#37, §5)', () => {
  it('next O₂ and reductant equal the explicit flux budget, exactly', () => {
    // A live planet mid-oxygenation: force early abiogenesis and run in.
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 1e-2 });
    const s = runFull(params, 60);
    expect(s.globals.abiogenesisYear).toBeGreaterThanOrEqual(0);

    const dt = params.stepYears;
    const sol = solveOxygen(s, dt);
    // oxygen === clamp(prev + gross − volc − reductantAbsorbed − oxSink, 0, MAX)
    const raw =
      s.globals.oxygen + sol.grossSource - sol.volcanicSink - sol.reductantAbsorbed - sol.oxidativeSink;
    const clamped = Math.min(OXYGEN_MAX_PAL, Math.max(0, raw));
    expect(sol.oxygen).toBeCloseTo(clamped, 12);
    // reductant === prev − absorbed, and the buffer is monotone / non-negative.
    expect(sol.reductant).toBeCloseTo(s.globals.oxygenReductant - sol.reductantAbsorbed, 12);
    expect(sol.reductant).toBeLessThanOrEqual(s.globals.oxygenReductant + 1e-15);
    expect(sol.reductant).toBeGreaterThanOrEqual(0);
    // Every flux is non-negative.
    for (const f of [sol.grossSource, sol.volcanicSink, sol.reductantAbsorbed, sol.oxidativeSink]) {
      expect(f).toBeGreaterThanOrEqual(0);
    }
  });

  it('accumulated atmospheric O₂ equals organic burial minus sinks over the run', () => {
    // The physical closure (§5): once O₂ leaves the anoxic floor it never returns
    // there (monotonic rise to plateau), so from that step on Δoxygen equals the
    // per-step budget every step — the cumulative sum must equal the final O₂.
    // We drive the climate + marineLife pipeline and integrate O₂ by hand so we
    // can accumulate the flux components exactly.
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 1e-2, stepYears: 5e6 });
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };

    // Run the full pipeline (so marineLife/abiogenesis advance for real) but
    // thread the O₂ reservoir by hand from the exposed flux components, ignoring
    // the pipeline's own O₂ write, so we can accumulate the budget exactly.
    let s = createInitialState(params);
    let oxygen = s.globals.oxygen;
    let reductant = s.globals.oxygenReductant;
    let cum = 0;
    let accumulating = false;
    for (let i = 0; i < 250; i++) {
      s = step(s, params.stepYears, ctx);
      const view: PlanetState = { ...s, globals: { ...s.globals, oxygen, oxygenReductant: reductant } };
      const sol = solveOxygen(view, params.stepYears);
      if (!accumulating && sol.oxygen > 0) accumulating = true;
      if (accumulating) {
        cum += sol.grossSource - sol.volcanicSink - sol.reductantAbsorbed - sol.oxidativeSink;
      }
      oxygen = sol.oxygen;
      reductant = sol.reductant;
    }
    expect(accumulating, 'the planet oxygenated').toBe(true);
    // The cumulative budget (from the first positive-O₂ step) equals the O₂ now,
    // to float-accumulation tolerance over the hundreds of Float64 sums.
    expect(oxygen).toBeCloseTo(cum, 4);
  });
});

describe('oxygen: bounds, ablation and the Great Oxidation (#37)', () => {
  it('holds its seed when the biosphere is disabled', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16, biosphereEnabled: false });
    const s = runFull(params, 30);
    expect(s.globals.oxygen).toBe(params.initialOxygenPAL);
    expect(s.globals.oxygenReductant).toBe(REDUCTANT_BUFFER_PAL);
    expect(s.events.some((e) => e.kind === 'greatOxidation')).toBe(false);
  });

  it('stays anoxic through the reductant-buffer latency, then crosses GOE exactly once', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 1e-2, stepYears: 5e6 });
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let s = createInitialState(params);
    let sawAnoxicAfterLife = false;
    let goeCount = 0;
    let prevGoe = 0;
    for (let i = 0; i < 300; i++) {
      s = step(s, params.stepYears, ctx);
      // While the buffer is oxidizing, life exists but O₂ is still sub-GOE.
      if (s.globals.abiogenesisYear >= 0 && s.globals.oxygen < GOE_THRESHOLD_PAL && s.globals.oxygenReductant > 0) {
        sawAnoxicAfterLife = true;
      }
      goeCount = s.events.filter((e) => e.kind === 'greatOxidation').length;
      // O₂ never exceeds the defensive ceiling.
      expect(s.globals.oxygen).toBeLessThanOrEqual(OXYGEN_MAX_PAL);
      expect(Number.isFinite(s.globals.oxygen)).toBe(true);
      expect(goeCount).toBeGreaterThanOrEqual(prevGoe);
      prevGoe = goeCount;
    }
    expect(sawAnoxicAfterLife, 'an anoxic latency separated abiogenesis from the GOE').toBe(true);
    expect(goeCount, 'the Great Oxidation fired exactly once').toBe(1);
    const goe = s.events.find((e) => e.kind === 'greatOxidation')!;
    const abio = s.events.find((e) => e.kind === 'abiogenesis')!;
    expect(goe.timeYears).toBeGreaterThan(abio.timeYears); // latency, not simultaneous
    expect(s.globals.oxygen).toBeGreaterThanOrEqual(GOE_THRESHOLD_PAL);
  });

  it('is a monotone driver: doubling marine productivity raises the next O₂', () => {
    // Same reservoir state, twice the productivity ⇒ twice the gross source ⇒ a
    // higher next O₂ (the directional §5 invariant: raise productivity ⇒ plateau
    // rises). Build a live-ocean state and scale its marineLife field.
    const params = createPlanetParams({ seed: 42, gridN: 16, abiogenesisRatePerYear: 1e-2 });
    const s = runFull(params, 60);
    const half: PlanetState = { ...s, fields: { ...s.fields, marineLife: s.fields.marineLife.map((v) => v * 0.5) } };
    const lo = solveOxygen(half, params.stepYears);
    const hi = solveOxygen(s, params.stepYears);
    expect(meanMarineProductivity(s)).toBeGreaterThan(meanMarineProductivity(half));
    expect(hi.grossSource).toBeGreaterThan(lo.grossSource);
    expect(hi.oxygen).toBeGreaterThan(lo.oxygen);
  });
});
