import { describe, expect, it } from 'vitest';
import {
  PLATE_OMEGA_MAX_RAD_PER_YR,
  PLATE_OMEGA_MIN_RAD_PER_YR,
  PLATE_SLOT_CODEC_LIMIT,
  PLATE_SLOT_WARN_COUNT,
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
    // This file tests the LEGACY wilson pass (fixed-countdown suture #18, size-
    // ramp rift #61, #57 cooldown, #60 suture memory) that the Tectonics V2
    // mechanisms replace when on. The #115 promotion flipped those three flags
    // default-ON, so the legacy world is pinned explicitly off here.
    params: createPlanetParams({
      seed: 7,
      gridN: N,
      numPlates: 1,
      forceKinematics: false,
      emergentSuture: false,
      tensionRift: false,
    }),
    globals: { landFraction: 0, co2: 280, meanTemperatureK: 0, seaLevelM: 0, waterInventoryM: 0, oxygen: 0, oxygenReductant: 0, abiogenesisYear: -1, plateSpeedMedianMPerYr: 0, plateSpeedMinMPerYr: 0, plateSpeedMaxMPerYr: 0, oceanicContinentalSpeedRatio: 0, speedContinentalityCorr: 0, speedSlabAttachmentCorr: 0, poleStability: 0, columnsExportedRockM3: 0, columnsExportShelfLimited: 0, columnsExportVisits: 0, columnsSedimentZeroedM3: 0, columnsThicknessCapBinds: 0, columnsMaturationFlips: 0, columnsMaturationElevSumM: 0, columnsMaturationCreditM3: 0, columnsRegularizedCreditM3: 0, columnsFounderTrimM3: 0, columnsRetiredDebitM3: 0, columnsRetiredCells: 0, columnsMarginThinnedM3: 0, marginConsolidationFlipsTotal: 0 },
    fields,
    plates: [makePlate({ pole: [1, 0, 0], omega: 4e-9 })],
    events: [],
    wilson: { contactSince: {}, stallSince: {}, shorteningIntegral: {} },
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
  // Legacy wilson-pass world: pin the three V2 flags off (they default-ON since
  // the #115 promotion; this file tests the pre-V2 suture/rift/cooldown path).
  const params = { ...s.params, forceKinematics: false, emergentSuture: false, tensionRift: false };
  return { ...s, params, plates, fields: { ...s.fields, elevation } };
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

/**
 * Prime a collision state so the a-b pair may legally suture on the FIRST
 * wilson pass: advance the clock to T0 and backdate the pair's contact clock
 * a full SUTURE_AFTER_YEARS. Every plate is stamped age-0 at T0, so within
 * the few-step windows these tests run no rift gate can open — the suture
 * path is exercised in isolation. (#66 made this fixture necessary: the
 * suture clock is now 60 Myr, LONGER than a hemisphere-scale plate's
 * ramp-relaxed rift gate, so the old recipe — run enough natural steps for
 * the contact clock to mature — cannot finish before a rift may fire.)
 */
const PRIME_T0 = 100e6;
function primeForSuture(state: PlanetState, a: number, b: number): PlanetState {
  return {
    ...state,
    timeYears: PRIME_T0,
    plates: state.plates.map((p) => ({ ...p, createdAtYears: PRIME_T0 })),
    wilson: { contactSince: { [`${a}-${b}`]: PRIME_T0 - SUTURE_AFTER_YEARS }, stallSince: {}, shorteningIntegral: {} },
  };
}

describe('suturing (#18)', () => {
  it('merges two continents after sustained collision and stops their motion', () => {
    // The polar cap keeps three cell-owning plates, so the live count sits
    // above the MIN_PLATES floor and the 0/1 collision may suture. Contact
    // is primed to mature on the first pass; 3 steps keep every plate's age
    // below every rift gate, so the merge is the only reorganization.
    let state = primeForSuture(collisionWorldWithCap(), 0, 1);
    state = runSystems(state, 3, WILSON_PIPELINE);

    const sutures = state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture);
    expect(sutures.length).toBe(1);
    const { absorbed, into } = sutures[0]!.data!;
    expect([0, 1]).toContain(absorbed);
    expect([0, 1]).toContain(into);

    // Loser is dead; every cell belongs to the winner or the untouched cap;
    // suture time respects the sustained-contact requirement (a full
    // SUTURE_AFTER_YEARS since the primed contact start, never earlier).
    expect(state.plates[absorbed!]!.alive).toBe(false);
    for (const p of state.fields.plateId) expect([into, 2]).toContain(p);
    expect(sutures[0]!.timeYears - (PRIME_T0 - SUTURE_AFTER_YEARS)).toBeGreaterThanOrEqual(
      SUTURE_AFTER_YEARS,
    );

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
    // Exactly MIN_PLATES cell-owning plates, with the 0-1 contact clock
    // primed to maturity: every suture requirement is met by construction on
    // the first pass, so the floor is the ONLY thing that can (and must)
    // veto the merge — a suture may never leave a single-plate world. The
    // capped variant of the same priming (the merge test above) is the
    // positive control that proves the primed contact does suture when the
    // live count sits above the floor. 3 steps keep every plate age below
    // every rift gate, so no rift can add a third plate mid-test.
    const state = runSystems(primeForSuture(collisionWorld(0), 0, 1), 3, WILSON_PIPELINE);
    expect(state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture)).toEqual([]);
    // Both plates still alive and still colliding.
    expect(state.plates[0]!.alive).toBe(true);
    expect(state.plates[1]!.alive).toBe(true);
  });
});

