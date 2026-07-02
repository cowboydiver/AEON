/**
 * Oceanic age–depth relation (half-space cooling, #15): ridge crest at
 * −2500 m deepening with √age to the abyssal floor at −6000 m. Oceanic cell
 * elevation is a pure function of crustAge (isostasy) except at active
 * margins, where #16's trench/arc topography takes over.
 */

import {
  OCEAN_ABYSSAL_DEPTH_M,
  OCEAN_RIDGE_DEPTH_M,
  OCEAN_SUBSIDENCE_K_M_PER_SQRT_YR,
} from './constants';

/** Equilibrium depth (m, negative) of oceanic crust of the given age. */
export function oceanicDepthForAge(ageYears: number): number {
  return Math.max(
    OCEAN_ABYSSAL_DEPTH_M,
    OCEAN_RIDGE_DEPTH_M - OCEAN_SUBSIDENCE_K_M_PER_SQRT_YR * Math.sqrt(Math.max(0, ageYears)),
  );
}

/**
 * Inverse of the age–depth curve, used to give the t=0 noise ocean a
 * consistent age structure: deep floor reads as old crust, shallow as young.
 */
export function oceanicAgeForDepth(elevationMeters: number): number {
  if (elevationMeters >= OCEAN_RIDGE_DEPTH_M) return 0;
  const clamped = Math.max(OCEAN_ABYSSAL_DEPTH_M, elevationMeters);
  const s = (OCEAN_RIDGE_DEPTH_M - clamped) / OCEAN_SUBSIDENCE_K_M_PER_SQRT_YR;
  return s * s;
}
