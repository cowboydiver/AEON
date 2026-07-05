import { describe, expect, it } from 'vitest';
import {
  PLATE_OMEGA_MAX_RAD_PER_YR,
  PLATE_OMEGA_MIN_RAD_PER_YR,
  RIFT_FRAGMENT_MAX_FRACTION,
  RIFT_FRAGMENT_MIN_FRACTION,
  RIFT_MIN_AGE_YEARS,
  RIFT_SIZE_RATE_KNEE,
  RIFT_SIZE_RATE_REF_FRACTION,
  RIFT_SIZE_RATE_REF_MULTIPLE,
  RIFT_SUTURE_COOLDOWN_YEARS,
  SUTURE_AFTER_YEARS,
} from '../src/constants';
import { EVENT_KINDS } from '../src/events';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCenterDirection, cellCount, neighbors, type Vec3 } from '../src/grid';
import { hash2, hashString } from '../src/hash';
import { createPlanetParams, type PlanetState } from '../src/state';
import { tectonicsSystem } from '../src/systems/tectonics';
import { riftPlate, riftSizeRamp, wilsonSystem } from '../src/systems/wilson';
import { dot3, normalize3 } from '../src/vec';
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

/** Two converging continental plates + zero-cell filler plates (which the
 *  wilson pass retires as consumed on its first step — see the retirement
 *  suite; tests that need a live count above the floor must use plates that
 *  own cells, e.g. collisionWorldWithCap). */
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

/** collisionWorld plus a small static south-polar cap owned by plate 2, so
 *  three plates own cells and the 0/1 collision may suture above the
 *  MIN_PLATES floor. */
function collisionWorldWithCap(): PlanetState {
  const s = collisionWorld(0);
  const plateId = s.fields.plateId.slice();
  for (let i = 0; i < cellCount(N); i++) {
    if (cellCenterDirection(i, N)[2] <= -0.95) plateId[i] = 2;
  }
  return {
    ...s,
    plates: [...s.plates, makePlate({ pole: [0, 1, 0], omega: 0 })],
    fields: { ...s.fields, plateId },
  };
}

const WILSON_PIPELINE = [tectonicsSystem, wilsonSystem];

describe('suturing (#18)', () => {
  it('merges two continents after sustained collision and stops their motion', () => {
    // The polar cap keeps three cell-owning plates, so the live count sits
    // above the MIN_PLATES floor and the 0/1 collision may suture. 20 steps:
    // past the ~16 Myr suture, but before the merged plate — now a
    // near-sphere-spanning monopoly — sheds its first fragment under the #59
    // oversize pressure, which would re-introduce boundaries and stress.
    let state = collisionWorldWithCap();
    state = runSystems(state, 20, WILSON_PIPELINE);

    const sutures = state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture);
    expect(sutures.length).toBe(1);
    const { absorbed, into } = sutures[0]!.data!;
    expect([0, 1]).toContain(absorbed);
    expect([0, 1]).toContain(into);

    // Loser is dead; every cell belongs to the winner or the untouched cap;
    // suture time respects the sustained-contact requirement.
    expect(state.plates[absorbed!]!.alive).toBe(false);
    for (const p of state.fields.plateId) expect([into, 2]).toContain(p);
    expect(sutures[0]!.timeYears).toBeGreaterThanOrEqual(SUTURE_AFTER_YEARS);

    // Relative motion across the old 0/1 boundary is gone: it is interior
    // now, and interior cells carry exactly zero stress. Only cells touching
    // the still-separate cap plate may be stressed.
    const nearCap = (i: number) =>
      state.fields.plateId[i] === 2 ||
      [...neighbors(i, N)].some((nb) => state.fields.plateId[nb] === 2);
    for (let i = 0; i < cellCount(N); i++) {
      if (!nearCap(i)) expect(state.fields.boundaryStress[i]).toBe(0);
    }
  });

  it('is deterministic (identical event lists across runs)', () => {
    const run = () =>
      runSystems(collisionWorldWithCap(), 80, WILSON_PIPELINE).events.map((e) => ({ ...e }));
    expect(run()).toEqual(run());
  });

  it('respects the MIN_PLATES floor', () => {
    // Exactly MIN_PLATES cell-owning plates: the collision may not suture (a
    // merge would leave a single-plate world). The window sits past
    // SUTURE_AFTER_YEARS (so a suture WOULD fire if the floor allowed it) but
    // inside the shortest size-relaxed rift gate at this size
    // (RIFT_MIN_AGE_YEARS / ramp at the 0.55 reference, #61 — the ~hemisphere
    // plates barely grow in this window), so no rift adds a third plate and this
    // stays a pure floor check.
    const shortestRiftGate = RIFT_MIN_AGE_YEARS / riftSizeRamp(RIFT_SIZE_RATE_REF_FRACTION);
    const base = collisionWorld(0);
    const steps = Math.floor((SUTURE_AFTER_YEARS + shortestRiftGate) / 2 / base.params.stepYears);
    expect(steps * base.params.stepYears).toBeGreaterThan(SUTURE_AFTER_YEARS);
    const state = runSystems(base, steps, WILSON_PIPELINE);
    expect(state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture)).toEqual([]);
    // Both plates still alive and still colliding.
    expect(state.plates[0]!.alive).toBe(true);
    expect(state.plates[1]!.alive).toBe(true);
  });
});

