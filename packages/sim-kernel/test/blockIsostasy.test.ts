import { describe, expect, it } from 'vitest';
import {
  BLOCK_FOUNDER_AREA_M2,
  BLOCK_FULL_OROGENY_AREA_M2,
  BLOCK_ISOSTASY_RELAX_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OROGENY_MAX_ELEVATION_M,
} from '../src/constants';
import { cellCount, faceRCToIndex } from '../src/grid';
import { blockElevationCap, blockIsostasySystem } from '../src/systems/blockIsostasy';
import type { PlanetState } from '../src/state';
import { runSystems, twoPlateState } from './helpers';

/**
 * Crustal-block isostasy invariants (#84). Worlds are static two-plate
 * states (zero angular velocity) run through [blockIsostasySystem] alone,
 * so the system under test is the only elevation writer.
 *
 * N=32: cell area = 4πR²/6144 ≈ 8.3e10 m², so the founder threshold
 * (3e11 m²) is ~3.6 cells and the full-orogeny threshold (2e12 m²) is
 * ~24 cells — a 2-cell island founders, a 6×6 block keeps its mountains.
 */
const N = 32;
const MID = N / 2;

/** Ocean world (crustType 0 everywhere) with isostasy enabled. */
function oceanWorld(): PlanetState {
  const base = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 0, 1], omega: 0 });
  const crustType = base.fields.crustType.slice().fill(0);
  const elevation = base.fields.elevation.slice().fill(-4000);
  return {
    ...base,
    params: { ...base.params, blockIsostasy: true },
    fields: { ...base.fields, crustType, elevation },
  };
}

/** Paint a rows×cols continental block at `elev` on face `face`. */
function paintBlock(
  state: PlanetState,
  face: number,
  rows: number,
  cols: number,
  elev: number,
): PlanetState {
  const crustType = state.fields.crustType.slice();
  const elevation = state.fields.elevation.slice();
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      const i = faceRCToIndex(face, MID + dr, MID + dc, N);
      crustType[i] = 1;
      elevation[i] = elev;
    }
  }
  return { ...state, fields: { ...state.fields, crustType, elevation } };
}

function blockCells(face: number, rows: number, cols: number): number[] {
  const cells: number[] = [];
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) cells.push(faceRCToIndex(face, MID + dr, MID + dc, N));
  }
  return cells;
}

describe('blockElevationCap contract', () => {
  it('is the founder level at and below the founder area', () => {
    expect(blockElevationCap(0)).toBe(MICROCONTINENT_FOUNDER_ELEVATION_M);
    expect(blockElevationCap(BLOCK_FOUNDER_AREA_M2)).toBe(MICROCONTINENT_FOUNDER_ELEVATION_M);
  });

  it('is the orogeny ceiling at and above the full-orogeny area', () => {
    expect(blockElevationCap(BLOCK_FULL_OROGENY_AREA_M2)).toBe(OROGENY_MAX_ELEVATION_M);
    expect(blockElevationCap(2 * BLOCK_FULL_OROGENY_AREA_M2)).toBe(OROGENY_MAX_ELEVATION_M);
  });

  it('is continuous, monotonic, and Earth-plausible between the thresholds', () => {
    // Continuity at the founder edge: a hair above the threshold is a hair
    // above the founder level, not a jump to +1 km.
    expect(blockElevationCap(BLOCK_FOUNDER_AREA_M2 * 1.001)).toBeLessThan(
      MICROCONTINENT_FOUNDER_ELEVATION_M + 400,
    );
    let prev = -Infinity;
    for (let a = 0; a <= 2.5e12; a += 2.5e10) {
      const cap = blockElevationCap(a);
      expect(cap).toBeGreaterThanOrEqual(prev);
      prev = cap;
    }
    // Calibration anchor: a New Guinea-sized block (~0.79 Mkm²) should hold
    // real mountains (Puncak Jaya ~4.9 km) but not a Himalaya.
    const png = blockElevationCap(7.9e11);
    expect(png).toBeGreaterThan(4000);
    expect(png).toBeLessThan(6000);
  });
});

describe('blockIsostasy system', () => {
  it('is the identity when the param is off', () => {
    const world = paintBlock(oceanWorld(), 0, 1, 2, 5000);
    const off: PlanetState = { ...world, params: { ...world.params, blockIsostasy: false } };
    const out = blockIsostasySystem.apply(off, off.params.stepYears, {
      rng: undefined as never, // system must not touch the rng
    });
    expect(out).toBe(off);
  });

  it('founders a small island toward the founder level, rate-bounded', () => {
    const world = paintBlock(oceanWorld(), 0, 1, 2, 5000);
    const cells = blockCells(0, 1, 2);
    const dt = world.params.stepYears;

    const one = runSystems(world, 1, [blockIsostasySystem]);
    for (const c of cells) {
      // One step moves exactly relax·dt, not all the way to the cap.
      expect(one.fields.elevation[c]).toBeCloseTo(5000 - BLOCK_ISOSTASY_RELAX_M_PER_YR * dt, 3);
    }

    const settled = runSystems(world, 10, [blockIsostasySystem]);
    for (const c of cells) {
      expect(settled.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 3);
      // Foundering never touches the crustal ledger.
      expect(settled.fields.crustType[c]).toBe(1);
    }
  });

  it('leaves a continent-sized block and all oceanic cells untouched', () => {
    const world = paintBlock(oceanWorld(), 0, 6, 6, 8000);
    const out = runSystems(world, 10, [blockIsostasySystem]);
    for (const c of blockCells(0, 6, 6)) {
      expect(out.fields.elevation[c]).toBe(8000);
    }
    const count = cellCount(N);
    for (let i = 0; i < count; i++) {
      if (out.fields.crustType[i] === 0) expect(out.fields.elevation[i]).toBe(-4000);
    }
  });

  it('never raises elevation, even far below a large block cap', () => {
    // A full-orogeny-sized block sitting low: cap is 9 km, cells at -100 m
    // (submerged continental platform) must stay exactly where they are.
    const world = paintBlock(oceanWorld(), 0, 6, 6, -100);
    const out = runSystems(world, 5, [blockIsostasySystem]);
    for (const c of blockCells(0, 6, 6)) {
      expect(out.fields.elevation[c]).toBe(-100);
    }
  });

  it('separated islands founder independently of a large neighbor component', () => {
    // A big block on face 0 and a detached 2-cell island on face 1: only the
    // island founders. Guards against component labels bleeding across the
    // ocean between them.
    let world = paintBlock(oceanWorld(), 0, 6, 6, 8000);
    world = paintBlock(world, 1, 1, 2, 5000);
    const out = runSystems(world, 10, [blockIsostasySystem]);
    for (const c of blockCells(0, 6, 6)) expect(out.fields.elevation[c]).toBe(8000);
    for (const c of blockCells(1, 1, 2)) {
      expect(out.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 3);
    }
  });
});
