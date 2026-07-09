import { describe, expect, it } from 'vitest';
import {
  CO2_MAX_PPM,
  CO2_OUTGAS_REFERENCE_PPM_PER_YR,
  SOLAR_LUMINOSITY_W,
} from '../../src/constants';
import { createRng } from '../../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../../src/state';
import { SYSTEMS, step, type SimContext, type System } from '../../src/step';

/**
 * Carbonate–silicate thermostat invariants (#34): the done-criteria of the
 * issue — the deep-time negative feedback regulates climate, a snowball is
 * reachable under a cold perturbation and recovers as CO₂ accumulates, and the
 * long run is stable (no oscillation/divergence, the phase's named risk). Each
 * couples through the whole integrated pipeline, so they live here rather than
 * in the per-system `carbon.test.ts`.
 */

const SEEDS = [1, 42, 1337] as const;

function meanIce(s: PlanetState): number {
  let sum = 0;
  for (const f of s.fields.iceFraction) sum += f;
  return sum / s.fields.iceFraction.length;
}

function withLum(s: PlanetState, lumFrac: number): PlanetState {
  return { ...s, params: { ...s.params, starLuminosity: SOLAR_LUMINOSITY_W * lumFrac } };
}

describe('carbon: the thermostat regulates climate (#34)', () => {
  /** Peak-to-peak of a series. */
  const amp = (a: number[]): number => Math.max(...a) - Math.min(...a);
  /** Mean of a series. */
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

  it('is a NEGATIVE feedback that settles to a stable attractor (no oscillation)', () => {
    // Same planet, opposite initial CO₂: a hothouse (2000 ppm) and an icehouse
    // (30 ppm) start. Two claims, both over the settled TAIL of the run (not a
    // single endpoint):
    //   1. Convergence to a stable attractor — the initial CO₂ is forgotten, so
    //      the two runs share the same tail climate (the negative feedback).
    //   2. Settling, not oscillation — the regulated surface temperature holds a
    //      tight band and the CO₂ amplitude stays bounded and does not GROW
    //      window-over-window. A sustained snowball⇄hothouse limit cycle (the
    //      phase's named oscillation risk, which the range bound in phase1 would
    //      miss) would blow the temperature band and the growth check.
    const dt = 5e6;
    for (const seed of SEEDS) {
      const trace = (initialCo2Ppm: number): { co2: number[]; temp: number[] } => {
        const params = createPlanetParams({ seed, gridN: 16, stepYears: dt, initialCo2Ppm });
        const ctx: SimContext = { rng: createRng(seed).fork('sim') };
        let s = createInitialState(params);
        const co2: number[] = [];
        const temp: number[] = [];
        for (let i = 0; i < 400; i++) {
          // 2 Gyr
          s = step(s, dt, ctx);
          co2.push(s.globals.co2);
          temp.push(s.globals.meanTemperatureK);
        }
        return { co2, temp };
      };
      const hot = trace(2000);
      const cold = trace(30);
      const mid = (a: number[]) => a.slice(150, 275); // ~0.75–1.4 Gyr
      const tail = (a: number[]) => a.slice(275, 400); // ~1.4–2.0 Gyr, settled

      // 1. Convergence: the hothouse and icehouse tails agree — the 66× starting
      //    spread in CO₂ is forgotten (a stable attractor, the negative feedback).
      expect(
        Math.abs(mean(tail(hot.temp)) - mean(tail(cold.temp))),
        `seed ${seed}: hothouse/icehouse converge in temperature`,
      ).toBeLessThan(3);
      expect(mean(tail(hot.co2)), `seed ${seed}: hothouse CO₂ drawn down`).toBeLessThan(1200);
      expect(mean(tail(cold.co2)), `seed ${seed}: icehouse CO₂ built up`).toBeGreaterThan(60);

      // 2. Settling / no sustained oscillation, checked on the hothouse run.
      const tT = tail(hot.temp);
      expect(amp(tT), `seed ${seed}: regulated temperature holds a tight band`).toBeLessThan(15);
      const tCo2 = tail(hot.co2);
      const mCo2 = mid(hot.co2);
      expect(amp(tCo2), `seed ${seed}: CO₂ amplitude bounded`).toBeLessThan(1800);
      // Not GROWING window-over-window (a divergent ring would blow this up).
      expect(amp(tCo2), `seed ${seed}: CO₂ oscillation not growing`).toBeLessThan(3 * amp(mCo2) + 400);
    }
  });

  it('a broken thermostat (outgassing, no weathering) DIVERGES — the detector is not vacuous', () => {
    // Replace carbon with outgassing-only: with no weathering sink, CO₂ can only
    // rise, so it pegs the ceiling. The real system (above / below) keeps CO₂
    // bounded far from the clamp — proving the regulation is doing real work.
    const outgasOnly: System = {
      name: 'brokenOutgasOnly',
      apply: (state, dt) => ({
        ...state,
        globals: {
          ...state.globals,
          co2: Math.min(CO2_MAX_PPM, state.globals.co2 + dt * CO2_OUTGAS_REFERENCE_PPM_PER_YR),
        },
      }),
    };
    const broken = [...SYSTEMS.filter((s) => s.name !== 'carbon'), outgasOnly];
    const dt = 5e6;
    const params = createPlanetParams({ seed: 42, gridN: 16, stepYears: dt });
    const ctx: SimContext = { rng: createRng(42).fork('sim') };
    let s = createInitialState(params);
    for (let i = 0; i < 400; i++) s = step(s, dt, ctx, broken);
    // Unbounded climb, ×100+ above any regulated value — with no weathering sink
    // CO₂ only rises, heading for the CO2_MAX ceiling.
    expect(s.globals.co2).toBeGreaterThan(50_000);
  });
});

