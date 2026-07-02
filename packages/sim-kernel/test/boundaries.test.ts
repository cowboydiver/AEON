import { describe, expect, it } from 'vitest';
import { cellCenterDirection, cellCount, neighborTable, neighbors } from '../src/grid';
import { overrides } from '../src/systems/boundaries';
import { runSystems, twoPlateState } from './helpers';

const N = 32;
const OMEGA = 4e-9;

/** Cells near a target direction (angle < maxAngle) that sit on the boundary. */
function boundaryCellsNear(
  plateId: Float32Array,
  target: [number, number, number],
  maxCos: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < plateId.length; i++) {
    const [x, y, z] = cellCenterDirection(i, N);
    if (x * target[0] + y * target[1] + z * target[2] < maxCos) continue;
    for (const nb of neighbors(i, N)) {
      if (plateId[nb] !== plateId[i]) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

describe('boundary stress classification (#14)', () => {
  // Plate 0 (z>0) rotates +X at +ω, plate 1 rotates +X at −ω. Along their
  // shared z=0 boundary the relative motion closes near [0,−1,0] (convergent),
  // opens near [0,+1,0] (divergent) and shears near [±1,0,0] (transform).
  const state = runSystems(
    twoPlateState(N, { pole: [1, 0, 0], omega: OMEGA }, { pole: [1, 0, 0], omega: -OMEGA }),
    1,
  );
  const stress = state.fields.boundaryStress;
  const relativeSpeed = 2 * OMEGA * state.params.radiusMeters; // ~0.051 m/yr

  it('marks head-on closure as convergent (positive stress)', () => {
    const cells = boundaryCellsNear(state.fields.plateId, [0, -1, 0], 0.95);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(stress[c]).toBeGreaterThan(0.5 * relativeSpeed);
    }
  });

  it('marks separation as divergent (negative stress)', () => {
    const cells = boundaryCellsNear(state.fields.plateId, [0, 1, 0], 0.95);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(stress[c]).toBeLessThan(-0.5 * relativeSpeed);
    }
  });

  it('marks pure shear as transform (near-zero normal stress)', () => {
    // Both plates rotate about +Z (the boundary's own axis) at different
    // rates: relative velocity is everywhere tangent to the boundary.
    const shear = runSystems(
      twoPlateState(N, { pole: [0, 0, 1], omega: OMEGA }, { pole: [0, 0, 1], omega: -OMEGA }),
      1,
    );
    const nbTable = neighborTable(N);
    let boundaryCells = 0;
    for (let i = 0; i < cellCount(N); i++) {
      let isBoundary = false;
      for (let k = 0; k < 4; k++) {
        if (shear.fields.plateId[nbTable[i * 4 + k]!] !== shear.fields.plateId[i]) isBoundary = true;
      }
      if (!isBoundary) continue;
      boundaryCells++;
      expect(Math.abs(shear.fields.boundaryStress[i]!)).toBeLessThan(0.1 * relativeSpeed);
    }
    expect(boundaryCells).toBeGreaterThan(0);
  });

  it('keeps interior cells at exactly zero', () => {
    const nbTable = neighborTable(N);
    for (let i = 0; i < cellCount(N); i++) {
      let isBoundary = false;
      for (let k = 0; k < 4; k++) {
        if (state.fields.plateId[nbTable[i * 4 + k]!] !== state.fields.plateId[i]) isBoundary = true;
      }
      if (!isBoundary) expect(stress[i]).toBe(0);
    }
  });
});

describe('subduction polarity (#16 rule table)', () => {
  it('continental overrides oceanic regardless of age or id', () => {
    expect(overrides(1, 0, 5, 0, 0, 1)).toBe(true);
    expect(overrides(0, 0, 1, 1, 9e9, 5)).toBe(false);
  });

  it('younger oceanic overrides older oceanic', () => {
    expect(overrides(0, 10e6, 5, 0, 80e6, 1)).toBe(true);
    expect(overrides(0, 80e6, 1, 0, 10e6, 5)).toBe(false);
  });

  it('ties resolve to the lower plate id', () => {
    expect(overrides(0, 50e6, 1, 0, 50e6, 2)).toBe(true);
    expect(overrides(1, 0, 2, 1, 0, 1)).toBe(false);
  });
});
