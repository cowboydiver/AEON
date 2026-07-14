import { describe, expect, it } from 'vitest';
import { FIELD_NAMES } from '../src/fields';
import { cellCount } from '../src/grid';
import { hashFloat32Array } from '../src/hash';
import type { PlateRecord } from '../src/plates';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import { computePlateCensus, plateCensusSystem } from '../src/systems/plateCensus';
import type { Vec3 } from '../src/grid';

/** Minimal plate record with sane diagnostic defaults, overridable per test. */
function plate(over: Partial<PlateRecord> & { eulerPole: Vec3; angularVelRadPerYr: number }): PlateRecord {
  return {
    accumulatedRadians: 0,
    advectionCount: 0,
    createdAtYears: 0,
    sutureLockUntilYears: 0,
    continentalFraction: 0,
    alive: true,
    ...over,
  };
}

/**
 * A controlled census fixture: `createInitialState` for a valid shell, then the
 * plate table and the `plateId`/`crustType` fields overwritten with a hand-laid
 * partition. `owners[i]` is the plate owning cell i; `continental[i]` its crust
 * type. Only the fields/params the census reads matter.
 */
function fixture(plates: PlateRecord[], owners: number[], continental: boolean[]): PlanetState {
  const params = createPlanetParams({ seed: 1, gridN: 2 });
  const base = createInitialState(params);
  const count = cellCount(params.gridN);
  const plateId = new Float32Array(count);
  const crustType = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    plateId[i] = owners[i] ?? 0;
    crustType[i] = continental[i] ? 1 : 0;
  }
  return {
    ...base,
    plates,
    fields: { ...base.fields, plateId, crustType },
  };
}

describe('computePlateCensus — speed distribution', () => {
  // Three plates, speeds strictly increasing with continentality, each owning
  // eight of a gridN=2 world's 24 cells.
  const R = createPlanetParams({ seed: 1, gridN: 2 }).radiusMeters;
  const w0 = 1e-9;
  const w1 = 2e-9;
  const w2 = 3e-9;
  const plates = [
    plate({ eulerPole: [1, 0, 0], angularVelRadPerYr: w0 }), // all oceanic → frac 0
    plate({ eulerPole: [0, 1, 0], angularVelRadPerYr: w1 }), // half continental → 0.5
    plate({ eulerPole: [0, 0, 1], angularVelRadPerYr: w2 }), // all continental → 1
  ];
  const owners: number[] = [];
  const cont: boolean[] = [];
  for (let i = 0; i < 24; i++) {
    const p = Math.floor(i / 8);
    owners.push(p);
    // plate 1's eight cells: first four continental → fraction exactly 0.5.
    cont.push(p === 2 || (p === 1 && i % 8 < 4));
  }
  const census = computePlateCensus(fixture(plates, owners, cont));

  it('reports min/median/max of |ω|·R over owning plates', () => {
    expect(census.plateSpeedMinMPerYr).toBeCloseTo(w0 * R, 6);
    expect(census.plateSpeedMedianMPerYr).toBeCloseTo(w1 * R, 6);
    expect(census.plateSpeedMaxMPerYr).toBeCloseTo(w2 * R, 6);
  });

  it('ratios ocean-dominated vs continent-dominated mean speed', () => {
    // ocean-dominated = {plate0}; continent-dominated = {plate1 (0.5), plate2}.
    const expected = (w0 * R) / (((w1 + w2) * R) / 2);
    expect(census.oceanicContinentalSpeedRatio).toBeCloseTo(expected, 6);
  });

  it('correlates speed with continentality (positive here by construction)', () => {
    // speed rises monotonically with continental fraction across the 3 plates.
    expect(census.speedContinentalityCorr).toBeGreaterThan(0.9);
  });

  it('reports poleStability 1.0 when no previous pole is recorded', () => {
    expect(census.poleStability).toBeCloseTo(1, 12);
  });
});