describe('consumed-plate retirement (#59)', () => {
  it('retires alive plates that own no cells and emits plateConsumed', () => {
    // The two filler plates own zero cells (fully "subducted" by construction);
    // one wilson pass must retire them and record the events, leaving the
    // cell-owning plates untouched.
    const state = runSystems(collisionWorld(2), 1, WILSON_PIPELINE);
    const consumed = state.events.filter((e) => e.kind === EVENT_KINDS.plateConsumed);
    expect(consumed.map((e) => e.data!['plate'])).toEqual([2, 3]);
    expect(state.plates[2]!.alive).toBe(false);
    expect(state.plates[3]!.alive).toBe(false);
    expect(state.plates[0]!.alive).toBe(true);
    expect(state.plates[1]!.alive).toBe(true);
  });
});

describe('rifting (#18, fragment kinematics #59)', () => {
  const riftSeed = hash2(7, hashString('wilsonRift'), 0);

  it('carves a contiguous sub-half fragment that translates, and emits the event', () => {
    const state = collisionWorld(0);
    const before0 = countCells(state, 0);
    const next = riftPlate(state, 0, riftSeed);

    expect(next.plates.length).toBe(3);
    const newId = 2;
    const rifts = next.events.filter((e) => e.kind === EVENT_KINDS.plateRift);
    expect(rifts.length).toBe(1);
    expect(rifts[0]!.data).toMatchObject({ plate: 0, newPlate: newId });

    // Fragment + remainder partition the old plate; total conserved.
    const a = countCells(next, 0);
    const b = countCells(next, newId);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a + b).toBe(before0);

    // The fragment is a hash-drawn sub-half fraction of the plate (never a
    // 50/50 bisection — see the whole-sphere test for why), and contiguous.
    expect(b / before0).toBeGreaterThanOrEqual(RIFT_FRAGMENT_MIN_FRACTION * 0.9);
    expect(b / before0).toBeLessThanOrEqual(RIFT_FRAGMENT_MAX_FRACTION * 1.1);
    expect(isContiguous(next, newId)).toBe(true);

    // Translating kinematics: the fragment's pole is a finite unit vector
    // perpendicular to its own centroid (the fragment sits on the equator of
    // its rotation, so it translates across the sphere instead of spinning).
    const p0 = next.plates[0]!;
    const p2 = next.plates[newId]!;
    for (const c of p2.eulerPole) expect(Number.isFinite(c)).toBe(true);
    expect(dot3(p2.eulerPole, p2.eulerPole)).toBeCloseTo(1, 10);
    expect(dot3(p2.eulerPole, normalize3(plateCentroid(next, newId)))).toBeCloseTo(0, 6);
    expect(p2.angularVelRadPerYr).toBeGreaterThanOrEqual(PLATE_OMEGA_MIN_RAD_PER_YR);
    expect(p2.angularVelRadPerYr).toBeLessThanOrEqual(PLATE_OMEGA_MAX_RAD_PER_YR);

    // The parent keeps its kinematics (the fragment leaves; the remaining
    // plate is not recoiled), but its rift-age clock restarts.
    expect(p0.eulerPole).toEqual(state.plates[0]!.eulerPole);
    expect(p0.angularVelRadPerYr).toBe(state.plates[0]!.angularVelRadPerYr);
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

  it('rifts a whole-sphere plate into a translating fragment, not antipodal halves', () => {
    // The deep-time endgame (#59): when one plate covers the whole sphere, a
    // 50/50 split necessarily yields two antipodal hemispheres — already
    // maximally separated, they can only shear about their shared pole and
    // re-suture, so the supercontinent never visibly disperses (and the
    // pre-#57 cross-product pole was outright degenerate, freezing the world).
    // The fragment rift must instead carve a sub-half piece whose pole
    // translates it across the remaining plate.
    const state = wholeSpherePlate();
    const next = riftPlate(state, 0, riftSeed);

    // The rift actually happened: a new plate, a rift event, two owners.
    expect(next).not.toBe(state);
    expect(next.plates.length).toBe(2);
    const newId = 1;
    expect(next.events.filter((e) => e.kind === EVENT_KINDS.plateRift).length).toBe(1);

    // Fragment + remainder non-empty, conserve the sphere's cells, and the
    // fragment is a contiguous sub-half piece — NOT a hemisphere.
    const a = countCells(next, 0);
    const b = countCells(next, newId);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a + b).toBe(cellCount(N));
    expect(isContiguous(next, newId)).toBe(true);
    expect(b / cellCount(N)).toBeGreaterThanOrEqual(RIFT_FRAGMENT_MIN_FRACTION * 0.9);
    expect(b / cellCount(N)).toBeLessThanOrEqual(RIFT_FRAGMENT_MAX_FRACTION * 1.1);

    // Translating kinematics: finite unit pole perpendicular to the
    // fragment's centroid, non-zero speed — no NaN from any degeneracy.
    const p1 = next.plates[newId]!;
    for (const c of p1.eulerPole) expect(Number.isFinite(c)).toBe(true);
    expect(dot3(p1.eulerPole, p1.eulerPole)).toBeCloseTo(1, 10);
    expect(dot3(p1.eulerPole, normalize3(plateCentroid(next, newId)))).toBeCloseTo(0, 6);
    expect(p1.angularVelRadPerYr).not.toBe(0);

    // Parent motion is untouched by the departure.
    expect(next.plates[0]!.eulerPole).toEqual(state.plates[0]!.eulerPole);
    expect(next.plates[0]!.angularVelRadPerYr).toBe(state.plates[0]!.angularVelRadPerYr);
  });
});

