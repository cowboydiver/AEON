import { describe, expect, it } from 'vitest';
import {
  BASAL_DRAG_N_YR_PER_M3,
  CONTINENTAL_DRAG_MULTIPLIER,
  EARTH_RADIUS_M,
  OMEGA_RELAX_YEARS,
  PLATE_SPEED_CAP_M_PER_YR,
  RIDGE_PUSH_N_PER_M,
  SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR,
} from '../src/constants';
import { FIELD_NAMES } from '../src/fields';
import { cellCount } from '../src/grid';
import { hashFloat32Array } from '../src/hash';
import { createRng } from '../src/rng';
import { computeBoundaryStress } from '../src/systems/boundaries';
import { plateDynamicsSystem, slabAgeRamp, solve3x3 } from '../src/systems/plateDynamics';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, SYSTEMS, type SimContext, type System } from '../src/step';

/**
 * Stage-1 forceKinematics physics battery (Tectonics V2, #111, proposal §6).
 * The linear-algebra core is exercised directly on `solve3x3`; the emergent
 * claims (free decay, collision stall, slab attachment, the India test, the
 * speed envelope) run isolated small-grid fixtures, driving ONLY the
 * `plateDynamics` system (step's custom-systems arg) so nothing else can move
 * the plates. Determinism and the flag-off byte-identity contract are pinned.
 */

const R = EARTH_RADIUS_M;

