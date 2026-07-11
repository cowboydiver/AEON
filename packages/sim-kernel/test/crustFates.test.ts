import { describe, expect, it } from 'vitest';
import {
  CRUST_FATE_SUBSIDENCE_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
} from '../src/constants';
import { faceRCToIndex } from '../src/grid';
import { crustFatesSystem } from '../src/systems/crustFates';
import type { PlanetState } from '../src/state';
import { runSystems, twoPlateState } from './helpers';

/**
 * Small-component crust fates + terrane docking invariants (#88). Worlds are
 * static two-plate states (zero angular velocity) run through
 * [crustFatesSystem] alone, so the system under test is the only writer.
 *
 * N=32 sizing (same as the #84 tests): true cell areas at the face center
 * run ~9.8e10 m², so a 1×2 block (~2e11 m²) is below the small threshold
 * (3e11) and a 6×6 block (~3.5e12 m²) is far above it.
 */
const N = 32;
const MID = N / 2;

/** Ocean world (crustType 0 everywhere) with crust fates enabled. */
function oceanWorld(): PlanetState {
  const base = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 0, 1], omega: 0 });
  const crustType = base.fields.crustType.slice().fill(0);
  const elevation = base.fields.elevation.slice().fill(-4000);
  return {
    ...base,
    params: { ...base.params, crustFates: true },
    fields: { ...base.fields, crustType, elevation },
  };
}

/** Paint a rows×cols continental block at `elev` on `face`, offset from MID. */
function paintBlock(
  state: PlanetState,
  face: number,
  rows: number,
  cols: number,
  elev: number,
  colOffset = 0,
  plate?: number,
): PlanetState {
  const crustType = state.fields.crustType.slice();
  const elevation = state.fields.elevation.slice();
  const plateId = state.fields.plateId.slice();
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      const i = faceRCToIndex(face, MID + dr, MID + colOffset + dc, N);
      crustType[i] = 1;
      elevation[i] = elev;
      if (plate !== undefined) plateId[i] = plate;
    }
  }
  return { ...state, fields: { ...state.fields, crustType, elevation, plateId } };
}

function blockCells(face: number, rows: number, cols: number, colOffset = 0): number[] {
  const cells: number[] = [];
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      cells.push(faceRCToIndex(face, MID + dr, MID + colOffset + dc, N));
    }
  }
  return cells;
}

