/**
 * Plate data model and initial partition (Phase 1, issue #12).
 *
 * The grid is partitioned into `params.numPlates` contiguous plates by the
 * spike-#9 winner: seed sites rejection-sampled for minimum angular
 * separation, then simultaneous Dijkstra growth over the 4-neighbor graph
 * with a deterministic per-cell edge-cost jitter (warped-metric Voronoi:
 * organic boundaries, contiguous by construction).
 *
 * Per-plate bookkeeping lives in a fixed-order array on PlanetState.plates —
 * iteration is always by index, never object-key order. Plates are rigid:
 * an Euler pole + angular velocity (assigned from rng.fork('plateKinematics');
 * motion itself starts with the tectonics system in #13).
 */

import { oceanicAgeForDepth, oceanicDepthForAge } from './bathymetry';
import {
  CONTINENTAL_CRUST_FRACTION,
  CONTINENTAL_INITIAL_AGE_YEARS,
  PLATE_FILL_JITTER,
  PLATE_OMEGA_MAX_RAD_PER_YR,
  PLATE_OMEGA_MIN_RAD_PER_YR,
  PLATE_SITE_SEPARATION_FACTOR,
} from './constants';
import { cellCenterDirection, cellCount, neighbors, type Vec3 } from './grid';
import { hash2, hashString } from './hash';
import { TriHeap } from './heap';
import { createRng, type Rng } from './rng';
import type { PlanetState } from './state';
import { angleBetween } from './vec';

/** Per-plate record. Fixed order by plate index; plateId field values point here. */
export interface PlateRecord {
  /** Unit rotation axis (Euler pole). */
  eulerPole: Vec3;
  /** Signed angular speed about the pole, rad/yr. */
  angularVelRadPerYr: number;
  /**
   * Rotation accumulated since this plate last advected, radians. Advection
   * (#13) applies it in whole quanta of one cell width and resets it.
   */
  accumulatedRadians: number;
  /**
   * Number of advection events this plate has undergone. Drives the
   * deterministic dither of the advection quantum: with a FIXED quantum,
   * cells rotating slower than the quantum (near the Euler pole) see the
   * same sub-cell rounding every event and systematically stall (found by
   * the #13 blob-transport test). Varying the quantum per event decorrelates
   * the rounding phase, so mean motion is preserved at every latitude.
   */
  advectionCount: number;
  /** Simulation time this plate came into existence (0 = initial partition). */
  createdAtYears: number;
  /**
   * Simulation time before which this plate may not suture, yr (#57 follow-up).
   * A rift stamps both halves with now + RIFT_SUTURE_COOLDOWN_YEARS so a fresh
   * passive margin can't immediately re-collide; 0 for primordial plates, which
   * are free to suture from the start. See the suture scan in wilson.ts.
   */
  sutureLockUntilYears: number;
  /** Fraction of the plate's cells that were continental at creation (diagnostic). */
  continentalFraction: number;
  /** Dead plates (consumed by suturing, #18) keep their slot so ids stay stable. */
  alive: boolean;
  /**
   * ω⃗ in rad/yr — the plate's angular-velocity vector and THE kinematic state
   * under `forceKinematics` (Tectonics V2 stage 1, #111, proposal §2.2). The
   * `plateDynamics` system relaxes it toward a boundary-integrated torque
   * balance each step and then derives `eulerPole`/`angularVelRadPerYr` from
   * it, so every existing consumer is unchanged. All-zero on the default
   * (flag-off) path — the drawn `eulerPole`/`angularVelRadPerYr` remain the
   * permanent kinematics and nothing reads `omegaVec`. */
  omegaVec: Vec3;
  /**
   * Diagnostic: gross − |net| boundary driving force on the plate, N — the
   * scalar `tensionRift` (stage 3) will convert into a rift hazard. 0 flag-off
   * and until `plateDynamics` writes it. */
  tensionN: number;
  /**
   * `emergentSuture` (stage 2) memory: sim time at which the plate's current
   * stalled continental contact began, yr (0 = not currently stalled). 0
   * flag-off and until stage 2 writes it. */
  stallSinceYears: number;
  /**
   * `tensionRift` (stage 3) memory: accumulated supercontinent thermal-blanket
   * age, yr. 0 flag-off and until stage 3 writes it. */
  blanketYears: number;
  /**
   * Previous census step's Euler pole, for the `poleStability` diagnostic
   * (Tectonics V2 stage 0, #110). Set ONLY by `plateCensusSystem` when
   * `params.plateCensus` is on; `undefined` on every plate otherwise, so the
   * census toggle never perturbs the plate table on the default path (goldens
   * hash fields, not plates, but this keeps the records byte-identical too).
   * Not stochastic, not read by any physics — pure diagnostic memory. */
  prevEulerPole?: Vec3;
}

/** Rigid-rotation surface velocity of a plate at unit position `pos`, m/yr. */
export function plateVelocityAt(plate: PlateRecord, pos: Vec3, radiusMeters: number): Vec3 {
  const w = plate.angularVelRadPerYr;
  const k = plate.eulerPole;
  // v = ω k × (R·pos)
  return [
    w * (k[1] * pos[2] - k[2] * pos[1]) * radiusMeters,
    w * (k[2] * pos[0] - k[0] * pos[2]) * radiusMeters,
    w * (k[0] * pos[1] - k[1] * pos[0]) * radiusMeters,
  ];
}

/**
 * Voronoi-style flood-fill partition (spike #9 winner). Pure function of
 * (rng stream, jitterSeed, numPlates, N); returns a plateId per cell.
 */
