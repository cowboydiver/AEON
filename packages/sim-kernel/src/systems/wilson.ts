/**
 * Wilson cycles (#18): plate reorganization so deep time tells a story.
 *
 * SUTURING — when two plates have been in continent-continent convergent
 * contact (≥ SUTURE_MIN_CONTACT_CELLS boundary cells with positive stress
 * and continental crust on both sides) continuously for SUTURE_AFTER_YEARS,
 * they merge: the smaller is absorbed into the larger, the combined plate
 * gets the area-weighted mean angular-velocity vector, and relative motion
 * across the old boundary drops to zero — collision stops consuming
 * continent and the orogen becomes an interior mountain belt that erosion
 * ages. This is also what halts the continental-area bleed measured in #19
 * integration runs (fixed plate speeds would otherwise grind colliding
 * continents away forever).
 *
 * RIFTING — a live plate that is old (age since creation/last rift), large,
 * and sufficiently continental rifts with a fixed probability per Myr. The
 * decision draw is `hash3(seed', plate, timeQuantum)` — deterministic and
 * independent of any other system's PRNG consumption (documented deviation
 * from the issue's rng.fork sketch: a fork taken inside a pure system would
 * restart its stream every step). The plate splits by two-seed jittered
 * Dijkstra (most-distant seed pair, same machinery as the #9 partition);
 * the halves get opposite rotations about the pole normal to both centroids,
 * so they separate and a new ocean opens along the rift.
 *
 * Both directions emit events (plateSuture / plateRift) and respect the
 * MIN_PLATES / MAX_PLATES live-count bounds. At most one suture and one
 * rift fire per step (deterministic first-eligible order), which keeps each
 * reorganization reviewable in the event log.
 */

import {
  MAX_PLATES,
  MIN_PLATES,
  PLATE_FILL_JITTER,
  PLATE_OMEGA_MAX_RAD_PER_YR,
  PLATE_OMEGA_MIN_RAD_PER_YR,
  RIFT_DRAW_QUANTUM_YEARS,
  RIFT_MIN_AGE_YEARS,
  RIFT_MIN_AREA_FRACTION,
  RIFT_MIN_CONTINENTAL_AREA_FRACTION,
  RIFT_PROBABILITY_PER_MYR,
  SUTURE_AFTER_YEARS,
  SUTURE_MIN_CONTACT_CELLS,
  ACTIVE_MARGIN_STRESS_M_PER_YR,
} from '../constants';
import { EVENT_KINDS, type SimEvent } from '../events';
import { cellCenterTable, cellCount, neighborTable, type Vec3 } from '../grid';
import { hash2, hash3, hashString } from '../hash';
import { TriHeap } from '../heap';
import type { PlateRecord } from '../plates';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { cross3, normalize3, perpendicular3 } from '../vec';
import { computeBoundaryStress } from './boundaries';

export const wilsonSystem: System = {
  name: 'wilson',
  apply: applyWilson,
};

interface PlateStats {
  cells: number;
  continental: number;
}