describe('crustFates system (#88)', () => {
  it('is the identity when the param is off', () => {
    const world = paintBlock(paintBlock(oceanWorld(), 0, 6, 6, 1000), 1, 1, 2, 500);
    const off: PlanetState = { ...world, params: { ...world.params, crustFates: false } };
    const out = crustFatesSystem.apply(off, off.params.stepYears, {
      rng: undefined as never, // system must not touch the rng
    });
    expect(out).toBe(off);
  });

  it('docks a small component across a 2-cell strait: bridge welds, terrane changes plate', () => {
    // Large block plate 0 at cols MID..MID+5 (elev 1000); small 1×2 terrane
    // plate 1 at cols MID+8..9 (elev 500); ocean strait at cols MID+6, MID+7.
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000, 0, 0);
    world = paintBlock(world, 0, 1, 2, 500, 8, 1);
    world = { ...world, timeYears: 5e6 };

    const out = crustFatesSystem.apply(world, world.params.stepYears, { rng: undefined as never });

    const bridge = [faceRCToIndex(0, MID, MID + 6, N), faceRCToIndex(0, MID, MID + 7, N)];
    for (const b of bridge) {
      expect(out.fields.crustType[b]).toBe(1);
      // The weld strait is the lower of the two continental endpoints.
      expect(out.fields.elevation[b]).toBe(500);
      // Docking is a suture: the weld line carries the stamp.
      expect(out.fields.sutureYears[b]).toBe(5e6);
      expect(out.fields.plateId[b]).toBe(0);
      expect(out.fields.sedimentM[b]).toBe(0);
    }
    // The whole terrane transferred to the large component's plate; its own
    // crust and relief are untouched (docking, not destruction).
    for (const m of blockCells(0, 1, 2, 8)) {
      expect(out.fields.plateId[m]).toBe(0);
      expect(out.fields.crustType[m]).toBe(1);
      expect(out.fields.elevation[m]).toBe(500);
    }
    // The large component is untouched.
    for (const c of blockCells(0, 6, 6)) {
      expect(out.fields.crustType[c]).toBe(1);
      expect(out.fields.elevation[c]).toBe(1000);
    }
  });

  it('founders an out-of-range small component: rate-bounded sink, then crust retirement', () => {
    // Large anchor on face 1 (so the world is not all-small); isolated small
    // 1×2 block on face 0 at 3000 m — beyond any docking range.
    let world = paintBlock(oceanWorld(), 1, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, 3000);
    const cells = blockCells(0, 1, 2);
    const dt = world.params.stepYears;

    const one = runSystems(world, 1, [crustFatesSystem]);
    for (const c of cells) {
      // One step moves exactly relax·dt, and the crust record survives.
      expect(one.fields.elevation[c]).toBeCloseTo(3000 - CRUST_FATE_SUBSIDENCE_M_PER_YR * dt, 3);
      expect(one.fields.crustType[c]).toBe(1);
    }

    // 3000 m → founder level takes ceil(3200/1000) = 4 steps; retirement
    // reads the PRE-pass elevations, so it fires on the step after arrival.
    const sunk = runSystems(world, 4, [crustFatesSystem]);
    for (const c of cells) {
      expect(sunk.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 3);
      expect(sunk.fields.crustType[c]).toBe(1);
    }
    const retired = runSystems(world, 5, [crustFatesSystem]);
    for (const c of cells) {
      // The drowned platform's crust record retires — the deliberate ledger
      // debit — with elevation left where it is (no cliff; the oceanic
      // age-depth relaxation takes it from here).
      expect(retired.fields.crustType[c]).toBe(0);
      expect(retired.fields.sutureYears[c]).toBe(0);
      expect(retired.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 3);
    }
  });

  it('never founders when a dock is available (accretion beats sinking)', () => {
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, 5000, 8);
    const out = runSystems(world, 10, [crustFatesSystem]);
    for (const m of blockCells(0, 1, 2, 8)) {
      expect(out.fields.crustType[m]).toBe(1);
      expect(out.fields.elevation[m]).toBe(5000); // docked, never subsided
    }
  });

  it('a 3-cell strait is out of docking range: the component founders instead', () => {
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, 500, 9); // strait: cols MID+6..8
    const out = runSystems(world, 1, [crustFatesSystem]);
    // No weld: the strait stays oceanic and the small block subsides.
    for (const dc of [6, 7, 8]) {
      expect(out.fields.crustType[faceRCToIndex(0, MID, MID + dc, N)]).toBe(0);
    }
    for (const m of blockCells(0, 1, 2, 9)) {
      // One relax quantum (1000 m) overshoots from 500 m, so the sink clamps
      // at the founder level — rate-bounded from above, never below it.
      expect(out.fields.elevation[m]).toBeCloseTo(
        Math.max(
          MICROCONTINENT_FOUNDER_ELEVATION_M,
          500 - CRUST_FATE_SUBSIDENCE_M_PER_YR * world.params.stepYears,
        ),
        3,
      );
    }
  });

  it('leaves large components untouched and does nothing in an all-small world', () => {
    // Only small components anywhere: no docking target — the pass must bail
    // rather than founder the planet's whole crust inventory.
    const world = paintBlock(paintBlock(oceanWorld(), 0, 1, 2, 4000), 1, 1, 2, 4000);
    const out = crustFatesSystem.apply(world, world.params.stepYears, { rng: undefined as never });
    expect(out).toBe(world);

    // And a lone large component is inert (nothing small to consolidate).
    const big = paintBlock(oceanWorld(), 0, 6, 6, 8000);
    const outBig = crustFatesSystem.apply(big, big.params.stepYears, { rng: undefined as never });
    expect(outBig).toBe(big);
  });

  it('is inert before crustFatesOnsetYears and active from it (#88 branched A/B)', () => {
    let base = paintBlock(oceanWorld(), 1, 6, 6, 1000);
    base = paintBlock(base, 0, 1, 2, 3000);
    const dt = base.params.stepYears;
    const world: PlanetState = {
      ...base,
      params: { ...base.params, crustFatesOnsetYears: 2 * dt },
    };
    const cells = blockCells(0, 1, 2);

    const preOnset = runSystems(world, 2, [crustFatesSystem]);
    for (const c of cells) expect(preOnset.fields.elevation[c]).toBe(3000);

    const postOnset = runSystems(world, 3, [crustFatesSystem]);
    for (const c of cells) {
      expect(postOnset.fields.elevation[c]).toBeCloseTo(
        3000 - CRUST_FATE_SUBSIDENCE_M_PER_YR * dt,
        3,
      );
    }
  });
});
