/**
 * Erosion (#19, #65): slope-proportional diffusion of continental elevation
 * plus the two sinks that let old mountains die.
 *
 * 1. Diffusion (#19): conservative Jacobi diffusion over the 4-neighbor
 *    graph, continental cell pairs only, flux ∝ height difference × local
 *    precipitation. Steep young belts erode fast and lowlands fill with the
 *    removed volume. Fluxes are antisymmetric per pair, so within the
 *    continents this is pure redistribution.
 *
 * 2. Coastal sediment export (#65): a continental cell standing above sea
 *    level next to a submerged oceanic cell exports elevation across the
 *    coast — rivers grade to sea level, so the flux is proportional to the
 *    cell's height above sea level (`seaLevelM`, base level — #33), NOT to the
 *    full drop to the ocean floor (that gradient is what drowned coastlines
 *    before EROSION_SUBSEA_FACTOR existed). The exported volume leaves the
 *    continental budget and accumulates in the oceanic neighbor's sedimentM,
 *    which the age-depth relaxation (#15, tectonics.ts) adds to its target —
 *    the shelf shoals toward SEDIMENT_SHELF_CEILING_M and deposition stops
 *    when the shelf is full. Because the flux vanishes at 0 m, export alone
 *    can never push a coastline below sea level. Conservation now reads:
 *    Σ continental elevation + Σ sedimentM is invariant under (1) + (2).
 *
 * 3. Orogenic root decay (#65): continental elevation above
 *    OROGENIC_ROOT_REFERENCE_M relaxes exponentially toward it with time
 *    constant OROGENIC_ROOT_DECAY_TAU_YEARS — isostatic re-equilibration of
 *    the over-thickened crustal root. This is the term that retires interior
 *    belts welded in by sutures, which diffusion alone flattens on Gyr
 *    timescales and nothing else opposes; active-margin belts stay high
 *    because orogeny out-injects the decay by ~20×. Deliberately NOT
 *    conservative: root loss is subsidence, not transport.
 *
 * 4. Marine planation for small components (#90, default-off behind
 *    params.marinePlanation): the #84 recap pinned island immortality on
 *    this module — interior diffusion needs continental pairs, cross-coast
 *    flux is damped ×EROSION_SUBSEA_FACTOR, and coastal export vanishes at
 *    sea level, so a small block's peaks outlive the planet. For components
 *    smaller than MARINE_PLANATION_AREA_M2 (strength ramps linearly with
 *    smallness), wave attack (a) lifts the subsea damping on the block's
 *    internal diffusion, and (b) exports elevation across the coast toward
 *    the shelf/founder level (MICROCONTINENT_FOUNDER_ELEVATION_M) at
 *    MARINE_PLANATION_RATE_M_PER_YR — a rate that neither scales with
 *    precipitation (wave energy, not runoff) nor vanishes at the coastline,
 *    so it planes islands to submerged platform where ordinary export
 *    asymptotes. The removed mass moves into the neighbor's sedimentM under
 *    the same shelf-room cap as (2) — the conservation invariant
 *    Σ(cont elevation) + Σ(sedimentM) extends over this flux unchanged,
 *    the designed contrast with the #84 founder's non-conservative
 *    subsidence.
 *
 * 5. Crustal columns, stage C2 (docs/CRUSTAL_COLUMN_PROPOSAL.md §5 sites
 *    13–15, §6 C2): under an active `crustalColumns` the three fluxes above
 *    become REAL MASS TRANSACTIONS in thickness space — the same rate laws,
 *    with the computed flux read as ROCK THICKNESS removed (denudation, which
 *    is what EROSION_RATE_PER_YR's mm/kyr calibration always described)
 *    instead of surface drop. The surface answers through the derivation:
 *    Δe = k·ΔT ≈ 0.142·ΔT (isostasy.ts) — erode 1 km of rock and the surface
 *    drops only ~142 m, the emergent rebound that planes interiors toward
 *    base level without a craton servo (proposal closure check 1). Ledger
 *    honesty, per trap T7 (±35% per-cell area distortion):
 *      - diffusion moves VOLUME `X·(Ω_i+Ω_j)/2` between the columns
 *        (ΔT = ∓V/Ω), so continental crustal mass is conserved exactly;
 *      - export/planation deposit `Δsed = X·(ρ_cc/ρ_sed)·(Ω_i/Ω_j)` — the
 *        density conversion (site 14) on true areas, so
 *        Σ(T·ρ_cc·A) + Σ(sed·ρ_sed·A) is invariant across the coast;
 *      - the never-below-sea / never-below-planation-level caps bind on the
 *        SURFACE, so the thickness caps divide by k; the shelf-room cap
 *        converts through the density + area ratio.
 *    Root decay (site 16) is physical since stage C3: thickness above
 *    CONTINENTAL_THICKNESS_EQUILIBRIUM_M (39 km) relaxes toward it with the
 *    unchanged τ = 300 Myr — the target no longer reads sea level (T1).
 *    Source/sink throughput is accumulated into the `columns*` globals
 *    counters (state.ts) for the C2 gate's planation-rate report; flag-off
 *    the path below never runs and the counters hold 0.
 *
 * Scope: oceanic ELEVATION is never written (it is isostatic, a function of
 * crustAge — #15); export writes oceanic sedimentM only. Fluxes are computed
 * Jacobi-style from the pre-step elevation; the export deposit cap reads the
 * accumulating sedimentM in fixed cell order, which is deterministic.
 */