describe('plate-slot codec ceiling guard (#127 item 7)', () => {
  const riftSeed = hash2(7, hashString('wilsonRift'), 0);

  /** collisionWorld(0) padded with retired (dead, cell-less) slots so the plate
   *  table has `targetLen` entries — plate 0 stays the only riftable plate.
   *  Models the monotonic dead-slot growth riftPlate produces over deep time. */
  function withSlots(targetLen: number): PlanetState {
    const s = collisionWorld(0);
    const plates = [...s.plates];
    while (plates.length < targetLen) {
      plates.push({ ...makePlate({ pole: [0, 1, 0], omega: 0 }), alive: false });
    }
    return { ...s, plates };
  }

  it('refuses to mint a slot at the codec ceiling, returning the state unchanged', () => {
    const state = withSlots(PLATE_SLOT_CODEC_LIMIT);
    const next = riftPlate(state, 0, riftSeed);
    // Same reference: the guard skips before any field/plate/event mutation, so
    // the codec's loud mid-run plateId<256 assertion can never be reached.
    expect(next).toBe(state);
    expect(next.plates.length).toBe(PLATE_SLOT_CODEC_LIMIT);
  });

  it('does not emit a slot-pressure event on an ordinary rift far from the ceiling', () => {
    const next = riftPlate(collisionWorld(0), 0, riftSeed);
    expect(next.plates.length).toBe(3);
    expect(next.events.filter((e) => e.kind === EVENT_KINDS.plateSlotPressure)).toEqual([]);
  });

  it('emits exactly one plateSlotPressure event on the rift that first reaches the warn count', () => {
    const state = withSlots(PLATE_SLOT_WARN_COUNT - 1);
    const next = riftPlate(state, 0, riftSeed);
    expect(next.plates.length).toBe(PLATE_SLOT_WARN_COUNT); // the mint that crosses the line
    const pressure = next.events.filter((e) => e.kind === EVENT_KINDS.plateSlotPressure);
    expect(pressure.length).toBe(1);
    expect(pressure[0]!.data).toMatchObject({
      slots: PLATE_SLOT_WARN_COUNT,
      limit: PLATE_SLOT_CODEC_LIMIT,
    });
    expect(pressure[0]!.timeYears).toBe(state.timeYears);
    // Still a genuine rift: the fragment slot was minted and its event recorded.
    expect(next.events.filter((e) => e.kind === EVENT_KINDS.plateRift).length).toBe(1);
  });

  it('does not re-emit the heads-up once the table is already past the warn count', () => {
    const state = withSlots(PLATE_SLOT_WARN_COUNT);
    const next = riftPlate(state, 0, riftSeed);
    expect(next.plates.length).toBe(PLATE_SLOT_WARN_COUNT + 1);
    expect(next.events.filter((e) => e.kind === EVENT_KINDS.plateSlotPressure)).toEqual([]);
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
    // this uncapped value, so the gate keeps shrinking (toward a ~2.7 Myr floor)
    // past 0.55.
    expect(riftSizeRamp(RIFT_SIZE_RATE_REF_FRACTION)).toBeCloseTo(RIFT_SIZE_RATE_REF_MULTIPLE, 10);
    expect(riftSizeRamp(1)).toBeGreaterThan(RIFT_SIZE_RATE_REF_MULTIPLE);
    // Monotonic and continuous — the whole point of #61 vs the old brake,
    // which MULTIPLIED the rate by REF_MULTIPLE at a single point (0.55).
    // Dense sweep: never decreases, and no 1%-area step multiplies the ramp
    // by 2× or more. A multiplicative bound (not the old absolute maxJump)
    // is what "no cliff" means for a rate scaler, and it survives
    // REF_MULTIPLE retunes (#66 raised it 8 → 16, which legitimately
    // steepens the absolute slope near whole-sphere) while still failing
    // loudly on any reintroduced threshold jump.
    let prev = riftSizeRamp(0);
    let maxRatio = 1;
    for (let a = 0.01; a <= 1.0001; a += 0.01) {
      const v = riftSizeRamp(a);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      maxRatio = Math.max(maxRatio, v / prev);
      prev = v;
    }
    expect(maxRatio).toBeLessThan(2);
  });

  it('a sphere-monopoly plate still sheds a fragment within ~100 Myr despite age 0', () => {
    // A freshly-created whole-sphere plate (age 0 — e.g. it just absorbed the
    // last other plate) must NOT wait out RIFT_MIN_AGE_YEARS: at ~whole-sphere
    // the ramp divides the maturity gate down to a few Myr (the old waiver, now
    // continuous), so it sheds within the window — the monopoly safety net the
    // #66 clock retune deliberately kept fast while slowing everything else.
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
    // Lower-bound guard (as the MIN_PLATES-floor test has): a coarser stepYears
    // could floor `steps` to 0, making the no-rift assertion pass vacuously.
    expect(steps * state.params.stepYears).toBeGreaterThan(shortestGate / 2);
    const after = runSystems(state, steps, WILSON_PIPELINE);
    // Make the coupling to tectonics tuning explicit: assert the plates never
    // grew into the size-relaxed gate during the window (gate = MIN_AGE / ramp
    // is monotone-decreasing in area, so its final value bounds the window), so
    // the "no rift" below is because the gate held — not because the plates
    // happened to stay small. Fails loudly here if advection is retuned faster.
    expect(RIFT_MIN_AGE_YEARS / riftSizeRamp(maxPlateAreaFraction(after))).toBeGreaterThan(
      steps * state.params.stepYears,
    );
    expect(after.events.filter((e) => e.kind === EVENT_KINDS.plateRift)).toEqual([]);
  });
});

