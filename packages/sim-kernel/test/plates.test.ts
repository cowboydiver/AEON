import { describe, expect, it } from 'vitest';
import {
  CONTINENTAL_CRUST_FRACTION,
  PLATE_OMEGA_MAX_RAD_PER_YR,
  PLATE_OMEGA_MIN_RAD_PER_YR,
} from '../src/constants';
import { neighbors } from '../src/grid';
import { hashFloat32Array } from '../src/hash';
import { createInitialState, createPlanetParams } from '../src/state';
import { dot3 } from '../src/vec';

const params = createPlanetParams({ seed: 42, gridN: 32 });

describe('initial plate partition', () => {
  const state = createInitialState(params);
  const { plateId, crustType } = state.fields;

  it('assigns every cell a valid plateId and every plate at least one cell', () => {
    const counts = new Array<number>(params.numPlates).fill(0);
    for (const p of plateId) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(params.numPlates);
      counts[p]!++;
    }
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });

  it('is identical across two runs of the same seed', () => {
    const again = createInitialState(params);
    expect(hashFloat32Array(again.fields.plateId)).toBe(hashFloat32Array(plateId));
    expect(hashFloat32Array(again.fields.crustType)).toBe(hashFloat32Array(crustType));
    expect(again.plates).toEqual(state.plates);
  });

  it('differs between seeds', () => {
    const other = createInitialState(createPlanetParams({ seed: 1, gridN: 32 }));
    expect(hashFloat32Array(other.fields.plateId)).not.toBe(hashFloat32Array(plateId));
  });

  it('produces contiguous plates (each a single 4-connected component)', () => {
    const sizes = new Array<number>(params.numPlates).fill(0);
    for (const p of plateId) sizes[p]!++;
    const seen = new Uint8Array(plateId.length);
    for (let p = 0; p < params.numPlates; p++) {
      const start = plateId.indexOf(p);
      const stack = [start];
      seen[start] = 1;
      let reached = 0;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        reached++;
        for (const nb of neighbors(cell, params.gridN)) {
          if (!seen[nb] && plateId[nb] === p) {
            seen[nb] = 1;
            stack.push(nb);
          }
        }
      }
      expect(reached).toBe(sizes[p]);
    }
  });
});

describe('initial crust type', () => {
  const state = createInitialState(params);

  it('is binary and hits the continental fraction, submerged shelves included', () => {
    const { crustType, elevation } = state.fields;
    let continental = 0;
    let submergedContinental = 0;
    for (let i = 0; i < crustType.length; i++) {
      expect(crustType[i] === 0 || crustType[i] === 1).toBe(true);
      if (crustType[i] === 1) {
        continental++;
        if (elevation[i]! < 0) submergedContinental++;
      }
    }
    const fraction = continental / crustType.length;
    expect(fraction).toBeGreaterThan(CONTINENTAL_CRUST_FRACTION - 0.02);
    expect(fraction).toBeLessThan(CONTINENTAL_CRUST_FRACTION + 0.02);
    // Threshold sits below sea level: some continental crust must be submerged.
    expect(submergedContinental).toBeGreaterThan(0);
    // And all land is continental (land fraction < continental fraction).
    for (let i = 0; i < crustType.length; i++) {
      if (elevation[i]! >= 0) expect(crustType[i]).toBe(1);
    }
  });
});

describe('plate table', () => {
  const state = createInitialState(params);

  it('has numPlates live records with unit poles and speeds in range', () => {
    expect(state.plates.length).toBe(params.numPlates);
    for (const plate of state.plates) {
      expect(plate.alive).toBe(true);
      expect(plate.createdAtYears).toBe(0);
      expect(plate.accumulatedRadians).toBe(0);
      expect(dot3(plate.eulerPole, plate.eulerPole)).toBeCloseTo(1, 10);
      expect(plate.angularVelRadPerYr).toBeGreaterThanOrEqual(PLATE_OMEGA_MIN_RAD_PER_YR);
      expect(plate.angularVelRadPerYr).toBeLessThanOrEqual(PLATE_OMEGA_MAX_RAD_PER_YR);
      expect(plate.continentalFraction).toBeGreaterThanOrEqual(0);
      expect(plate.continentalFraction).toBeLessThanOrEqual(1);
    }
  });

  it('gives plates distinct kinematics', () => {
    const poles = new Set(state.plates.map((p) => p.eulerPole.join(',')));
    expect(poles.size).toBe(params.numPlates);
  });
});