describe('computePlateCensus — degenerate cases', () => {
  it('returns all zeros when there are no plates', () => {
    const params = createPlanetParams({ seed: 1, gridN: 2 });
    const base = createInitialState(params);
    const census = computePlateCensus({ ...base, plates: [] });
    expect(census.plateSpeedMedianMPerYr).toBe(0);
    expect(census.poleStability).toBe(0);
    expect(census.oceanicContinentalSpeedRatio).toBe(0);
    expect(census.speedContinentalityCorr).toBe(0);
  });

  it('skips dead plates and plates owning no cells', () => {
    const plates = [
      plate({ eulerPole: [1, 0, 0], angularVelRadPerYr: 5e-9, alive: false }), // dead
      plate({ eulerPole: [0, 1, 0], angularVelRadPerYr: 2e-9 }), // owns everything
      plate({ eulerPole: [0, 0, 1], angularVelRadPerYr: 9e-9 }), // alive but 0 cells
    ];
    const owners = new Array<number>(24).fill(1);
    const cont = new Array<boolean>(24).fill(false);
    const R = createPlanetParams({ seed: 1, gridN: 2 }).radiusMeters;
    const census = computePlateCensus(fixture(plates, owners, cont));
    // Only plate 1 counts: min == max == median == its speed.
    expect(census.plateSpeedMinMPerYr).toBeCloseTo(2e-9 * R, 6);
    expect(census.plateSpeedMaxMPerYr).toBeCloseTo(2e-9 * R, 6);
    // Single plate ⇒ correlation and ratio are the "no signal" 0.
    expect(census.speedContinentalityCorr).toBe(0);
    expect(census.oceanicContinentalSpeedRatio).toBe(0);
  });

  it('ratio is 0 when one partition is empty (all plates same class)', () => {
    const plates = [
      plate({ eulerPole: [1, 0, 0], angularVelRadPerYr: 1e-9 }),
      plate({ eulerPole: [0, 1, 0], angularVelRadPerYr: 3e-9 }),
    ];
    const owners: number[] = [];
    for (let i = 0; i < 24; i++) owners.push(i < 12 ? 0 : 1);
    const cont = new Array<boolean>(24).fill(false); // both ocean-dominated
    const census = computePlateCensus(fixture(plates, owners, cont));
    expect(census.oceanicContinentalSpeedRatio).toBe(0);
  });
});

describe('plateCensusSystem — pole stability memory', () => {
  it('reports 1.0 while poles are unchanged, < 1 after a pole rotates', () => {
    const plates = [plate({ eulerPole: [1, 0, 0], angularVelRadPerYr: 2e-9 })];
    const owners = new Array<number>(24).fill(0);
    const cont = new Array<boolean>(24).fill(false);
    const s0 = fixture(plates, owners, cont);
    s0.params.plateCensus = true;

    // First pass records prevEulerPole; stability is the 1.0 identity.
    const s1 = plateCensusSystem.apply(s0, 1e6, {} as SimContext);
    expect(s1.globals.poleStability).toBeCloseTo(1, 12);
    expect(s1.plates[0]!.prevEulerPole).toEqual([1, 0, 0]);

    // Second pass, pole unchanged ⇒ cosine 1.0.
    const s2 = plateCensusSystem.apply(s1, 1e6, {} as SimContext);
    expect(s2.globals.poleStability).toBeCloseTo(1, 12);

    // Rotate the pole 90° (x→y): cosine with the recorded prev is 0.
    const rotated: PlanetState = {
      ...s1,
      plates: [{ ...s1.plates[0]!, eulerPole: [0, 1, 0] }],
    };
    const s3 = plateCensusSystem.apply(rotated, 1e6, {} as SimContext);
    expect(s3.globals.poleStability).toBeCloseTo(0, 12);
  });
});

describe('plateCensusSystem — off is exact identity', () => {
  it('returns the same state object when params.plateCensus is false', () => {
    const params = createPlanetParams({ seed: 42, gridN: 8 });
    const base = createInitialState(params);
    expect(plateCensusSystem.apply(base, 1e6, {} as SimContext)).toBe(base);
  });

  it('leaves every field byte-identical across 10 steps whether census is on or off', () => {
    // The goldens hash fields only; this pins that the census toggle never
    // perturbs a single field (the stage-0 byte-identical contract).
    function run10(plateCensus: boolean): PlanetState {
      const params = createPlanetParams({ seed: 42, gridN: 16, plateCensus });
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let s = createInitialState(params);
      for (let i = 0; i < 10; i++) s = step(s, params.stepYears, ctx);
      return s;
    }
    const off = run10(false);
    const on = run10(true);
    for (const name of FIELD_NAMES) {
      expect(hashFloat32Array(on.fields[name])).toBe(hashFloat32Array(off.fields[name]));
    }
    // And the census actually populated the globals on the "on" arm.
    expect(on.globals.plateSpeedMedianMPerYr).toBeGreaterThan(0);
    expect(off.globals.plateSpeedMedianMPerYr).toBe(0);
  });
});
