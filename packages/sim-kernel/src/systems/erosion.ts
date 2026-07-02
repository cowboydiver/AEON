/**
 * Erosion (#19): conservative diffusion of elevation over the 4-neighbor
 * graph, scaled by local precipitation. Flux between a cell pair is
 * proportional to their height difference (i.e. to slope), so steep young
 * belts erode fast and lowlands fill with the removed volume — pushing
 * hypsometry toward the real bimodal shape.
 *
 * Scope: continental crust only (both endpoints crustType = 1). Oceanic
 * elevation is isostatic — a pure function of crust age (#15) — so eroding
 * it would be overwritten; sediment reaching the shelf edge stops there
 * (continental margins accumulate it). Within continental crust the pairwise
 * antisymmetric fluxes conserve total elevation exactly (up to float
 * rounding): pure redistribution, no sinks. Fluxes are computed Jacobi-style
 * from the pre-step field, so the result is order-independent.
 */

import {
  EROSION_PRECIP_FACTOR_MAX,
  EROSION_PRECIP_FACTOR_MIN,
  EROSION_PRECIP_REF,
  EROSION_RATE_PER_YR,
  EROSION_SUBSEA_FACTOR,
} from '../constants';
import { cellCount, neighborTable } from '../grid';
import type { System } from '../step';

export const erosionSystem: System = {
  name: 'erosion',
  apply: (state, dtYears) => {
    const N = state.params.gridN;
    const count = cellCount(N);
    const nbTable = neighborTable(N);
    const { crustType, precipitation } = state.fields;
    const old = state.fields.elevation;
    const elevation = old.slice();

    for (let i = 0; i < count; i++) {
      if (crustType[i] !== 1) continue;
      for (let k = 0; k < 4; k++) {
        const j = nbTable[i * 4 + k]!;
        // Each unordered pair once; both endpoints continental.
        if (j <= i || crustType[j] !== 1) continue;
        const precipFactor = Math.min(
          EROSION_PRECIP_FACTOR_MAX,
          Math.max(
            EROSION_PRECIP_FACTOR_MIN,
            (precipitation[i]! + precipitation[j]!) / 2 / EROSION_PRECIP_REF,
          ),
        );
        // Base-level damping: flux involving a submerged cell is slow (the
        // coast is where rivers deposit). Symmetric, so still conservative.
        const subsea = old[i]! < 0 || old[j]! < 0 ? EROSION_SUBSEA_FACTOR : 1;
        const flux = EROSION_RATE_PER_YR * dtYears * precipFactor * subsea * (old[i]! - old[j]!);
        elevation[i]! -= flux;
        elevation[j]! += flux;
      }
    }
    return { ...state, fields: { ...state.fields, elevation } };
  },
};
