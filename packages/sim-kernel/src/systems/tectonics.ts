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
 * (elevation, crustAge, crustType, sutureYears) travel with the winning
 * claim's source.
 * Unclaimed cells are divergent gaps, repaired deterministically by
 * majority-of-assigned-neighbors and filled as provisional young ocean crust
 * (#15 turns this into real ridge bathymetry).
 *
 * Displaced continental crust is bulldozed, not destroyed (#16/#59), landing
 * by a compactness-seeking pick against the post-advection crust map (#67),
 * and each step ends with a margin-consolidation pass (#67) that pair-flips
 * stray one-cell continental flecks against enclosed ocean holes — the two
 * shipped halves of the boundary-process coherence pass that stopped
 * reorganization churn from shredding deep-time continents into lace.
 */

import { seaKeyedOceanicDepthForAge } from '../bathymetry';
import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  COLLISION_THICKENING_FACTOR,
  MARGIN_CONSOLIDATION_HOLE_MIN_NEIGHBORS,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OCEAN_RELIEF_RELAX_M_PER_YR,
  OROGENY_MAX_ELEVATION_M,
} from '../constants';
import { bathymetryDatumOffsetM, landDatumOffsetM, platformDatumOffsetM } from '../datums';
import { cellCenterTable, cellCount, directionToIndex, neighborTable, type Vec3 } from '../grid';
import { hash2, hashString } from '../hash';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { rotateAroundAxis } from '../vec';
import { applyConvergentTopography, computeBoundaryStress, overrides } from './boundaries';

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
const ADVECTED_FIELDS = ['elevation', 'crustAge', 'crustType', 'sutureYears', 'sedimentM'] as const;

export const tectonicsSystem: System = {
  name: 'tectonics',
  apply: applyTectonics,
};

function applyTectonics(state: PlanetState, dtYears: number): PlanetState {
  const N = state.params.gridN;
  const thetaMin = Math.PI / 2 / N;

  // Crust ages everywhere, every step (#15). Ticked before advection so
  // transported crust carries its aged value; gap fill afterwards writes 0.
  const crustAge = state.fields.crustAge.slice();
  for (let i = 0; i < crustAge.length; i++) crustAge[i]! += dtYears;
  state = { ...state, fields: { ...state.fields, crustAge } };

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

  const advected = moving.length > 0 ? advect(state, accumulated, moving) : state;
  const next: PlanetState = {
    ...advected,
    plates: state.plates.map((p, i) =>
      moving.includes(i)
        ? { ...p, accumulatedRadians: 0, advectionCount: p.advectionCount + 1 }
        : { ...p, accumulatedRadians: accumulated[i]! },
    ),
  };

  // Boundary stress is a per-step derived field (#14): partition and
  // kinematics both feed it, so recompute after any motion.
  const boundaryStress = computeBoundaryStress(next);

  // Thermal subsidence (#15): oceanic elevation relaxes toward the
  // age-depth curve (isostasy) — ridge crest young, abyssal plain old.
  // Sediment exported from the continents (#65) rides on top: the target is
  // curve + sedimentM, so filled shelves stand above bare crust of the same
  // age (deposition is capped at SEDIMENT_SHELF_CEILING_M in erosion.ts, and
  // the curve only deepens with age, so the target never exceeds it).
  // Active convergent margins are exempt (#16): trenches pin below the
  // curve, arcs accumulate above it. The relaxation is rate-bounded (#59)
  // rather than a hard-set so inactive arc/trench relief has memory: it
  // decays over Myr instead of snapping to the curve the step the margin
  // moves off the cell (see OCEAN_RELIEF_RELAX_M_PER_YR).
  const elevation = next.fields.elevation.slice();
  const crustType = next.fields.crustType.slice();
  const sedimentM = next.fields.sedimentM.slice();
  const age = next.fields.crustAge;
  const relax = OCEAN_RELIEF_RELAX_M_PER_YR * dtYears;
  // Sea-level-keyed bathymetry (#102, datums.ts + bathymetry.ts): under the
  // bathymetryDatum mechanism the curve's crest rides the previous step's
  // sea level (abyss absolute); offset 0 means the exact absolute curve.
  const bathyOffset = bathymetryDatumOffsetM(next);
  for (let i = 0; i < elevation.length; i++) {
    if (crustType[i] === 0 && boundaryStress[i]! <= ACTIVE_MARGIN_STRESS_M_PER_YR) {
      const target = seaKeyedOceanicDepthForAge(age[i]!, bathyOffset) + sedimentM[i]!;
      const e = elevation[i]!;
      elevation[i] = e > target ? Math.max(target, e - relax) : Math.min(target, e + relax);
    }
  }

  // Convergent topography (#16): trench + arc + orogenic uplift, driven by
  // this step's stress; mature arcs become continental crust. Mutates only
  // the local elevation/crustType copies.
  applyConvergentTopography(next, boundaryStress, elevation, crustType, dtYears);

  // Isolated continental slivers founder (#59): a continental cell with no
  // continental 4-neighbor is pinned below sea level (it stays continental
  // crust — a Zealandia-style submerged micro-continent that can later
  // re-accrete, so the crustal-area budget is untouched). Collision
  // consumption and herringbone advection strand single continental cells
  // whose peaks the subsea-damped erosion preserves for gigayears — the
  // ocean "white speckle" that turned deep-time land into confetti once the
  // world stayed tectonically alive. Physically: a one-cell fragment is
  // 100+ km of land with no cratonic root; it erodes to and below sea level
  // on far shorter timescales than we resolve. The clamp is idempotent and
  // reads only crustType, which is final by this point in the step, so scan
  // order cannot leak into the result. Under seaLevelDatums the founder
  // level is anchored to the dynamic sea level (previous step's value), so
  // the fragment is genuinely drowned instead of stranded above a fallen
  // waterline (datums.ts).
  const founderLevel = platformDatumOffsetM(next) + MICROCONTINENT_FOUNDER_ELEVATION_M;
  const nbTable = neighborTable(N);
  for (let i = 0; i < crustType.length; i++) {
    if (crustType[i] !== 1) continue;
    if (
      crustType[nbTable[i * 4]!] !== 1 &&
      crustType[nbTable[i * 4 + 1]!] !== 1 &&
      crustType[nbTable[i * 4 + 2]!] !== 1 &&
      crustType[nbTable[i * 4 + 3]!] !== 1
    ) {
      elevation[i] = Math.min(elevation[i]!, founderLevel);
    }
  }

  // Margin consolidation (#67): pair-flip stray one-cell continental flecks
  // against enclosed one-cell ocean holes, by neighbor majority. Islands —
  // continental cells with NO continental 4-neighbor (the same debris the
  // founder clamp above sinks: shredded collision margins, herringbone
  // rework scraps) — flip to oceanic crust at their age-depth floor. Holes —
  // oceanic cells with >= MARGIN_CONSOLIDATION_HOLE_MIN_NEIGHBORS
  // continental 4-neighbors (gap-fill scars and advection tears inside a
  // continent) — flip to continental crust inheriting their neighbors'
  // properties. Flips are PAIRED (k = min(#islands, #holes), both sides in
  // ascending cell order) so continental cell count is exactly conserved:
  // the pass is bookkeeping that moves stranded crustal area from a form
  // the planet can never read as continent (foundered confetti) into the
  // enclave basins the boundary processes tore open. Unpaired islands stay
  // (foundered, Zealandia-style) and unpaired holes stay open water.
  // Decisions are computed from the pre-pass crustType and applied
  // together, so scan order cannot leak into the result.
  let crustAgeOut = next.fields.crustAge;
  let sutureYearsOut = next.fields.sutureYears;
  {
    const islands: number[] = [];
    // Holes with the properties they inherit, snapshotted at decision time —
    // a hole's continental neighbor may itself be an island this pass flips
    // to ocean, so inheritance must read the pre-pass state, not the
    // mutating working arrays.
    const holes: { cell: number; elev: number; age: number; suture: number }[] = [];
    const crustAgeIn = next.fields.crustAge;
    const sutureYearsIn = next.fields.sutureYears;
    for (let i = 0; i < crustType.length; i++) {
      let contNb = 0;
      for (let k = 0; k < 4; k++) if (crustType[nbTable[i * 4 + k]!] === 1) contNb++;
      if (crustType[i] === 1 && contNb === 0) {
        islands.push(i);
      } else if (crustType[i] === 0 && contNb >= MARGIN_CONSOLIDATION_HOLE_MIN_NEIGHBORS) {
        // A filled hole becomes continental basin floor: lowest continental
        // neighbor's elevation (an enclave is low ground), oldest neighbor's
        // age, and the neighbors' weld memory.
        let elev = Infinity;
        let age = 0;
        let suture = 0;
        for (let k = 0; k < 4; k++) {
          const nb = nbTable[i * 4 + k]!;
          if (crustType[nb] !== 1) continue;
          if (elevation[nb]! < elev) elev = elevation[nb]!;
          if (crustAgeIn[nb]! > age) age = crustAgeIn[nb]!;
          if (sutureYearsIn[nb]! > suture) suture = sutureYearsIn[nb]!;
        }
        holes.push({ cell: i, elev, age, suture });
      }
    }
    const flips = Math.min(islands.length, holes.length);
    if (flips > 0) {
      // crustAge/sutureYears are only copied when a flip actually writes
      // them (most steps flip nothing).
      crustAgeOut = crustAgeOut.slice();
      sutureYearsOut = sutureYearsOut.slice();
      for (let f = 0; f < flips; f++) {
        const isl = islands[f]!;
        const hole = holes[f]!;
        // The island's cell reverts to seafloor at its age-depth floor
        // (crust age travels with the cell, so an old fleck sinks toward
        // abyssal depth; its sediment cover, if any, rides on top).
        crustType[isl] = 0;
        elevation[isl] = seaKeyedOceanicDepthForAge(crustAgeOut[isl]!, bathyOffset) + sedimentM[isl]!;
        sutureYearsOut[isl] = 0; // ocean carries no weld memory
        crustType[hole.cell] = 1;
        elevation[hole.cell] = hole.elev;
        crustAgeOut[hole.cell] = hole.age;
        sutureYearsOut[hole.cell] = hole.suture;
      }
    }
  }

  // sedimentM is oceanic cover only (#65): crust that just became continental
  // (arc maturation above, bulldozer re-root in advect, consolidation hole
  // fill) consumes its sediment — accreted into the margin wedge, it leaves
  // the ledger the same way subducted sediment does. Erosion deposits only
  // on oceanic cells, so this sweep is the single place the invariant
  // "sedimentM = 0 on continental crust" is enforced. The one continental →
  // oceanic path (a consolidation-flipped island, #67) re-enters the ocean
  // ledger carrying the 0 this sweep gave it while it was continental, so
  // the invariant survives the flip in both directions.
  for (let i = 0; i < crustType.length; i++) {
    if (crustType[i] === 1) sedimentM[i] = 0;
  }

  let land = 0;
  for (const e of elevation) if (e >= 0) land++;

  return {
    ...next,
    globals: { ...next.globals, landFraction: land / elevation.length },
    fields: {
      ...next.fields,
      boundaryStress,
      elevation,
      crustType,
      sedimentM,
      crustAge: crustAgeOut,
      sutureYears: sutureYearsOut,
    },
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
    sutureYears: new Float32Array(count),
    sedimentM: new Float32Array(count),
  };
  const old = {
    elevation: state.fields.elevation,
    crustAge: state.fields.crustAge,
    crustType: state.fields.crustType,
    sutureYears: state.fields.sutureYears,
    sedimentM: state.fields.sedimentM,
  };

  // Claims + resolution. Overlaps (multiple claimants) are convergence: the
  // overriding side keeps the surface, the subducting side's OCEANIC crust
  // is consumed — an ownership transfer, never a hole (#16). Polarity comes
  // from overrides(): continental beats oceanic, younger oceanic beats
  // older, ties to the lower plate id. The fold order is deterministic and
  // overrides() is a strict weak order, so the winner is order-independent.
  // Displaced CONTINENTAL crust is not consumed — it is bulldozed one cell
  // deeper into its own plate (see the push pass below).
  const dir: Vec3 = [0, 0, 0];
  interface Push {
    /** Displaced continental cell (the crust's original home). */
    from: number;
    /** Plate that owned the displaced cell (the retreating side). */
    owner: number;
    /** Local shortening direction the crust is shoved along. */
    fx: number;
    fy: number;
    fz: number;
    elevation: number;
    crustAge: number;
    sutureYears: number;
  }
  const pushes: Push[] = [];
  // Source cells whose content survived at some target this event. The
  // quantized rotation map is not a bijection (one source can feed several
  // targets); a source counts as consumed only if it won NOWHERE, and is
  // bulldozed at most once, so crust is never duplicated.
  const wonFrom = new Uint8Array(count);
  const winPlateArr = new Int32Array(count).fill(-1);
  // Memoized inverse-rotation map from the claim loop, srcOf[i * movers + mi]:
  // the blocked-mover pass below needs the same (target, plate) -> source
  // mapping, but only after wonFrom is complete — recomputing it doubled the
  // most expensive per-cell trig in the kernel's hottest system.
  const movers = moving.length;
  const srcOf = new Int32Array(count * movers);
  for (let i = 0; i < count; i++) {
    let winSrc = -1;
    let winPlate = -1;
    dir[0] = centers[i * 3]!;
    dir[1] = centers[i * 3 + 1]!;
    dir[2] = centers[i * 3 + 2]!;
    for (let mi = 0; mi < movers; mi++) {
      const p = moving[mi]!;
      const src = directionToIndex(
        rotateAroundAxis(dir, state.plates[p]!.eulerPole, -accumulated[p]!),
        N,
      );
      srcOf[i * movers + mi] = src;
      if (oldPlate[src] !== p) continue;
      if (
        winPlate === -1 ||
        overrides(
          old.crustType[src]!,
          old.crustAge[src]!,
          p,
          old.crustType[winSrc]!,
          old.crustAge[winSrc]!,
          winPlate,
        )
      ) {
        winSrc = src;
        winPlate = p;
      }
    }
    const owner = oldPlate[i]!;
    if (!movingSet[owner]) {
      if (
        winPlate === -1 ||
        overrides(
          old.crustType[i]!,
          old.crustAge[i]!,
          owner,
          old.crustType[winSrc]!,
          old.crustAge[winSrc]!,
          winPlate,
        )
      ) {
        winSrc = i;
        winPlate = owner;
      }
    }
    if (winSrc !== -1) {
      newFields.plateId[i] = winPlate;
      for (const f of ADVECTED_FIELDS) newFields[f][i] = old[f][winSrc]!;
      wonFrom[winSrc] = 1;
      winPlateArr[i] = winPlate;
    }

    // Continental crust does not subduct (#59 / direction (b)): if a moving
    // continental claim overrode a static plate's continental cell, that
    // cell's crust is displaced, not destroyed. Shove it one cell deeper
    // into its own (retreating) plate along the winner's motion (src -> i),
    // preferring oceanic ground (area conserved) over thickening — see
    // pickPushTarget.
    if (
      winSrc !== -1 &&
      winPlate !== owner &&
      !movingSet[owner] &&
      old.crustType[i] === 1 &&
      old.crustType[winSrc] === 1
    ) {
      pushes.push({
        from: i,
        owner,
        fx: dir[0] - centers[winSrc * 3]!,
        fy: dir[1] - centers[winSrc * 3 + 1]!,
        fz: dir[2] - centers[winSrc * 3 + 2]!,
        elevation: old.elevation[i]!,
        crustAge: old.crustAge[i]!,
        sutureYears: old.sutureYears[i]!,
      });
    }
  }

  // The symmetric displacement case: a MOVING plate's continental source
  // cell whose content won at no target (its advance was blocked by a
  // stronger claim everywhere it mapped). That column failed to advance —
  // it stacks onto the cell behind it (most anti-aligned with its own
  // motion, still owned by its plate): the pile-up half of the shortening.
  // This must run after the claim loop completes (a source may win at a
  // later target), so it replays the memoized srcOf map instead of
  // recomputing the rotations.
  for (let i = 0; i < count; i++) {
    dir[0] = centers[i * 3]!;
    dir[1] = centers[i * 3 + 1]!;
    dir[2] = centers[i * 3 + 2]!;
    for (let mi = 0; mi < movers; mi++) {
      const p = moving[mi]!;
      if (p === winPlateArr[i]) continue;
      const src = srcOf[i * movers + mi]!;
      if (oldPlate[src] !== p || old.crustType[src] !== 1) continue;
      if (wonFrom[src]) continue; // survived somewhere; not consumed
      wonFrom[src] = 1; // handle each consumed source exactly once
      // Push back opposite to the motion (from target i toward src and past
      // it), preferring oceanic ground — see the apply pass below.
      pushes.push({
        from: src,
        owner: p,
        fx: centers[src * 3]! - dir[0],
        fy: centers[src * 3 + 1]! - dir[1],
        fz: centers[src * 3 + 2]! - dir[2],
        elevation: old.elevation[src]!,
        crustAge: old.crustAge[src]!,
        sutureYears: old.sutureYears[src]!,
      });
    }
  }

  // Apply the bulldozed crust in the deterministic order it was collected
  // (ascending displaced-cell index; multiple pushes may land on one
  // target). Each push picks its landing cell HERE, against the resolved
  // post-advection crust map (newFields, including earlier pushes), not the
  // pre-advection one (#67): the same-plate (old partition) 4-neighbor that
  // is (1) oceanic/unclaimed, ATTACHED to post-advection continental crust,
  // and forward, else (2) oceanic attached anywhere — accretion against a
  // continental mass, compactness-seeking — else (3) oceanic forward, else
  // (4) oceanic anywhere (lateral extrusion, the Indochina-style sideways
  // escape that keeps the crustal area conserved), else (5) continental and
  // forward, which thickens. Preferring attached ground matters because a
  // detached re-root is a one-cell micro-continent the founder clamp then
  // sinks — the measured "collision debris" shape leak (#67): conserving
  // area as confetti is conserving it in a form the planet can never read
  // as a continent. No candidate at all (-1) = the last sliver of a
  // fully-overridden salient is genuinely consumed (the exception that
  // keeps this a one-shot pass, not a shortening solver). Onto oceanic or
  // still-unclaimed cells the displaced column re-roots: the cell becomes
  // continental with the displaced properties (area conserved). Onto
  // continental cells the collision shortens and thickens: a fraction of
  // the displaced positive relief piles on, capped at the orogeny ceiling.
  const isCont = (c: number): boolean => newFields.plateId[c] !== -1 && newFields.crustType[c] === 1;
  const isAttached = (c: number): boolean =>
    isCont(nbTable[c * 4]!) || isCont(nbTable[c * 4 + 1]!) || isCont(nbTable[c * 4 + 2]!) || isCont(nbTable[c * 4 + 3]!);
  for (const push of pushes) {
    let bestOceanAttFwd = -1;
    let bestOceanAttFwdDot = 0;
    let bestOceanAttAny = -1;
    let bestOceanAttAnyDot = -Infinity;
    let bestOceanFwd = -1;
    let bestOceanFwdDot = 0;
    let bestOceanAny = -1;
    let bestOceanAnyDot = -Infinity;
    let bestContFwd = -1;
    let bestContFwdDot = 0;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[push.from * 4 + k]!;
      if (oldPlate[nb] !== push.owner) continue;
      const d =
        (centers[nb * 3]! - centers[push.from * 3]!) * push.fx +
        (centers[nb * 3 + 1]! - centers[push.from * 3 + 1]!) * push.fy +
        (centers[nb * 3 + 2]! - centers[push.from * 3 + 2]!) * push.fz;
      if (isCont(nb)) {
        if (d > bestContFwdDot) {
          bestContFwdDot = d;
          bestContFwd = nb;
        }
      } else if (isAttached(nb)) {
        if (d > bestOceanAttFwdDot) {
          bestOceanAttFwdDot = d;
          bestOceanAttFwd = nb;
        }
        if (d > bestOceanAttAnyDot) {
          bestOceanAttAnyDot = d;
          bestOceanAttAny = nb;
        }
      } else {
        if (d > bestOceanFwdDot) {
          bestOceanFwdDot = d;
          bestOceanFwd = nb;
        }
        if (d > bestOceanAnyDot) {
          bestOceanAnyDot = d;
          bestOceanAny = nb;
        }
      }
    }
    const t =
      bestOceanAttFwd !== -1
        ? bestOceanAttFwd
        : bestOceanAttAny !== -1
          ? bestOceanAttAny
          : bestOceanFwd !== -1
            ? bestOceanFwd
            : bestOceanAny !== -1
              ? bestOceanAny
              : bestContFwd;
    if (t === -1) continue;
    if (newFields.plateId[t] !== -1 && newFields.crustType[t] === 1) {
      // Collision thickening caps at the orogeny ceiling — a land-relief
      // datum that rides the dynamic sea level under the freeboard
      // mechanism (landDatumOffsetM, datums.ts) and is exactly the absolute
      // constant when it is off.
      newFields.elevation[t] = Math.min(
        landDatumOffsetM(state) + OROGENY_MAX_ELEVATION_M,
        newFields.elevation[t]! + COLLISION_THICKENING_FACTOR * Math.max(0, push.elevation),
      );
      newFields.crustAge[t] = Math.max(newFields.crustAge[t]!, push.crustAge);
      // Weld memory survives shortening: the newer of the two suture stamps
      // wins (0 = never sutured, so max is also the presence-preserving pick).
      newFields.sutureYears[t] = Math.max(newFields.sutureYears[t]!, push.sutureYears);
    } else {
      if (newFields.plateId[t] === -1) newFields.plateId[t] = push.owner;
      newFields.crustType[t] = 1;
      newFields.elevation[t] = push.elevation;
      newFields.crustAge[t] = push.crustAge;
      newFields.sutureYears[t] = push.sutureYears;
    }
  }

  // Divergent gap repair: deterministic multi-pass majority-of-assigned-
  // neighbors (ties toward the lower plate id), filled as provisional young
  // ocean crust at ridge depth. Decisions are computed from the pre-pass
  // state and applied together, so fill order cannot leak into the result.
  // Fresh crust is created at the age-depth reference for age 0 — the crest,
  // which rides the sea level under bathymetryDatum (#102, bathymetry.ts).
  const ridgeFillLevel = seaKeyedOceanicDepthForAge(0, bathymetryDatumOffsetM(state));
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
      newFields.elevation[i] = ridgeFillLevel;
      newFields.crustAge[i] = 0;
      newFields.crustType[i] = 0;
      newFields.sutureYears[i] = 0; // fresh ocean carries no weld memory
      newFields.sedimentM[i] = 0; // ...and no sediment cover
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

