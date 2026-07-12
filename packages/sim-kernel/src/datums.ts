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
 * The oceanic AGE-DEPTH CURVE (ridge −2500 m / abyss −6000 m) is
 * deliberately NOT re-keyed: sea level is solved by filling the hypsometry
 * with a conserved water volume, so a seafloor target that tracks sea level
 * makes the two chase each other downward without bound (each metre of floor
 * subsidence lowers the sea a metre, which lowers the target again). Fixing
 * that needs the freeboard-regulation follow-up, not a datum shift — see the
 * findings doc.
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