export function partitionPlates(
  rng: Rng,
  jitterSeed: number,
  numPlates: number,
  N: number,
): Float32Array {
  const count = cellCount(N);
  let minSep = PLATE_SITE_SEPARATION_FACTOR * Math.sqrt((4 * Math.PI) / numPlates);

  const siteDirs: Vec3[] = [];
  const sites: number[] = [];
  while (sites.length < numPlates) {
    let placed = false;
    for (let attempt = 0; attempt < 64 && !placed; attempt++) {
      const candidate = rng.nextInt(count);
      const dir = cellCenterDirection(candidate, N);
      if (siteDirs.every((s) => angleBetween(s, dir) >= minSep)) {
        sites.push(candidate);
        siteDirs.push(dir);
        placed = true;
      }
    }
    // Deterministic relaxation keeps termination guaranteed on tiny grids.
    if (!placed) minSep *= 0.85;
  }

  const plateId = new Float32Array(count).fill(-1);
  const heap = new TriHeap();
  for (let p = 0; p < numPlates; p++) heap.push(0, sites[p]!, p);

  let assigned = 0;
  while (assigned < count && heap.size > 0) {
    const [cost, cell, plate] = heap.pop();
    if (plateId[cell] !== -1) continue;
    plateId[cell] = plate;
    assigned++;
    for (const nb of neighbors(cell, N)) {
      if (plateId[nb] === -1) {
        const stepCost = 1 + PLATE_FILL_JITTER * (hash2(jitterSeed, nb, 0) / 4294967296);
        heap.push(cost + stepCost, nb, plate);
      }
    }
  }
  if (assigned !== count) {
    // Unreachable on a connected grid; a hole here would corrupt every
    // downstream invariant, so fail loudly rather than return a partial fill.
    throw new Error(`plates: partition left ${count - assigned} cells unassigned`);
  }
  return plateId;
}

/** Uniform random unit vector (2 draws: z uniform in [-1,1], azimuth uniform). */
function randomUnitVec(rng: Rng): Vec3 {
  const z = 2 * rng.next() - 1;
  const phi = 2 * Math.PI * rng.next();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(phi), z, r * Math.sin(phi)];
}

/**
 * Initial plate assignment, run once inside createInitialState after the
 * terrain pass: fills plateId (partition) and crustType (elevation quantile
 * at CONTINENTAL_CRUST_FRACTION — continental crust includes submerged
 * shelves, so the threshold sits below sea level), and builds the plate
 * table with kinematics.
 */
export function applyInitialPlates(state: PlanetState): PlanetState {
  const { params } = state;
  const count = cellCount(params.gridN);
  const numPlates = params.numPlates;

  const plateId = partitionPlates(
    createRng(params.seed).fork('plates'),
    hash2(params.seed >>> 0, hashString('plateJitter'), 0),
    numPlates,
    params.gridN,
  );

  // Continental crust = the highest CONTINENTAL_CRUST_FRACTION of initial
  // elevation. Exact quantile, same technique as the terrain sea level.
  const elevation = state.fields.elevation;
  const sorted = elevation.slice().sort();
  const thresholdIndex = Math.min(count - 1, Math.floor(count * (1 - CONTINENTAL_CRUST_FRACTION)));
  const threshold = sorted[thresholdIndex]!;
  const crustType = new Float32Array(count);
  const continentalCells = new Array<number>(numPlates).fill(0);
  const plateCells = new Array<number>(numPlates).fill(0);
  // Oceanic crust gets an age consistent with its depth (inverted half-space
  // cooling curve) and its elevation snapped onto that curve, so t=0 already
  // obeys the #15 bathymetry law (no visual jump at the first step). Only
  // the shallow-oceanic band moves (down to ridge depth); coastlines are
  // continental crust and are untouched, so landFraction is unaffected.
  const crustAge = new Float32Array(count);
  const newElevation = elevation.slice();
  for (let i = 0; i < count; i++) {
    const continental = elevation[i]! >= threshold ? 1 : 0;
    crustType[i] = continental;
    if (continental === 1) {
      crustAge[i] = CONTINENTAL_INITIAL_AGE_YEARS;
    } else {
      const age = oceanicAgeForDepth(elevation[i]!);
      crustAge[i] = age;
      newElevation[i] = oceanicDepthForAge(age);
    }
    const p = plateId[i]!;
    plateCells[p]!++;
    continentalCells[p]! += continental;
  }

  const kinematics = createRng(params.seed).fork('plateKinematics');
  const plates: PlateRecord[] = [];
  for (let p = 0; p < numPlates; p++) {
    const eulerPole = randomUnitVec(kinematics);
    const omega =
      PLATE_OMEGA_MIN_RAD_PER_YR +
      kinematics.next() * (PLATE_OMEGA_MAX_RAD_PER_YR - PLATE_OMEGA_MIN_RAD_PER_YR);
    plates.push({
      eulerPole,
      angularVelRadPerYr: omega,
      accumulatedRadians: 0,
      advectionCount: 0,
      createdAtYears: 0,
      sutureLockUntilYears: 0,
      continentalFraction: continentalCells[p]! / plateCells[p]!,
      alive: true,
      // Force-balance kinematics state (#111): zero flag-off, so the drawn
      // eulerPole/omega above stay the permanent kinematics.
      omegaVec: [0, 0, 0],
      tensionN: 0,
      stallSinceYears: 0,
      blanketYears: 0,
    });
  }

  return {
    ...state,
    plates,
    fields: { ...state.fields, plateId, crustType, crustAge, elevation: newElevation },
  };
}