import { seaKeyedOceanicDepthForAge } from '../bathymetry';
import { labelContinentalComponents } from '../components';
import {
  CONTINENTAL_BUOYANCY_FACTOR,
  CONTINENTAL_THICKNESS_EQUILIBRIUM_M,
  CRUST_DENSITY_CONTINENTAL_KG_M3,
  EROSION_PRECIP_FACTOR_MAX,
  EROSION_PRECIP_FACTOR_MIN,
  EROSION_PRECIP_REF,
  EROSION_RATE_PER_YR,
  EROSION_SUBSEA_FACTOR,
  MARINE_PLANATION_AREA_M2,
  MARINE_PLANATION_RATE_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OROGENIC_ROOT_DECAY_TAU_YEARS,
  OROGENIC_ROOT_REFERENCE_M,
  SEDIMENT_DENSITY_KG_M3,
  SEDIMENT_SHELF_CEILING_M,
} from '../constants';
import { bathymetryDatumOffsetM, landDatumOffsetM, platformDatumOffsetM } from '../datums';
import { cellCount, cellSolidAngleTable, neighborTable } from '../grid';
import { continentalElevationForThicknessM, crustalColumnsActive } from '../isostasy';
import type { PlanetState } from '../state';
import type { System } from '../step';

/**
 * Marine planation (#90): per-cell wave-attack strength, 1 − area/ref
 * clamped to [0, 1] — full attack on a speck, none at/above the threshold,
 * no cliff as a component grows across it. null when off (and every flag-off
 * consumer below is byte-identical to the pre-#90 kernel). Hoisted so the
 * legacy and crustal-columns paths share it verbatim — pure reads.
 */
function planationStrengthField(state: PlanetState): Float32Array | null {
  if (
    !(state.params.marinePlanation && state.timeYears >= state.params.marinePlanationOnsetYears)
  ) {
    return null;
  }
  const N = state.params.gridN;
  const { componentOf, areasM2 } = labelContinentalComponents(
    state.fields.crustType,
    N,
    state.params.radiusMeters,
  );
  const strength = areasM2.map((a) => Math.max(0, 1 - a / MARINE_PLANATION_AREA_M2));
  if (!strength.some((s) => s > 0)) return null;
  const count = cellCount(N);
  const planation = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const comp = componentOf[i]!;
    if (comp !== -1) planation[i] = strength[comp]!;
  }
  return planation;
}

/**
 * Stages C2–C3 (sites 13–16): erosion as thickness transactions — see doc
 * block (5). Every continental write stores thickness FIRST and re-derives
 * elevation from the stored Float32 (the C1 coherence contract), so
 * `e === fround(C + k·T)` stays bit-exact through this system.
 */