function applyWilson(state: PlanetState, dtYears: number): PlanetState {
  const N = state.params.gridN;
  const count = cellCount(N);
  const { plateId, crustType, boundaryStress } = state.fields;
  const nbTable = neighborTable(N);

  // Per-plate area/composition, one pass.
  const stats: PlateStats[] = state.plates.map(() => ({ cells: 0, continental: 0 }));
  for (let i = 0; i < count; i++) {
    const s = stats[plateId[i]!]!;
    s.cells++;
    s.continental += crustType[i]!;
  }
  const liveCount = state.plates.filter((p) => p.alive).length;

  // --- Contact scan: continent-continent convergent boundary cells per pair.
  const pairContact = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    if (boundaryStress[i]! <= ACTIVE_MARGIN_STRESS_M_PER_YR || crustType[i] !== 1) continue;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[i * 4 + k]!;
      const q = plateId[nb]!;
      if (q === plateId[i] || crustType[nb] !== 1) continue;
      const a = Math.min(plateId[i]!, q);
      const b = Math.max(plateId[i]!, q);
      const key = `${a}-${b}`;
      pairContact.set(key, (pairContact.get(key) ?? 0) + 1);
      break; // count each cell once
    }
  }

  // Rebuild contactSince from live contacts only (insertion via sorted keys —
  // the record is never iterated for physics, but keep it canonical anyway).
  const contactSince: Record<string, number> = {};
  const sortedKeys = [...pairContact.keys()].sort();
  for (const key of sortedKeys) {
    if (pairContact.get(key)! >= SUTURE_MIN_CONTACT_CELLS) {
      contactSince[key] = state.wilson.contactSince[key] ?? state.timeYears;
    }
  }

  let next: PlanetState = { ...state, wilson: { contactSince } };
  let reorganized = false;

  // --- Suture: first pair (sorted key order) in contact long enough.
  if (liveCount > MIN_PLATES) {
    for (const key of sortedKeys) {
      if (contactSince[key] === undefined) continue;
      if (state.timeYears - contactSince[key] < SUTURE_AFTER_YEARS) continue;
      const [a, b] = key.split('-').map(Number) as [number, number];
      const merged = suture(next, stats, a, b);
      next = merged.state;
      reorganized = true;
      // Keep stats consistent with the post-suture partition, so the rift
      // eligibility below judges the merged plate at its real size.
      stats[merged.winner]!.cells += stats[merged.loser]!.cells;
      stats[merged.winner]!.continental += stats[merged.loser]!.continental;
      stats[merged.loser] = { cells: 0, continental: 0 };
      break;
    }
  }

  // --- Rift: first eligible plate whose hash draw fires this step.
  const liveAfter = next.plates.filter((p) => p.alive).length;
  if (liveAfter < MAX_PLATES) {
    const riftSeed = hash2(state.params.seed >>> 0, hashString('wilsonRift'), 0);
    // min() keeps the hash input unique per step even below the nominal
    // quantum; identical to a fixed 10 kyr quantum for all dt >= 10 kyr.
    const timeQuantum = Math.round(state.timeYears / Math.min(RIFT_DRAW_QUANTUM_YEARS, dtYears));
    const pRift = RIFT_PROBABILITY_PER_MYR * (dtYears / 1e6);
    for (let p = 0; p < next.plates.length; p++) {
      const plate = next.plates[p]!;
      const s = stats[p];
      if (!plate.alive || !s || s.cells === 0) continue;
      if (state.timeYears - plate.createdAtYears < RIFT_MIN_AGE_YEARS) continue;
      if (s.cells / count < RIFT_MIN_AREA_FRACTION) continue;
      if (s.continental / count < RIFT_MIN_CONTINENTAL_AREA_FRACTION) continue;
      if (hash3(riftSeed, p, timeQuantum, 0) / 4294967296 >= pRift) continue;
      const rifted = riftPlate(next, p, riftSeed);
      reorganized = reorganized || rifted !== next;
      next = rifted;
      break;
    }
  }

  // A reorganization changed the partition after tectonics computed the
  // stress field; recompute so keyframes never pair post-merge plateId with
  // pre-merge boundaryStress (review finding on #55).
  if (reorganized) {
    next = {
      ...next,
      fields: { ...next.fields, boundaryStress: computeBoundaryStress(next) },
    };
  }

  return next;
}