describe('size-dependent rift rate (#61)', () => {
  it('ramps continuously from 1 at the knee to the reference multiple at 0.55, then climbs', () => {
    // Small plates feel no size pressure: the ramp is exactly 1 at and below
    // the knee (so the normal Wilson draw and the golden window are unchanged).
    expect(riftSizeRamp(0)).toBe(1);
    expect(riftSizeRamp(RIFT_SIZE_RATE_KNEE - 0.05)).toBe(1);
    expect(riftSizeRamp(RIFT_SIZE_RATE_KNEE)).toBe(1);
    // Anchored to reproduce the old brake exactly at the old 0.55 threshold, and
    // it keeps climbing above it (a near-whole-sphere plate) — the caller caps
    // the probability at the brake magnitude but divides the maturity gate by
    // this uncapped value, so the gate keeps shrinking toward zero past 0.55.
    expect(riftSizeRamp(RIFT_SIZE_RATE_REF_FRACTION)).toBeCloseTo(RIFT_SIZE_RATE_REF_MULTIPLE, 10);
    expect(riftSizeRamp(1)).toBeGreaterThan(RIFT_SIZE_RATE_REF_MULTIPLE);
    // Monotonic and continuous — the whole point of #61 vs the old brake, which
    // jumped by (REF_MULTIPLE − 1) = 7× at a single point (0.55). Dense sweep:
    // never decreases, and its largest 1%-area step stays a small fraction of
    // that old cliff (steepest near whole-sphere, ~1.6 per step).
    let prev = riftSizeRamp(0);
    let maxJump = 0;
    for (let a = 0.01; a <= 1.0001; a += 0.01) {
      const v = riftSizeRamp(a);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      maxJump = Math.max(maxJump, v - prev);
      prev = v;
    }
    expect(maxJump).toBeLessThan(RIFT_SIZE_RATE_REF_MULTIPLE - 1);
  });

  it('a sphere-monopoly plate still sheds a fragment within a few tens of Myr despite age 0', () => {
    // A freshly-created whole-sphere plate (age 0 — e.g. it just absorbed the
    // last other plate) must NOT wait out RIFT_MIN_AGE_YEARS: at ~whole-sphere
    // the ramp divides the maturity gate down to a few Myr (the old waiver, now
    // continuous), so it sheds within the window.
    const base = wholeSpherePlate();
    const state: PlanetState = {
      ...base,
      plates: [{ ...base.plates[0]!, createdAtYears: base.timeYears }],
    };
    const steps = 100; // 100 Myr at the default step — well under the 150 Myr base age gate
    expect(steps * state.params.stepYears).toBeLessThan(RIFT_MIN_AGE_YEARS);
    const after = runSystems(state, steps, WILSON_PIPELINE);
    expect(after.events.filter((e) => e.kind === EVENT_KINDS.plateRift).length).toBeGreaterThan(0);
  });

  it('still respects a (relaxed) maturity gate — a large plate does not rift while too young', () => {
    // Two ~50% plates, age 0. The ramp relaxes their maturity gate but does not
    // waive it: they must age past RIFT_MIN_AGE_YEARS / ramp(area) before any
    // rift can fire. Run strictly inside that window — bound the area from above
    // by the reference fraction, where the gate is shortest — and assert it
    // holds. (Under the old brake these hemispheres were on the full 150 Myr
    // gate; #61 relaxes it with size, so the window is now much shorter.)
    const state = collisionWorld(0);
    const shortestGate = RIFT_MIN_AGE_YEARS / riftSizeRamp(RIFT_SIZE_RATE_REF_FRACTION);
    const steps = Math.floor((0.8 * shortestGate) / state.params.stepYears);
    const after = runSystems(state, steps, WILSON_PIPELINE);
    expect(after.events.filter((e) => e.kind === EVENT_KINDS.plateRift)).toEqual([]);
  });
});

