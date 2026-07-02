/**
 * Tectonics system (Phase 1): rigid Euler-pole plate motion with
 * semi-Lagrangian gather advection — the spike-#10 winner.
 *
 * Each step accumulates every live plate's rotation. When a plate's
 * accumulated angle crosses one cell's angular width ((π/2)/N), an advection
 * event fires: every accumulated-past-threshold plate rotates by its FULL
 * accumulated angle (no sub-cell remainder is ever discarded) and resets.
 *
 * At an event, each cell collects claims:
 *   - a moved plate p claims cell i iff p owned the backward-rotated source
 *     cell of i (interiors are exact by construction — an interior cell's
 *     source is interior to the same plate);
 *   - an unmoved plate claims exactly its current cells.
 * Resolution (#13 provisional, replaced by density rules in #16): moved
 * claims beat static claims, then lower plate index. Crust properties
 * (elevation, crustAge, crustType) travel with the winning claim's source.
 * Unclaimed cells are divergent gaps, repaired deterministically by
 * majority-of-assigned-neighbors and filled as provisional young ocean crust
 * (#15 turns this into real ridge bathymetry).
 */

import { OCEAN_RIDGE_DEPTH_M } from '../constants';
import { cellCenterTable, cellCount, directionToIndex, neighborTable, type Vec3 } from '../grid';
import { hash2, hashString } from '../hash';
import type { PlateRecord } from '../plates';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { rotateAroundAxis } from '../vec';

/**
 * The advection quantum for a plate's next event: between 1 and 2.5 cell
 * widths, dithered deterministically per (seed, plate, event count). A fixed
 * quantum makes cells that rotate slower than it (near the Euler pole) hit
 * the same sub-cell rounding at every event — they stall systematically.
 * Varying the quantum sweeps the rounding phase, so realized motion is
 * unbiased at every latitude (residual wobble ~0.5 cell random walk, the
 * accepted spike-#10 limitation).
 */
const QUANTUM_DITHER_RANGE = 1.5;

function advectionQuantum(seed: number, plate: number, eventCount: number, thetaMin: number): number {
  const h01 = hash2(hash2(seed >>> 0, hashString('advectionDither'), 0), plate, eventCount) / 4294967296;
  return thetaMin * (1 + QUANTUM_DITHER_RANGE * h01);
}

/** Crust fields transported with plate motion (see ARCHITECTURE.md). */
const ADVECTED_FIELDS = ['elevation', 'crustAge', 'crustType'] as const;

export const tectonicsSystem: System = {
  name: 'tectonics',
  apply: applyTectonics,
};

function applyTectonics(state: PlanetState, dtYears: number): PlanetState {
  const N = state.params.gridN;
  const thetaMin = Math.PI / 2 / N;

  // Accumulate rotation; collect plates crossing their dithered quantum.
  const accumulated = state.plates.map((p) =>
    p.alive ? p.accumulatedRadians + p.angularVelRadPerYr * dtYears : 0,
  );
  const moving: number[] = [];
  for (let p = 0; p < accumulated.length; p++) {
    const plate = state.plates[p]!;
    if (!plate.alive) continue;
    const quantum = advectionQuantum(state.params.seed, p, plate.advectionCount, thetaMin);
    if (Math.abs(accumulated[p]!) >= quantum) moving.push(p);
  }

  if (moving.length === 0) {
    return {
      ...state,
      plates: state.plates.map((p, i) => ({ ...p, accumulatedRadians: accumulated[i]! })),
    };
  }

  const next = advect(state, accumulated, moving);
  return {
    ...next,
    plates: state.plates.map((p, i) =>
      moving.includes(i)
        ? { ...p, accumulatedRadians: 0, advectionCount: p.advectionCount + 1 }
        : { ...p, accumulatedRadians: accumulated[i]! },
    ),
  };
}

function advect(
  state: PlanetState,
  accumulated: readonly number[],
  moving: readonly number[],
): PlanetState {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const oldPlate = state.fields.plateId;

  const movingSet = new Uint8Array(state.plates.length);
  for (const p of moving) movingSet[p] = 1;

  const newFields = {
    plateId: new Float32Array(count).fill(-1),
    elevation: new Float32Array(count),
    crustAge: new Float32Array(count),
    crustType: new Float32Array(count),
  };
  const old = {
    elevation: state.fields.elevation,
    crustAge: state.fields.crustAge,
    crustType: state.fields.crustType,
  };

  // Claims + resolution. Precedence: moved plates (ascending index) beat the
  // static owner. #16 replaces this with subduction density rules.
  const dir: Vec3 = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    let chosenSrc = -1;
    dir[0] = centers[i * 3]!;
    dir[1] = centers[i * 3 + 1]!;
    dir[2] = centers[i * 3 + 2]!;
    for (const p of moving) {
      const src = directionToIndex(
        rotateAroundAxis(dir, state.plates[p]!.eulerPole, -accumulated[p]!),
        N,
      );
      if (oldPlate[src] === p) {
        chosenSrc = src;
        newFields.plateId[i] = p;
        break;
      }
    }
    if (chosenSrc === -1) {
      const owner = oldPlate[i]!;
      if (!movingSet[owner]) {
        chosenSrc = i;
        newFields.plateId[i] = owner;
      }
    }
    if (chosenSrc !== -1) {
      for (const f of ADVECTED_FIELDS) newFields[f][i] = old[f][chosenSrc]!;
    }
  }

  // Divergent gap repair: deterministic multi-pass majority-of-assigned-
  // neighbors (ties toward the lower plate id), filled as provisional young
  // ocean crust at ridge depth. Decisions are computed from the pre-pass
  // state and applied together, so fill order cannot leak into the result.
  for (;;) {
    const fills: number[] = [];
    const owners: number[] = [];
    for (let i = 0; i < count; i++) {
      if (newFields.plateId[i] !== -1) continue;
      let bestPlate = -1;
      let bestVotes = 0;
      // 4 neighbors: count votes per owner via a tiny fixed scan.
      const candidates = [
        newFields.plateId[nbTable[i * 4]!]!,
        newFields.plateId[nbTable[i * 4 + 1]!]!,
        newFields.plateId[nbTable[i * 4 + 2]!]!,
        newFields.plateId[nbTable[i * 4 + 3]!]!,
      ];
      for (const c of candidates) {
        if (c === -1) continue;
        let votes = 0;
        for (const d of candidates) if (d === c) votes++;
        if (votes > bestVotes || (votes === bestVotes && c < bestPlate)) {
          bestVotes = votes;
          bestPlate = c;
        }
      }
      if (bestPlate !== -1) {
        fills.push(i);
        owners.push(bestPlate);
      }
    }
    if (fills.length === 0) break;
    for (let k = 0; k < fills.length; k++) {
      const i = fills[k]!;
      newFields.plateId[i] = owners[k]!;
      newFields.elevation[i] = OCEAN_RIDGE_DEPTH_M;
      newFields.crustAge[i] = 0;
      newFields.crustType[i] = 0;
    }
  }

  // Land fraction is diagnostic; refresh it whenever elevation moved.
  let land = 0;
  for (const e of newFields.elevation) if (e >= 0) land++;

  return {
    ...state,
    globals: { ...state.globals, landFraction: land / count },
    fields: { ...state.fields, ...newFields },
  };
}

/** Surface velocity of plate `plate` at unit position `pos`, m/yr. */
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