describe('suture-line memory (#60)', () => {
  it('suturing stamps the continent-continent weld cells with the merge time', () => {
    // Same primed setup as the suturing suite: the 0/1 collision sutures on
    // the first pass while the polar cap (plate 2) stays separate and
    // untouched.
    const state = runSystems(primeForSuture(collisionWorldWithCap(), 0, 1), 3, WILSON_PIPELINE);
    const sutures = state.events.filter((e) => e.kind === EVENT_KINDS.plateSuture);
    expect(sutures.length).toBe(1);
    const weldTime = sutures[0]!.timeYears;

    const stamped: number[] = [];
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.sutureYears[i]! > 0) stamped.push(i);
    }
    // The weld exists, is belt-like (a strip along the old 0/1 boundary, not
    // an area fill), and every stamp carries the merge time on continental
    // crust — sutureYears > 0 implies continental by construction (only
    // continental weld cells are stamped, the stamp advects with the crust,
    // and fresh ocean/arc crust starts at 0).
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.length).toBeLessThan(0.12 * cellCount(N));
    for (const i of stamped) {
      expect(state.fields.sutureYears[i]).toBe(weldTime);
      expect(state.fields.crustType[i]).toBe(1);
    }
    // The uninvolved cap plate carries no weld memory.
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.plateId[i] === 2) expect(state.fields.sutureYears[i]).toBe(0);
    }
  });

  it('recording alone never perturbs the other fields or the rift carve', () => {
    // #60 is deliberately recording-only (see wilson.ts header): a run with
    // suturing must produce byte-identical non-sutureYears fields whether or
    // not the sutureYears record is inspected — i.e. the stamp is written,
    // advected, and read by nothing. Guard: compare every other field of two
    // independent runs (determinism) and assert the rift carve of a stamped
    // state matches the carve of the same state with the record erased.
    // The primed fixture guarantees a suture actually stamped the record
    // (#66: an unprimed run no longer sutures inside any short window); the
    // remaining steps advect it before the carve comparison.
    const stamped = runSystems(primeForSuture(collisionWorldWithCap(), 0, 1), 20, WILSON_PIPELINE);
    const erased: PlanetState = {
      ...stamped,
      fields: { ...stamped.fields, sutureYears: new Float32Array(cellCount(N)) },
    };
    const riftSeed = hash2(7, hashString('wilsonRift'), 0);
    const plateToRift = stamped.fields.plateId[0]!;
    const a = riftPlate(stamped, plateToRift, riftSeed);
    const b = riftPlate(erased, plateToRift, riftSeed);
    expect(Array.from(a.fields.plateId)).toEqual(Array.from(b.fields.plateId));
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
    // Rift plate 0, then hand the parent-fragment pair a contact clock that
    // is already a full SUTURE_AFTER_YEARS old: every suture requirement is
    // met by construction, so ONLY the lock can veto the merge — and it
    // must, at any time inside RIFT_SUTURE_COOLDOWN_YEARS. The same primed
    // state moved past the lock is the positive control: the identical
    // contact now sutures. (#66 note: the old form of this test ran natural
    // steps for 0.6× the cooldown, which the 4× clock stretched past the
    // unlocked hemisphere plate's rift gate — the primed form pins every
    // plate's age to 0 so the lock is the only variable.)
    const rifted = riftPlate(collisionWorld(0), 0, riftSeed);
    const fragment = rifted.plates.length - 1;
    const pairKey = `0-${fragment}`;
    const lockUntil = rifted.plates[0]!.sutureLockUntilYears;
    const prime = (t: number): PlanetState => ({
      ...rifted,
      timeYears: t,
      plates: rifted.plates.map((p) => ({ ...p, createdAtYears: t })),
      wilson: { contactSince: { [pairKey]: t - SUTURE_AFTER_YEARS }, stallSince: {}, shorteningIntegral: {} },
    });

    // Deep inside the lock: no suture, live count unchanged, and the pair's
    // contact bookkeeping is dropped entirely (a locked pair accumulates
    // nothing — when the lock lifts it must start a FRESH SUTURE_AFTER_YEARS).
    const within = runSystems(prime(0.5 * RIFT_SUTURE_COOLDOWN_YEARS), 3, WILSON_PIPELINE);
    expect(within.events.filter((e) => e.kind === EVENT_KINDS.plateSuture)).toEqual([]);
    expect(within.plates.filter((p) => p.alive).length).toBe(
      rifted.plates.filter((p) => p.alive).length,
    );
    expect(within.wilson.contactSince[pairKey]).toBeUndefined();

    // Just past the lock: the identical primed contact sutures immediately.
    const after = runSystems(prime(lockUntil + rifted.params.stepYears), 3, WILSON_PIPELINE);
    const sutures = after.events.filter((e) => e.kind === EVENT_KINDS.plateSuture);
    expect(sutures.length).toBe(1);
    const { absorbed, into } = sutures[0]!.data!;
    expect([0, fragment]).toContain(absorbed);
    expect([0, fragment]).toContain(into);
  });
});