describe('post-rift suture cooldown (#57 follow-up)', () => {
  const riftSeed = hash2(7, hashString('wilsonRift'), 0);

  it('stamps both rift halves with a suture lock, leaving other plates free', () => {
    const state = collisionWorld(0); // timeYears 0
    const rifted = riftPlate(state, 0, riftSeed);
    const lockUntil = state.timeYears + RIFT_SUTURE_COOLDOWN_YEARS;
    // Parent remnant (0) and the fragment (last slot) are locked; the
    // untouched colliding plate (1) keeps its free (0) lock.
    expect(rifted.plates[0]!.sutureLockUntilYears).toBe(lockUntil);
    expect(rifted.plates.at(-1)!.sutureLockUntilYears).toBe(lockUntil);
    expect(rifted.plates[1]!.sutureLockUntilYears).toBe(0);
  });

  it('bars a rifted half from re-suturing until the cooldown lifts', () => {
    // A colliding pair sutures within one SUTURE_AFTER_YEARS (~15 Myr) — see
    // the suturing suite. Rift plate 0 first: three plates own cells (above
    // the floor), but 0 and the fragment carry the lock, so that same
    // convergent contact must produce no suture for the whole lock window: a
    // rifted margin is passive, not ready to re-collide. Run length is
    // derived from the constant (well inside the lock, past SUTURE_AFTER) so
    // the test tracks any retuning of RIFT_SUTURE_COOLDOWN_YEARS.
    const rifted = riftPlate(collisionWorld(0), 0, riftSeed);
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

/** Sum of unit cell-center directions over the plate's cells (not normalized). */
function plateCentroid(state: PlanetState, plate: number): Vec3 {
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < state.fields.plateId.length; i++) {
    if (state.fields.plateId[i] !== plate) continue;
    const d = cellCenterDirection(i, N);
    c[0] += d[0];
    c[1] += d[1];
    c[2] += d[2];
  }
  return c;
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
