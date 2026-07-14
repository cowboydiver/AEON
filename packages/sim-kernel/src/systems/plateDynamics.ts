/**
 * Force-driven plate kinematics (Tectonics V2 stage 1, #111; proposal §2.4/§6).
 *
 * A pure, RNG-free system that makes each plate's angular velocity ω⃗ *derived*
 * state: every step it relaxes ω⃗ toward the terminal velocity ω⃗* of a
 * boundary-integrated rigid-plate torque balance, replacing the immutable
 * random Euler vectors drawn once at creation (`plates.ts`). The balance is:
 *
 *   - **slab pull** (∝√age with a young-lithosphere ramp) on the *subducting*
 *     oceanic plate at a convergent margin, pulling it trench-ward;
 *   - **slab suction** — a fraction of that pull applied to the *overriding*
 *     plate, also trench-ward, so a subduction margin organizes both plates;
 *   - **ridge push** on each flank of a divergent boundary, pushing away from
 *     the ridge;
 *   - **continent–continent collision damping** — pure damping that opposes
 *     the closing motion (it can stall a collision but never reverse it);
 *   - closed by **linear basal drag** −c_d·v with a continental-keel
 *     multiplier, integrated per cell into a per-plate drag tensor K.
 *
 * At terminal velocity the drive torque τ balances the drag torque c_d·R²·K·ω⃗,
 * so ω⃗* solves the closed-form 3×3 system (c_d·R²·K)·ω⃗* = τ (one adjugate
 * inverse per plate, deterministically regularized so a near-point plate's
 * dragless radial spin-axis is pinned). ω⃗ then relaxes semi-implicitly,
 * ω⃗ = (ω⃗ + a·ω⃗*)/(1+a) with a = dt/OMEGA_RELAX_YEARS — unconditionally stable
 * for any dt, and a low-pass against advection-quantum torque noise (§8).
 *
 * The one-step lag: forces read the `boundaryStress` field that `tectonics`
 * just computed from the *previous* step's kinematics; after ω⃗ is updated the
 * field is recomputed here (the #55 rule — never pair stale-kinematics stress
 * with new state), so `wilson` downstream sees consistent kinematics + stress.
 *
 * Gated by `params.forceKinematics` (default false) and
 * `params.forceKinematicsOnsetYears`. When off — or before onset — the system
 * is exact identity, so the main goldens and every default run stay
 * byte-identical. It consumes **zero RNG draws** in all cases, satisfying the
 * A/B contract by construction.
 *
 * ω⃗ is written to each plate's `omegaVec`, and `eulerPole`/`angularVelRadPerYr`
 * are re-derived from it (|ω⃗| and its unit direction), so every existing
 * consumer — advection, `computeBoundaryStress`, `plateVelocityAt`, the wilson
 * stats — is unchanged. The current ω⃗ fed into the relaxation is reconstructed
 * from that derived pair (`angularVelRadPerYr·eulerPole`), which is the single
 * source of truth every other system already reads: on the first engaged step
 * that is the initial random draw, so the drawn kinematics act as the ~3τ
 * symmetry-breaking transient (§2.5) rather than being discarded, and a rift
 * fragment (whose pole/ω wilson still constructs in stage 1) stays consistent.
 *
 * Purity: one ascending-index O(cells) sweep (fixed FP summation order)
 * accumulating per-plate drag tensors + boundary torques, then an O(plates)
 * closed-form solve + algebraic relaxation. No iterative solver, no I/O, no
 * globals, no input mutation; scratch allocated per call; `sqrt` the only
 * transcendental.
 */

import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  BASAL_DRAG_N_YR_PER_M3,
  COLLISION_DAMP_N_YR_PER_M2,
  CONTINENTAL_DRAG_MULTIPLIER,
  DRAG_TENSOR_REGULARIZATION,
  OMEGA_RELAX_YEARS,
  PLATE_SPEED_CAP_M_PER_YR,
  RIDGE_PUSH_N_PER_M,
  SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR,
  SLAB_PULL_MIN_AGE_YEARS,
  SLAB_SUCTION_FACTOR,
} from '../constants';
import { cellAreaM2, cellCenterTable, neighborTable, type Vec3 } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { computeBoundaryStress, dominantOtherPlate, overrides, pairConsistentTangent } from './boundaries';

// Module-load guard: the semi-implicit relaxation ω⃗=(ω⃗+a·ω⃗*)/(1+a),
// a=dt/OMEGA_RELAX_YEARS, is unconditionally stable for any dt>0 — but only if
// the e-folding time is positive (a≤0 would divide by ≤0 or de-stabilize). A
// non-positive constant is a build-time misconfiguration, not a runtime state.
if (OMEGA_RELAX_YEARS <= 0) {
  throw new Error(
    `plateDynamics: OMEGA_RELAX_YEARS must be > 0 (got ${OMEGA_RELAX_YEARS}) for the semi-implicit relaxation to be stable`,
  );
}

