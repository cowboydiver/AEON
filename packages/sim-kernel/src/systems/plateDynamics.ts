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
 *     the closing motion: it can stall a collision and, under a one-step-lagged
 *     stress spike, transiently overshoot the stall by a hair (the review
 *     measured ≲0.1 mm/yr, TECTONICS_V2_REVIEW_FINDINGS §2), but the speed cap
 *     bars a super-physical reversal and it never drives a *sustained* reversal;
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
 * The updated ω⃗ is stored as `eulerPole`/`angularVelRadPerYr` (its unit
 * direction and |ω⃗|), the single source of truth every existing consumer —
 * advection, `computeBoundaryStress`, `plateVelocityAt`, the wilson stats,
 * `emergentSuture`'s merge blend — already reads. The current ω⃗ fed into the
 * relaxation is likewise reconstructed from that pair (`angularVelRadPerYr·
 * eulerPole`): on the first engaged step that is the initial random draw, so the
 * drawn kinematics act as the ~3τ symmetry-breaking transient (§2.5) rather than
 * being discarded, and a rift fragment (whose pole/ω wilson constructs in stage
 * 1) stays consistent. (The redundant write-only `omegaVec` mirror was dropped
 * in #127 item 8 — nothing ever read its value.)
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

/** Six unique entries of a symmetric 3×3 tensor, row-major upper triangle:
 *  [xx, xy, xz, yy, yz, zz]. */
export type SymTensor3 = readonly [number, number, number, number, number, number];

/**
 * Plate p's basal-drag tensor K_p = Σ_{cells∈p} dragMult·cellA·(I − r̂r̂ᵀ) — the
 * exact per-plate accumulation the force balance builds inline in `apply`'s
 * pass 1 (continental cells drag CONTINENTAL_DRAG_MULTIPLIER× harder for their
 * cratonic keels). Standalone here so `emergentSuture` (#112) can weight two
 * merging plates' ω⃗ by the same drag geometry without touching the force
 * balance's fixed summation order. The scalar c_d·R² that pass 2 multiplies
 * onto K cancels in the merge blend (it multiplies both sides of the solve), so
 * it is omitted here. O(cells), ascending index ⇒ deterministic.
 */
export function plateDragTensor(state: PlanetState, p: number): SymTensor3 {
  const R = state.params.radiusMeters;
  const cellA = cellAreaM2(state.params.gridN, R);
  const centers = cellCenterTable(state.params.gridN);
  const { plateId, crustType } = state.fields;
  let kxx = 0;
  let kxy = 0;
  let kxz = 0;
  let kyy = 0;
  let kyz = 0;
  let kzz = 0;
  for (let i = 0; i < plateId.length; i++) {
    if (plateId[i] !== p) continue;
    const rx = centers[i * 3]!;
    const ry = centers[i * 3 + 1]!;
    const rz = centers[i * 3 + 2]!;
    const w = (crustType[i] === 1 ? CONTINENTAL_DRAG_MULTIPLIER : 1) * cellA;
    kxx += w * (1 - rx * rx);
    kxy += w * (-rx * ry);
    kxz += w * (-rx * rz);
    kyy += w * (1 - ry * ry);
    kyz += w * (-ry * rz);
    kzz += w * (1 - rz * rz);
  }
  return [kxx, kxy, kxz, kyy, kyz, kzz];
}

/**
 * Drag-tensor-weighted blend of two plates' angular-velocity vectors (#112,
 * proposal §2.4): ω⃗ = (K_a+K_b)⁻¹(K_a·ω⃗_a + K_b·ω⃗_b). This is the exact fixed
 * point the merged plate relaxes to when each input plate already sits at its
 * own force-balance fixed point (ω⃗_p = (c_d R² K_p)⁻¹ τ_p): the summed torque
 * is τ_a+τ_b = c_d R² (K_a ω⃗_a + K_b ω⃗_b), and the merged plate's fixed point
 * is (c_d R² K_total)⁻¹(τ_a+τ_b) = this blend (the c_d R² cancels). Degrades to
 * the drag-area-weighted mean when K_a ∝ K_b (co-located plates). Falls back to
 * the trace-weighted mean if the summed tensor is singular (a degenerate
 * near-point plate) so a merge can never emit NaN.
 */
export function kWeightedOmega(
  ka: SymTensor3,
  wa: Vec3,
  kb: SymTensor3,
  wb: Vec3,
): Vec3 {
  const s0 = ka[0] + kb[0];
  const s1 = ka[1] + kb[1];
  const s2 = ka[2] + kb[2];
  const s3 = ka[3] + kb[3];
  const s4 = ka[4] + kb[4];
  const s5 = ka[5] + kb[5];
  // rhs = K_a·ω⃗_a + K_b·ω⃗_b (each K applied as a symmetric matrix).
  const rhs: Vec3 = [
    ka[0] * wa[0] + ka[1] * wa[1] + ka[2] * wa[2] + kb[0] * wb[0] + kb[1] * wb[1] + kb[2] * wb[2],
    ka[1] * wa[0] + ka[3] * wa[1] + ka[4] * wa[2] + kb[1] * wb[0] + kb[3] * wb[1] + kb[4] * wb[2],
    ka[2] * wa[0] + ka[4] * wa[1] + ka[5] * wa[2] + kb[2] * wb[0] + kb[4] * wb[1] + kb[5] * wb[2],
  ];
  // det of the summed symmetric tensor [s0 s1 s2; s1 s3 s4; s2 s4 s5].
  const c00 = s3 * s5 - s4 * s4;
  const c01 = s4 * s2 - s1 * s5;
  const c02 = s1 * s4 - s3 * s2;
  const det = s0 * c00 + s1 * c01 + s2 * c02;
  const trace = s0 + s3 + s5;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6 * trace * trace * trace) {
    // Singular / degenerate: trace-weighted mean of the two ω⃗ (K_p ≈ tr(K_p)/3·I
    // for a near-isotropic plate) — the drag-area-weighted mean (tr(K) ∝ Σ
    // dragMult·cellA), NOT the legacy cell-count-weighted merge mean; the two
    // coincide only when both plates are uniform single-crust.
    const ta = ka[0] + ka[3] + ka[5];
    const tb = kb[0] + kb[3] + kb[5];
    const tt = ta + tb;
    if (tt <= 0) return [0, 0, 0];
    return [
      (ta * wa[0] + tb * wb[0]) / tt,
      (ta * wa[1] + tb * wb[1]) / tt,
      (ta * wa[2] + tb * wb[2]) / tt,
    ];
  }
  return solve3x3([s0, s1, s2, s1, s3, s4, s2, s4, s5], rhs);
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
  // NOTE (#127 item 8b): this is a FIXED per-cell edge length, orientation-
  // blind. A staircased diagonal margin has ~√2× as many boundary cells per
  // unit of true geodesic boundary length as an axis-aligned one, so each 45°
  // margin accrues ~√2× the total force-length — a known cube-sphere staircase
  // anisotropy. The force calibration (SLAB_PULL_COEF/RIDGE_PUSH/COLLISION_DAMP)
  // was tuned against this actual discretized geometry, so it is absorbed into
  // the constants; a true fix (weighting cellW by a per-cell boundary-normal
  // estimate) is disproportionate to the bounded √2 effect. Documented, not
  // fixed (review §2, TECTONICS_V2_REVIEW_FINDINGS §7).
  const cellW = (Math.PI / 2) * (R / N);
  const cellA = cellAreaM2(N, R);

  // Per-plate accumulators. Drag tensor K is symmetric (6 unique entries);
  // torque is the full driving torque. The tension bookkeeping (pullNet Vec3 +
  // pullGross scalar) sums ONLY the pull-class forces — slab pull on the
  // subducting side and slab suction on the overriding side, the two trench-pull
  // drives — so tensionN measures opposed pull, not opposed compression (#127
  // item 2.1 / TECTONICS_V2_REVIEW_FINDINGS §2.1). Ridge push and continental
  // collision damping (compression-side) are excluded.
  const kxx = new Float64Array(nPlates);
  const kxy = new Float64Array(nPlates);
  const kxz = new Float64Array(nPlates);
  const kyy = new Float64Array(nPlates);
  const kyz = new Float64Array(nPlates);
  const kzz = new Float64Array(nPlates);
  const tqx = new Float64Array(nPlates);
  const tqy = new Float64Array(nPlates);
  const tqz = new Float64Array(nPlates);
  const pullNetX = new Float64Array(nPlates);
  const pullNetY = new Float64Array(nPlates);
  const pullNetZ = new Float64Array(nPlates);
  const pullGross = new Float64Array(nPlates);
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
        // super-physical retarding torque — the "capped, can stall, at most a
        // ≲0.1 mm/yr transient overshoot, never a sustained reversal" clause of
        // COLLISION_DAMP (review §2 measured the overshoot). With a realistic dt
        // (a = dt/τ ≈ 0.1) the clamp rarely binds; it is the pathological-config
        // guard the §2.4 `min(…, cap)` calls for.
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
        // NOTE (#127 item 8a, verified): √age has NO old-age saturation, so the
        // oldest subducting slabs are super-calibrated. Measured over a seed-42
        // 2.5 Gyr default run, the age of cells where this branch fires is P50 40
        // / P90 141 / P99 389 Myr with a max ~4.5 Gyr (deep ocean basins that
        // never rode a ridge to subduction) — the top decile exceeds the ~100
        // Myr calibration point, giving up to ~6.7× the 100-Myr pull at the tail.
        // Real slabs saturate (half-space √age holds only to the plate-model
        // thickness, ~tens of Myr). The consequence is bounded here by the plate
        // speed cap and the stage-5 world measures healthy (speed median ~6
        // cm/yr, no runaway), so a saturation clamp (min(√age, √~100 Myr)) is a
        // deferred physics refinement — a force-balance change needing its own
        // golden regen + acceptance grid, out of scope for the item-8 hygiene
        // pass. See TECTONICS_V2_REVIEW_FINDINGS §7.
        const pull =
          SLAB_PULL_COEF_N_PER_M_PER_SQRT_YR * Math.sqrt(age) * slabAgeRamp(age) * cellW;
        // Slab pull drags the subducting plate trench-ward (toward the other
        // plate, +û).
        fx = u[0] * pull;
        fy = u[1] * pull;
        fz = u[2] * pull;
        // Pull-class tension bookkeeping (#127 item 2.1): slab pull stretches
        // the subducting plate's interior (it drags the plate trench-ward).
        // Accumulate its vector (pullNet) and magnitude (pullGross, = pull since
        // |û|=1) so tensionN = pullGross − |pullNet| reads the OPPOSED pull —
        // large only when a plate is girdled by subduction pulling it in
        // conflicting directions. Ridge push and continental collision damping
        // (both compression-side) are deliberately excluded, so an actively
        // colliding plate no longer reads as "being pulled apart". (Slab suction
        // adds the overrider's share of the same trench pull, below.)
        pullGross[p]! += pull;
        pullNetX[p]! += fx;
        pullNetY[p]! += fy;
        pullNetZ[p]! += fz;
        // Attached-slab diagnostic: sum the pull magnitude on this (subducting)
        // plate. |û|=1 ⇒ |f| = pull. Census correlate; not a physics term.
        slabPull[p]! += pull;
        // Slab suction: a fraction of that pull also drags the OVERRIDING
        // plate trench-ward (from its cell toward this subducting plate),
        // so the margin organizes both plates. Added to the overrider's torque
        // AND (below) its pull-class tension bookkeeping.
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
          // Suction is pull-class too: it drags the OVERRIDER trench-ward, so a
          // large overriding continent girdled by subduction accrues radially-
          // opposed suction — the physical supercontinent-breakup driver. Feed
          // it into the overrider's tension bookkeeping (|uo|=1 ⇒ |f| = so).
          // Without this a swallowing plate loses its own slab-pull tension as it
          // grows (fewer of its OWN margins subduct) and monopoly-locks at coarse
          // grid; the old sign-blind sum masked this with collision-damping tension.
          pullGross[other.plate]! += so;
          pullNetX[other.plate]! += fox;
          pullNetY[other.plate]! += foy;
          pullNetZ[other.plate]! += foz;
        }
      }
      // The overriding oceanic/continental side of a subduction margin (the
      // `overrides()`-true branch) receives no direct drive here — its arc/
      // orogeny topography is tectonics' job; its motion comes from slab
      // suction (above) and its own margins elsewhere.
    }

    // Torque about the origin: (R·r̂) × F⃗ — every force class drives the plate.
    // (Pull-class tension bookkeeping — slab pull + suction — lives above.)
    const px = rx * R;
    const py = ry * R;
    const pz = rz * R;
    tqx[p]! += py * fz - pz * fy;
    tqy[p]! += pz * fx - px * fz;
    tqz[p]! += px * fy - py * fx;
  }

  // Pass 2 — per-plate closed-form solve + semi-implicit relaxation.
  const a = dtYears / OMEGA_RELAX_YEARS;
  const cdR2 = BASAL_DRAG_N_YR_PER_M3 * R * R;
  const speedCapOmega = PLATE_SPEED_CAP_M_PER_YR / R;

  const plates = state.plates.map((plate, p) => {
    const trK = kxx[p]! + kyy[p]! + kzz[p]!;
    // Dead / cell-less plate: kinematics unchanged, and it owns no boundary this
    // step, so its force diagnostics are stale — clear slabPullN AND tensionN so
    // a retired plate doesn't carry a phantom attached slab / tension (#127 item
    // 8). Same reference back when already clean.
    if (trK <= 0) {
      return plate.slabPullN === 0 && plate.tensionN === 0
        ? plate
        : { ...plate, slabPullN: 0, tensionN: 0 };
    }

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
      pullGross[p]! -
      Math.sqrt(
        pullNetX[p]! * pullNetX[p]! + pullNetY[p]! * pullNetY[p]! + pullNetZ[p]! * pullNetZ[p]!,
      );

    if (mag < OMEGA_REST_THRESHOLD_RAD_PER_YR) {
      // At rest: keep the previous pole direction (can't normalize ~0), zero
      // speed. A revived torque next step lifts it off rest again.
      return {
        ...plate,
        angularVelRadPerYr: 0,
        tensionN,
        slabPullN: slabPull[p]!,
      };
    }
    const inv = 1 / mag;
    return {
      ...plate,
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
