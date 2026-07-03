import { describe, expect, it } from 'vitest';
import { MIN_PLATES, RIFT_SUTURE_COOLDOWN_YEARS, SUTURE_AFTER_YEARS } from '../src/constants';
import { EVENT_KINDS } from '../src/events';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCount, neighbors } from '../src/grid';
import { hash2, hashString } from '../src/hash';
import { createPlanetParams, type PlanetState } from '../src/state';
import { tectonicsSystem } from '../src/systems/tectonics';
import { riftPlate, wilsonSystem } from '../src/systems/wilson';
import { dot3 } from '../src/vec';
import { makePlate, runSystems, twoPlateState } from './helpers';

/** A single continental plate covering the whole sphere — the seed-42/1
 *  endgame, where every prior plate has sutured into plate 0. */
function wholeSpherePlate(): PlanetState {
  const count = cellCount(N);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
  ) as Fields;
  fields.crustType.fill(1);
  fields.elevation.fill(300);
  return {
    timeYears: 2e9,
    params: createPlanetParams({ seed: 7, gridN: N, numPlates: 1 }),
    globals: { landFraction: 0 },
    fields,
    plates: [makePlate({ pole: [1, 0, 0], omega: 4e-9 })],
    events: [],
    wilson: { contactSince: {} },
  };
}

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
    // Poles must be finite unit vectors. (Antipodal-centroid splits, where the
    // half-centroids' cross product vanishes, fall back to a deterministic
    // perpendicular pole rather than being skipped — see the whole-sphere test.)
    for (const plate of [p0, p2]) {
      for (const c of plate.eulerPole) expect(Number.isFinite(c)).toBe(true);
      expect(dot3(plate.eulerPole, plate.eulerPole)).toBeCloseTo(1, 10);
      expect(Number.isFinite(plate.angularVelRadPerYr)).toBe(true);
    }
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

  it('rifts a whole-sphere plate so a supercontinent can break up', () => {
    // Regression for the tectonic-death bug: when one plate covers the whole
    // sphere, seedA/seedB are antipodal and the half-centroids' cross product
    // vanishes (poleMag ~1e-15). The old zero-cross guard skipped the rift, so
    // a merged supercontinent froze forever (seeds 42/1 died by ~1.5 Gyr). The
    // fallback pole must let it split.
    const state = wholeSpherePlate();
    const next = riftPlate(state, 0, riftSeed);

    // The rift actually happened: a new plate, a rift event, two owners.
    expect(next).not.toBe(state);
    expect(next.plates.length).toBe(2);
    const newId = 1;
    expect(next.events.filter((e) => e.kind === EVENT_KINDS.plateRift).length).toBe(1);

    // Both halves non-empty, contiguous, and conserve the sphere's cells.
    const a = countCells(next, 0);
    const b = countCells(next, newId);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a + b).toBe(cellCount(N));
    for (const plate of [0, newId]) expect(isContiguous(next, plate)).toBe(true);

    // Valid diverging kinematics: finite unit poles, opposite senses — no NaN
    // from the degenerate cross product.
    const p0 = next.plates[0]!;
    const p1 = next.plates[newId]!;
    for (const plate of [p0, p1]) {
      for (const c of plate.eulerPole) expect(Number.isFinite(c)).toBe(true);
      expect(dot3(plate.eulerPole, plate.eulerPole)).toBeCloseTo(1, 10);
      expect(Number.isFinite(plate.angularVelRadPerYr)).toBe(true);
      expect(plate.angularVelRadPerYr).not.toBe(0);
    }
    expect(Math.sign(p0.angularVelRadPerYr)).toBe(-Math.sign(p1.angularVelRadPerYr));
  });
});

describe('post-rift suture cooldown (#57 follow-up)', () => {
  const riftSeed = hash2(7, hashString('wilsonRift'), 0);

  it('stamps both rift halves with a suture lock, leaving other plates free', () => {
    const state = collisionWorld(MIN_PLATES + 2); // timeYears 0
    const rifted = riftPlate(state, 0, riftSeed);
    const lockUntil = state.timeYears + RIFT_SUTURE_COOLDOWN_YEARS;
    // Parent remnant (0) and the new half (last slot) are locked; the untouched
    // colliding plate (1) and the zero-cell fillers keep their free (0) lock.
    expect(rifted.plates[0]!.sutureLockUntilYears).toBe(lockUntil);
    expect(rifted.plates.at(-1)!.sutureLockUntilYears).toBe(lockUntil);
    expect(rifted.plates[1]!.sutureLockUntilYears).toBe(0);
  });

  it('bars a rifted half from re-suturing until the cooldown lifts', () => {
    // collisionWorld(MIN_PLATES + 2) sutures within one SUTURE_AFTER_YEARS
    // (~15 Myr) WITHOUT a rift — see the suturing suite. Rift plate 0 first and
    // that same convergent contact must produce no suture for the whole lock
    // window: a rifted margin is passive, not ready to re-collide. Run length
    // is derived from the constant (well inside the lock, past SUTURE_AFTER)
    // so the test tracks any retuning of RIFT_SUTURE_COOLDOWN_YEARS.
    const rifted = riftPlate(collisionWorld(MIN_PLATES + 2), 0, riftSeed);
    const withinLock = Math.floor((0.6 * RIFT_SUTURE_COOLDOWN_YEARS) / rifted.params.stepYears);
    expect(withinLock * rifted.params.stepYears).toBeGreaterThan(SUTURE_AFTER_YEARS);
    const aliveBefore = rifted.plates.filter((p) => p.alive).length;
    const within = runSystems(rifted, withinLock, WILSON_PIPELINE);
    expect(within.events.filter((e) => e.kind === EVENT_KINDS.plateSuture)).toEqual([]);
    // No continent absorbed: the live-plate count is unchanged.
    expect(within.plates.filter((p) => p.alive).length).toBe(aliveBefore);
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
