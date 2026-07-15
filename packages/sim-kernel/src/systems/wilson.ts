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
 * continents away forever). A plate that was just born by rifting is barred
 * from suturing for RIFT_SUTURE_COOLDOWN_YEARS (its sutureLockUntilYears): the
 * two halves of a breakup share an in-plane pole, so part of their new
 * boundary is convergent, and without the lock they re-sutured within one
 * SUTURE_AFTER_YEARS and no supercontinent ever visibly dispersed (#57
 * follow-up).
 *
 * RIFTING — a live plate that is old (age since creation/last rift), large,
 * and sufficiently continental rifts with a fixed probability per Myr. The
 * decision draw is `hash3(seed', plate, timeQuantum)` — deterministic and
 * independent of any other system's PRNG consumption (documented deviation
 * from the issue's rng.fork sketch: a fork taken inside a pure system would
 * restart its stream every step). Rift likelihood rises SMOOTHLY with plate
 * size (#61, replacing #59's threshold brake): one size ramp (1 below
 * RIFT_SIZE_RATE_KNEE, RIFT_SIZE_RATE_REF_MULTIPLE at
 * RIFT_SIZE_RATE_REF_FRACTION = 0.55, the old #59 threshold)
 * both relaxes the maturity age gate (RIFT_MIN_AGE_YEARS / ramp, shrinking
 * toward zero as a plate approaches whole-sphere — the old age-gate waiver made
 * continuous) and boosts the draw probability (capped at REF_MULTIPLE, so
 * nothing rifts faster than the reference oversize rate — retuned against the
 * dispersal metrics in #66, see the constant's comment). This lets a
 * near-whole-sphere monopoly keep shedding fragments without the old
 * discontinuous 0.55 threshold or its MIN_PLATES coupling. The rift carves a
 * contiguous continental
 * FRAGMENT (a hash-drawn RIFT_FRAGMENT_MIN/MAX_FRACTION of the plate, grown
 * by jittered Dijkstra from a continental seed cell) and gives it an Euler
 * pole perpendicular to its own centroid, so the fragment TRANSLATES across
 * the sphere — new ocean opens along its trailing edge while its leading
 * edge subducts the ocean ahead, Pangaea-style dispersal. The parent keeps
 * its kinematics. (The previous two-seed 50/50 split gave two antipodal
 * hemispheres whenever the plate was sphere-spanning; already maximally
 * separated, they could only shear about the shared pole and re-suture, so
 * deep time was supercontinent-locked.)
 *
 * SUTURE-LINE MEMORY (#60) — suturing stamps the continent-continent weld
 * cells (both sides of the closed ocean's scar, a 2-cell belt) with the
 * merge time in `sutureYears`, an advected crust property: the planet keeps
 * a permanent, drifting record of where its continents were assembled.
 * Deliberately RECORDING-ONLY: the rift carve does not read it. Seven
 * carve-weighting variants (age stiffness absolute and plate-relative, a
 * continental quota, weld walls with flank seeding under permanent /
 * 800 Myr / 200 Myr / spent-on-rift memory, and craton rim tolls at two
 * strengths) were prototyped and measured against the #59/#61 dispersal
 * metrics and 4.5 Gyr flipbooks, and every one of them made deep-time
 * continents LESS coherent or broke dispersal — the raggedness driver is
 * the per-boundary process layer (arc freckling, quantized-advection
 * herringbone, collision debris), not carve geometry, so steering rift
 * lines into continental interiors only manufactures more boundary length
 * through continent. Full variant table and failure mechanisms:
 * docs/PHASE_2_STAGE0_FINDINGS.md, "#60" section. The field ships so a
 * future boundary-process pass (or the renderer) can use the weld record.
 *
 * Both directions emit events (plateSuture / plateRift) and respect the
 * MIN_PLATES / MAX_PLATES live-count bounds. At most one suture and one
 * rift fire per step (deterministic first-eligible order), which keeps each
 * reorganization reviewable in the event log. Plates whose last cell was
 * consumed by advection are retired here each step (plateConsumed) so the
 * live count those bounds gate on stays honest (#59).
 */

import {
  BLANKET_CONTINENT_FRACTION,
  BLANKET_EFOLD_YEARS,
  BLANKET_MAX_FACTOR,
  MAX_PLATES,
  MIN_PLATES,
  PLATE_FILL_JITTER,
  PLATE_OMEGA_MAX_RAD_PER_YR,
  PLATE_OMEGA_MIN_RAD_PER_YR,
  RIFT_AZIMUTH_CANDIDATES,
  RIFT_DRAW_QUANTUM_YEARS,
  RIFT_HAZARD_AT_REF_PER_MYR,
  RIFT_TENSION_REF_N,
  RIFT_FRAGMENT_MAX_FRACTION,
  RIFT_FRAGMENT_MIN_FRACTION,
  RIFT_OCEAN_SCAN_RAD,
  RIFT_OCEAN_SCAN_SAMPLES,
  RIFT_MIN_AGE_YEARS,
  RIFT_MIN_AREA_FRACTION,
  RIFT_MIN_CONTINENTAL_AREA_FRACTION,
  RIFT_PROBABILITY_PER_MYR,
  RIFT_SIZE_RATE_EXPONENT,
  RIFT_SIZE_RATE_KNEE,
  RIFT_SIZE_RATE_REF_FRACTION,
  RIFT_SIZE_RATE_REF_MULTIPLE,
  RIFT_SUTURE_COOLDOWN_YEARS,
  SUTURE_AFTER_YEARS,
  SUTURE_MIN_CONTACT_CELLS,
  ACTIVE_MARGIN_STRESS_M_PER_YR,
} from '../constants';
import { EVENT_KINDS, type SimEvent } from '../events';
import { cellCenterTable, cellCount, directionToIndex, neighborTable, type Vec3 } from '../grid';
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

  // Retire fully-consumed plates (#59): advection can eat a plate's last cell
  // (subduction/override transfers ownership one cell at a time, and nothing
  // else notices). Leaving such a plate `alive` inflates the live count that
  // gates MIN_PLATES/MAX_PLATES — measured deep-time runs accumulated zombie
  // plates that held the suture floor "satisfied" while only two plates
  // actually owned crust. Death keeps the slot (plateId stability contract).
  const consumed: number[] = [];
  for (let p = 0; p < state.plates.length; p++) {
    if (state.plates[p]!.alive && stats[p]!.cells === 0) consumed.push(p);
  }
  if (consumed.length > 0) {
    state = {
      ...state,
      plates: state.plates.map((rec, idx) =>
        consumed.includes(idx)
          ? { ...rec, alive: false, angularVelRadPerYr: 0, accumulatedRadians: 0 }
          : rec,
      ),
      events: [
        ...state.events,
        ...consumed.map(
          (p): SimEvent => ({
            timeYears: state.timeYears,
            kind: EVENT_KINDS.plateConsumed,
            data: { plate: p },
          }),
        ),
      ],
    };
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

  // A plate whose post-rift suture lock is still in force can't accumulate
  // contact toward a suture. Dropping its pairs here (rather than only vetoing
  // the merge below) resets contactSince to now when the lock lifts, so the
  // halves need a fresh SUTURE_AFTER_YEARS of contact afterward instead of
  // suturing the instant the clock expires — a passive margin that has drifted
  // apart by then simply never re-collides.
  const locked = (id: number) => state.timeYears < state.plates[id]!.sutureLockUntilYears;

  // Rebuild contactSince from live contacts only (insertion via sorted keys —
  // the record is never iterated for physics, but keep it canonical anyway).
  const contactSince: Record<string, number> = {};
  const sortedKeys = [...pairContact.keys()].sort();
  for (const key of sortedKeys) {
    if (pairContact.get(key)! < SUTURE_MIN_CONTACT_CELLS) continue;
    const [a, b] = key.split('-').map(Number) as [number, number];
    if (locked(a) || locked(b)) continue;
    contactSince[key] = state.wilson.contactSince[key] ?? state.timeYears;
  }

  let next: PlanetState = { ...state, wilson: { contactSince } };
  let reorganized = false;

  // Tension-driven rift timing (Tectonics V2 stage 3, #113). Off (and before
  // onset) the rift hazard and fragment kinematics are byte-identical to the
  // legacy scheme; on, the hazard reads `tensionN`/`blanketYears` and the
  // fragment inherits the parent's ω⃗.
  const tensionRiftActive =
    state.params.tensionRift && state.timeYears >= state.params.tensionRiftOnsetYears;

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

  // --- Thermal blanket bookkeeping (Tectonics V2 stage 3, #113): a plate that
  // holds >= BLANKET_CONTINENT_FRACTION of the sphere as continent accumulates
  // `blanketYears`; any other plate resets to 0. The one pseudo-mantle scalar —
  // the quiet-interior slow fuse that raises a long-lived supercontinent's rift
  // hazard. Only under the flag; `blanketYears` stays 0 on the flag-off path so
  // the goldens (field hashes) and plate records are byte-identical. Uses the
  // post-suture `stats` so a plate that just absorbed another is judged at its
  // real size this step.
  if (tensionRiftActive) {
    next = {
      ...next,
      plates: next.plates.map((plate, p) => {
        if (!plate.alive) return plate;
        const s = stats[p];
        const contFraction = s && s.cells > 0 ? s.continental / count : 0;
        const blanketYears =
          contFraction >= BLANKET_CONTINENT_FRACTION ? plate.blanketYears + dtYears : 0;
        return blanketYears === plate.blanketYears ? plate : { ...plate, blanketYears };
      }),
    };
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
      // Plate-slot budget safety gates — kept under both schemes (proposal §2.4).
      if (s.cells / count < RIFT_MIN_AREA_FRACTION) continue;
      if (s.continental / count < RIFT_MIN_CONTINENTAL_AREA_FRACTION) continue;
      let pDraw: number;
      if (tensionRiftActive) {
        // Tension² + thermal-blanket hazard (#113, proposal §2.4). The age gate
        // and size ramp are gone: a plate rifts because the opposed subducting
        // perimeter is pulling it apart (`tensionN`), boosted by its blanket age
        // — a continuous physical scalar, no knee. `tensionN` is 0 unless
        // `forceKinematics` has written it, so this reads ~0 without the engine.
        pDraw = riftTensionHazardProbability(plate.tensionN, plate.blanketYears, dtYears);
      } else {
        // Continuous size-dependent rift pressure (#61), replacing the #59
        // discontinuous 0.55 brake and its MIN_PLATES coupling. One size ramp
        // scales the decision: it relaxes the maturity gate (RIFT_MIN_AGE_YEARS /
        // ramp — full below the knee, shrinking toward zero as a plate approaches
        // whole-sphere, the old age-gate waiver made continuous) and boosts the
        // draw probability (capped at REF_MULTIPLE, so nothing rifts faster than
        // the reference oversize rate — the monopoly safety net whose absolute
        // magnitude was re-measured in the #66 clock retune).
        const ramp = riftSizeRamp(s.cells / count);
        if (state.timeYears - plate.createdAtYears < RIFT_MIN_AGE_YEARS / ramp) continue;
        pDraw = pRift * Math.min(RIFT_SIZE_RATE_REF_MULTIPLE, ramp);
      }
      if (hash3(riftSeed, p, timeQuantum, 0) / 4294967296 >= pDraw) continue;
      const rifted = riftPlate(next, p, riftSeed, tensionRiftActive);
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

/**
 * Continuous size-dependent rift-rate ramp (#61), replacing the #59 threshold
 * brake. Returns 1 for any plate at or below RIFT_SIZE_RATE_KNEE, rises smoothly
 * (power RIFT_SIZE_RATE_EXPONENT) through RIFT_SIZE_RATE_REF_MULTIPLE at
 * RIFT_SIZE_RATE_REF_FRACTION — the former oversize threshold/factor — and keeps
 * climbing above it. Monotonic and continuous in areaFraction: no plate's rift
 * rate jumps as it grows. The caller reads it two ways, both smoothing a half of
 * the old brake: the draw probability uses min(REF_MULTIPLE, ramp), which
 * saturates at the reference oversize rate above 0.55 (so nothing rifts faster
 * than it); the maturity gate divides RIFT_MIN_AGE_YEARS by the
 * uncapped ramp, which keeps shrinking toward zero for a near-whole-sphere plate
 * (the old age-gate waiver, now continuous). Exported for the contract test.
 */
export function riftSizeRamp(areaFraction: number): number {
  const t =
    (areaFraction - RIFT_SIZE_RATE_KNEE) / (RIFT_SIZE_RATE_REF_FRACTION - RIFT_SIZE_RATE_KNEE);
  if (t <= 0) return 1;
  return 1 + (RIFT_SIZE_RATE_REF_MULTIPLE - 1) * Math.pow(t, RIFT_SIZE_RATE_EXPONENT);
}

/**
 * Supercontinent thermal-blanket hazard multiplier (Tectonics V2 stage 3,
 * #113, proposal §2.4). Rises from 1 (a plate that has just crossed the
 * `BLANKET_CONTINENT_FRACTION` threshold) toward `BLANKET_MAX_FACTOR` as the
 * plate's `blanketYears` accumulate, with e-folding time `BLANKET_EFOLD_YEARS`.
 * The one deliberately *pseudo-mantle* term: a slow fuse standing in for the
 * sub-continental warming a real mantle layer would produce. Exported for the
 * contract test.
 */
export function blanketFactor(blanketYears: number): number {
  return 1 + (BLANKET_MAX_FACTOR - 1) * (1 - Math.exp(-blanketYears / BLANKET_EFOLD_YEARS));
}

/**
 * Per-step tension-driven rift acceptance probability (Tectonics V2 stage 3,
 * #113, proposal §2.4). Hazard λ = `RIFT_HAZARD_AT_REF_PER_MYR` ×
 * min(4, (tensionN/`RIFT_TENSION_REF_N`)²) × blanketFactor(blanketYears), and
 * the probability the step's Bernoulli draw must clear is 1 − exp(−λ·dtMyr).
 * `tensionN` (gross − |net| boundary driving force, ≥ 0) is the physical scalar
 * the old size ramp was faking: a supercontinent ringed by opposed subduction
 * carries high gross / low net force and rifts *because it is being pulled
 * apart*. The tension factor is quadratic (a plate at twice the reference
 * tension rifts ~4× as readily), capped at 4× the reference rate so a
 * runaway-tension plate cannot rift every step. Exported for the contract test.
 */
export function riftTensionHazardProbability(
  tensionN: number,
  blanketYears: number,
  dtYears: number,
): number {
  const ratio = tensionN / RIFT_TENSION_REF_N;
  const tensionFactor = Math.min(4, ratio * ratio);
  const lambdaPerMyr = RIFT_HAZARD_AT_REF_PER_MYR * tensionFactor * blanketFactor(blanketYears);
  const dtMyr = dtYears / 1e6;
  return 1 - Math.exp(-lambdaPerMyr * dtMyr);
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

  // Suture-line memory (#60): before the boundary disappears into the merged
  // plate's interior, stamp the weld — every continental cell of either plate
  // with a continental 4-neighbor across the a/b boundary (a 2-cell-wide
  // belt, both sides of the closed ocean's scar) — with the merge time.
  // sutureYears advects with the crust (ADVECTED_FIELDS), so the weld line
  // travels with the merged continent however far it drifts. Recording-only
  // for now — see the header for the measured reasons the carve doesn't read
  // it.
  const nbTable = neighborTable(state.params.gridN);
  const sutureYears = state.fields.sutureYears.slice();
  const oldPlateId = state.fields.plateId;
  const { crustType } = state.fields;
  for (let i = 0; i < oldPlateId.length; i++) {
    const pid = oldPlateId[i];
    if ((pid !== a && pid !== b) || crustType[i] !== 1) continue;
    const other = pid === a ? b : a;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[i * 4 + k]!;
      if (oldPlateId[nb] === other && crustType[nb] === 1) {
        sutureYears[i] = state.timeYears;
        break;
      }
    }
  }

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
      fields: { ...state.fields, plateId, sutureYears },
      plates,
      events: [...state.events, event],
      wilson: { contactSince },
    },
    winner,
    loser,
  };
}

/**
 * Rift plate p by carving off a contiguous continental fragment that then
 * translates across the sphere (#59). Exported for direct unit testing (the
 * probabilistic trigger above is exercised by long-run integration tests).
 *
 * The fragment is grown by jittered Dijkstra from a continental seed cell to
 * a hash-drawn RIFT_FRAGMENT_MIN/MAX_FRACTION of the plate, and its Euler
 * pole is perpendicular to its own centroid — the rotation that maximally
 * TRANSLATES a spherical cap rather than spinning it in place. Its trailing
 * edge opens young ocean while its leading edge subducts the ocean ahead,
 * which is how real supercontinent fragments (India, the Gondwana pieces)
 * disperse. The parent keeps its kinematics: rifting is the fragment pulling
 * away, not the whole remaining sphere recoiling. A 50/50 split (the
 * previous scheme) cannot do this for a sphere-spanning plate — its halves
 * are antipodal, already maximally separated, and can only shear about a
 * shared pole and re-suture.
 */
export function riftPlate(
  state: PlanetState,
  p: number,
  riftSeed: number,
  tensionRiftActive = false,
): PlanetState {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const plateId = state.fields.plateId.slice();
  const { crustType } = state.fields;

  // Fragment seed: min-hash continental cell of the plate — rifts nucleate
  // in continental lithosphere, and a fragment carved around a continent is
  // a block that can sail. Plates with no continental cell (unit-test
  // states; the pipeline gate requires continental area) fall back to the
  // min-hash over all their cells.
  let seedA = -1;
  let bestHash = Infinity;
  let plateCells = 0;
  let seedFallback = -1;
  let bestFallbackHash = Infinity;
  for (let i = 0; i < count; i++) {
    if (plateId[i] !== p) continue;
    plateCells++;
    const h = hash2(riftSeed, i, 1);
    if (h < bestFallbackHash) {
      bestFallbackHash = h;
      seedFallback = i;
    }
    if (crustType[i] === 1 && h < bestHash) {
      bestHash = h;
      seedA = i;
    }
  }
  if (seedA === -1) seedA = seedFallback;
  if (plateCells < 2) return state; // degenerate single-cell plate: skip

  const newId = state.plates.length;
  // Fragment size: a sub-half fraction of the plate, drawn per rift (the
  // hash input newId is unique per rift because dead slots are never
  // reclaimed).
  const sizeDraw = hash2(riftSeed, newId, 4) / 4294967296;
  const fraction =
    RIFT_FRAGMENT_MIN_FRACTION +
    sizeDraw * (RIFT_FRAGMENT_MAX_FRACTION - RIFT_FRAGMENT_MIN_FRACTION);
  const targetCells = Math.min(plateCells - 1, Math.max(1, Math.round(fraction * plateCells)));

  // Single-source jittered Dijkstra restricted to the plate (same recipe as
  // the #9 partition, distinct hash stream: salt 2), stopped at the target
  // size. The fragment is contiguous by construction. If the plate itself is
  // disconnected (advection can strand pieces) the fragment is capped at the
  // seed's component.
  const label = new Int8Array(count); // 1 = fragment
  const heap = new TriHeap();
  heap.push(0, seedA, 0);
  let claimed = 0;
  while (heap.size > 0 && claimed < targetCells) {
    const [cost, cell] = heap.pop();
    if (label[cell] === 1) continue;
    label[cell] = 1;
    claimed++;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[cell * 4 + k]!;
      if (plateId[nb] === p && label[nb] === 0) {
        heap.push(cost + 1 + PLATE_FILL_JITTER * (hash2(riftSeed, nb, 2) / 4294967296), nb, 1);
      }
    }
  }
  if (claimed === 0 || claimed === plateCells) return state; // degenerate split: skip

  const centroidB: Vec3 = [0, 0, 0];
  let contA = 0;
  let cellsA = 0;
  let contB = 0;
  let cellsB = 0;
  for (let i = 0; i < count; i++) {
    if (plateId[i] !== p) continue;
    if (label[i] === 1) {
      plateId[i] = newId;
      centroidB[0] += centers[i * 3]!;
      centroidB[1] += centers[i * 3 + 1]!;
      centroidB[2] += centers[i * 3 + 2]!;
      cellsB++;
      contB += crustType[i]!;
    } else {
      cellsA++;
      contA += crustType[i]!;
    }
  }

  // Fragment kinematics. Two schemes, chosen by `tensionRiftActive`:
  let pole: Vec3;
  let omegaRift: number;
  if (tensionRiftActive) {
    // Tectonics V2 stage 3 (#113, proposal §2.4): the fragment inherits the
    // parent's kinematics. Under `forceKinematics` the parent's
    // eulerPole/angularVelRadPerYr are the derived form of its ω⃗ (also copied
    // into the fragment's `omegaVec` below), so the fragment rotates with the
    // parent at creation and the halves separate next step because ridge push
    // registers on their new divergent margin — forces separate them, not a
    // prescribed translating pole. The perpendicular-pole construction and the
    // ocean-seeking azimuth fan go dead, along with their salt-5 and salt-3
    // position-hash draws; skipping stateless hashes perturbs no other stream,
    // and flag-off they still evaluate, so the default path is byte-identical.
    const parent = state.plates[p]!;
    pole = [...parent.eulerPole];
    omegaRift = parent.angularVelRadPerYr;
  } else {
    // Translating kinematics: an Euler pole perpendicular to the fragment's
    // centroid puts the fragment on the equator of its own rotation, so it
    // translates across the surface at ω·R instead of spinning in place.
    // Guard: a pathologically balanced fragment can have a near-zero centroid
    // sum; its seed cell's direction is always a valid stand-in.
    const cMag = Math.sqrt(centroidB[0] ** 2 + centroidB[1] ** 2 + centroidB[2] ** 2);
    const c: Vec3 =
      cMag < 1e-9
        ? [centers[seedA * 3]!, centers[seedA * 3 + 1]!, centers[seedA * 3 + 2]!]
        : [centroidB[0] / cMag, centroidB[1] / cMag, centroidB[2] / cMag];
    const u = perpendicular3(c);
    const v = cross3(c, u);

    // Direction of travel: continents rift toward the ocean. Score a fan of
    // candidate azimuths (phase-shifted per rift so no global axis is
    // favored) by the oceanic-crust count along the forward great circle
    // between the fragment's edge and RIFT_OCEAN_SCAN_RAD beyond it, and sail
    // the most oceanic heading. A fragment sent into open ocean subducts
    // oceanic crust ahead of it; sent into the parent's continent it would
    // grind continent-on-continent through the whole post-rift lock — the
    // dominant continental-area bleed (#16/#58). Deterministic: pure function
    // of the fields and the hash stream.
    const phase = hash2(riftSeed, newId, 5) / 4294967296;
    // Angular radius of a spherical cap covering the fragment's share of the
    // sphere: cos θ = 1 − 2·fraction. Scanning starts at the cap edge.
    const capCos = Math.max(-1, Math.min(1, 1 - (2 * cellsB) / count));
    const edgeRad = Math.acos(capCos);
    let bestScore = -1;
    pole = u;
    for (let k = 0; k < RIFT_AZIMUTH_CANDIDATES; k++) {
      const azimuth = ((phase + k / RIFT_AZIMUTH_CANDIDATES) % 1) * 2 * Math.PI;
      const cand: Vec3 = [
        Math.cos(azimuth) * u[0] + Math.sin(azimuth) * v[0],
        Math.cos(azimuth) * u[1] + Math.sin(azimuth) * v[1],
        Math.cos(azimuth) * u[2] + Math.sin(azimuth) * v[2],
      ];
      // Unit travel direction of the fragment centroid under +ω about cand.
      const d = cross3(cand, c);
      let score = 0;
      for (let s = 1; s <= RIFT_OCEAN_SCAN_SAMPLES; s++) {
        const delta = edgeRad + (s / RIFT_OCEAN_SCAN_SAMPLES) * RIFT_OCEAN_SCAN_RAD;
        const cosD = Math.cos(delta);
        const sinD = Math.sin(delta);
        const cell = directionToIndex(
          [cosD * c[0] + sinD * d[0], cosD * c[1] + sinD * d[1], cosD * c[2] + sinD * d[2]],
          N,
        );
        if (label[cell] !== 1 && crustType[cell] === 0) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        pole = cand;
      }
    }
    omegaRift =
      PLATE_OMEGA_MIN_RAD_PER_YR +
      (hash2(riftSeed, newId, 3) / 4294967296) *
        (PLATE_OMEGA_MAX_RAD_PER_YR - PLATE_OMEGA_MIN_RAD_PER_YR);
  }

  // Parent keeps pole/velocity (the fragment leaves; the remaining plate is
  // not recoiled), but its rift-age clock restarts and both sides get the
  // post-rift suture lock so the new passive margin can open before it may
  // collide again.
  const plates: PlateRecord[] = state.plates.map((rec, idx) =>
    idx === p
      ? {
          ...rec,
          createdAtYears: state.timeYears, // rift-age cooldown restarts
          sutureLockUntilYears: state.timeYears + RIFT_SUTURE_COOLDOWN_YEARS,
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
    sutureLockUntilYears: state.timeYears + RIFT_SUTURE_COOLDOWN_YEARS,
    continentalFraction: contB / cellsB,
    alive: true,
    // Force-balance kinematics state (#111): the fragment inherits the
    // parent's ω⃗ (a copy, not the shared reference; §2.4 — ridge push at the
    // new divergent margin separates the halves next step). Zero flag-off.
    omegaVec: [...state.plates[p]!.omegaVec],
    tensionN: 0,
    // Not inherited: recomputed next step from the fragment's own margins.
    slabPullN: 0,
    stallSinceYears: 0,
    blanketYears: 0,
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
