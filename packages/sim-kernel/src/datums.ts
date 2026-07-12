/**
 * Sea-level-anchored datums (the `seaLevelDatums` mechanism prototype).
 *
 * Several kernel constants describe depths/heights that are physically
 * relative to the OCEAN SURFACE — "a drowned platform sits 200 m below the
 * waves", "an arc matures 500 m before it emerges" — but are written as
 * absolute elevations against the fixed 0 m crust datum, which was correct
 * only while sea level sat at 0. The #33 dynamic sea level falls ~3 km over
 * the first 500 Myr as the ocean basins mature (measured in
 * docs/SEA_LEVEL_DATUM_FINDINGS.md), stranding every such constant
 * kilometres above the real waterline: foundered microcontinents stand as
 * dry islands, filled sediment shelves as coastal plain, and arcs emerge
 * long before they mature.
 *
 * With `params.seaLevelDatums` on, the affected call sites add this offset
 * (the previous step's `globals.seaLevelM` — the standard explicit lag every
 * cross-system read uses) to those constants, restoring their design intent
 * in any sea-level regime. Flag-off the offset is exactly 0 and every
 * expression is byte-identical to the unflagged kernel (adding a float 0 is
 * exact), which is what lets the main goldens pin the off path unchanged.
 *
 * The oceanic AGE-DEPTH CURVE (ridge −2500 m / abyss −6000 m) was
 * deliberately NOT re-keyed by `seaLevelDatums`: sea level is solved by
 * filling the hypsometry with a conserved water volume, so a seafloor target
 * that tracks sea level makes the two chase each other downward without
 * bound when nothing else anchors the hypsometry (each metre of floor
 * subsidence lowers the sea a metre, which lowers the target again). The
 * `freeboard` mechanism changed that: continental crust regulated to
 * `seaLevelM + FREEBOARD_TARGET_M` is an independent isostatic anchor, which
 * is what makes the third offset below (`bathymetryDatumOffsetM`, the #102
 * `bathymetryDatum` mechanism) feasible at all — see its comment and the
 * findings doc for the conditioning argument and its measured limits.
 */

import type { PlanetState } from './state';

/**
 * The datum offset (m) the platform/arc constants get under the
 * `seaLevelDatums` mechanism: the dynamic sea level when the mechanism is
 * active, exactly 0 when it is off or before its onset year (the branched
 * A/B contract — no RNG is consumed, so pre-onset history is bit-identical
 * to a flag-off run).
 */
export function platformDatumOffsetM(state: PlanetState): number {
  return state.params.seaLevelDatums && state.timeYears >= state.params.seaLevelDatumsOnsetYears
    ? state.globals.seaLevelM
    : 0;
}

/**
 * The datum offset (m) the LAND-RELIEF constants get under the `freeboard`
 * mechanism: the dynamic sea level when the mechanism is active, exactly 0
 * when it is off or before its onset year (same branched-A/B contract as
 * `platformDatumOffsetM` — no RNG is consumed).
 *
 * Kept separate from `platformDatumOffsetM` because the two mechanisms own
 * different constants: `seaLevelDatums` re-keys the submerged-platform datums
 * (founder level, shelf ceiling, arc gates), a pure unit fix; `freeboard`
 * re-keys the land-relief datums (`OROGENIC_ROOT_REFERENCE_M`,
 * `OROGENY_MAX_ELEVATION_M`) as part of regulating how high continents ride
 * over the sea — a regime change the findings doc deliberately excluded from
 * the datum-shift prototype because it re-tunes orogeny/erosion budgets
 * planet-wide. The flags stay independently togglable for A/B isolation;
 * freeboard is designed to be MEASURED with seaLevelDatums also on.
 */
export function landDatumOffsetM(state: PlanetState): number {
  return state.params.freeboard && state.timeYears >= state.params.freeboardOnsetYears
    ? state.globals.seaLevelM
    : 0;
}

/**
 * The datum offset (m) the OCEANIC AGE-DEPTH reference gets under the
 * `bathymetryDatum` mechanism (#102): the dynamic sea level when the
 * mechanism is active, exactly 0 when it is off or before its onset year
 * (the same branched-A/B contract as the two offsets above — no RNG is
 * consumed, so pre-onset history is bit-identical to a flag-off run).
 *
 * Every consumer of the age-depth reference reads it through
 * `seaKeyedOceanicDepthForAge(age, thisOffset)` (bathymetry.ts — the crest
 * rides the sea at OCEAN_RIDGE_MIN_SUBMERGENCE_M, the abyssal end stays
 * absolute; offset 0 returns the design curve exactly), so the whole
 * age-depth-relative family rides together: the thermal-subsidence target
 * (tectonics.ts), trench pinning (boundaries.ts), divergent gap fill and
 * consolidation island flips (tectonics.ts), and the sediment shelf-room
 * check (erosion.ts). `sedimentM` stacks on top of the re-keyed curve
 * exactly as it stacked on the absolute one. The t=0 initial-terrain snap
 * (plates.ts) stays absolute by construction: it runs before the first
 * step, when the initial sea level is ~0 and no lagged value exists.
 *
 * Kept separate from `platformDatumOffsetM`/`landDatumOffsetM` because this
 * re-key changes the FEEDBACK TOPOLOGY of the sea-level solve (the floor
 * reads the level that is solved FROM the floor), not just a constant's
 * unit — it must stay independently togglable for the A/B that measures
 * exactly that feedback. The shipped crest-cap shape is well-posed even
 * alone (the abyssal end of the curve stays the absolute volume anchor);
 * it is the full-curve 1:1 shape that diverges, with or without freeboard
 * (measured — see bathymetry.ts and the findings doc). When this flag is
 * on but `seaLevelDatums`/`freeboard` are off, the young ridge flank rides
 * the sea while the platform/land datums stay absolute — e.g. the sediment
 * shelf ceiling sits kilometres above the re-keyed floor and shelves can
 * fill toward a beached −200 m. That combination is measurement-only and
 * documented rather than prevented (the blockElevationCap precedent,
 * blockIsostasy.ts).
 */
export function bathymetryDatumOffsetM(state: PlanetState): number {
  return state.params.bathymetryDatum && state.timeYears >= state.params.bathymetryDatumOnsetYears
    ? state.globals.seaLevelM
    : 0;
}
