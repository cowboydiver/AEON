import { describe, expect, it } from 'vitest';
import { MICROCONTINENT_FOUNDER_ELEVATION_M } from '../src/constants';
import { cellCount, faceRCToIndex } from '../src/grid';
import { erosionSystem } from '../src/systems/erosion';
import type { PlanetState } from '../src/state';
import { runSystems, twoPlateState } from './helpers';

/**
 * Marine planation for small components (#90). Static two-plate worlds run
 * through [erosionSystem] alone. N=32 sizing as in the #84/#88 tests: a 1×2
 * block (~2e11 m²) is inside the planation ramp (threshold 3e11), a 6×6
 * block (~3.5e12 m²) is far outside it.
 */
const N = 32;
const MID = N / 2;

function oceanWorld(): PlanetState {
  const base = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 0, 1], omega: 0 });
  const crustType = base.fields.crustType.slice().fill(0);
  const elevation = base.fields.elevation.slice().fill(-4000);
  return {
    ...base,
    params: { ...base.params, marinePlanation: true },
    fields: { ...base.fields, crustType, elevation },
  };
}

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

/** Σ(continental elevation) + Σ(sedimentM) — the #65 ledger, which #90 must extend, not break. */
function ledger(state: PlanetState): number {
  let sum = 0;
  for (let i = 0; i < cellCount(N); i++) {
    if (state.fields.crustType[i] === 1) sum += state.fields.elevation[i]!;
    sum += state.fields.sedimentM[i]!;
  }
  return sum;
}

describe('marine planation (#90)', () => {
  it('planes a small island below sea level, stopping at the founder/shelf level', () => {
    // An 800 m island: ordinary coastal export would asymptote at sea level
    // (flux ∝ height above it); planation must carry it below and stop at
    // −200 m exactly.
    const world = paintBlock(oceanWorld(), 0, 1, 2, 800);
    const cells = blockCells(0, 1, 2);

    const out = runSystems(world, 5, [erosionSystem]);
    for (const c of cells) {
      expect(out.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 2);
      // Conservative: the crust record is untouched (contrast with #84/#88).
      expect(out.fields.crustType[c]).toBe(1);
    }
    // The removed mass landed in neighboring ocean sediment, not nowhere.
    let sediment = 0;
    for (let i = 0; i < cellCount(N); i++) sediment += out.fields.sedimentM[i]!;
    expect(sediment).toBeGreaterThan(0);
  });

  it('conserves Σ(continental elevation) + Σ(sedimentM) across the planation flux', () => {
    // Below the orogenic-root reference (1 km) so decay — the one deliberate
    // sink — contributes nothing; diffusion and both export fluxes must then
    // conserve the ledger exactly (to float32 accumulation noise).
    let world = paintBlock(oceanWorld(), 0, 1, 2, 900);
    world = paintBlock(world, 1, 6, 6, 400);
    const before = ledger(world);
    const after = ledger(runSystems(world, 4, [erosionSystem]));
    expect(after).toBeCloseTo(before, 0);
  });

  it('leaves large components alone', () => {
    // A 6×6 block wholly at −100 m: submerged, so ordinary export is silent
    // (it needs land above sea level), uniform so diffusion is silent — any
    // movement would be planation misfiring on a continent-scale component.
    const world = paintBlock(oceanWorld(), 0, 6, 6, -100);
    const out = runSystems(world, 5, [erosionSystem]);
    for (const c of blockCells(0, 6, 6)) {
      expect(out.fields.elevation[c]).toBe(-100);
    }
  });

  it('is inert before marinePlanationOnsetYears and active from it (#90 branched A/B)', () => {
    // A submerged small island at −100 m is invisible to every pre-#90
    // erosion term (no subaerial export, uniform → no diffusion), so any
    // movement is planation alone — a clean onset probe.
    const base = paintBlock(oceanWorld(), 0, 1, 2, -100);
    const dt = base.params.stepYears;
    const world: PlanetState = {
      ...base,
      params: { ...base.params, marinePlanationOnsetYears: 2 * dt },
    };
    const cells = blockCells(0, 1, 2);

    const preOnset = runSystems(world, 2, [erosionSystem]);
    for (const c of cells) expect(preOnset.fields.elevation[c]).toBe(-100);

    const postOnset = runSystems(world, 3, [erosionSystem]);
    for (const c of cells) {
      expect(postOnset.fields.elevation[c]).toBeLessThan(-100);
      expect(postOnset.fields.elevation[c]).toBeGreaterThanOrEqual(
        MICROCONTINENT_FOUNDER_ELEVATION_M,
      );
    }
  });
});
