import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, type SimEvent } from '../src/events';
import { FIELD_NAMES } from '../src/fields';
import { hashFloat32Array } from '../src/hash';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams } from '../src/state';
import { snapshotKeyframe, step, type SimContext, type System } from '../src/step';

const params = createPlanetParams({ seed: 42, gridN: 16 });

/**
 * Synthetic producer (#18's Wilson system is the first real one): appends a
 * rift event whenever the state's time crosses a 3 Myr multiple, following
 * the events.ts purity rule (immutable append, event time = state time).
 */
const syntheticProducer: System = {
  name: 'syntheticEventProducer',
  apply: (state, dtYears) => {
    const interval = 3e6;
    const before = Math.floor(state.timeYears / interval);
    const after = Math.floor((state.timeYears + dtYears) / interval);
    if (after <= before) return state;
    const event: SimEvent = {
      timeYears: state.timeYears,
      kind: EVENT_KINDS.plateRift,
      data: { plate: after },
    };
    return { ...state, events: [...state.events, event] };
  },
};

function runSynthetic(seed: number): { events: readonly SimEvent[]; fieldHashes: number[] } {
  const p = createPlanetParams({ seed, gridN: 16 });
  const ctx: SimContext = { rng: createRng(p.seed).fork('sim') };
  let state = createInitialState(p);
  for (let i = 0; i < 10; i++) state = step(state, p.stepYears, ctx, [syntheticProducer]);
  return {
    events: state.events,
    fieldHashes: FIELD_NAMES.map((n) => hashFloat32Array(state.fields[n])),
  };
}

describe('event log', () => {
  it('starts empty', () => {
    expect(createInitialState(params).events).toEqual([]);
  });

  it('is deterministic: same seed => identical list (count, order, times, payloads)', () => {
    for (const seed of [1, 42, 1337]) {
      const a = runSynthetic(seed);
      const b = runSynthetic(seed);
      expect(a.events.length).toBeGreaterThan(0);
      expect(b.events).toEqual(a.events);
    }
  });

  it('does not perturb field bytes (structure alone changes no hashes)', () => {
    const withEvents = runSynthetic(42);
    const p = createPlanetParams({ seed: 42, gridN: 16 });
    const ctx: SimContext = { rng: createRng(p.seed).fork('sim') };
    let state = createInitialState(p);
    for (let i = 0; i < 10; i++) state = step(state, p.stepYears, ctx, []);
    const withoutEvents = FIELD_NAMES.map((n) => hashFloat32Array(state.fields[n]));
    expect(withEvents.fieldHashes).toEqual(withoutEvents);
  });

  it('events survive the keyframe path as deep copies', () => {
    const p = createPlanetParams({ seed: 42, gridN: 16 });
    const ctx: SimContext = { rng: createRng(p.seed).fork('sim') };
    let state = createInitialState(p);
    for (let i = 0; i < 4; i++) state = step(state, p.stepYears, ctx, [syntheticProducer]);
    const kf = snapshotKeyframe(state);
    expect(kf.events).toEqual(state.events);
    expect(kf.events[0]).not.toBe(state.events[0]);
    kf.events[0]!.data!.plate = 999;
    expect(state.events[0]!.data!.plate).not.toBe(999);
  });

  it('systems appending events do not mutate the input state', () => {
    const p = createPlanetParams({ seed: 42, gridN: 16 });
    const ctx: SimContext = { rng: createRng(p.seed).fork('sim') };
    const state = createInitialState(p);
    let s = state;
    for (let i = 0; i < 4; i++) s = step(s, p.stepYears, ctx, [syntheticProducer]);
    expect(state.events).toEqual([]);
  });
});
