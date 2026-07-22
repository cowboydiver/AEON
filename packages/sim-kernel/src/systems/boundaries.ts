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

import { seaKeyedOceanicDepthForAge } from '../bathymetry';
import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  ARC_CREATION_REFERENCE_GRID_N,
  ARC_EMERGENT_GROWTH_FACTOR,
  ARC_GROWTH_RATE_M_PER_YR,
  ARC_MATURATION_ELEVATION_M,
  ARC_MATURATION_THICKNESS_M,
  ARC_MAX_ELEVATION_M,
  COLLISION_WIDTH_CELLS,
  COMPACT_ARC_MIN_CONT_NEIGHBORS,
  CONTINENTAL_THICKNESS_MAX_M,
  OROGENY_MAX_ELEVATION_M,
  OROGENY_RATE_M_PER_YR,
  OROGENY_STRESS_REF_M_PER_YR,
  OROGENY_WIDTH_CELLS,
  TRENCH_EXTRA_DEPTH_M,
} from '../constants';
import { bathymetryDatumOffsetM, landDatumOffsetM, platformDatumOffsetM } from '../datums';
import { cellCenterTable, cellSolidAngleTable, neighborTable, type Vec3 } from '../grid';
import { continentalElevationForThicknessM, foundColumnFromElevation } from '../isostasy';
import { plateVelocityAt } from '../plates';
import type { PlanetState } from '../state';

/**
 * The pair-consistent unit tangent at boundary cell `i` pointing toward the
 * side owned by `otherPlate`: the mean direction to i's neighbors that belong
 * to `otherPlate` ONLY, projected onto the tangent plane at i (radial
 * component removed) and normalized. Returns `null` for the pure-shear cell
 * where opposing differing neighbors cancel (zero-length tangent).
 *
 * Blending all differing neighbors here while projecting a single plate's
 * relative velocity flips the convergent/divergent sign at triple junctions
 * (review finding on #55): û and the relative velocity must describe the same
 * plate pair. Factored out of `computeBoundaryStress` so `plateDynamics`
 * (Tectonics V2 stage 1, #111) reuses the identical construction — it must
 * stay byte-for-byte the same arithmetic.
 */