/** Merge the smaller of plates a, b into the larger; kill the loser's slot. */
function suture(
  state: PlanetState,
  stats: PlateStats[],
  a: number,
  b: number,
): { state: PlanetState; winner: number; loser: number } {
  const [winner, loser] =
    stats[a]!.cells > stats[b]!.cells || (stats[a]!.cells === stats[b]!.cells && a < b)
      ? [a, b]
      : [b, a];

  const plateId = state.fields.plateId.slice();
  for (let i = 0; i < plateId.length; i++) {
    if (plateId[i] === loser) plateId[i] = winner;
  }

  // Area-weighted mean angular-velocity vector: the merged plate keeps the
  // combined momentum-ish motion; relative velocity across the suture -> 0.
  const w = state.plates[winner]!;
  const l = state.plates[loser]!;
  const aw = stats[winner]!.cells;
  const al = stats[loser]!.cells;
  const omega: Vec3 = [
    (w.eulerPole[0] * w.angularVelRadPerYr * aw + l.eulerPole[0] * l.angularVelRadPerYr * al) / (aw + al),
    (w.eulerPole[1] * w.angularVelRadPerYr * aw + l.eulerPole[1] * l.angularVelRadPerYr * al) / (aw + al),
    (w.eulerPole[2] * w.angularVelRadPerYr * aw + l.eulerPole[2] * l.angularVelRadPerYr * al) / (aw + al),
  ];
  const mag = Math.sqrt(omega[0] ** 2 + omega[1] ** 2 + omega[2] ** 2);

  const plates: PlateRecord[] = state.plates.map((p, idx) => {
    if (idx === winner) {
      return {
        ...p,
        eulerPole: mag > 1e-18 ? normalize3(omega) : p.eulerPole,
        angularVelRadPerYr: mag > 1e-18 ? mag : 0,
        accumulatedRadians: 0,
        continentalFraction:
          (stats[winner]!.continental + stats[loser]!.continental) / (aw + al),
      };
    }
    if (idx === loser) {
      return { ...p, alive: false, angularVelRadPerYr: 0, accumulatedRadians: 0 };
    }
    return p;
  });

  const event: SimEvent = {
    timeYears: state.timeYears,
    kind: EVENT_KINDS.plateSuture,
    data: { absorbed: loser, into: winner, absorbedCells: al },
  };

  // Contact bookkeeping involving the dead plate is stale; drop those keys.
  const contactSince: Record<string, number> = {};
  for (const key of Object.keys(state.wilson.contactSince).sort()) {
    const [x, y] = key.split('-').map(Number);
    if (x !== loser && y !== loser) contactSince[key] = state.wilson.contactSince[key]!;
  }

  return {
    state: {
      ...state,
      fields: { ...state.fields, plateId },
      plates,
      events: [...state.events, event],
      wilson: { contactSince },
    },
    winner,
    loser,
  };
}

/**
 * Split plate p in two along a jittered two-seed Dijkstra; halves diverge.
 * Exported for direct unit testing (the probabilistic trigger above is
 * exercised by long-run integration tests instead).
 */
