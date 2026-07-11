import { describe, expect, it } from 'vitest';
import { GOE_THRESHOLD_PAL, OXYGEN_MAX_PAL, REDUCTANT_BUFFER_PAL } from '../../src/constants';
import type { SimEvent } from '../../src/events';
import { createRng } from '../../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../../src/state';
import { step, type SimContext } from '../../src/step';

/**
 * Biosphere done-criteria (#37), coupled through the whole pipeline over deep
 * time — so they live here rather than in the per-system tests:
 *   - the Great Oxidation EMERGES (an O₂ crossing driven by productivity vs.
 *     sinks) and reliably completes on every golden seed within 4.5 Gyr;
 *   - its TIMING varies by seed (emergent, not a scripted date), with an anoxic
 *     latency between abiogenesis and the GOE;
 *   - the coupled loop is STABLE — O₂ finite and bounded, the reductant buffer
 *     monotone, no runaway, over the full history;
 *   - it is DETERMINISTIC — same seed ⇒ bit-identical O₂ trajectory.
 *
 * Runs at N=16 / 10 Myr (coarse, in the kernel test budget). The absolute O₂
 * plateau is grid-sensitive (M0 caution 1) so these key off relative thresholds,
 * not an absolute PAL. NOTE: #37 wires NO biosphere→climate feedback (that
 * arrives with vegetation, #39), so the "disable biosphere changes late climate"
 * done-criterion is asserted in #39/#41, not here; `marineLife.test.ts` pins the
 * complementary #37 fact that the ablation is byte-identical in climate today.
 */

const SEEDS = [1, 42, 1337] as const;
const UNTIL_YEARS = 4.5e9;

interface LifeStory {
  abiogenesisYear: number;
  greatOxidationYear: number;
  finalOxygen: number;
  maxOxygen: number;
  finalReductant: number;
}

function eventYear(events: readonly SimEvent[], kind: SimEvent['kind']): number {
  const e = events.find((ev) => ev.kind === kind);
  return e ? e.timeYears : -1;
}

function runLifeStory(seed: number): LifeStory {
  const params = createPlanetParams({ seed, gridN: 16, stepYears: 10e6 });
  const ctx: SimContext = { rng: createRng(seed).fork('sim') };
  let s = createInitialState(params);
  let maxOxygen = s.globals.oxygen;
  let prevReductant = s.globals.oxygenReductant;
  const steps = Math.round(UNTIL_YEARS / params.stepYears);
  for (let i = 0; i < steps; i++) {
    s = step(s, params.stepYears, ctx);
    const { oxygen, oxygenReductant } = s.globals;
    // Stability, checked every step of the full history.
    expect(Number.isFinite(oxygen), `seed ${seed} step ${i}: O₂ finite`).toBe(true);
    expect(oxygen, `seed ${seed} step ${i}: O₂ ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(oxygen, `seed ${seed} step ${i}: O₂ bounded (no runaway)`).toBeLessThanOrEqual(OXYGEN_MAX_PAL);
    expect(oxygenReductant, `seed ${seed} step ${i}: reductant ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(oxygenReductant, `seed ${seed} step ${i}: reductant is monotone`).toBeLessThanOrEqual(prevReductant + 1e-12);
    prevReductant = oxygenReductant;
    if (oxygen > maxOxygen) maxOxygen = oxygen;
  }
  return {
    abiogenesisYear: eventYear(s.events, 'abiogenesis'),
    greatOxidationYear: eventYear(s.events, 'greatOxidation'),
    finalOxygen: s.globals.oxygen,
    maxOxygen,
    finalReductant: s.globals.oxygenReductant,
  };
}

describe('biosphere: the Great Oxidation is emergent and reliable (#37)', () => {
  const stories = new Map<number, LifeStory>();
  for (const seed of SEEDS) stories.set(seed, runLifeStory(seed));

  it('life originates and oxygenates on every golden seed within 4.5 Gyr', () => {
    for (const seed of SEEDS) {
      const st = stories.get(seed)!;
      expect(st.abiogenesisYear, `seed ${seed}: life originated`).toBeGreaterThanOrEqual(0);
      expect(st.greatOxidationYear, `seed ${seed}: Great Oxidation fired`).toBeGreaterThanOrEqual(0);
      expect(st.greatOxidationYear, `seed ${seed}: GOE within deep time`).toBeLessThan(UNTIL_YEARS);
      // Oxygenated to a plateau well above the GOE threshold, bounded, no runaway.
      expect(st.finalOxygen, `seed ${seed}: oxygenated plateau`).toBeGreaterThan(10 * GOE_THRESHOLD_PAL);
      expect(st.maxOxygen, `seed ${seed}: O₂ never approached the runaway guard`).toBeLessThan(OXYGEN_MAX_PAL);
      // The reductant buffer was drawn down (its consumption IS the latency).
      expect(st.finalReductant, `seed ${seed}: reductant buffer spent`).toBeLessThan(REDUCTANT_BUFFER_PAL);
    }
  });

  it('has an anoxic latency: the GOE follows abiogenesis, not simultaneous', () => {
    for (const seed of SEEDS) {
      const st = stories.get(seed)!;
      expect(st.greatOxidationYear, `seed ${seed}: GOE after abiogenesis`).toBeGreaterThan(st.abiogenesisYear);
    }
  });

  it('GOE timing varies by seed (emergent, not a scripted date)', () => {
    // The timing arises from each seed's abiogenesis onset + reductant-clearing
    // trajectory, so the seeds must not share one date. The ABSOLUTE spread is
    // grid-sensitive (M0: ~490 Myr at N=32 vs a tighter band at the N=16 test
    // grid), so the emergence claim keys off distinctness, not a fixed magnitude.
    const goeYears = SEEDS.map((s) => stories.get(s)!.greatOxidationYear);
    expect(new Set(goeYears).size, `distinct GOE years (${goeYears.join(', ')})`).toBeGreaterThanOrEqual(2);
  });
});

describe('biosphere: determinism (#37)', () => {
  it('same seed + params ⇒ bit-identical O₂ trajectory', () => {
    const trace = (): number[] => {
      const params = createPlanetParams({ seed: 1337, gridN: 16, stepYears: 8e6 });
      const ctx: SimContext = { rng: createRng(1337).fork('sim') };
      let s: PlanetState = createInitialState(params);
      const out: number[] = [];
      for (let i = 0; i < 120; i++) {
        s = step(s, params.stepYears, ctx);
        out.push(s.globals.oxygen);
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});