describe('stage 4 — measurable post-rift cooldown under tensionRift (#114)', () => {
  const riftSeed = hash2(7, hashString('wilsonRift'), 0);
  // A nonzero clock so `timeYears + cooldown` differs from a bare cooldown and
  // the "no lock" case (cooldown 0 ⇒ lock == now) is unambiguous.
  const T0 = 500e6;
  const atTime = (s: PlanetState, params: Partial<PlanetState['params']>): PlanetState => ({
    ...s,
    timeYears: T0,
    params: { ...s.params, ...params },
  });

  it('defaults riftSutureCooldownYears to the legacy 120 Myr constant', () => {
    expect(createPlanetParams({ seed: 1 }).riftSutureCooldownYears).toBe(RIFT_SUTURE_COOLDOWN_YEARS);
  });

  it('with the default param, flag-on stamps the same 120 Myr lock as flag-off (byte-neutral)', () => {
    // Default riftSutureCooldownYears == RIFT_SUTURE_COOLDOWN_YEARS, so turning
    // tensionRift on without overriding the param changes nothing about the lock.
    const state = atTime(collisionWorld(0), { tensionRift: true });
    const rifted = riftPlate(state, 0, riftSeed, true);
    const lockUntil = T0 + RIFT_SUTURE_COOLDOWN_YEARS;
    expect(rifted.plates[0]!.sutureLockUntilYears).toBe(lockUntil);
    expect(rifted.plates.at(-1)!.sutureLockUntilYears).toBe(lockUntil);
  });

  it('under tensionRift the cooldown is riftSutureCooldownYears, not the constant', () => {
    // The retirement target: V2 = 0 ⇒ fresh halves carry no post-rift lock, so
    // ridge push (not a timer) is what keeps them apart.
    const zero = riftPlate(atTime(collisionWorld(0), { tensionRift: true, riftSutureCooldownYears: 0 }), 0, riftSeed, true);
    expect(zero.plates[0]!.sutureLockUntilYears).toBe(T0);
    expect(zero.plates.at(-1)!.sutureLockUntilYears).toBe(T0);

    // An intermediate measurement step (30 Myr) lands where expected.
    const mid = riftPlate(atTime(collisionWorld(0), { tensionRift: true, riftSutureCooldownYears: 30e6 }), 0, riftSeed, true);
    expect(mid.plates[0]!.sutureLockUntilYears).toBe(T0 + 30e6);
    expect(mid.plates.at(-1)!.sutureLockUntilYears).toBe(T0 + 30e6);
  });

  it('flag-off ignores riftSutureCooldownYears entirely (legacy spine preserved)', () => {
    // Even with the param zeroed, the flag-off path (tensionRiftActive=false)
    // stamps the legacy 120 Myr constant — the main/comparison baseline can
    // never be perturbed by this knob.
    const state = atTime(collisionWorld(0), { riftSutureCooldownYears: 0 });
    const rifted = riftPlate(state, 0, riftSeed, false);
    const lockUntil = T0 + RIFT_SUTURE_COOLDOWN_YEARS;
    expect(rifted.plates[0]!.sutureLockUntilYears).toBe(lockUntil);
    expect(rifted.plates.at(-1)!.sutureLockUntilYears).toBe(lockUntil);
  });
});

function countCells(state: PlanetState, plate: number): number {
  let n = 0;
  for (const p of state.fields.plateId) if (p === plate) n++;
  return n;
}

/** Largest single-plate area as a fraction of the sphere. */
function maxPlateAreaFraction(state: PlanetState): number {
  const counts = new Map<number, number>();
  for (const p of state.fields.plateId) counts.set(p, (counts.get(p) ?? 0) + 1);
  return Math.max(...counts.values()) / state.fields.plateId.length;
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
