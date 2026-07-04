/**
 * Plate-boundary classification (#14) and subduction polarity (#16).
 *
 * A cell is a boundary cell iff any of its 4 neighbors belongs to a different
 * plate. At each boundary cell the relative velocity of the two plates
 * (rigid ω × r from their Euler poles) is projected onto the local
 * boundary-normal direction, giving the signed `boundaryStress` field:
 * positive = convergent (closing), negative = divergent (opening), near-zero
 * with large tangential motion = transform. Interior cells are exactly 0.
 * Boundary *type* is derived from the sign and a tangential threshold rather
 * than stored as a second field.
 */

import { oceanicDepthForAge } from '../bathymetry';
import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  ARC_GROWTH_RATE_M_PER_YR,
  ARC_GROWTH_REFERENCE_GRID_N,
  ARC_MATURATION_ELEVATION_M,
  ARC_MAX_ELEVATION_M,
  COLLISION_WIDTH_CELLS,
  OROGENY_MAX_ELEVATION_M,
  OROGENY_RATE_M_PER_YR,
  OROGENY_STRESS_REF_M_PER_YR,
  OROGENY_WIDTH_CELLS,
  TRENCH_EXTRA_DEPTH_M,
} from '../constants';
import { cellCenterTable, neighborTable } from '../grid';
import { plateVelocityAt } from '../plates';
import type { PlanetState } from '../state';

/**
 * The dominant other plate at boundary cell i: the most frequent differing
 * owner among the 4 neighbors (ties toward the lower plate id), plus one of
 * its cells (the first such neighbor in fixed order) for property lookups.
 * Returns null for interior cells.
 */
export function dominantOtherPlate(
  plateId: Float32Array,
  i: number,
  nbTable: Int32Array,
): { plate: number; cell: number } | null {
  const own = plateId[i]!;
  let bestPlate = -1;
  let bestVotes = 0;
  let bestCell = -1;
  for (let k = 0; k < 4; k++) {
    const nb = nbTable[i * 4 + k]!;
    const p = plateId[nb]!;
    if (p === own) continue;
    let votes = 0;
    let firstCell = -1;
    for (let m = 0; m < 4; m++) {
      const nb2 = nbTable[i * 4 + m]!;
      if (plateId[nb2] === p) {
        votes++;
        if (firstCell === -1) firstCell = nb2;
      }
    }
    if (votes > bestVotes || (votes === bestVotes && p < bestPlate)) {
      bestVotes = votes;
      bestPlate = p;
      bestCell = firstCell;
    }
  }
  return bestPlate === -1 ? null : { plate: bestPlate, cell: bestCell };
}

/**
 * Recompute the boundaryStress field for the current partition/kinematics.
 * stress(i) = (v_own − v_other) · û where û is the unit tangent direction
 * from cell i toward the dominant other plate's side — positive when the two
 * plates close on each other.
 */
export function computeBoundaryStress(state: PlanetState): Float32Array {
  const N = state.params.gridN;
  const R = state.params.radiusMeters;
  const plateId = state.fields.plateId;
  const centers = cellCenterTable(N);
  const nbTable = neighborTable(N);
  const stress = new Float32Array(plateId.length);

  for (let i = 0; i < plateId.length; i++) {
    const other = dominantOtherPlate(plateId, i, nbTable);
    if (other === null) continue;

    const cx = centers[i * 3]!;
    const cy = centers[i * 3 + 1]!;
    const cz = centers[i * 3 + 2]!;

    // Mean direction toward the DOMINANT plate's neighbors only, projected
    // onto the tangent plane at i (subtract the radial component) and
    // normalized. Blending all differing neighbors here while projecting a
    // single plate's relative velocity below flips the convergent/divergent
    // sign at triple junctions (review finding on #55): û and vOther must
    // describe the same plate pair.
    let ux = 0;
    let uy = 0;
    let uz = 0;
    for (let k = 0; k < 4; k++) {
      const nb = nbTable[i * 4 + k]!;
      if (plateId[nb] === other.plate) {
        ux += centers[nb * 3]! - cx;
        uy += centers[nb * 3 + 1]! - cy;
        uz += centers[nb * 3 + 2]! - cz;
      }
    }
    const radial = ux * cx + uy * cy + uz * cz;
    ux -= radial * cx;
    uy -= radial * cy;
    uz -= radial * cz;
    const len = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (len === 0) continue; // opposing differing neighbors cancel: pure shear cell
    ux /= len;
    uy /= len;
    uz /= len;

    const pos: [number, number, number] = [cx, cy, cz];
    const vOwn = plateVelocityAt(state.plates[plateId[i]!]!, pos, R);
    const vOther = plateVelocityAt(state.plates[other.plate]!, pos, R);
    stress[i] = (vOwn[0] - vOther[0]) * ux + (vOwn[1] - vOther[1]) * uy + (vOwn[2] - vOther[2]) * uz;
  }
  return stress;
}

/**
 * Subduction polarity (#16): does side A override side B at a convergent
 * boundary? Continental crust is buoyant and never subducts under oceanic;
 * between two oceanic sides the older (colder, denser) subducts; ties and
 * continent–continent contacts resolve to the lower plate id (collision
 * handling itself lives with the orogeny pass — this is only the
 * deterministic ownership rule).
 */
export function overrides(
  typeA: number,
  ageA: number,
  plateA: number,
  typeB: number,
  ageB: number,
  plateB: number,
): boolean {
  if (typeA !== typeB) return typeA === 1;
  if (typeA === 0 && ageA !== ageB) return ageA < ageB;
  return plateA < plateB;
}

