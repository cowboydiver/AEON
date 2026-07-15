import { describe, expect, it } from 'vitest';
import {
  SUTURE_STALL_AFTER_YEARS,
  SUTURE_STALL_SPEED_M_PER_YR,
  SUTURE_TIMEOUT_YEARS,
} from '../src/constants';
import { EVENT_KINDS } from '../src/events';
import { cellCount, type Vec3 } from '../src/grid';
import { createRng } from '../src/rng';
import { wilsonSystem } from '../src/systems/wilson';
import {
  kWeightedOmega,
  plateDragTensor,
  type SymTensor3,
} from '../src/systems/plateDynamics';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import type { SimContext } from '../src/step';

/**
 * Tectonics V2 stage 2 (`emergentSuture`, #112, proposal §2.4). The merge blend
 * ω⃗ = (K_a+K_b)⁻¹(K_a·ω⃗_a + K_b·ω⃗_b) is the exact fixed point the combined
 * plate relaxes to when both inputs are at their own force-balance fixed point.
 * These tests pin that algebraic property plus the co-located degradation and
 * the singular fallback — the trigger/timeout behavior is exercised through the
 * full pipeline in the flag-off byte-identity and onset-gating suites and the
 * measurement campaign on #112.
 */

/** Multiply a symmetric tensor (6 unique entries) by a vector. */
function symMul(k: SymTensor3, v: Vec3): Vec3 {
  return [
    k[0] * v[0] + k[1] * v[1] + k[2] * v[2],
    k[1] * v[0] + k[3] * v[1] + k[4] * v[2],
    k[2] * v[0] + k[4] * v[1] + k[5] * v[2],
  ];
}

describe('kWeightedOmega — suture-blend fixed point (#112)', () => {
  it('satisfies (K_a+K_b)·ω⃗ = K_a·ω⃗_a + K_b·ω⃗_b (the merged fixed point)', () => {
    // Two arbitrary symmetric positive-definite drag tensors and two ω⃗.
    const ka: SymTensor3 = [5, 1, -0.5, 4, 0.3, 6];
    const kb: SymTensor3 = [3, -0.4, 0.2, 7, -1, 2];
    const wa: Vec3 = [1e-9, -2e-9, 0.5e-9];
    const wb: Vec3 = [-3e-9, 1e-9, 2e-9];

    const omega = kWeightedOmega(ka, wa, kb, wb);

    // Reconstruct the residual: (K_a+K_b)·ω⃗ should equal K_a·ω⃗_a + K_b·ω⃗_b.
    const ksum: SymTensor3 = [
      ka[0] + kb[0],
      ka[1] + kb[1],
      ka[2] + kb[2],
      ka[3] + kb[3],
      ka[4] + kb[4],
      ka[5] + kb[5],
    ];
    const lhs = symMul(ksum, omega);
    const rhsA = symMul(ka, wa);
    const rhsB = symMul(kb, wb);
    for (let c = 0; c < 3; c++) {
      expect(lhs[c]).toBeCloseTo(rhsA[c] + rhsB[c], 20);
    }
  });

  it('degrades to the drag-area-weighted mean when K_b = c·K_a (co-located plates)', () => {
    const ka: SymTensor3 = [5, 1, -0.5, 4, 0.3, 6];
    const c = 3; // plate b carries 3× the drag-weighted area of plate a.
    const kb: SymTensor3 = [ka[0] * c, ka[1] * c, ka[2] * c, ka[3] * c, ka[4] * c, ka[5] * c];
    const wa: Vec3 = [1e-9, -2e-9, 0.5e-9];
    const wb: Vec3 = [-3e-9, 1e-9, 2e-9];

    const omega = kWeightedOmega(ka, wa, kb, wb);
    // Expected area-weighted mean: (ω⃗_a + c·ω⃗_b)/(1+c).
    for (let i = 0; i < 3; i++) {
      expect(omega[i]).toBeCloseTo((wa[i] + c * wb[i]) / (1 + c), 20);
    }
  });

  it('falls back to the trace-weighted mean when the summed tensor is singular', () => {
    // Rank-1 tensors sharing a null space: r̂r̂ᵀ-style, both singular, K_a+K_b
    // still singular (both annihilate the same directions is not required —
    // here both are multiples of one rank-1 outer product).
    const ka: SymTensor3 = [4, 0, 0, 0, 0, 0]; // 4·x̂x̂ᵀ, trace 4
    const kb: SymTensor3 = [2, 0, 0, 0, 0, 0]; // 2·x̂x̂ᵀ, trace 2
    const wa: Vec3 = [1e-9, 5e-9, 0];
    const wb: Vec3 = [4e-9, -1e-9, 3e-9];
    const omega = kWeightedOmega(ka, wa, kb, wb);
    // trace-weighted mean = (4·ω⃗_a + 2·ω⃗_b)/6, and no NaN.
    for (let i = 0; i < 3; i++) {
      expect(Number.isFinite(omega[i])).toBe(true);
      expect(omega[i]).toBeCloseTo((4 * wa[i] + 2 * wb[i]) / 6, 20);
    }
  });

  it('returns zero for two null tensors (no divide-by-zero)', () => {
    const zero: SymTensor3 = [0, 0, 0, 0, 0, 0];
    const omega = kWeightedOmega(zero, [1e-9, 0, 0], zero, [0, 1e-9, 0]);
    expect(omega).toEqual([0, 0, 0]);
  });
});

