import { describe, expect, it } from 'vitest';
import { INITIAL_LAND_FRACTION } from '../src/constants';
import { FIELD_NAMES } from '../src/fields';
import { cellCount, neighbors } from '../src/grid';
import { hashFloat32Array } from '../src/hash';
import { createInitialState, createPlanetParams } from '../src/state';
import { createRng } from '../src/rng';
import { run, snapshotKeyframe, step, type SimContext } from '../src/step';

const params = createPlanetParams({ seed: 42, gridN: 32 });

describe('createInitialState', () => {
  it('allocates every field at cellCount length', () => {
    const state = createInitialState(params);
    for (const name of FIELD_NAMES) {
      expect(state.fields[name]).toBeInstanceOf(Float32Array);
      expect(state.fields[name].length).toBe(cellCount(params.gridN));
    }
  });

  it('lands ~30% of cells above the datum', () => {
    const state = createInitialState(params);
    const elevation = state.fields.elevation;
    // >= 0: the sea-level quantile cell itself maps to exactly 0 m and is land.
    let land = 0;
    for (const e of elevation) if (e >= 0) land++;
    const fraction = land / elevation.length;
    expect(fraction).toBeGreaterThan(INITIAL_LAND_FRACTION - 0.02);
    expect(fraction).toBeLessThan(INITIAL_LAND_FRACTION + 0.02);
    expect(state.globals.landFraction).toBeCloseTo(fraction, 3);
  });

  it('produces finite, plausibly-ranged elevation and temperature', () => {
    const state = createInitialState(params);
    for (const e of state.fields.elevation) {
      expect(Number.isFinite(e)).toBe(true);
      expect(e).toBeGreaterThanOrEqual(-11_000);
      expect(e).toBeLessThanOrEqual(9_000);
    }
    for (const t of state.fields.temperature) {
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(180);
      expect(t).toBeLessThan(340);
    }
  });

  it('elevation is spatially coherent, not per-cell noise', () => {
    // Neighboring cells should correlate strongly: mean |Δelev| between
    // neighbors must be far below the field's overall spread.
    const state = createInitialState(params);
    const elevation = state.fields.elevation;
    let min = Infinity;
    let max = -Infinity;
    for (const e of elevation) {
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    const spread = max - min;
    let sumDelta = 0;
    let count = 0;
    for (let i = 0; i < elevation.length; i++) {
      for (const j of neighbors(i, params.gridN)) {
        sumDelta += Math.abs(elevation[i]! - elevation[j]!);
        count++;
      }
    }
    expect(sumDelta / count).toBeLessThan(spread * 0.05);
  });
});

describe('step / run', () => {
  it('step advances time and does not mutate the input state', () => {
    const state = createInitialState(params);
    const before = FIELD_NAMES.map((n) => hashFloat32Array(state.fields[n]));
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    const next = step(state, params.stepYears, ctx);
    expect(next.timeYears).toBe(params.stepYears);
    expect(state.timeYears).toBe(0);
    const after = FIELD_NAMES.map((n) => hashFloat32Array(state.fields[n]));
    expect(after).toEqual(before);
  });

  it('run emits initial + one keyframe per interval', () => {
    const times: number[] = [];
    run(params, 100e6, (kf) => times.push(kf.timeYears));
    expect(times).toEqual([0, 10e6, 20e6, 30e6, 40e6, 50e6, 60e6, 70e6, 80e6, 90e6, 100e6]);
  });

  it('run emits a final keyframe when untilYears is off-interval', () => {
    const times: number[] = [];
    run(params, 25e6, (kf) => times.push(kf.timeYears));
    expect(times).toEqual([0, 10e6, 20e6, 25e6]);
  });

  it('keyframes are deep copies', () => {
    const state = createInitialState(params);
    const kf = snapshotKeyframe(state);
    expect(kf.fields.elevation).not.toBe(state.fields.elevation);
    const original = state.fields.elevation[0]!;
    kf.fields.elevation[0] = original + 999;
    expect(state.fields.elevation[0]).toBe(original);
  });
});
