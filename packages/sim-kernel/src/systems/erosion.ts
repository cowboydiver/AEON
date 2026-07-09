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
 * Scope: oceanic ELEVATION is never written (it is isostatic, a function of
 * crustAge — #15); export writes oceanic sedimentM only. Fluxes are computed
 * Jacobi-style from the pre-step elevation; the export deposit cap reads the
 * accumulating sedimentM in fixed cell order, which is deterministic.
 */

import { oceanicDepthForAge } from '../bathymetry';
import {
  EROSION_PRECIP_FACTOR_MAX,
  EROSION_PRECIP_FACTOR_MIN,
  EROSION_PRECIP_REF,
  EROSION_RATE_PER_YR,
  EROSION_SUBSEA_FACTOR,
  OROGENIC_ROOT_DECAY_TAU_YEARS,
  OROGENIC_ROOT_REFERENCE_M,
  SEDIMENT_SHELF_CEILING_M,
} from '../constants';
import { cellCount, neighborTable } from '../grid';
import type { System } from '../step';

export const erosionSystem: System = {
  name: 'erosion',
  apply: (state, dtYears) => {
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
          const subsea = old[i]! < seaLevel || old[j]! < seaLevel ? EROSION_SUBSEA_FACTOR : 1;
          const flux = EROSION_RATE_PER_YR * dtYears * precipFactor * subsea * (old[i]! - old[j]!);
          elevation[i]! -= flux;
          elevation[j]! += flux;
        } else {
          // Coastal export (#65): only from subaerial continent to submerged
          // ocean (an emergent arc neighbor above sea level receives nothing).
          // Each such pair has exactly one continental endpoint, so it is
          // visited exactly once — no index guard needed.
          if (old[i]! <= seaLevel || old[j]! >= seaLevel) continue;
          // The shelf's remaining capacity: how far the relaxation target
          // (age-depth curve + sediment) still sits below the fill ceiling.
          const room =
            SEDIMENT_SHELF_CEILING_M - (oceanicDepthForAge(crustAge[j]!) + sedimentM[j]!);
          if (room <= 0) continue;
          const flux = Math.min(
            // Rivers grade to base level (sea level, #33), so export scales with
            // the cell's height ABOVE SEA LEVEL, not the full drop to the floor.
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
    }

    // Orogenic root decay (#65), applied to the post-flux elevation. keep is
    // hoisted so Math.exp runs once per step, not per cell.
    const keep = Math.exp(-dtYears / OROGENIC_ROOT_DECAY_TAU_YEARS);
    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1) continue;
      const e = elevation[i]!;
      if (e > OROGENIC_ROOT_REFERENCE_M) {
        elevation[i] = OROGENIC_ROOT_REFERENCE_M + (e - OROGENIC_ROOT_REFERENCE_M) * keep;
      }
    }

    return { ...state, fields: { ...state.fields, elevation, sedimentM } };
  },
};
