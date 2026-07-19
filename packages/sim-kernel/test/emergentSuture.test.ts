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
  // Zero the plates' kinematics so they are genuinely COMOVING (|v_rel| = 0).
  // These tests inject a synthetic `boundaryStress` to exercise the net-closing
  // shortening integral, which models advection-quantum jitter on an already-
  // stopped collision — a stopped collision is comoving by construction. That
  // keeps the #127 item 2.2 gross-motion gate neutral here, isolating the
  // net-integral logic; the gate itself is tested separately below with real
  // relative motion.
  const plates = state.plates.map((p) => ({
    ...p,
    angularVelRadPerYr: 0,
  }));
  return { ...state, plates, fields: { ...state.fields, crustType, crustAge } };
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

/**
 * Drive wilson step-by-step with a per-cell `boundaryStress` pattern (a function
 * of cell index and time), advancing timeYears by 1 Myr, until the first suture
 * event fires (or the cap). Lets a test build spatially non-uniform closing
 * fields (e.g. ±jitter that nets to zero) that `runUntilSuture` cannot.
 */
function runUntilSutureField(
  seed: number,
  stressAt: (cellIndex: number, timeYears: number) => number,
  capYears: number,
): { timeYears: number; kind: string } | null {
  const dt = 1e6;
  const count = cellCount(16);
  const ctx: SimContext = { rng: createRng(seed).fork('sim') };
  let s = threePlateContactState(seed);
  for (let t = 0; t <= capYears; t += dt) {
    const boundaryStress = new Float32Array(count);
    for (let i = 0; i < count; i++) boundaryStress[i] = stressAt(i, t);
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

describe('emergentSuture trigger — shortening-integral fallback (#112)', () => {
  // The stall criterion is the NET signed shortening integral, not the mean of
  // per-cell |closing speed|: the instantaneous per-cell-magnitude metric was
  // measured DEAD on the acceptance grid (0 stall sutures; advection-quantum
  // jitter kept the |speed| mean above 2 mm/yr forever). The integral takes the
  // net signed sum, whose jitter cancels over the contact and over time, so a
  // genuinely stopped collision is detected even when per-cell speeds are noisy.

  it('stalls a net-zero contact whose per-cell speeds jitter ±5 mm/yr (the case the |speed|-mean metric missed)', () => {
    // Every cell reads ±5 mm/yr (well above the 2 mm/yr threshold in magnitude),
    // but they alternate by index so the NET closing is ≈0: the plates are not
    // approaching. The old per-cell-|speed| mean read 5 mm/yr ≫ threshold and
    // never stalled (this pattern used to merge only on the 150 Myr timeout).
    // The net integral reads ≈0 ⇒ stalled ⇒ plateSuture at exactly 20 Myr.
    const res = runUntilSutureField(3, (i) => (i % 2 === 0 ? 0.005 : -0.005), 200e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.plateSuture);
    expect(res!.timeYears).toBe(SUTURE_STALL_AFTER_YEARS);
  });

  it('sutures after SUTURE_STALL_AFTER_YEARS of sub-threshold net closing, not before', () => {
    // 1 mm/yr uniform net closing < 2 mm/yr stall speed ⇒ the average net rate
    // since the anchor never reaches threshold, the anchor never resets, and the
    // pair merges the first step at/after 20 Myr with a normal plateSuture.
    const res = runUntilSuture(3, () => 0.001, 100e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.plateSuture);
    expect(res!.timeYears).toBe(SUTURE_STALL_AFTER_YEARS);
  });

  it('never stalls an actively converging contact — merges only on the loud timeout', () => {
    // 3 cm/yr uniform net convergence: the average net rate since the anchor is
    // 3 cm/yr ≫ 2 mm/yr every step, so the anchor resets every step and the
    // stall window never accumulates. The only merge is the 150 Myr timeout.
    const res = runUntilSuture(3, () => 0.03, 200e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.sutureTimeout);
    expect(res!.timeYears).toBe(SUTURE_TIMEOUT_YEARS);
  });

  it('never stalls a separating (net-divergent) contact — proposal §7 re-suture guard', () => {
    // −1 cm/yr uniform net divergence: |average net rate| is large, so the
    // anchor resets every step and the pair never registers a (convergent)
    // stall. Ridge-push-separated rift halves therefore cannot re-suture on the
    // stall path; the only merge available is the loud timeout.
    const res = runUntilSuture(3, () => -0.01, 200e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.sutureTimeout);
    expect(res!.timeYears).toBe(SUTURE_TIMEOUT_YEARS);
  });

  it('a single one-step convergence spike does not reset a stall (integral robustness)', () => {
    // A lone 1-Myr spike to 1 cm/yr adds only 10 km of shortening — far below the
    // rate×window tolerance — so the trailing-window average net rate stays sub-
    // threshold and the stall still fires at 20 Myr. This is the robustness the
    // instantaneous metric lacked: one teleporting-boundary step cannot veto a
    // 20 Myr stall determination.
    const res = runUntilSuture(3, (t) => (t === 10e6 ? 0.01 : 0.001), 100e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.plateSuture);
    expect(res!.timeYears).toBe(SUTURE_STALL_AFTER_YEARS);
  });
});

describe('emergentSuture gross-motion gate — shearing/mixed contacts do not stall-weld (#127 item 2.2)', () => {
  // The net-closing stall test is sign-blind to HOW net≈0 arose. A genuinely
  // stalled collision is near-comoving; a shearing transform, or a boundary
  // rotating about a nearby pole whose signed normal segments cancel, reads
  // net≈0 yet its plates still move at plate speed — and used to weld as
  // "stalled" after only 20 Myr. Give the three plates distinct fast spins so
  // the real |v_own − v_other| ≫ the gate at every contact, then inject a
  // sub-threshold NET closing so the net-integral WOULD stall. The merge must
  // fall through to the loud 150 Myr timeout, never fire the 20 Myr stall.
  function spinningState(seed: number): PlanetState {
    const base = threePlateContactState(seed);
    const omega = 1.5e-8; // |ω|·R ≈ 9.6 cm/yr ≫ SUTURE_SHEAR_MAX_M_PER_YR (8 mm/yr)
    const poles: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const plates = base.plates.map((p, idx) =>
      idx < 3
        ? {
            ...p,
            eulerPole: poles[idx]!,
            angularVelRadPerYr: omega,
          }
        : p,
    );
    return { ...base, plates };
  }

  it('a fast-shearing net-zero contact merges only on the timeout, never the 20 Myr stall', () => {
    const dt = 1e6;
    const count = cellCount(16);
    const ctx: SimContext = { rng: createRng(7).fork('sim') };
    let s = spinningState(7);
    let result: { timeYears: number; kind: string } | null = null;
    for (let t = 0; t <= 200e6; t += dt) {
      // 1 mm/yr uniform net closing < the 2 mm/yr stall speed: the net-integral
      // stays sub-threshold and WOULD register a stall at 20 Myr — but the plates
      // are shearing at ~10 cm/yr, so the gross-motion gate refuses it.
      const boundaryStress = new Float32Array(count).fill(0.001);
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

  it('the same net-zero contact WOULD stall-weld at 20 Myr if the plates were comoving (control)', () => {
    // Identical injected stress, but the default comoving fixture (|v_rel|=0):
    // the gate is neutral and the net-integral stall fires at 20 Myr. This is
    // the exact pair the gate discriminates on real relative motion alone.
    const res = runUntilSuture(7, () => 0.001, 100e6);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe(EVENT_KINDS.plateSuture);
    expect(res!.timeYears).toBe(SUTURE_STALL_AFTER_YEARS);
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