/** m (row-major 9) times v. */
function matVec(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

function norm3(v: readonly [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

const ONLY_DYNAMICS: readonly System[] = [plateDynamicsSystem];

function makeCtx(seed: number): SimContext {
  return { rng: createRng(seed).fork('sim') };
}

describe('solve3x3 (closed-form adjugate inverse)', () => {
  it('recovers a synthetic rigid rotation to 1e-12 (exactness)', () => {
    // A symmetric positive-definite drag-like matrix and a known ω⃗; feed
    // τ = M·ω⃗ back through the solve and require the original ω⃗ back.
    const m = [4, 1, 0.5, 1, 3, 0.25, 0.5, 0.25, 2];
    const omega: [number, number, number] = [0.0123, -0.0456, 0.0789];
    const tau = matVec(m, omega);
    const recovered = solve3x3(m, tau);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(recovered[i]! - omega[i]!)).toBeLessThan(1e-12);
    }
  });

  it('closes the torque balance at realistic (c_d·R²) scale (residual < 1e-6)', () => {
    // The actual solve runs on M = c_d·R²·K, whose entries are ~1e20. The
    // adjugate inverse must still close ‖M·ω⃗* − τ‖/‖τ‖ to well under 1e-6.
    const scale = BASAL_DRAG_N_YR_PER_M3 * R * R;
    const k = [2.1, 0.3, -0.4, 0.3, 1.7, 0.2, -0.4, 0.2, 1.4];
    const m = k.map((x) => x * scale);
    const tau: [number, number, number] = [5e21, -3e21, 8e21];
    const omegaStar = solve3x3(m, tau);
    const residual = matVec(m, omegaStar);
    const rel = norm3([residual[0] - tau[0], residual[1] - tau[1], residual[2] - tau[2]]) / norm3(tau);
    expect(rel).toBeLessThan(1e-6);
  });

  it('returns zero for a singular matrix (deterministic, no NaN)', () => {
    const singular = [1, 2, 3, 2, 4, 6, 7, 8, 9]; // rows 0,1 linearly dependent
    expect(solve3x3(singular, [1, 1, 1])).toEqual([0, 0, 0]);
  });

  it('dissipation positivity: ω⃗ᵀ·M·ω⃗ > 0 for a PSD-derived drag matrix', () => {
    // K is PSD (sum of cellA·(I − r̂r̂ᵀ), each PSD); the regularized, c_d·R²
    // scaled matrix is PD, so drag power ω·(M ω) is strictly positive — nothing
    // is secretly propulsive.
    const scale = BASAL_DRAG_N_YR_PER_M3 * R * R;
    const m = [2.1, 0.3, -0.4, 0.3, 1.7, 0.2, -0.4, 0.2, 1.4].map((x) => x * scale);
    for (const w of [
      [1, 0, 0],
      [0.2, -0.5, 0.9],
      [-0.7, 0.1, 0.3],
    ] as [number, number, number][]) {
      expect(w[0] * matVec(m, w)[0] + w[1] * matVec(m, w)[1] + w[2] * matVec(m, w)[2]).toBeGreaterThan(0);
    }
  });
});

describe('force laws (the constant-level "cargo-cult" checks)', () => {
  it('craton drag: terminal speed ratio equals CONTINENTAL_DRAG_MULTIPLIER', () => {
    // Identical geometry and drive; continental cells scale the whole drag
    // tensor (and its trace-proportional regularizer) by the multiplier, so
    // the terminal ω⃗* — hence surface speed — is exactly 1/multiplier of the
    // oceanic twin's. Speed anticorrelates with continental fraction.
    const kOcean = [2.1, 0.3, -0.4, 0.3, 1.7, 0.2, -0.4, 0.2, 1.4];
    const mOcean = kOcean.map((x) => x * BASAL_DRAG_N_YR_PER_M3 * R * R);
    const mCont = mOcean.map((x) => x * CONTINENTAL_DRAG_MULTIPLIER);
    const tau: [number, number, number] = [4e21, 1e21, -2e21];
    const ratio = norm3(solve3x3(mOcean, tau)) / norm3(solve3x3(mCont, tau));
    expect(ratio).toBeCloseTo(CONTINENTAL_DRAG_MULTIPLIER, 6);
  });

  it('slab attachment: a mature slab out-drives ridge push ≥ 2× (both ends of the envelope)', () => {
    // At 100 Myr the √age slab pull is ~2× ridge push per m of margin — the
    // design's headline: the fast (slab-attached) and slow (ridge-only) speed
    // regimes fall out of two constants before any tuning. Same geometry ⇒ the
    // terminal-speed ratio is the force ratio.
    const age = 1e8;
    const slabForcePerM = SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR * Math.sqrt(age) * slabAgeRamp(age);
    expect(slabForcePerM / RIDGE_PUSH_N_PER_M).toBeGreaterThanOrEqual(2);

    // And through the linear solve on identical drag+geometry:
    const m = [2.0, 0.2, -0.3, 0.2, 1.6, 0.1, -0.3, 0.1, 1.3].map((x) => x * BASAL_DRAG_N_YR_PER_M3 * R * R);
    const dir: [number, number, number] = [1, 0.5, -0.2];
    const slabTau = dir.map((d) => d * slabForcePerM) as [number, number, number];
    const ridgeTau = dir.map((d) => d * RIDGE_PUSH_N_PER_M) as [number, number, number];
    expect(norm3(solve3x3(m, slabTau)) / norm3(solve3x3(m, ridgeTau))).toBeGreaterThanOrEqual(2);
  });

  it('slabAgeRamp gates young lithosphere: 0 below min age, 1 above twice min age', () => {
    expect(slabAgeRamp(0)).toBe(0);
    expect(slabAgeRamp(2.5e7)).toBe(0); // exactly the min age
    expect(slabAgeRamp(5e7)).toBe(1); // twice the min age
    expect(slabAgeRamp(3.75e7)).toBeCloseTo(0.5, 6); // midpoint
    expect(slabAgeRamp(1e8)).toBe(1); // mature crust: full pull
  });
});

describe('free decay (drag is purely dissipative)', () => {
  it('a boundary-free plate spins down geometrically toward rest', () => {
    // numPlates=1 ⇒ no boundaries ⇒ zero drive torque; ω⃗* = 0, so each step
    // ω⃗ = ω⃗/(1+a). |ω⃗| decays by exactly 1/(1+a) per step, pole fixed.
    const params = createPlanetParams({ seed: 7, gridN: 16, numPlates: 1, forceKinematics: true });
    let state: PlanetState = createInitialState(params);
    state = { ...state, fields: { ...state.fields, boundaryStress: computeBoundaryStress(state) } };
    const ctx = makeCtx(params.seed);
    const dt = params.stepYears;
    const factor = 1 / (1 + dt / OMEGA_RELAX_YEARS);
    const pole0 = state.plates[0]!.eulerPole;

    let prev = state.plates[0]!.angularVelRadPerYr;
    expect(prev).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      state = step(state, dt, ctx, ONLY_DYNAMICS);
      const cur = state.plates[0]!.angularVelRadPerYr;
      expect(cur).toBeLessThan(prev); // strictly decreasing
      expect(cur / prev).toBeCloseTo(factor, 9); // exact geometric decay
      // Pole direction unchanged (pure scaling of ω⃗).
      const pole = state.plates[0]!.eulerPole;
      expect(pole[0] * pole0[0] + pole[1] * pole0[1] + pole[2] * pole0[2]).toBeCloseTo(1, 9);
      prev = cur;
    }
  });
});