export function pairConsistentTangent(
  centers: Float64Array,
  nbTable: Int32Array,
  plateId: Float32Array,
  i: number,
  otherPlate: number,
): Vec3 | null {
  const cx = centers[i * 3]!;
  const cy = centers[i * 3 + 1]!;
  const cz = centers[i * 3 + 2]!;
  let ux = 0;
  let uy = 0;
  let uz = 0;
  for (let k = 0; k < 4; k++) {
    const nb = nbTable[i * 4 + k]!;
    if (plateId[nb] === otherPlate) {
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
  if (len === 0) return null; // opposing differing neighbors cancel: pure shear cell
  return [ux / len, uy / len, uz / len];
}

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

    // Pair-consistent unit tangent toward the dominant other plate (shared
    // helper — û and the relative velocity below must describe the same pair).
    const u = pairConsistentTangent(centers, nbTable, plateId, i, other.plate);
    if (u === null) continue; // pure shear cell
    const ux = u[0];
    const uy = u[1];
    const uz = u[2];

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
 * Arcs that build above the maturation gate become continental crust (arc
 * magmatism is how continental crust is manufactured) — the source of new
 * continental area balancing what collisions consume. The gate is
 * ARC_MATURATION_ELEVATION_M (sea-keyed under seaLevelDatums) on the legacy
 * path and the absolute e(ARC_MATURATION_THICKNESS_M) on the columns path
 * (C4 site 10 — see the gate comment below).
 *
 * Mutates only the caller's working `elevation`/`crustType` copies — never
 * state fields. Returns the columns-path diagnostics (all exactly 0 when
 * `crustalThicknessM` is null — the legacy path is not instrumented).
 */
export interface ConvergentTopographyStats {
  /** Orogeny/collision thickness additions clipped by the 70 km ceiling
   *  (C3 — accumulated into `globals.columnsThicknessCapBinds`). */
  capBinds: number;
  /** Arc-maturation flips this step (C4 — the maturation-depth
   *  distribution's denominator). */
  maturationFlips: number;
  /** Σ of flip-time elevation over those flips, m (C4 — mean maturation
   *  depth per interval = Δsum/Δflips in sim-cli). */
  maturationElevSumM: number;
  /** Rock volume founded at those flips (inversion thickness × true cell
   *  area), m³ — the arc-accretion creation credit (C4). */
  maturationCreditM3: number;
}

export function applyConvergentTopography(
  state: PlanetState,
  stress: Float32Array,
  elevation: Float32Array,
  crustType: Float32Array,
  dtYears: number,
  // Crustal columns: the caller's working thickness copy, or null when the
  // mechanism is inactive. Since stage C3 the orogeny/collision BFS is a
  // real thickness transaction (crustal shortening as rock addition, capped
  // at the 70 km collapse ceiling — see the seed loop); maturation flips
  // found the new column by inversion. Oceanic writes (arc growth, trench
  // pinning) are untouched — the oceanic branch keeps today's machinery
  // verbatim (proposal §2.4, trap T1).
  crustalThicknessM: Float32Array | null = null,
): ConvergentTopographyStats {
  const N = state.params.gridN;
  const nbTable = neighborTable(N);
  const { plateId, crustAge } = state.fields;
  // Arc magmatic flux is per unit margin length, concentrated onto a
  // one-cell-wide boundary line whose width shrinks ∝ 1/N — so the per-cell
  // elevation rate scales with N above the reference grid, and the
  // accretionary belt (fixed physical width) does too (see
  // ARC_CREATION_REFERENCE_GRID_N for both arguments).
  const arcGrowthRate =
    ARC_GROWTH_RATE_M_PER_YR * Math.max(1, N / ARC_CREATION_REFERENCE_GRID_N);
  const beltRadius = Math.max(1, Math.round(N / ARC_CREATION_REFERENCE_GRID_N));
  // Emergent-arc growth taper (#91, default-off): above sea level, arc
  // growth is scaled by ARC_EMERGENT_GROWTH_FACTOR so only long-lived
  // subduction builds emergent chains (see the constant's comment). Reads
  // the previous step's sea level — the same explicit lag erosion uses.
  const emergentTaper =
    state.params.emergentArcTaper && state.timeYears >= state.params.emergentArcTaperOnsetYears;
  const seaLevel = state.globals.seaLevelM;
  // Compact arc maturation (#89, default-off): a belt candidate matures only
  // with >= COMPACT_ARC_MIN_CONT_NEIGHBORS continental 4-neighbors in the
  // pre-topography crust map, so creation grows blobs instead of chains.
  const compactArcs =
    state.params.compactArcs && state.timeYears >= state.params.compactArcsOnsetYears;
  // Sea-level-anchored datums (datums.ts): the arc island ceiling and the
  // maturation gate are physically sea-level-relative ("a 1 km island",
  // "matures 500 m before emerging"); the offset anchors them to the dynamic
  // sea level when the mechanism is on, and is exactly 0 when off.
  const datumOffset = platformDatumOffsetM(state);
  // C4 (site 10, gate only — the growth term above is untouched): on the
  // columns path the maturation gate is the ABSOLUTE derived-equivalent
  // elevation e(ARC_MATURATION_THICKNESS_M) ≈ −2306 m — one condition, two
  // readings: the cell's elevation-inversion thickness reaches the cited
  // 20 km (Suyehiro et al. 1996; Calvert 2011) exactly when its elevation
  // reaches this level, so the inversion-at-flip below founds ≥ 20 km by
  // algebra. The gate stops reading sea level here (one less sea-keyed
  // target — trap T1); the creation-budget shift this causes is the reason
  // stage C4 reads crust fraction FIRST (trap T3, proposal §6 C4).
  const maturationGate =
    crustalThicknessM !== null
      ? continentalElevationForThicknessM(ARC_MATURATION_THICKNESS_M)
      : datumOffset + ARC_MATURATION_ELEVATION_M;
  // C7 (the creation-datum re-key — the C5 §3 dry-half starvation fix): the
  // island ceiling is a sea-relative statement about EMERGENT edifices ("a
  // 1 km island"); read verbatim under a sea more than ~3.3 km below the
  // datum it caps arc columns at ~12 km thickness-equivalent — below the
  // cited 20–35 km arc-crust range the maturation threshold is built on —
  // and continental creation starves while consumption continues (measured:
  // crust fraction 40% → 3.5% at water scale 0.5, C5 gate record §3). On
  // the columns path the ceiling therefore never falls below the absolute
  // maturation gate: an arc column can always build at least to the
  // thickness at which arc crust IS continental, whatever the sea does. The
  // sea-keyed ceiling still owns the wet regime (it binds whenever the sea
  // sits above ≈ −3.3 km — every measured scale ≥ 1.0 sea), so scale-1.0
  // behavior is unchanged wherever the floor never engages. Legacy path
  // untouched (flag-off byte-identity is structural).
  const arcCeiling =
    crustalThicknessM !== null
      ? Math.max(datumOffset + ARC_MAX_ELEVATION_M, maturationGate)
      : datumOffset + ARC_MAX_ELEVATION_M;
  // Freeboard regulation (datums.ts): the orogeny ceiling is a land-relief
  // datum ("mountains cap near 9 km" — above the SEA); under the freeboard
  // mechanism it rides the dynamic sea level, and is exactly the absolute
  // constant when the mechanism is off.
  const orogenyCeiling = landDatumOffsetM(state) + OROGENY_MAX_ELEVATION_M;
  // Sea-level-keyed bathymetry (#102, datums.ts + bathymetry.ts): the trench
  // hard-set pins below the age-depth reference, whose crest rides the
  // dynamic sea level under the bathymetryDatum mechanism; offset 0 means
  // the exact absolute curve.
  const bathyOffset = bathymetryDatumOffsetM(state);
  // Arc cells that reached maturation elevation this step (#67): maturation
  // is decided in one attachment pass after the margin loop, not inline —
  // see below.
  const matureCandidates: number[] = [];
  let maturationFlips = 0;
  let maturationElevSumM = 0;
  let maturationCreditM3 = 0;

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
        if (emergentTaper) {
          // #91: full-rate submarine construction, tapered subaerial growth.
          // Growth that would land above sea level is split at the surface:
          // the submerged portion applies in full (the −500 m maturation
          // gate is reached exactly as without the taper), the emergent
          // remainder is scaled by ARC_EMERGENT_GROWTH_FACTOR.
          const e = elevation[i]!;
          const full = arcGrowthRate * dtYears * norm;
          let grown = e + full;
          if (grown > seaLevel) {
            const submerged = Math.max(0, seaLevel - e);
            grown = Math.max(e, seaLevel) + (full - submerged) * ARC_EMERGENT_GROWTH_FACTOR;
          }
          elevation[i] = Math.min(grown, arcCeiling);
        } else {
          elevation[i] = Math.min(elevation[i]! + arcGrowthRate * dtYears * norm, arcCeiling);
        }
        if (elevation[i]! >= maturationGate) matureCandidates.push(i);
      }
    } else {
      // Subducting side is always oceanic (continental crust never loses to
      // oceanic under overrides(), and continent-continent is collision).
      elevation[i] = seaKeyedOceanicDepthForAge(crustAge[i]!, bathyOffset) - TRENCH_EXTRA_DEPTH_M * norm;
    }
  }

  // Maturation is accretionary (#59): an arc becomes continental crust only
  // inside the accretionary belt — within beltRadius cells (fixed physical
  // width, ∝N in cells) of pre-topography continental crust — so new
  // continent grows at continent margins (accretionary belts) instead of
  // freckling along mid-ocean herringbone advection trails. At deep-time
  // equilibrium most continental crust has been recycled through this term,
  // so continents take the SHAPE of the creation process — ungated
  // maturation dissolved them into lace by ~3 Gyr. Isolated arcs still
  // build toward ARC_MAX_ELEVATION_M but stay oceanic (a dead arc
  // re-subsides to the age-depth curve). Maturation is applied in ONE pass
  // after the margin loop (since #67), so no margin cell's collision/
  // polarity branch can observe a maturation from earlier in the same scan.
  // The belt mask reads the immutable pre-topography crustType field; each
  // mask bit is set exactly once, so scan order cannot leak into the
  // result. The crustal-area budget the gate slows is protected by the
  // continental-conservation bulldozer in tectonics.ts (#16/#58).
  //
  // #67 measured negative: a stricter ATTACHMENT gate (mature only when
  // 4-connected to the continent through cells already at maturation
  // elevation — accretion onto a face, never across open water) removed the
  // detached-freckle deposition but starved creation for zero net shape
  // gain once margin consolidation (tectonics.ts) existed: land minima fell
  // 2-4 points (seed 1337 to 10.9%, grazing the #20 floor) while largest-
  // component coherence stayed within noise of the belt-only gate. The
  // freckles the belt gate deposits are not a shape leak under
  // consolidation — they are creation-budget flux that consolidation
  // relocates into enclave holes. See PHASE_2_STAGE0_FINDINGS.md, "#67".
  if (matureCandidates.length > 0) {
    const preCrust = state.fields.crustType;
    const belt = new Uint8Array(plateId.length);
    let frontier: number[] = [];
    for (let i = 0; i < plateId.length; i++) {
      if (preCrust[i] === 1) {
        belt[i] = 1;
        frontier.push(i);
      }
    }
    for (let d = 0; d < beltRadius && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const c of frontier) {
        for (let k = 0; k < 4; k++) {
          const nb = nbTable[c * 4 + k]!;
          if (belt[nb] === 0) {
            belt[nb] = 1;
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    // C4 diagnostics: the maturation-depth distribution and the founded-mass
    // creation credit, on true solid-angle areas (trap T7). Columns-path
    // only; the legacy path stays uninstrumented (stats hold 0).
    const solidAngle = crustalThicknessM !== null ? cellSolidAngleTable(N) : null;
    const r2 = state.params.radiusMeters * state.params.radiusMeters;
    for (const i of matureCandidates) {
      if (belt[i] !== 1) continue;
      if (compactArcs) {
        // #89: mature only against a concave stretch of continent (>= 2
        // continental 4-neighbors in the PRE-topography map — immutable
        // this step, so scan order cannot leak). A coast-parallel chain
        // cell has 1 and stays an oceanic arc; it can mature in a later
        // step once the continent grows around it. Creation is reshaped
        // toward blobs, not throttled to enclosed holes (the measured-fatal
        // #67 attachment-gate trap used connectivity through other arcs).
        let contNb = 0;
        for (let k = 0; k < 4; k++) {
          if (preCrust[nbTable[i * 4 + k]!] === 1) contNb++;
        }
        if (contNb < COMPACT_ARC_MIN_CONT_NEIGHBORS) continue;
      }
      crustType[i] = 1;
      // C1 branch flip (oceanic → continental, proposal §2.4): the matured
      // cell founds its column by inversion of its current elevation — the
      // assigned mass IS the ledger's arc-accretion credit, and elevation is
      // continuous through the flip by construction. Under the C4 absolute
      // gate the inversion is ≥ ARC_MATURATION_THICKNESS_M by algebra.
      // The cell's sediment cover, if any, accretes as thickness in the
      // tectonics site-22 sweep this same step (C4).
      if (crustalThicknessM !== null && solidAngle !== null) {
        foundColumnFromElevation(elevation, crustalThicknessM, i);
        maturationFlips++;
        maturationElevSumM += elevation[i]!;
        maturationCreditM3 += crustalThicknessM[i]! * solidAngle[i]! * r2;
      }
    }
  }

  // Spread orogenic uplift inland: BFS through same-plate continental cells,
  // linear falloff over the seed's width, capped at the orogeny ceiling.
  // Deterministic: seeds are in ascending cell order, BFS order is fixed.
  // dist doubles as the visited marker; only touched cells are reset after
  // each seed, so cost stays O(seeds x width^2), not O(seeds x grid).
  let capBinds = 0;
  const dist = new Int32Array(plateId.length).fill(-1);
  for (const seed of seeds) {
    const plate = plateId[seed.cell]!;
    dist[seed.cell] = 0;
    const queue = [seed.cell];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]!;
      const d = dist[c]!;
      const falloff = (seed.width + 1 - d) / (seed.width + 1);
      if (crustalThicknessM !== null) {
        // C3 (site 12): crustal shortening as a real thickness addition —
        // the same rate constant read as ROCK (600 m/Myr of thickness at
        // full stress: Tibetan-order shortening influx; the surface answers
        // k·ΔT ≈ 85 m/Myr through the derivation). The 9 km ELEVATION
        // ceiling retires on this path; the physical stop is the 70 km
        // gravitational-collapse thickness cap (England & Houseman 1989),
        // which only ever clips the ADDITION — it never snaps an already
        // over-thick shim-era column down (root decay owns that relaxation).
        const tCur = crustalThicknessM[c]!;
        const add = seed.amount * falloff;
        if (tCur + add > CONTINENTAL_THICKNESS_MAX_M) {
          capBinds++;
          if (tCur < CONTINENTAL_THICKNESS_MAX_M) {
            crustalThicknessM[c] = CONTINENTAL_THICKNESS_MAX_M;
            elevation[c] = continentalElevationForThicknessM(crustalThicknessM[c]!);
          }
        } else {
          crustalThicknessM[c] = tCur + add;
          elevation[c] = continentalElevationForThicknessM(crustalThicknessM[c]!);
        }
      } else {
        elevation[c] = Math.min(orogenyCeiling, elevation[c]! + seed.amount * falloff);
      }
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
  return { capBinds, maturationFlips, maturationElevSumM, maturationCreditM3 };
}
