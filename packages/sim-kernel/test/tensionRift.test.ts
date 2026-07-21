import { describe, expect, it } from 'vitest';
import {
  BLANKET_EFOLD_YEARS,
  BLANKET_MAX_FACTOR,
  RIFT_HAZARD_AT_REF_PER_MYR,
  RIFT_TENSION_MAX_FACTOR,
  RIFT_TENSION_REF_N,
} from '../src/constants';
import { EVENT_KINDS } from '../src/events';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCount } from '../src/grid';
import { createPlanetParams, type PlanetState } from '../src/state';
import { makePlate } from './helpers';
import {
  blanketFactor,
  riftPlate,
  riftTensionHazardProbability,
  wilsonSystem,
} from '../src/systems/wilson';

const N = 32;

/** A single continental plate covering the whole sphere with caller-set
 *  kinematic and stage-3 memory on plate 0. */
function singlePlate(overrides: Partial<PlanetState['plates'][number]> = {}): PlanetState {
  const count = cellCount(N);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
  ) as Fields;
  fields.crustType.fill(1);
  fields.elevation.fill(300);
  return {
    timeYears: 2e9,
    // The #115 promotion flipped the three V2 flags default-ON; this helper
    // builds the flag-OFF wilson baseline these tests assert against (the
    // on-path tests set tensionRift:true explicitly on top).
    params: createPlanetParams({
      seed: 7,
      gridN: N,
      numPlates: 1,
      forceKinematics: false,
      emergentSuture: false,
      tensionRift: false,
    }),
    globals: {
      landFraction: 0,
      co2: 280,
      meanTemperatureK: 0,
      seaLevelM: 0,
      waterInventoryM: 0,
      oxygen: 0,
      oxygenReductant: 0,
      abiogenesisYear: -1,
      plateSpeedMedianMPerYr: 0,
      plateSpeedMinMPerYr: 0,
      plateSpeedMaxMPerYr: 0,
      oceanicContinentalSpeedRatio: 0,
      speedContinentalityCorr: 0,
      speedSlabAttachmentCorr: 0,
      poleStability: 0,
      marginConsolidationFlipsTotal: 0,
      columnsExportedRockM3: 0,
      columnsExportShelfLimited: 0,
      columnsExportVisits: 0,
      columnsSedimentZeroedM3: 0,
      columnsThicknessCapBinds: 0,
      columnsMaturationFlips: 0,
      columnsMaturationElevSumM: 0,
      columnsMaturationCreditM3: 0,
    },
    fields,
    plates: [{ ...makePlate({ pole: [1, 0, 0], omega: 4e-9 }), ...overrides }],
    events: [],
    wilson: { contactSince: {}, stallSince: {}, shorteningIntegral: {} },
  };
}

describe('tensionRift hazard helper', () => {
  const dtYears = 1e6; // 1 Myr → dtMyr = 1

  it('at the reference tension and zero blanket, λ = RIFT_HAZARD_AT_REF_PER_MYR', () => {
    const p = riftTensionHazardProbability(RIFT_TENSION_REF_N, 0, dtYears);
    // tension factor = min(4, 1²) = 1, blanket factor = 1 → λ = RIFT_HAZARD_AT_REF_PER_MYR.
    expect(p).toBeCloseTo(1 - Math.exp(-RIFT_HAZARD_AT_REF_PER_MYR), 12);
  });

  it('is quadratic in tension below the cap', () => {
    // tensionN = 1.5 × ref → factor = 2.25 (< 4).
    const p = riftTensionHazardProbability(1.5 * RIFT_TENSION_REF_N, 0, dtYears);
    expect(p).toBeCloseTo(1 - Math.exp(-RIFT_HAZARD_AT_REF_PER_MYR * 2.25), 12);
  });

  it('caps the tension factor at RIFT_TENSION_MAX_FACTOR', () => {
    // 2×ref → (2)²=4 (exactly at the cap); 3×ref → 9 clamped to 4. Both equal.
    const at2 = riftTensionHazardProbability(2 * RIFT_TENSION_REF_N, 0, dtYears);
    const at3 = riftTensionHazardProbability(3 * RIFT_TENSION_REF_N, 0, dtYears);
    expect(at2).toBeCloseTo(1 - Math.exp(-RIFT_HAZARD_AT_REF_PER_MYR * RIFT_TENSION_MAX_FACTOR), 12);
    expect(at3).toBe(at2);
  });

  it('is zero at zero tension (no engine → no rift)', () => {
    expect(riftTensionHazardProbability(0, 5 * BLANKET_EFOLD_YEARS, dtYears)).toBe(0);
  });

  it('blanket factor rises from 1 toward BLANKET_MAX_FACTOR', () => {
    expect(blanketFactor(0)).toBe(1);
    // One e-fold: 1 + (3−1)(1 − e⁻¹) ≈ 2.2642.
    expect(blanketFactor(BLANKET_EFOLD_YEARS)).toBeCloseTo(
      1 + (BLANKET_MAX_FACTOR - 1) * (1 - Math.exp(-1)),
      12,
    );
    // Asymptote.
    expect(blanketFactor(50 * BLANKET_EFOLD_YEARS)).toBeCloseTo(BLANKET_MAX_FACTOR, 6);
  });

  it('the blanket multiplies the tension hazard', () => {
    const bare = riftTensionHazardProbability(RIFT_TENSION_REF_N, 0, dtYears);
    const blanketed = riftTensionHazardProbability(
      RIFT_TENSION_REF_N,
      BLANKET_EFOLD_YEARS,
      dtYears,
    );
    expect(blanketed).toBeGreaterThan(bare);
  });
});