/**
 * Build a two-plate, all-continental fixture and orient the plates so their
 * shared boundary CLOSES. Returns the state with a live boundaryStress field.
 * Drives closing by giving plate 0 a pole/speed and leaving plate 1 at rest,
 * then flipping the sign if the measured mean contact stress came out divergent.
 */
function twoContinentClosingState(seed: number): { state: PlanetState; contact: number[] } {
  const params = createPlanetParams({ seed, gridN: 16, numPlates: 2, forceKinematics: true });
  let state = createInitialState(params);
  const count = cellCount(params.gridN);
  const crustType = new Float32Array(count).fill(1); // all continental
  const crustAge = new Float32Array(count).fill(2e9);
  state = { ...state, fields: { ...state.fields, crustType, crustAge } };

  // Contact cells: boundary cells owned by plate 0 whose dominant other is 1.
  const stress0 = computeBoundaryStress(state);
  const contact: number[] = [];
  const plateId = state.fields.plateId;
  for (let i = 0; i < count; i++) {
    if (plateId[i] === 0 && stress0[i] !== 0) contact.push(i);
  }
  // Mean contact stress with the drawn kinematics; if it opens, reverse both.
  const mean = contact.reduce((s, i) => s + stress0[i]!, 0) / Math.max(1, contact.length);
  if (mean < 0) {
    const plates = state.plates.map((p) => ({ ...p, angularVelRadPerYr: -p.angularVelRadPerYr }));
    state = { ...state, plates };
  }
  state = { ...state, fields: { ...state.fields, boundaryStress: computeBoundaryStress(state) } };
  return { state, contact };
}

function meanContactStress(state: PlanetState, contact: number[]): number {
  const s = state.fields.boundaryStress;
  return contact.reduce((a, i) => a + s[i]!, 0) / Math.max(1, contact.length);
}

describe('collision damping is non-propulsive', () => {
  it('closing speed strictly decreases, never reverses, and stalls within 40 Myr', () => {
    const { state: s0, contact } = twoContinentClosingState(3);
    let state = s0;
    const ctx = makeCtx(3);
    const dt = state.params.stepYears;
    let closing = meanContactStress(state, contact);
    expect(closing).toBeGreaterThan(0); // fixture really is converging
    const initial = closing;
    let stalledAt = -1;
    for (let i = 0; i < 40; i++) {
      state = step(state, dt, ctx, ONLY_DYNAMICS);
      const next = meanContactStress(state, contact);
      expect(next).toBeLessThan(closing + 1e-30); // never accelerates (monotone)
      expect(next).toBeGreaterThanOrEqual(-1e-6); // never sign-flips (reverses)
      closing = next;
      if (stalledAt < 0 && closing < 0.1 * initial) stalledAt = i;
    }
    expect(stalledAt).toBeGreaterThanOrEqual(0); // stalled within 40 steps = 40 Myr
  });
});

