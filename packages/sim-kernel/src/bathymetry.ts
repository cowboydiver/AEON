/**
 * Oceanic age–depth relation (half-space cooling, #15): ridge crest at
 * −2500 m deepening with √age to the abyssal floor at −6000 m. Oceanic cell
 * elevation is a pure function of crustAge (isostasy) except at active
 * margins, where #16's trench/arc topography takes over.
 */

import {
  OCEAN_ABYSSAL_DEPTH_M,
  OCEAN_RIDGE_DEPTH_M,
  OCEAN_RIDGE_MIN_SUBMERGENCE_M,
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

/** √age at which the design curve reaches the abyssal floor (√yr): the age
 *  anchor shared by the absolute and sea-keyed curve shapes. */
const ABYSSAL_SQRT_AGE_YR =
  (OCEAN_RIDGE_DEPTH_M - OCEAN_ABYSSAL_DEPTH_M) / OCEAN_SUBSIDENCE_K_M_PER_SQRT_YR;

/**
 * The age-depth reference under the `bathymetryDatum` mechanism (#102):
 * `datumOffsetM` is `bathymetryDatumOffsetM(state)` (the previous step's sea
 * level when the mechanism is active, exactly 0 when it is off — datums.ts).
 *
 * Shape: the CREST rides the sea — capped at `datumOffsetM −
 * OCEAN_RIDGE_MIN_SUBMERGENCE_M`, never shallower than the absolute design
 * crest, never below the abyss — while the ABYSSAL reference stays absolute
 * and the √age slope rescales so the curve still reaches the abyss at the
 * same age. This is the issue's "partial tracking" shape, kept because the
 * alternatives fail measurably (docs/SEA_LEVEL_DATUM_FINDINGS.md, #102):
 * tracking the whole curve 1:1 has NO equilibrium — the keyed basin
 * capacity (~3.9 km global-equivalent) exceeds the conserved water
 * inventory (~1.7 km), so the (sea, floor) pair co-falls at the ocean
 * relief relax rate (~200 m/Myr, measured) forever. Pinning the abyss keeps
 * the bulk of the hypsometry as the absolute volume anchor: only the young
 * ridge flank (a small, bounded volume) tracks the sea, so the sea-level
 * solve keeps its slope by construction and the datum stays stationary.
 *
 * With the flag off (offset 0) the cap is inactive and this returns
 * `oceanicDepthForAge` exactly — the byte-identity path the main goldens
 * pin. It also degrades gracefully OUTSIDE the fallen-sea regime it was
 * built for: a sea within ~1.5 km of the 0 m datum leaves the design curve
 * untouched, and a hypothetical sea below the abyss collapses the relief to
 * zero rather than inverting the curve.
 */
export function seaKeyedOceanicDepthForAge(ageYears: number, datumOffsetM: number): number {
  const crest = Math.max(
    OCEAN_ABYSSAL_DEPTH_M,
    Math.min(OCEAN_RIDGE_DEPTH_M, datumOffsetM - OCEAN_RIDGE_MIN_SUBMERGENCE_M),
  );
  if (crest === OCEAN_RIDGE_DEPTH_M) return oceanicDepthForAge(ageYears);
  const k = (crest - OCEAN_ABYSSAL_DEPTH_M) / ABYSSAL_SQRT_AGE_YR;
  return Math.max(OCEAN_ABYSSAL_DEPTH_M, crest - k * Math.sqrt(Math.max(0, ageYears)));
}