/** Below this |ω⃗| (rad/yr) a plate is treated as at rest: keep its previous
 *  pole direction (normalizing ~0 is undefined) and report zero speed. */
const OMEGA_REST_THRESHOLD_RAD_PER_YR = 1e-18;

/**
 * Solve the 3×3 linear system `m·x = b` by the closed-form adjugate inverse
 * (Cramer / cofactor expansion), no iteration. `m` is row-major length 9.
 * Returns the zero vector for a singular matrix (|det| ≈ 0) — deterministic
 * and safe; the drag-tensor regularization keeps every real per-plate matrix
 * comfortably non-singular. Exported for the exactness invariant test.
 */
export function solve3x3(m: readonly number[], b: Vec3): Vec3 {
  const a00 = m[0]!;
  const a01 = m[1]!;
  const a02 = m[2]!;
  const a10 = m[3]!;
  const a11 = m[4]!;
  const a12 = m[5]!;
  const a20 = m[6]!;
  const a21 = m[7]!;
  const a22 = m[8]!;
  // Cofactors of row 0 (also the first column of the adjugate).
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a12 * a20 - a10 * a22;
  const c02 = a10 * a21 - a11 * a20;
  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (det === 0 || !Number.isFinite(det)) return [0, 0, 0];
  const c10 = a02 * a21 - a01 * a22;
  const c11 = a00 * a22 - a02 * a20;
  const c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11;
  const c21 = a02 * a10 - a00 * a12;
  const c22 = a00 * a11 - a01 * a10;
  const inv = 1 / det;
  return [
    (c00 * b[0] + c10 * b[1] + c20 * b[2]) * inv,
    (c01 * b[0] + c11 * b[1] + c21 * b[2]) * inv,
    (c02 * b[0] + c12 * b[1] + c22 * b[2]) * inv,
  ];
}

/**
 * Linear ramp gating slab pull for young (buoyant) lithosphere: 0 below
 * SLAB_PULL_MIN_AGE_YEARS, rising linearly to 1 at twice that age. Prevents a
 * fresh ridge-flank self-subduction feedback.
 */