function applyColumns(state: PlanetState, dtYears: number): PlanetState {
  const N = state.params.gridN;
  const count = cellCount(N);
  const nbTable = neighborTable(N);
  const solidAngle = cellSolidAngleTable(N);
  const r2 = state.params.radiusMeters * state.params.radiusMeters;
  const { crustType, precipitation, crustAge } = state.fields;
  // Previous step's sea level (the #33 explicit lag), as in the legacy path.
  const seaLevel = state.globals.seaLevelM;
  const old = state.fields.elevation;
  const elevation = old.slice();
  const thickness = state.fields.crustalThicknessM.slice();
  const sedimentM = state.fields.sedimentM.slice();
  const datumOffset = platformDatumOffsetM(state);
  const shelfCeiling = datumOffset + SEDIMENT_SHELF_CEILING_M;
  const planationLevel = datumOffset + MICROCONTINENT_FOUNDER_ELEVATION_M;
  const bathyOffset = bathymetryDatumOffsetM(state);
  const planation = planationStrengthField(state);

  const k = CONTINENTAL_BUOYANCY_FACTOR;
  // Meters of sediment per meter of eroded rock at equal area: rock is denser,
  // so the pile is thicker than the column it came from (site 14's ρ_cc/ρ_sed).
  const rockToSed = CRUST_DENSITY_CONTINENTAL_KG_M3 / SEDIMENT_DENSITY_KG_M3;

  // C2 gate instrumentation (cumulative globals counters, state.ts).
  let exportedRockM3 = 0;
  let exportVisits = 0;
  let shelfLimited = 0;

  for (let i = 0; i < count; i++) {
    if (crustType[i] !== 1) continue;
    const ai = solidAngle[i]!;
    for (let nb = 0; nb < 4; nb++) {
      const j = nbTable[i * 4 + nb]!;
      const precipFactor = Math.min(
        EROSION_PRECIP_FACTOR_MAX,
        Math.max(
          EROSION_PRECIP_FACTOR_MIN,
          (precipitation[i]! + precipitation[j]!) / 2 / EROSION_PRECIP_REF,
        ),
      );
      if (crustType[j] === 1) {
        // Site 13 — interior diffusion, each unordered pair once. The same
        // slope-driven denudation law as the legacy path; X is meters of ROCK
        // at the shared edge, moved as volume so mass is conserved on true
        // areas. Rebound emerges: each side's surface answers by k·ΔT.
        if (j <= i) continue;
        let subsea = old[i]! < seaLevel || old[j]! < seaLevel ? EROSION_SUBSEA_FACTOR : 1;
        if (planation !== null && subsea < 1) {
          const s = Math.max(planation[i]!, planation[j]!);
          if (s > 0) subsea += (1 - subsea) * s;
        }
        const X = EROSION_RATE_PER_YR * dtYears * precipFactor * subsea * (old[i]! - old[j]!);
        if (X !== 0) {
          const aj = solidAngle[j]!;
          const volume = X * 0.5 * (ai + aj); // solid-angle volume; R² cancels
          thickness[i] = thickness[i]! - volume / ai;
          thickness[j] = thickness[j]! + volume / aj;
          elevation[i] = continentalElevationForThicknessM(thickness[i]!);
          elevation[j] = continentalElevationForThicknessM(thickness[j]!);
        }
      } else {
        // Coastal terms: only toward a submerged oceanic neighbor, as today.
        if (old[j]! >= seaLevel) continue;
        const aj = solidAngle[j]!;
        // Site 14 — coastal export. Rivers grade to base level, so the
        // denudation rate scales with height above SEA LEVEL; the surface cap
        // (never draw the cell below sea, however many neighbors drew from it
        // this step) binds on the DERIVED surface, hence /k in rock space.
        if (old[i]! > seaLevel) {
          exportVisits++;
          const desired = EROSION_RATE_PER_YR * dtYears * precipFactor * (old[i]! - seaLevel);
          const room =
            shelfCeiling - (seaKeyedOceanicDepthForAge(crustAge[j]!, bathyOffset) + sedimentM[j]!);
          // Rock the shelf can still take: sediment room × density × area ratio.
          const roomRock = room > 0 ? (room / rockToSed) * (aj / ai) : 0;
          const surfaceRock = Math.max(0, elevation[i]! - seaLevel) / k;
          if (roomRock < Math.min(desired, surfaceRock)) shelfLimited++;
          const X = Math.min(desired, roomRock, surfaceRock);
          if (X > 0) {
            thickness[i] = thickness[i]! - X;
            elevation[i] = continentalElevationForThicknessM(thickness[i]!);
            sedimentM[j]! += X * rockToSed * (ai / aj);
            exportedRockM3 += X * ai * r2;
          }
        }
        // Site 15 — marine planation export (#90): wave attack grades a small
        // component's coast toward the shelf/founder level; does NOT stop at
        // sea level. Same deposit ledger, density conversion and shelf-room
        // cap as site 14 (the room re-reads sedimentM[j], which the flux
        // above may just have raised).
        if (planation !== null && planation[i]! > 0) {
          if (old[i]! <= planationLevel) continue;
          exportVisits++;
          const desired = MARINE_PLANATION_RATE_M_PER_YR * dtYears * planation[i]!;
          const room =
            shelfCeiling - (seaKeyedOceanicDepthForAge(crustAge[j]!, bathyOffset) + sedimentM[j]!);
          const roomRock = room > 0 ? (room / rockToSed) * (aj / ai) : 0;
          // Never plane the SURFACE below the founder level, hence /k.
          const surfaceRock = Math.max(0, elevation[i]! - planationLevel) / k;
          if (roomRock < Math.min(desired, surfaceRock)) shelfLimited++;
          const X = Math.min(desired, roomRock, surfaceRock);
          if (X > 0) {
            thickness[i] = thickness[i]! - X;
            elevation[i] = continentalElevationForThicknessM(thickness[i]!);
            sedimentM[j]! += X * rockToSed * (ai / aj);
            exportedRockM3 += X * ai * r2;
          }
        }
      }
    }
  }

  // Site 16 — orogenic root decay, physical since stage C3: thickness above
  // CONTINENTAL_THICKNESS_EQUILIBRIUM_M relaxes toward it with the same
  // τ = 300 Myr (the timescale was always the physical part; the target
  // becomes the cited 39 km equilibrium column). The sea-keyed land-relief
  // reference retires on this path — one less relaxation target reading sea
  // level (trap T1). Still deliberately non-conservative: root loss is
  // foundering into the mantle, not transport (today's declared posture).
  // Applied to the post-flux columns, as the legacy decay is to the
  // post-flux surface.
  const keep = Math.exp(-dtYears / OROGENIC_ROOT_DECAY_TAU_YEARS);
  for (let i = 0; i < count; i++) {
    if (crustType[i] !== 1) continue;
    const t = thickness[i]!;
    if (t > CONTINENTAL_THICKNESS_EQUILIBRIUM_M) {
      thickness[i] =
        CONTINENTAL_THICKNESS_EQUILIBRIUM_M + (t - CONTINENTAL_THICKNESS_EQUILIBRIUM_M) * keep;
      elevation[i] = continentalElevationForThicknessM(thickness[i]!);
    }
  }

  return {
    ...state,
    globals: {
      ...state.globals,
      columnsExportedRockM3: state.globals.columnsExportedRockM3 + exportedRockM3,
      columnsExportShelfLimited: state.globals.columnsExportShelfLimited + shelfLimited,
      columnsExportVisits: state.globals.columnsExportVisits + exportVisits,
    },
    fields: { ...state.fields, elevation, sedimentM, crustalThicknessM: thickness },
  };
}