describe('tensionRift blanket bookkeeping (wilson pass)', () => {
  const dt = 1e6;

  it('accumulates blanketYears while a plate holds ≥25% of the sphere as continent', () => {
    // Whole-sphere continental plate, zero tension → no rift, blanket accrues.
    const state = singlePlate({ blanketYears: 0, tensionN: 0 });
    const params = { ...state.params, tensionRift: true };
    const next = wilsonSystem.apply({ ...state, params }, dt, {} as never);
    expect(next.plates[0]!.blanketYears).toBe(dt);
    // No rift fired (hazard 0).
    expect(next.events.some((e) => e.kind === EVENT_KINDS.plateRift)).toBe(false);
  });

  it('resets blanketYears to 0 when continental fraction drops below the threshold', () => {
    const state = singlePlate({ blanketYears: 200e6, tensionN: 0 });
    // Make the plate mostly oceanic (well under 25% continent).
    state.fields.crustType.fill(0);
    for (let i = 0; i < 10; i++) state.fields.crustType[i] = 1;
    const params = { ...state.params, tensionRift: true };
    const next = wilsonSystem.apply({ ...state, params }, dt, {} as never);
    expect(next.plates[0]!.blanketYears).toBe(0);
  });

  it('flag-off never touches blanketYears (byte-preserved path)', () => {
    const state = singlePlate({ blanketYears: 123e6, tensionN: 5 * RIFT_TENSION_REF_N });
    const next = wilsonSystem.apply(state, dt, {} as never); // tensionRift off by default
    expect(next.plates[0]!.blanketYears).toBe(123e6);
  });
});

describe('tensionRift onset gating', () => {
  const dt = 1e6;

  it('before onset is bit-identical to the flag-off wilson pass', () => {
    const base = singlePlate({ blanketYears: 0, tensionN: 5 * RIFT_TENSION_REF_N });
    const off = wilsonSystem.apply(base, dt, {} as never);
    const gated = wilsonSystem.apply(
      { ...base, timeYears: 10e6, params: { ...base.params, tensionRift: true, tensionRiftOnsetYears: 50e6 } },
      dt,
      {} as never,
    );
    // Same partition, same (untouched) blanket memory, same events → onset holds.
    expect(gated.plates[0]!.blanketYears).toBe(off.plates[0]!.blanketYears);
    expect([...gated.fields.plateId]).toEqual([
      ...wilsonSystem.apply({ ...base, timeYears: 10e6 }, dt, {} as never).fields.plateId,
    ]);
  });
});

describe('tensionRift safety gates and fragment kinematics', () => {
  const dt = 1e6;

  it('a plate below the area safety gate never rifts, even at extreme tension', () => {
    // Two plates: a tiny one (< 8% of the sphere) with huge tension, and a big
    // ocean-filler plate. The tiny plate must be vetoed by RIFT_MIN_AREA_FRACTION.
    const count = cellCount(N);
    const fields = Object.fromEntries(
      FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
    ) as Fields;
    fields.crustType.fill(1);
    fields.elevation.fill(300);
    // Plate 1 owns everything except a 2% sliver owned by plate 0.
    const sliver = Math.floor(count * 0.02);
    for (let i = 0; i < count; i++) fields.plateId[i] = i < sliver ? 0 : 1;
    const state: PlanetState = {
      ...singlePlate(),
      fields,
      plates: [
        { ...makePlate({ pole: [1, 0, 0], omega: 4e-9 }), tensionN: 100 * RIFT_TENSION_REF_N },
        makePlate({ pole: [0, 1, 0], omega: 4e-9 }),
      ],
    };
    const params = { ...state.params, tensionRift: true };
    const next = wilsonSystem.apply({ ...state, params }, dt, {} as never);
    expect(next.events.some((e) => e.kind === EVENT_KINDS.plateRift)).toBe(false);
  });

  it('under the flag the fragment inherits the parent ω⃗ instead of an azimuth-drawn pole', () => {
    const parentPole: [number, number, number] = [0, 0, 1];
    const parentOmega = 7e-9;
    const state = singlePlate({
      eulerPole: parentPole,
      angularVelRadPerYr: parentOmega,
    });
    const riftSeed = 12345;
    const flagOn = riftPlate(state, 0, riftSeed, true);
    const fragment = flagOn.plates[flagOn.plates.length - 1]!;
    // The fragment's kinematics (pole + speed) are the parent's — that pair is
    // the sole source of truth (#127 item 8 dropped the redundant omegaVec).
    expect(fragment.eulerPole).toEqual(parentPole);
    expect(fragment.angularVelRadPerYr).toBe(parentOmega);

    // The legacy path draws a different (azimuth/omega-hash) pole — confirms the
    // flag genuinely changes the fragment kinematics, not just a coincidence.
    const legacy = riftPlate(state, 0, riftSeed, false);
    const legacyFragment = legacy.plates[legacy.plates.length - 1]!;
    expect(legacyFragment.angularVelRadPerYr).not.toBe(parentOmega);
  });
});
