import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge } from '../src/bathymetry';
import { FIELD_NAMES } from '../src/fields';
import { directionToIndex, neighbors } from '../src/grid';
import { hashFloat32Array } from '../src/hash';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams } from '../src/state';
import { step, type SimContext } from '../src/step';
import { tectonicsSystem } from '../src/systems/tectonics';
import { normalize3, rotateAroundAxis } from '../src/vec';
import { runSystems, twoPlateState } from './helpers';

const N = 32;

describe('tectonics advection', () => {
  it('keeps exactly one valid owner per cell after every step', () => {
    let state = twoPlateState(N, { pole: [0, 0, 1], omega: 8e-9 }, { pole: [0, 1, 0], omega: 0 });
    const ctx: SimContext = { rng: createRng(7).fork('sim') };
    for (let i = 0; i < 60; i++) {
      state = step(state, state.params.stepYears, ctx, [tectonicsSystem]);
      for (const p of state.fields.plateId) {
        expect(p === 0 || p === 1).toBe(true);
      }
    }
  });

  it('changes ownership only near pre-step boundaries (rigid interiors)', () => {
    let state = twoPlateState(N, { pole: [0, 0, 1], omega: 8e-9 }, { pole: [0, 1, 0], omega: 0 });
    const ctx: SimContext = { rng: createRng(7).fork('sim') };
    for (let i = 0; i < 40; i++) {
      const before = state.fields.plateId;
      // Distance-to-boundary (capped at 4) before the step.
      const dist = new Int32Array(before.length).fill(99);
      const queue: number[] = [];
      for (let c = 0; c < before.length; c++) {
        for (const nb of neighbors(c, N)) {
          if (before[nb] !== before[c]) {
            dist[c] = 0;
            queue.push(c);
            break;
          }
        }
      }
      for (let q = 0; q < queue.length; q++) {
        const c = queue[q]!;
        if (dist[c]! >= 4) continue;
        for (const nb of neighbors(c, N)) {
          if (dist[nb]! > dist[c]! + 1) {
            dist[nb] = dist[c]! + 1;
            queue.push(nb);
          }
        }
      }
      state = step(state, state.params.stepYears, ctx, [tectonicsSystem]);
      const after = state.fields.plateId;
      for (let c = 0; c < after.length; c++) {
        if (after[c] !== before[c]) {
          // One event moves crust by ~1-2.5 cells; owner changes further than
          // 4 cells from any boundary would mean interiors are not rigid.
          expect(dist[c]).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('transports an interior elevation blob to the predicted position', () => {
    const pole: [number, number, number] = [0, 0, 1];
    const omega = 8e-9;
    let state = twoPlateState(N, { pole, omega }, { pole: [0, 1, 0], omega: 0 });

    // Paint a 5x5 blob deep inside plate 0, ~25 degrees from the Euler pole —
    // the slow-motion region where a fixed advection quantum stalls crust.
    const blobCenterDir = normalize3([0.3, 0.3, 0.9]);
    const blobCenter = directionToIndex(blobCenterDir, N);
    const blob = new Set<number>([blobCenter]);
    for (let r = 0; r < 2; r++) {
      for (const c of [...blob]) for (const nb of neighbors(c, N)) blob.add(nb);
    }
    const elevation = state.fields.elevation.slice();
    for (const c of blob) elevation[c] = 1234;
    state = { ...state, fields: { ...state.fields, elevation } };

    const steps = 100;
    const end = runSystems(state, steps);

    // Total applied rotation = omega * elapsed - unapplied remainder.
    const applied = omega * steps * state.params.stepYears - end.plates[0]!.accumulatedRadians;
    const predicted = directionToIndex(rotateAroundAxis(blobCenterDir, pole, applied), N);
    expect(end.fields.plateId[predicted]).toBe(0);
    // Tolerance: nearest-neighbor resampling wobbles ~0.5 cell per event
    // (random walk once the quantum dither decorrelates rounding phases —
    // without the dither this blob stalls 6 cells behind). The transported
    // blob must cover a cell within graph distance 2 of the prediction.
    let found = false;
    const seen = new Set<number>([predicted]);
    let ring = [predicted];
    for (let depth = 0; depth <= 2 && !found; depth++) {
      for (const c of ring) if (end.fields.elevation[c] === 1234) found = true;
      const nextRing: number[] = [];
      for (const c of ring) {
        for (const nb of neighbors(c, N)) {
          if (!seen.has(nb)) {
            seen.add(nb);
            nextRing.push(nb);
          }
        }
      }
      ring = nextRing;
    }
    expect(found).toBe(true);
    // And it genuinely moved: the original center is no longer blob crust.
    expect(end.fields.elevation[blobCenter]).not.toBe(1234);
  });

  it('fills divergent gaps with young ocean crust on the age-depth curve', () => {
    // Plate 0 rotates about +X: its boundary retreats somewhere, opening gaps.
    let state = twoPlateState(N, { pole: [1, 0, 0], omega: 8e-9 }, { pole: [0, 1, 0], omega: 0 });
    const elevation = state.fields.elevation.slice();
    elevation.fill(1000); // all continental "land" so new ocean is unmistakable
    state = { ...state, fields: { ...state.fields, elevation } };
    const end = runSystems(state, 60);
    let youngOcean = 0;
    let minAge = Infinity;
    for (let i = 0; i < end.fields.elevation.length; i++) {
      if (end.fields.crustType[i] === 0) {
        youngOcean++;
        minAge = Math.min(minAge, end.fields.crustAge[i]!);
        // Oceanic crust obeys the half-space cooling curve (float32 rounding).
        expect(
          Math.abs(end.fields.elevation[i]! - oceanicDepthForAge(end.fields.crustAge[i]!)),
        ).toBeLessThan(0.5);
        // All ocean here was created during the run, so it is younger than the run.
        expect(end.fields.crustAge[i]).toBeLessThan(61e6);
      }
    }
    expect(youngOcean).toBeGreaterThan(0);
    // The most recent spreading happened within the last few advection events.
    expect(minAge).toBeLessThanOrEqual(10e6);
  });

  it('is deterministic on the real initial state', () => {
    const params = createPlanetParams({ seed: 42, gridN: N });
    const runOnce = () => {
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let s = createInitialState(params);
      for (let i = 0; i < 50; i++) s = step(s, params.stepYears, ctx, [tectonicsSystem]);
      return FIELD_NAMES.map((n) => hashFloat32Array(s.fields[n]));
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('does not mutate the input state', () => {
    const state = twoPlateState(N, { pole: [0, 0, 1], omega: 8e-9 }, { pole: [0, 1, 0], omega: 0 });
    const before = FIELD_NAMES.map((n) => hashFloat32Array(state.fields[n]));
    const acc = state.plates.map((p) => p.accumulatedRadians);
    runSystems(state, 20);
    expect(FIELD_NAMES.map((n) => hashFloat32Array(state.fields[n]))).toEqual(before);
    expect(state.plates.map((p) => p.accumulatedRadians)).toEqual(acc);
  });
});