describe('the India test (slab-driven convergence, then the ocean closes)', () => {
  it("removing a plate's slab halves its speed within 3τ", () => {
    // Two plates; make plate 0 an OLD oceanic plate subducting under a young
    // plate 1, so slab pull drives plate 0. Relax to terminal, then delete
    // plate 0's slab (zero its crust age ⇒ it can no longer subduct / the √age
    // pull vanishes) and confirm its speed falls below half within 3τ = 30 Myr.
    const params = createPlanetParams({ seed: 11, gridN: 16, numPlates: 2, forceKinematics: true });
    let state = createInitialState(params);
    const count = cellCount(params.gridN);
    const plateId = state.fields.plateId;
    const crustType = new Float32Array(count).fill(0); // all oceanic
    const crustAge = new Float32Array(count);
    for (let i = 0; i < count; i++) crustAge[i] = plateId[i] === 0 ? 1.5e8 : 1e7; // plate 0 old, plate 1 young
    state = { ...state, fields: { ...state.fields, crustType, crustAge } };
    state = { ...state, fields: { ...state.fields, boundaryStress: computeBoundaryStress(state) } };
    const ctx = makeCtx(params.seed);
    const dt = params.stepYears;

    // Relax to near-terminal.
    for (let i = 0; i < 60; i++) state = step(state, dt, ctx, ONLY_DYNAMICS);
    const drivenSpeed = state.plates[0]!.angularVelRadPerYr * R;
    expect(drivenSpeed).toBeGreaterThan(0.005); // slab pull actually spun it up (> 0.5 cm/yr)

    // Delete plate 0's slab: young crust everywhere ⇒ plate 0 no longer the
    // older (subducting) side, and the √age pull it did have collapses.
    const youngAge = new Float32Array(count).fill(1e7);
    state = { ...state, fields: { ...state.fields, crustAge: youngAge } };
    state = { ...state, fields: { ...state.fields, boundaryStress: computeBoundaryStress(state) } };
    for (let i = 0; i < 30; i++) state = step(state, dt, ctx, ONLY_DYNAMICS); // 3τ = 30 Myr
    expect(state.plates[0]!.angularVelRadPerYr * R).toBeLessThan(0.5 * drivenSpeed);
  });
});

describe('slabPullN diagnostic (the census slab-attachment predictor, #111)', () => {
  it('accumulates on the subducting plate, stays 0 on the overrider, and scales with √age', () => {
    // Same geometry as the India test: plate 0 OLD oceanic subducts under the
    // YOUNG oceanic plate 1. Plate 0 is the down-going side → it accrues slab
    // pull; plate 1 overrides and receives only slab SUCTION, which is excluded
    // from slabPullN by design → it stays exactly 0.
    const params = createPlanetParams({ seed: 11, gridN: 16, numPlates: 2, forceKinematics: true });
    let state = createInitialState(params);
    const count = cellCount(params.gridN);
    const plateId = state.fields.plateId;
    const crustType = new Float32Array(count).fill(0); // all oceanic
    const oldAge = new Float32Array(count);
    for (let i = 0; i < count; i++) oldAge[i] = plateId[i] === 0 ? 1.5e8 : 1e7;
    state = { ...state, fields: { ...state.fields, crustType, crustAge: oldAge } };
    state = { ...state, fields: { ...state.fields, boundaryStress: computeBoundaryStress(state) } };
    const ctx = makeCtx(params.seed);
    const dt = params.stepYears;

    const afterOld = step(state, dt, ctx, ONLY_DYNAMICS);
    expect(afterOld.plates[0]!.slabPullN).toBeGreaterThan(0); // subducting side attached
    expect(afterOld.plates[1]!.slabPullN).toBe(0); // overrider: suction only, excluded

    // Reduce the subducting plate's age (1.5e8 → 0.6e8, both still past the ramp
    // saturation at 2·SLAB_PULL_MIN_AGE_YEARS=5e7). Slab pull ∝ √age·ramp with
    // ramp pinned at 1, so the attached force must strictly shrink with age —
    // the density/age weighting the correlation depends on is live in slabPullN.
    const youngerAge = new Float32Array(count);
    for (let i = 0; i < count; i++) youngerAge[i] = plateId[i] === 0 ? 0.6e8 : 1e7;
    let s2 = { ...state, fields: { ...state.fields, crustAge: youngerAge } };
    s2 = { ...s2, fields: { ...s2.fields, boundaryStress: computeBoundaryStress(s2) } };
    const afterYoung = step(s2, dt, ctx, ONLY_DYNAMICS);
    expect(afterYoung.plates[0]!.slabPullN).toBeGreaterThan(0);
    expect(afterYoung.plates[0]!.slabPullN).toBeLessThan(afterOld.plates[0]!.slabPullN);
  });
});