/**
 * Convergent-margin topography (#16), applied every step after thermal
 * subsidence. For each active convergent boundary cell (stress above
 * ACTIVE_MARGIN_STRESS, exempted from the subsidence hard-set when oceanic):
 *
 *  - continent–continent: collision — symmetric orogeny on both sides,
 *    wider than a subduction margin (each side seeds when visited).
 *  - overriding continental side: orogeny — uplift spread a few cells
 *    inland with linear falloff, rate ∝ closing speed, capped at ~9 km.
 *  - overriding oceanic side: volcanic arc — elevation accumulates from its
 *    advected value toward a low island ceiling.
 *  - subducting oceanic side: trench — pinned below the local age-depth
 *    floor by up to TRENCH_EXTRA_DEPTH_M, scaled by closing speed. When a
 *    margin deactivates, trench and arc cells rejoin the subsidence hard-set
 *    and relax to the age-depth curve (a documented Phase 1 simplification:
 *    dead arcs sink instantly instead of persisting as seamounts).
 *
 * Arcs that build above ARC_MATURATION_ELEVATION_M become continental crust
 * (arc magmatism is how continental crust is manufactured) — the source of
 * new continental area balancing what collisions consume.
 *
 * Mutates only the caller's working `elevation`/`crustType` copies — never
 * state fields.
 */
export function applyConvergentTopography(
  state: PlanetState,
  stress: Float32Array,
  elevation: Float32Array,
  crustType: Float32Array,
  dtYears: number,
): void {
  const N = state.params.gridN;
  const nbTable = neighborTable(N);
  const { plateId, crustAge } = state.fields;
  // Arc magmatic flux is per unit margin length, concentrated onto a
  // one-cell-wide boundary line whose width shrinks ∝ 1/N — so the per-cell
  // elevation rate scales with N above the reference grid (see
  // ARC_GROWTH_REFERENCE_GRID_N for the saturation argument below it).
  const arcGrowthRate =
    ARC_GROWTH_RATE_M_PER_YR * Math.max(1, N / ARC_GROWTH_REFERENCE_GRID_N);

  interface Seed {
    cell: number;
    amount: number;
    width: number;
  }
  const seeds: Seed[] = [];

  for (let i = 0; i < plateId.length; i++) {
    if (stress[i]! <= ACTIVE_MARGIN_STRESS_M_PER_YR) continue;
    const other = dominantOtherPlate(plateId, i, nbTable);
    if (other === null) continue;

    const norm = Math.min(1, stress[i]! / OROGENY_STRESS_REF_M_PER_YR);
    const myType = crustType[i]!;
    const otherType = crustType[other.cell]!;

    if (myType === 1 && otherType === 1) {
      // Collision: this side seeds; the other side seeds when visited.
      seeds.push({ cell: i, amount: OROGENY_RATE_M_PER_YR * dtYears * norm, width: COLLISION_WIDTH_CELLS });
    } else if (
      overrides(myType, crustAge[i]!, plateId[i]!, otherType, crustAge[other.cell]!, other.plate)
    ) {
      if (myType === 1) {
        seeds.push({ cell: i, amount: OROGENY_RATE_M_PER_YR * dtYears * norm, width: OROGENY_WIDTH_CELLS });
      } else {
        elevation[i] = Math.min(elevation[i]! + arcGrowthRate * dtYears * norm, ARC_MAX_ELEVATION_M);
        // Maturation is accretionary (#59): an arc becomes continental crust
        // only where it touches continental crust already, so new continent
        // grows compactly at continent margins (accretionary belts) instead
        // of freckling along mid-ocean herringbone advection trails. At
        // deep-time equilibrium most continental crust has been recycled
        // through this term, so continents take the SHAPE of the creation
        // process — ungated maturation dissolved them into lace by ~3 Gyr.
        // Isolated arcs still build toward ARC_MAX_ELEVATION_M but stay
        // oceanic (a dead arc re-subsides to the age-depth curve). The
        // neighbor check reads the immutable pre-topography field, never the
        // working copy this loop mutates, so scan order cannot leak into the
        // result. The crustal-area budget this slows is protected by the
        // continental-conservation bulldozer in tectonics.ts (#16/#58).
        if (elevation[i]! >= ARC_MATURATION_ELEVATION_M) {
          const preCrust = state.fields.crustType;
          for (let k = 0; k < 4; k++) {
            if (preCrust[nbTable[i * 4 + k]!] === 1) {
              crustType[i] = 1;
              break;
            }
          }
        }
      }
    } else {
      // Subducting side is always oceanic (continental crust never loses to
      // oceanic under overrides(), and continent-continent is collision).
      elevation[i] = oceanicDepthForAge(crustAge[i]!) - TRENCH_EXTRA_DEPTH_M * norm;
    }
  }

  // Spread orogenic uplift inland: BFS through same-plate continental cells,
  // linear falloff over the seed's width, capped at the orogeny ceiling.
  // Deterministic: seeds are in ascending cell order, BFS order is fixed.
  // dist doubles as the visited marker; only touched cells are reset after
  // each seed, so cost stays O(seeds x width^2), not O(seeds x grid).
  const dist = new Int32Array(plateId.length).fill(-1);
  for (const seed of seeds) {
    const plate = plateId[seed.cell]!;
    dist[seed.cell] = 0;
    const queue = [seed.cell];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]!;
      const d = dist[c]!;
      const falloff = (seed.width + 1 - d) / (seed.width + 1);
      elevation[c] = Math.min(OROGENY_MAX_ELEVATION_M, elevation[c]! + seed.amount * falloff);
      if (d >= seed.width) continue;
      for (let k = 0; k < 4; k++) {
        const nb = nbTable[c * 4 + k]!;
        if (dist[nb] === -1 && plateId[nb] === plate && crustType[nb] === 1) {
          dist[nb] = d + 1;
          queue.push(nb);
        }
      }
    }
    for (const c of queue) dist[c] = -1;
  }
}