describe('carbon: a snowball is reachable and recovers (#34)', () => {
  // A transient cold forcing (a fainter star) drives the #33 ice-albedo runaway
  // into a snowball; while the land is ice-sealed, weathering stops and
  // outgassing keeps degassing, so CO₂ accumulates; when the forcing abates the
  // accumulated CO₂ deglaciates the planet and the thermostat draws CO₂ back
  // down — the classic carbonate–silicate recovery.
  it('faint star tips into a snowball, then it recovers as CO₂ accumulates', () => {
    const dt = 3e6;
    const params = createPlanetParams({ seed: 42, gridN: 16, stepYears: dt });
    const ctx: SimContext = { rng: createRng(42).fork('sim') };
    let s = createInitialState(params);

    // Phase 1 — faint star for ~450 Myr: ice-albedo runaway. The tipping point
    // is milder (a measured ~0.63–0.65 of present luminosity for this seed, in
    // the neighbourhood of the ~0.7 faint young Sun); 0.55 is used to force a
    // decisive, unambiguous snowball quickly rather than a marginal slushball.
    for (let i = 0; i < 150; i++) s = step(withLum(s, 0.55), dt, ctx);
    const snowballIce = meanIce(s);
    const snowballCo2 = s.globals.co2;
    expect(snowballIce, 'snowball reached: near-global ice cover').toBeGreaterThan(0.6);
    expect(s.globals.meanTemperatureK, 'snowball is frozen').toBeLessThan(240);
    expect(snowballCo2, 'CO₂ accumulated while weathering was ice-sealed off').toBeGreaterThan(5000);

    // Phase 2 — luminosity restored: the accumulated CO₂ deglaciates the planet
    // (step() carries params forward, so force lum=1.0 each step).
    let recovered = s;
    for (let i = 0; i < 200; i++) recovered = step(withLum(recovered, 1.0), dt, ctx);
    expect(meanIce(recovered), 'deglaciated: ice retreated').toBeLessThan(0.15);
    // Warmed back above freezing into the default planet's warm band (N=16 runs
    // a few K cooler than finer grids, so this checks "clearly deglaciated", not
    // an absolute temperature).
    expect(recovered.globals.meanTemperatureK, 'warmed back up').toBeGreaterThan(273);
    // And the thermostat drew the excess CO₂ back down once weathering resumed.
    expect(recovered.globals.co2, 'CO₂ drawn back down post-deglaciation').toBeLessThan(snowballCo2 / 5);
  });

  it('the accumulated CO₂ is load-bearing: without it the planet stays frozen', () => {
    // Same snowball, but reset CO₂ to preindustrial at restore-time and recover
    // under a still-somewhat-faint star (85%): with the accumulated CO₂ the
    // planet deglaciates; stripped of it, the same restored state stays much icier
    // over the same span — so the recovery genuinely rides the CO₂ build-up, not
    // the luminosity change alone.
    const dt = 3e6;
    const params = createPlanetParams({ seed: 42, gridN: 16, stepYears: dt });
    const mkSnowball = (): PlanetState => {
      const ctx: SimContext = { rng: createRng(42).fork('sim') };
      let s = createInitialState(params);
      for (let i = 0; i < 150; i++) s = step(withLum(s, 0.55), dt, ctx);
      return s;
    };
    const recoverAt = (s0: PlanetState): number => {
      const ctx: SimContext = { rng: createRng(42).fork('sim') };
      let s = s0;
      // A short window (~90 Myr): long enough for the accumulated-CO₂ case to
      // deglaciate, short enough that the stripped case has not yet rebuilt CO₂.
      for (let i = 0; i < 30; i++) s = step(withLum(s, 0.85), dt, ctx);
      return meanIce(s);
    };
    const withCo2 = recoverAt(mkSnowball());
    const strippedCo2 = recoverAt({ ...mkSnowball(), globals: { ...mkSnowball().globals, co2: 280 } });
    expect(withCo2, 'accumulated CO₂ drives deglaciation').toBeLessThan(0.3);
    // Stripped of the accumulated CO₂, the same restored state stays markedly
    // icier over the same span — the recovery rides the CO₂ build-up, not the
    // luminosity alone.
    expect(strippedCo2, 'stripped of that CO₂, it stays far icier').toBeGreaterThan(0.4);
  });
});

describe('carbon: long-run stability, no divergence (#34)', () => {
  // The deep-time (4.5 Gyr) bound that CO₂ stays regulated far inside its clamps
  // and never spuriously snowballs the default planet lives in the phase-1
  // integrated invariant (`phase1.test.ts`), which already runs the full 4.5 Gyr
  // pipeline — this file adds only the determinism check on top of it.
  it('is deterministic: same seed + params ⇒ bit-identical CO₂ trajectory', () => {
    const params = createPlanetParams({ seed: 1337, gridN: 16, stepYears: 4e6 });
    const runTrace = (): number[] => {
      const ctx: SimContext = { rng: createRng(1337).fork('sim') };
      let s = createInitialState(params);
      const trace: number[] = [];
      for (let i = 0; i < 60; i++) {
        s = step(s, params.stepYears, ctx);
        trace.push(s.globals.co2);
      }
      return trace;
    };
    expect(runTrace()).toEqual(runTrace());
  });
});