describe('speed envelope on a full small run', () => {
  it('every live plate stays in [0, 20] cm/yr with a plausible median', () => {
    // Full pipeline, forceKinematics on, N=16 to 1 Gyr. The census speed target
    // (median 2–6 cm/yr) is a chunk-3 gate; here we only assert the hard
    // envelope holds and no plate runs away past the cap.
    const params = createPlanetParams({ seed: 42, gridN: 16, forceKinematics: true });
    const ctx = makeCtx(params.seed);
    let state = createInitialState(params);
    for (let i = 0; i < 1000; i++) state = step(state, params.stepYears, ctx);
    const speeds = state.plates
      .filter((p) => p.alive)
      .map((p) => p.angularVelRadPerYr * R)
      .sort((a, b) => a - b);
    expect(speeds.length).toBeGreaterThan(0);
    for (const v of speeds) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(PLATE_SPEED_CAP_M_PER_YR + 1e-12); // ≤ 20 cm/yr
    }
    const median = speeds[Math.floor(speeds.length / 2)]!;
    expect(median).toBeGreaterThan(0); // the balance moved the plates
  });
});

function fieldHashes(state: PlanetState): Record<string, string> {
  return Object.fromEntries(
    FIELD_NAMES.map((n) => [n, hashFloat32Array(state.fields[n]).toString(16).padStart(8, '0')]),
  );
}

describe('flag-on golden + engaged spine (#102 pattern)', () => {
  const runFlagOn = (seed: number): PlanetState => {
    const params = createPlanetParams({ seed, gridN: 32, forceKinematics: true });
    const ctx = makeCtx(seed);
    let s = createInitialState(params);
    for (let i = 0; i < 100; i++) s = step(s, params.stepYears, ctx);
    return s;
  };

  // Pin the flag-on field spine across the three golden seeds, and prove the
  // balance provably acted on each (≥1 plate alive since t=0 changed speed
  // > 20% from its initial draw — the #102 engaged-golden guard against
  // silently pinning an inert path).
  for (const seed of [1, 42, 1337] as const) {
    it(`seed ${seed}: engaged (≥1 plate speed changed > 20%) and pinned`, () => {
      const params = createPlanetParams({ seed, gridN: 32, forceKinematics: true });
      const speed0 = createInitialState(params).plates.map((p) => p.angularVelRadPerYr);
      const final = runFlagOn(seed);
      let maxRel = 0;
      for (let p = 0; p < final.plates.length; p++) {
        const plate = final.plates[p]!;
        if (!plate.alive || plate.createdAtYears !== 0) continue;
        const s0 = speed0[p]!;
        if (s0 > 0) maxRel = Math.max(maxRel, Math.abs(plate.angularVelRadPerYr - s0) / s0);
      }
      expect(maxRel).toBeGreaterThan(0.2);
      expect({ after100: { timeYears: final.timeYears, ...fieldHashes(final) } }).toMatchSnapshot();
    });
  }

  it('is deterministic: zero RNG in the gated system ⇒ two runs are byte-identical', () => {
    expect(fieldHashes(runFlagOn(42))).toEqual(fieldHashes(runFlagOn(42)));
  });
});

describe('flag-off byte-identity', () => {
  it('the default (flag-off) path leaves plateDynamics an exact identity', () => {
    // With forceKinematics off, the default SYSTEMS pipeline (which now
    // includes plateDynamics) must produce the same fields as a pipeline with
    // plateDynamics explicitly removed — the guarantee the main goldens rest on.
    const params = createPlanetParams({ seed: 1, gridN: 16 });
    expect(params.forceKinematics).toBe(false);
    const withoutDynamics = SYSTEMS.filter((s) => s.name !== 'plateDynamics');
    const ctx1 = makeCtx(params.seed);
    const ctx2 = makeCtx(params.seed);
    let withSys = createInitialState(params);
    let withoutSys = createInitialState(params);
    for (let i = 0; i < 20; i++) {
      withSys = step(withSys, params.stepYears, ctx1); // default SYSTEMS: plateDynamics present (identity)
      withoutSys = step(withoutSys, params.stepYears, ctx2, withoutDynamics);
    }
    expect(fieldHashes(withSys)).toEqual(fieldHashes(withoutSys));
    // And every plate's kinematic state is untouched (omegaVec stays zero).
    for (const p of withSys.plates) expect(p.omegaVec).toEqual([0, 0, 0]);
  });
});