export function slabAgeRamp(ageYears: number): number {
  const t = (ageYears - SLAB_PULL_MIN_AGE_YEARS) / SLAB_PULL_MIN_AGE_YEARS;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * The per-step rigid-plate torque balance. Pure function of `state`; see the
 * module header. Returns the state unchanged when the flag is off / pre-onset.
 */
function apply(state: PlanetState, dtYears: number): PlanetState {
  const { params } = state;
  if (!params.forceKinematics || state.timeYears < params.forceKinematicsOnsetYears) {
    return state;
  }

  const N = params.gridN;
  const R = params.radiusMeters;
  const plateId = state.fields.plateId;
  const crustType = state.fields.crustType;
  const crustAge = state.fields.crustAge;
  const boundaryStress = state.fields.boundaryStress;
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const nPlates = state.plates.length;

  // Boundary length per boundary cell (arc width of one cell on a cube face)
  // and equal-area cell area — the geometric weights for forces and drag.
  const cellW = (Math.PI / 2) * (R / N);
  const cellA = cellAreaM2(N, R);

  // Per-plate accumulators. Drag tensor K is symmetric (6 unique entries);
  // torque, net driving force (Vec3) and gross |force| are the tension inputs.
  const kxx = new Float64Array(nPlates);
  const kxy = new Float64Array(nPlates);
  const kxz = new Float64Array(nPlates);
  const kyy = new Float64Array(nPlates);
  const kyz = new Float64Array(nPlates);
  const kzz = new Float64Array(nPlates);
  const tqx = new Float64Array(nPlates);
  const tqy = new Float64Array(nPlates);
  const tqz = new Float64Array(nPlates);
  const netx = new Float64Array(nPlates);
  const nety = new Float64Array(nPlates);
  const netz = new Float64Array(nPlates);
  const gross = new Float64Array(nPlates);
  // Attached down-going slab-pull force per plate (N) — the Forsyth & Uyeda
  // slab-attachment variable the census correlates speed against (#111). Only
  // the subducting side's own pull is summed; slab suction (a drive on the
  // overrider) is excluded by design.
  const slabPull = new Float64Array(nPlates);

  // Pass 1 — one ascending-index sweep. Fixed summation order ⇒ deterministic.
  for (let i = 0; i < plateId.length; i++) {
    const p = plateId[i]!;
    const rx = centers[i * 3]!;
    const ry = centers[i * 3 + 1]!;
    const rz = centers[i * 3 + 2]!;

    // Basal-drag tensor contribution: dragMult·cellA·(I − r̂r̂ᵀ). Continental
    // cells drag CONTINENTAL_DRAG_MULTIPLIER× harder (cratonic keels), so a
    // plate's speed anticorrelates with its continental fraction as a
    // *consequence* of mixed-cell integration, not a rule.
    const w = (crustType[i] === 1 ? CONTINENTAL_DRAG_MULTIPLIER : 1) * cellA;
    kxx[p]! += w * (1 - rx * rx);
    kxy[p]! += w * (-rx * ry);
    kxz[p]! += w * (-rx * rz);
    kyy[p]! += w * (1 - ry * ry);
    kyz[p]! += w * (-ry * rz);
    kzz[p]! += w * (1 - rz * rz);

    const other = dominantOtherPlate(plateId, i, nbTable);
    if (other === null) continue; // interior cell: drag only

    // Pair-consistent unit tangent from i toward the dominant other plate —
    // the same construction computeBoundaryStress used to sign this cell's
    // stress, so û and uN describe the same plate pair (the #55 rule).
    const u = pairConsistentTangent(centers, nbTable, plateId, i, other.plate);
    if (u === null) continue; // pure-shear cell: no normal force
    const uN = boundaryStress[i]!; // PREVIOUS kinematics (one-step lag)

    let fx = 0;
    let fy = 0;
    let fz = 0;
    if (uN < -ACTIVE_MARGIN_STRESS_M_PER_YR) {
      // Divergent: ridge push drives this flank AWAY from the ridge (−û).
      const mag = RIDGE_PUSH_N_PER_M * cellW;
      fx = -u[0] * mag;
      fy = -u[1] * mag;
      fz = -u[2] * mag;
    } else if (uN > ACTIVE_MARGIN_STRESS_M_PER_YR) {
      const myType = crustType[i]!;
      const otherType = crustType[other.cell]!;
      if (myType === 1 && otherType === 1) {
        // Continent–continent collision: pure damping opposing the closing
        // motion (−û). The closing speed feeding the damper is clamped at the
        // plate speed cap so a one-step-lagged stress spike cannot inject a
        // super-physical retarding torque that would REVERSE the plate — the
        // "capped, can stall never reverse" clause of COLLISION_DAMP. With a
        // realistic dt (a = dt/τ ≈ 0.1) the clamp rarely binds; it is the
        // pathological-config guard the §2.4 `min(…, cap)` calls for.
        const dampSpeed = Math.min(uN, PLATE_SPEED_CAP_M_PER_YR);
        const mag = COLLISION_DAMP_N_YR_PER_M2 * dampSpeed * cellW;
        fx = -u[0] * mag;
        fy = -u[1] * mag;
        fz = -u[2] * mag;
      } else if (
        // This side SUBDUCTS iff it does not override its neighbor (velocity-
        // independent polarity). A subducting side is always oceanic
        // (continental crust never loses under overrides(), cont–cont is
        // handled above), so slab pull only ever attaches to oceanic crust.
        !overrides(myType, crustAge[i]!, p, otherType, crustAge[other.cell]!, other.plate)
      ) {
        // crustAge is physically ≥ 0 everywhere; clamp defensively so a stray
        // negative age can never turn √age into NaN and poison the pole.
        const age = Math.max(0, crustAge[i]!);
        const pull =
          SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR * Math.sqrt(age) * slabAgeRamp(age) * cellW;
        // Slab pull drags the subducting plate trench-ward (toward the other
        // plate, +û).
        fx = u[0] * pull;
        fy = u[1] * pull;
        fz = u[2] * pull;
        // Attached-slab diagnostic: sum the pull magnitude on this (subducting)
        // plate. |û|=1 ⇒ |f| = pull. Census correlate; not a physics term.
        slabPull[p]! += pull;
        // Slab suction: a fraction of that pull also drags the OVERRIDING
        // plate trench-ward (from its cell toward this subducting plate),
        // so the margin organizes both plates. Added straight to the
        // overrider's torque — it is a drive on `other`, not part of this
        // cell's tension bookkeeping.
        const uo = pairConsistentTangent(centers, nbTable, plateId, other.cell, p);
        if (uo !== null) {
          const so = SLAB_SUCTION_FACTOR * pull;
          const fox = uo[0] * so;
          const foy = uo[1] * so;
          const foz = uo[2] * so;
          const orx = centers[other.cell * 3]! * R;
          const ory = centers[other.cell * 3 + 1]! * R;
          const orz = centers[other.cell * 3 + 2]! * R;
          tqx[other.plate]! += ory * foz - orz * foy;
          tqy[other.plate]! += orz * fox - orx * foz;
          tqz[other.plate]! += orx * foy - ory * fox;
        }
      }
      // The overriding oceanic/continental side of a subduction margin (the
      // `overrides()`-true branch) receives no direct drive here — its arc/
      // orogeny topography is tectonics' job; its motion comes from slab
      // suction (above) and its own margins elsewhere.
    }

    // Torque about the origin: (R·r̂) × F⃗. Accumulate tension bookkeeping.
    const px = rx * R;
    const py = ry * R;
    const pz = rz * R;
    tqx[p]! += py * fz - pz * fy;
    tqy[p]! += pz * fx - px * fz;
    tqz[p]! += px * fy - py * fx;
    netx[p]! += fx;
    nety[p]! += fy;
    netz[p]! += fz;
    gross[p]! += Math.sqrt(fx * fx + fy * fy + fz * fz);
  }

  // Pass 2 — per-plate closed-form solve + semi-implicit relaxation.
  const a = dtYears / OMEGA_RELAX_YEARS;
  const cdR2 = BASAL_DRAG_N_YR_PER_M3 * R * R;
  const speedCapOmega = PLATE_SPEED_CAP_M_PER_YR / R;

  const plates = state.plates.map((plate, p) => {
    const trK = kxx[p]! + kyy[p]! + kzz[p]!;
    // dead / cell-less plate: kinematics unchanged, no attached slab this step.
    if (trK <= 0) return plate.slabPullN === 0 ? plate : { ...plate, slabPullN: 0 };

    // Regularize the (PSD) drag tensor: add REG·tr(K)/3 to its diagonal so a
    // near-point plate's singular radial spin-axis is pinned deterministically,
    // then scale by c_d·R² into the terminal-velocity matrix.
    const reg = DRAG_TENSOR_REGULARIZATION * (trK / 3);
    const m: number[] = [
      cdR2 * (kxx[p]! + reg),
      cdR2 * kxy[p]!,
      cdR2 * kxz[p]!,
      cdR2 * kxy[p]!,
      cdR2 * (kyy[p]! + reg),
      cdR2 * kyz[p]!,
      cdR2 * kxz[p]!,
      cdR2 * kyz[p]!,
      cdR2 * (kzz[p]! + reg),
    ];
    const omegaStar = solve3x3(m, [tqx[p]!, tqy[p]!, tqz[p]!]);

    // Current ω⃗ from the derived pair (the source of truth every consumer
    // reads): on the first engaged step this is the initial random draw.
    const wPrev = plate.angularVelRadPerYr;
    const k = plate.eulerPole;
    let ox = (wPrev * k[0] + a * omegaStar[0]) / (1 + a);
    let oy = (wPrev * k[1] + a * omegaStar[1]) / (1 + a);
    let oz = (wPrev * k[2] + a * omegaStar[2]) / (1 + a);

    // Speed cap on the characteristic surface speed |ω⃗|·R.
    let mag = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (mag > speedCapOmega) {
      const s = speedCapOmega / mag;
      ox *= s;
      oy *= s;
      oz *= s;
      mag = speedCapOmega;
    }

    const tensionN =
      gross[p]! - Math.sqrt(netx[p]! * netx[p]! + nety[p]! * nety[p]! + netz[p]! * netz[p]!);

    if (mag < OMEGA_REST_THRESHOLD_RAD_PER_YR) {
      // At rest: keep the previous pole direction (can't normalize ~0), zero
      // speed. A revived torque next step lifts it off rest again.
      return {
        ...plate,
        omegaVec: [0, 0, 0] as Vec3,
        angularVelRadPerYr: 0,
        tensionN,
        slabPullN: slabPull[p]!,
      };
    }
    const inv = 1 / mag;
    return {
      ...plate,
      omegaVec: [ox, oy, oz] as Vec3,
      eulerPole: [ox * inv, oy * inv, oz * inv] as Vec3,
      angularVelRadPerYr: mag,
      tensionN,
      slabPullN: slabPull[p]!,
    };
  });

  // Recompute boundaryStress against the updated kinematics (#55): wilson and
  // the rest of this step must never read stress paired with stale poles.
  const next: PlanetState = { ...state, plates };
  return { ...next, fields: { ...next.fields, boundaryStress: computeBoundaryStress(next) } };
}

export const plateDynamicsSystem: System = {
  name: 'plateDynamics',
  apply: (state, dtYears) => apply(state, dtYears),
};