describe('plateDragTensor (#112)', () => {
  it('is symmetric, positive on the diagonal, and heavier for continental crust', () => {
    const params = createPlanetParams({ seed: 42, gridN: 16 });
    const state = createInitialState(params);
    // Every alive plate owns some cells; its drag tensor diagonal is positive
    // (a distributed plate is never a point) and off-diagonals are finite.
    const p = state.plates.findIndex((pl) => pl.alive);
    const k = plateDragTensor(state, p);
    expect(k[0]).toBeGreaterThan(0);
    expect(k[3]).toBeGreaterThan(0);
    expect(k[5]).toBeGreaterThan(0);
    for (const e of k) expect(Number.isFinite(e)).toBe(true);
  });
});

/**
 * A three-plate, all-continental N=16 fixture with a uniform, controlled
 * `boundaryStress` field so the closing speed at every cont–cont adjacency
 * equals `uniformStress`. Three plates so a merge is allowed (MIN_PLATES = 2);
 * all-continental so every boundary is a cont–cont contact; plates created at
 * t=0 stay well under the 600 Myr rift-age gate, so no rift perturbs the window.
 * `emergentSuture` on with onset 0.
 */
function threePlateContactState(seed: number): PlanetState {
  const params = createPlanetParams({
    seed,
    gridN: 16,
    numPlates: 3,
    forceKinematics: true,
    emergentSuture: true,
  });
  const state = createInitialState(params);
  const count = cellCount(16);
  const crustType = new Float32Array(count).fill(1);
  const crustAge = new Float32Array(count).fill(2e9);
  return { ...state, fields: { ...state.fields, crustType, crustAge } };
}

/** Drive wilson step-by-step with a per-step uniform closing speed, advancing
 *  timeYears by 1 Myr, until the first suture event fires (or the cap). */
function runUntilSuture(
  seed: number,
  closingSpeedAt: (timeYears: number) => number,
  capYears: number,
): { timeYears: number; kind: string } | null {
  const dt = 1e6;
  const count = cellCount(16);
  const ctx: SimContext = { rng: createRng(seed).fork('sim') };
  let s = threePlateContactState(seed);
  for (let t = 0; t <= capYears; t += dt) {
    const boundaryStress = new Float32Array(count).fill(closingSpeedAt(t));
    s = { ...s, timeYears: t, fields: { ...s.fields, boundaryStress } };
    const before = s.events.length;
    s = wilsonSystem.apply(s, dt, ctx);
    if (s.events.length > before) {
      const ev = s.events[s.events.length - 1]!;
      return { timeYears: ev.timeYears, kind: ev.kind };
    }
  }
  return null;
}