export function riftPlate(state: PlanetState, p: number, riftSeed: number): PlanetState {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const plateId = state.fields.plateId.slice();

  // Seed A: min-hash cell of the plate. Seed B: the plate cell farthest
  // from A (ties to the lower index). Both pure functions of the state.
  let seedA = -1;
  let bestHash = Infinity;
  for (let i = 0; i < count; i++) {
    if (plateId[i] !== p) continue;
    const h = hash2(riftSeed, i, 1);
    if (h < bestHash) {
      bestHash = h;
      seedA = i;
    }
  }
  let seedB = -1;
  let bestDot = Infinity;
  for (let i = 0; i < count; i++) {
    if (plateId[i] !== p) continue;
    const d =
      centers[i * 3]! * centers[seedA * 3]! +
      centers[i * 3 + 1]! * centers[seedA * 3 + 1]! +
      centers[i * 3 + 2]! * centers[seedA * 3 + 2]!;
    if (d < bestDot) {
      bestDot = d;
      seedB = i;
    }
  }
  if (seedA === seedB) return state; // degenerate single-cell plate: skip

  // Two-source jittered Dijkstra restricted to the plate (same recipe as the
  // initial partition): label 0 stays plate p, label 1 becomes the new plate.
  const label = new Int8Array(count).fill(-1);
  const heap = new TriHeap();
  heap.push(0, seedA, 0);
  heap.push(0, seedB, 1);
  while (heap.size > 0) {
    const [cost, cell, side] = heap.pop();
    if (label[cell] !== -1) continue;
    label[cell] = side;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[cell * 4 + k]!;
      if (plateId[nb] === p && label[nb] === -1) {
        // Same recipe as the #9 partition (PLATE_FILL_JITTER), distinct
        // hash stream (salt 2).
        heap.push(cost + 1 + PLATE_FILL_JITTER * (hash2(riftSeed, nb, 2) / 4294967296), nb, side);
      }
    }
  }

  const newId = state.plates.length;
  const centroidA: Vec3 = [0, 0, 0];
  const centroidB: Vec3 = [0, 0, 0];
  let contA = 0;
  let cellsA = 0;
  let contB = 0;
  let cellsB = 0;
  for (let i = 0; i < count; i++) {
    if (plateId[i] !== p) continue;
    const target = label[i] === 1 ? centroidB : centroidA;
    target[0] += centers[i * 3]!;
    target[1] += centers[i * 3 + 1]!;
    target[2] += centers[i * 3 + 2]!;
    if (label[i] === 1) {
      plateId[i] = newId;
      cellsB++;
      contB += state.fields.crustType[i]!;
    } else {
      cellsA++;
      contA += state.fields.crustType[i]!;
    }
  }
  if (cellsA === 0 || cellsB === 0) return state; // degenerate split: skip

  // Diverging kinematics: rotate both halves about a pole so they separate
  // along the rift. The natural choice is the pole normal to the two
  // half-centroids (opposite rotations then open the boundary between them).
  // But when the halves are (near-)antipodal that cross product vanishes and
  // can't pick a pole — and that is *always* the case when the rifting plate
  // covers the whole sphere, because seedB is chosen as seedA's most-distant
  // (antipodal) cell, so the two hemispheres' centroids are anti-parallel to
  // machine precision (measured poleMag ~1e-15). This branch previously
  // skipped the rift, which froze any supercontinent forever — a whole-sphere
  // plate could never break up, so seeds 42/1 went tectonically dead by
  // ~1.5 Gyr. Fall back to a deterministic pole in the rift's dividing-circle
  // plane (perpendicular to centroidA): opposite rotations about it still
  // shear the halves apart along their shared boundary (relative velocity
  // 2ω·(pole×r) is non-zero there), so the boundary reactivates and Wilson
  // cycling resumes. Real supercontinents break up; this lets ours.
  const rawPole = cross3(normalize3(centroidA), normalize3(centroidB));
  const poleMag = Math.sqrt(rawPole[0] ** 2 + rawPole[1] ** 2 + rawPole[2] ** 2);
  const pole: Vec3 =
    poleMag < 1e-9
      ? perpendicular3(centroidA)
      : [rawPole[0] / poleMag, rawPole[1] / poleMag, rawPole[2] / poleMag];
  const omegaRift =
    PLATE_OMEGA_MIN_RAD_PER_YR +
    (hash2(riftSeed, newId, 3) / 4294967296) *
      (PLATE_OMEGA_MAX_RAD_PER_YR - PLATE_OMEGA_MIN_RAD_PER_YR);

  const plates: PlateRecord[] = state.plates.map((rec, idx) =>
    idx === p
      ? {
          ...rec,
          eulerPole: pole,
          angularVelRadPerYr: -omegaRift,
          accumulatedRadians: 0,
          createdAtYears: state.timeYears, // rift cooldown restarts
          continentalFraction: contA / cellsA,
        }
      : rec,
  );
  plates.push({
    eulerPole: pole,
    angularVelRadPerYr: omegaRift,
    accumulatedRadians: 0,
    advectionCount: 0,
    createdAtYears: state.timeYears,
    continentalFraction: contB / cellsB,
    alive: true,
  });

  const event: SimEvent = {
    timeYears: state.timeYears,
    kind: EVENT_KINDS.plateRift,
    data: { plate: p, newPlate: newId, newPlateCells: cellsB },
  };

  return {
    ...state,
    fields: { ...state.fields, plateId },
    plates,
    events: [...state.events, event],
  };
}