export const erosionSystem: System = {
  name: 'erosion',
  apply: (state, dtYears) => {
    // Crustal columns (stage C2): sites 13–15 become thickness transactions —
    // a separate path, so the flag-off arithmetic below stays byte-identical.
    if (crustalColumnsActive(state)) return applyColumns(state, dtYears);

    const N = state.params.gridN;
    const count = cellCount(N);
    const nbTable = neighborTable(N);
    const { crustType, precipitation, crustAge } = state.fields;
    // Previous step's sea level (the #33 explicit lag): base level for coastal
    // export and the submerged/emergent split of the diffusion damping.
    const seaLevel = state.globals.seaLevelM;
    const old = state.fields.elevation;
    const elevation = old.slice();
    const sedimentM = state.fields.sedimentM.slice();
    // Sea-level-anchored datums (datums.ts): the sediment shelf ceiling and
    // the planation target are physically sea-level-relative (a shelf break
    // sits ~200 m below the WAVES); the offset anchors them to the dynamic
    // sea level when the mechanism is on, and is exactly 0 when off.
    const datumOffset = platformDatumOffsetM(state);
    const shelfCeiling = datumOffset + SEDIMENT_SHELF_CEILING_M;
    const planationLevel = datumOffset + MICROCONTINENT_FOUNDER_ELEVATION_M;
    // Sea-level-keyed bathymetry (#102, datums.ts + bathymetry.ts): the
    // shelf-room check measures the relaxation target (age-depth curve +
    // sediment), so the curve reference carries the bathymetry datum offset;
    // offset 0 means the exact absolute curve.
    const bathyOffset = bathymetryDatumOffsetM(state);

    const planation = planationStrengthField(state);

    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1) continue;
      for (let k = 0; k < 4; k++) {
        const j = nbTable[i * 4 + k]!;
        const precipFactor = Math.min(
          EROSION_PRECIP_FACTOR_MAX,
          Math.max(
            EROSION_PRECIP_FACTOR_MIN,
            (precipitation[i]! + precipitation[j]!) / 2 / EROSION_PRECIP_REF,
          ),
        );
        if (crustType[j] === 1) {
          // Each unordered continental pair once.
          if (j <= i) continue;
          // Base-level damping: flux involving a submerged cell is slow (the
          // coast is where rivers deposit). Symmetric, so still conservative.
          let subsea = old[i]! < seaLevel || old[j]! < seaLevel ? EROSION_SUBSEA_FACTOR : 1;
          // #90: wave attack keeps a small block's interior draining — the
          // damping lifts toward 1 with the pair's larger planation strength
          // (both endpoints are continental, so almost always one component).
          // Still symmetric per pair, so still conservative.
          if (planation !== null && subsea < 1) {
            const s = Math.max(planation[i]!, planation[j]!);
            if (s > 0) subsea += (1 - subsea) * s;
          }
          const flux = EROSION_RATE_PER_YR * dtYears * precipFactor * subsea * (old[i]! - old[j]!);
          elevation[i]! -= flux;
          elevation[j]! += flux;
        } else {
          // Coastal export (#65): only from subaerial continent to submerged
          // ocean (an emergent arc neighbor above sea level receives nothing).
          // Each such pair has exactly one continental endpoint, so it is
          // visited exactly once — no index guard needed.
          if (old[j]! >= seaLevel) continue;
          if (old[i]! > seaLevel) {
            // The shelf's remaining capacity: how far the relaxation target
            // (age-depth curve + sediment) still sits below the fill ceiling.
            const room = shelfCeiling - (seaKeyedOceanicDepthForAge(crustAge[j]!, bathyOffset) + sedimentM[j]!);
            if (room > 0) {
              const flux = Math.min(
                // Rivers grade to base level (sea level, #33), so export scales
                // with the cell's height ABOVE SEA LEVEL, not the full drop to
                // the floor.
                EROSION_RATE_PER_YR * dtYears * precipFactor * (old[i]! - seaLevel),
                room,
                // Never draw a cell below sea level, whatever dt or how many
                // oceanic neighbors already drew from it this step.
                Math.max(0, elevation[i]! - seaLevel),
              );
              elevation[i]! -= flux;
              sedimentM[j]! += flux;
            }
          }
          // Marine planation export (#90): wave attack grades a small
          // component's coast toward the shelf/founder level — it does NOT
          // stop at sea level, which is exactly the asymptote that made
          // islands immortal. Same deposit ledger and shelf-room cap as
          // ordinary export (the room re-reads sedimentM[j], which the flux
          // above may just have raised), so conservation is unchanged.
          if (planation !== null && planation[i]! > 0) {
            if (old[i]! <= planationLevel) continue;
            const room = shelfCeiling - (seaKeyedOceanicDepthForAge(crustAge[j]!, bathyOffset) + sedimentM[j]!);
            if (room <= 0) continue;
            const flux = Math.min(
              MARINE_PLANATION_RATE_M_PER_YR * dtYears * planation[i]!,
              room,
              // Never plane below the founder level, whatever dt or how many
              // oceanic neighbors drew from the cell this step.
              Math.max(0, elevation[i]! - planationLevel),
            );
            elevation[i]! -= flux;
            sedimentM[j]! += flux;
          }
        }
      }
    }

    // Orogenic root decay (#65), applied to the post-flux elevation. keep is
    // hoisted so Math.exp runs once per step, not per cell. The reference is
    // a land-relief datum ("terrain standing ~1 km above the SEA carries an
    // excess root"); under the freeboard mechanism it rides the dynamic sea
    // level (landDatumOffsetM, datums.ts), and is exactly the absolute
    // constant when the mechanism is off.
    const rootReference = landDatumOffsetM(state) + OROGENIC_ROOT_REFERENCE_M;
    const keep = Math.exp(-dtYears / OROGENIC_ROOT_DECAY_TAU_YEARS);
    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1) continue;
      const e = elevation[i]!;
      if (e > rootReference) {
        elevation[i] = rootReference + (e - rootReference) * keep;
      }
    }

    return { ...state, fields: { ...state.fields, elevation, sedimentM } };
  },
};
