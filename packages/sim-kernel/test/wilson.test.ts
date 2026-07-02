import { describe, expect, it } from 'vitest';
import { MIN_PLATES, SUTURE_AFTER_YEARS } from '../src/constants';
import { EVENT_KINDS } from '../src/events';
import { cellCount, neighbors } from '../src/grid';
import { hash2, hashString } from '../src/hash';
import type { PlanetState } from '../src/state';
import { tectonicsSystem } from '../src/systems/tectonics';
import { riftPlate, wilsonSystem } from '../src/systems/wilson';
import { dot3 } from '../src/vec';
import { makePlate, runSystems, twoPlateState } from './helpers';

const N = 32;

/** Two converging continental plates + zero-cell filler plates so the live
 *  count sits above/at the MIN_PLATES floor as each test needs. */
function collisionWorld(fillerPlates: number): PlanetState {
  const s = twoPlateState(N, { pole: [1, 0, 0], omega: 4e-9 }, { pole: [1, 0, 0], omega: -4e-9 });
  const elevation = s.fields.elevation.slice();
  elevation.fill(300);
  const plates = [...s.plates];
  for (let k = 0; k < fillerPlates; k++) {
    plates.push(makePlate({ pole: [0, 1, 0], omega: 0 }));
  }
  return { ...s, plates, fields: { ...s.fields, elevation } };
}

const WILSON_PIPELINE = [tectonicsSystem, wilsonSystem];

describe('suturing (#18)', () => {
  it('merges two continents after sustained collision and stops their motion', () => {
    // Enough fillers that the live count sits above MIN_PLATES: suturing allowed.
    let state = collisionWorld(MIN_PLATES + 2);
    state = runSystems(state, 80, WILSON_PIPELINE);

    const sutures = state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture);
    expect(sutures.length).toBe(1);
    const { absorbed, into } = sutures[0]!.data!;
    expect([0, 1]).toContain(absorbed);
    expect([0, 1]).toContain(into);

    // Loser is dead; every cell belongs to the winner; suture time respects
    // the sustained-contact requirement.
    expect(state.plates[absorbed!]!.alive).toBe(false);
    for (const p of state.fields.plateId) expect(p).toBe(into);
    expect(sutures[0]!.timeYears).toBeGreaterThanOrEqual(SUTURE_AFTER_YEARS);

    // With one owner there are no boundaries, so no stress anywhere.
    for (const s of state.fields.boundaryStress) expect(s).toBe(0);
  });

  it('is deterministic (identical event lists across runs)', () => {
    const run = () =>
      runSystems(collisionWorld(MIN_PLATES + 2), 80, WILSON_PIPELINE).events.map((e) => ({ ...e }));
    expect(run()).toEqual(run());
  });

  it('respects the MIN_PLATES floor', () => {
    // Fillers chosen so the live count sits exactly at MIN_PLATES: no suture.
    const state = runSystems(collisionWorld(MIN_PLATES - 2), 80, WILSON_PIPELINE);
    expect(state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture)).toEqual([]);
    // Both plates still alive and still colliding.
    expect(state.plates[0]!.alive).toBe(true);
    expect(state.plates[1]!.alive).toBe(true);
  });
});

describe('rifting (#18)', () => {
  const riftSeed = hash2(7, hashString('wilsonRift'), 0);

  it('splits a plate into two contiguous diverging halves and emits the event', () => {
    const state = collisionWorld(0);
    const before0 = countCells(state, 0);
    const next = riftPlate(state, 0, riftSeed);

    expect(next.plates.length).toBe(3);
    const newId = 2;
    const rifts = next.events.filter((e) => e.kind === EVENT_KINDS.plateRift);
    expect(rifts.length).toBe(1);
    expect(rifts[0]!.data).toMatchObject({ plate: 0, newPlate: newId });

    // Halves partition the old plate; both non-empty; total conserved.
    const a = countCells(next, 0);
    const b = countCells(next, newId);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a + b).toBe(before0);

    // Both halves contiguous.
    for (const plate of [0, newId]) expect(isContiguous(next, plate)).toBe(true);

    // Diverging kinematics: same pole, opposite senses, and the plates'
    // relative motion opens the boundary between them.
    const p0 = next.plates[0]!;
    const p2 = next.plates[newId]!;
    expect(dot3(p0.eulerPole, p2.eulerPole)).toBeCloseTo(1, 10);
    expect(Math.sign(p0.angularVelRadPerYr)).toBe(-Math.sign(p2.angularVelRadPerYr));
    expect(p0.createdAtYears).toBe(state.timeYears);
    expect(p2.createdAtYears).toBe(state.timeYears);
  });

  it('opens young ocean along the rift under the normal pipeline', () => {
    const rifted = riftPlate(collisionWorld(0), 0, riftSeed);
    const after = runSystems(rifted, 40, WILSON_PIPELINE);
    // Somewhere along the 0|2 boundary trail there is now brand-new oceanic
    // crust (the halves separated and the gap filled at ridge depth).
    let youngOcean = 0;
    for (let i = 0; i < cellCount(N); i++) {
      if (after.fields.crustType[i] === 0 && after.fields.crustAge[i]! < 40e6) youngOcean++;
    }
    expect(youngOcean).toBeGreaterThan(20);
  });

  it('is deterministic', () => {
    const a = riftPlate(collisionWorld(0), 0, riftSeed);
    const b = riftPlate(collisionWorld(0), 0, riftSeed);
    expect(Array.from(a.fields.plateId)).toEqual(Array.from(b.fields.plateId));
    expect(a.plates).toEqual(b.plates);
  });
});

function countCells(state: PlanetState, plate: number): number {
  let n = 0;
  for (const p of state.fields.plateId) if (p === plate) n++;
  return n;
}

function isContiguous(state: PlanetState, plate: number): boolean {
  const { plateId } = state.fields;
  const total = countCells(state, plate);
  const start = plateId.indexOf(plate);
  if (start === -1) return false;
  const seen = new Set<number>([start]);
  const stack = [start];
  let reached = 0;
  while (stack.length > 0) {
    const c = stack.pop()!;
    reached++;
    for (const nb of neighbors(c, N)) {
      if (!seen.has(nb) && plateId[nb] === plate) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return reached === total;
}