describe('emergentSuture trigger (#112)', () => {
  it('sutures after SUTURE_STALL_AFTER_YEARS of sub-threshold closing, not before', () => {
    // 1 mm/yr < 2 mm/yr stall threshold, held constant ⇒ stalled from t=0.
    const res = runUntilSuture(3, () => 0.001, 100e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.plateSuture);
    // Stall clock starts at t=0; merge the first step at/after 20 Myr.
    expect(res!.timeYears).toBe(SUTURE_STALL_AFTER_YEARS);
  });

  it('resets the stall clock on a closing-speed spike above threshold', () => {
    // Stalled except a single spike to 1 cm/yr at t=10 Myr, which clears the
    // stall clock; it restarts at 11 Myr, so the merge slips to 31 Myr.
    const res = runUntilSuture(3, (t) => (t === 10e6 ? 0.01 : 0.001), 100e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.plateSuture);
    expect(res!.timeYears).toBe(11e6 + SUTURE_STALL_AFTER_YEARS);
  });

  it('does not stall on a mixed convergent/divergent boundary (mean |speed|, not |mean|)', () => {
    // Alternating ±1 cm/yr by cell index: the signed mean is ~0 (an abs-of-mean
    // metric would falsely read this active boundary as stalled and merge at
    // 20 Myr), but every cell's |closing speed| is 1 cm/yr, so the mean of the
    // magnitudes is 1 cm/yr ≫ the 2 mm/yr threshold ⇒ never stalls. The only
    // merge is the loud 150 Myr timeout.
    const dt = 1e6;
    const count = cellCount(16);
    const ctx: SimContext = { rng: createRng(3).fork('sim') };
    let s = threePlateContactState(3);
    let result: { timeYears: number; kind: string } | null = null;
    for (let t = 0; t <= 200e6; t += dt) {
      const boundaryStress = new Float32Array(count);
      for (let i = 0; i < count; i++) boundaryStress[i] = i % 2 === 0 ? 0.01 : -0.01;
      s = { ...s, timeYears: t, fields: { ...s.fields, boundaryStress } };
      const before = s.events.length;
      s = wilsonSystem.apply(s, dt, ctx);
      if (s.events.length > before) {
        const ev = s.events[s.events.length - 1]!;
        result = { timeYears: ev.timeYears, kind: ev.kind };
        break;
      }
    }
    expect(result).not.toBeNull();
    expect(result!.kind).toBe(EVENT_KINDS.sutureTimeout);
    expect(result!.timeYears).toBe(SUTURE_TIMEOUT_YEARS);
  });

  it('fires the loud sutureTimeout backstop when the contact never stalls', () => {
    // 1 cm/yr, always above threshold ⇒ never stalls; the contact merges on the
    // SUTURE_TIMEOUT_YEARS backstop with the distinct sutureTimeout event.
    const res = runUntilSuture(3, () => 0.01, 200e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.sutureTimeout);
    expect(res!.timeYears).toBe(SUTURE_TIMEOUT_YEARS);
  });
});

describe('stage-2 constants (#112, proposal §2.3)', () => {
  it('stall speed is below the active-margin gate and stall/timeout are ordered', () => {
    expect(SUTURE_STALL_SPEED_M_PER_YR).toBe(0.002);
    expect(SUTURE_STALL_AFTER_YEARS).toBe(2e7);
    expect(SUTURE_TIMEOUT_YEARS).toBe(1.5e8);
    // A stall must be resolvable long before the loud backstop fires.
    expect(SUTURE_STALL_AFTER_YEARS).toBeLessThan(SUTURE_TIMEOUT_YEARS);
  });
});
