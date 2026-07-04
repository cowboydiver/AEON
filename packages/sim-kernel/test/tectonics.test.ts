import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge } from '../src/bathymetry';
import { FIELD_NAMES } from '../src/fields';
import { cellCenterDirection, directionToIndex, neighbors } from '../src/grid';
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
        // Oceanic crust obeys the half-space cooling curve. Subsidence is
        // rate-bounded (OCEAN_RELIEF_RELAX_M_PER_YR, #59), and the curve's
        // first ~3 Myr subside faster than the bound, so the youngest crust
        // may lag the curve by up to ~150 m before it catches up; settled
        // crust must sit on the curve to float32 rounding.
        const deviation = Math.abs(
          end.fields.elevation[i]! - oceanicDepthForAge(end.fields.crustAge[i]!),
        );
        expect(deviation).toBeLessThan(end.fields.crustAge[i]! < 5e6 ? 200 : 0.5);
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

describe('continental conservation: the pickPushTarget -1 leak is bounded (#59)', () => {
  // The bulldozer's one documented exception: a displaced continental cell
  // with NO same-plate 4-neighbor has nowhere to go and is genuinely
  // consumed (pickPushTarget returns -1). These tests pin down that the
  // leak is exactly that corner — one column, once, only when the salient
  // is fully surrounded — and that the ordinary escape path conserves
  // continental cell count exactly.

  const continentalCells = (crustType: Float32Array): number => {
    let n = 0;
    for (const c of crustType) if (c === 1) n++;
    return n;
  };

  /**
   * Plate 0 (z >= 0, all continental) shears eastward about +Z along the
   * static plate-1 hemisphere. One plate-0 cell near +X is repainted as a
   * static plate-1 continental salient with elevation 777. Returns the
   * salient index and, for the escape variant, the same-plate oceanic cell.
   */
  function salientWorld(isolated: boolean): {
    state: ReturnType<typeof twoPlateState>;
    salient: number;
    escape: number;
  } {
    const state = twoPlateState(N, { pole: [0, 0, 1], omega: 8e-9 }, { pole: [0, 1, 0], omega: 0 });
    const { plateId } = state.fields;
    // The plate-0 boundary cell nearest +X (has a plate-1 neighbor).
    let boundary = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < plateId.length; i++) {
      if (plateId[i] !== 0) continue;
      let touchesP1 = false;
      for (const nb of neighbors(i, N)) if (plateId[nb] === 1) touchesP1 = true;
      if (!touchesP1) continue;
      const d = cellCenterDirection(i, N)[0];
      if (d > bestDot) {
        bestDot = d;
        boundary = i;
      }
    }
    // Isolated salient: a neighbor of the boundary cell with no plate-1
    // neighbor of its own (one row deeper into plate 0). Escape salient:
    // the boundary cell itself, whose plate-1 neighbor becomes the
    // same-plate oceanic ground the displaced column re-roots on.
    let salient = boundary;
    if (isolated) {
      salient = -1;
      for (const nb of neighbors(boundary, N)) {
        if (plateId[nb] !== 0) continue;
        let touchesP1 = false;
        for (const nb2 of neighbors(nb, N)) if (plateId[nb2] === 1) touchesP1 = true;
        if (!touchesP1) salient = nb;
      }
      expect(salient).not.toBe(-1);
    }
    let escape = -1;
    if (!isolated) {
      for (const nb of neighbors(salient, N)) if (plateId[nb] === 1) escape = nb;
      expect(escape).not.toBe(-1);
    }
    const plateIdNew = plateId.slice();
    const elevation = state.fields.elevation.slice();
    const crustType = state.fields.crustType.slice();
    const crustAge = state.fields.crustAge.slice();
    plateIdNew[salient] = 1;
    elevation[salient] = 777;
    if (escape !== -1) {
      crustType[escape] = 0; // oceanic same-plate ground: the escape route
      crustAge[escape] = 60e6;
      elevation[escape] = oceanicDepthForAge(60e6);
    }
    if (isolated) {
      // The precondition the leak needs: no same-plate neighbor at all.
      for (const nb of neighbors(salient, N)) expect(plateIdNew[nb]).toBe(0);
    }
    return {
      state: { ...state, fields: { ...state.fields, plateId: plateIdNew, elevation, crustType, crustAge } },
      salient,
      escape,
    };
  }

  it('a fully-surrounded salient loses exactly its one column, never more', () => {
    const { state, salient } = salientWorld(true);
    const before = continentalCells(state.fields.crustType);
    const end = runSystems(state, 40);
    expect(end.plates[0]!.advectionCount).toBeGreaterThan(0);
    // The mover overrode the salient (it is no longer plate 1).
    expect(end.fields.plateId[salient]).toBe(0);
    // The displaced column is gone — its marker elevation survives nowhere.
    for (const e of end.fields.elevation) expect(e).not.toBe(777);
    // Bounded: continental cell count dropped by exactly the one dropped
    // column (the advecting hole's young-ocean wake swaps ownership with
    // continental ground content-conservingly; it does not compound).
    expect(continentalCells(end.fields.crustType)).toBe(before - 1);
  });

  it('a salient with same-plate oceanic ground escapes: area conserved, column intact', () => {
    const { state, salient, escape } = salientWorld(false);
    const before = continentalCells(state.fields.crustType);
    const end = runSystems(state, 40);
    expect(end.plates[0]!.advectionCount).toBeGreaterThan(0);
    expect(end.fields.plateId[salient]).toBe(0);
    // The displaced column re-rooted on its plate's oceanic neighbor.
    expect(end.fields.crustType[escape]).toBe(1);
    expect(end.fields.elevation[escape]).toBe(777);
    // Conserved exactly: ocean lost one cell to the re-root, the wake took
    // one back — the continental budget never shrinks on this path.
    expect(continentalCells(end.fields.crustType)).toBe(before);
  });
});
