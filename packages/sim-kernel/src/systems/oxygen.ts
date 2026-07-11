/**
 * Atmospheric oxygenation (#37, Phase 4) — the second system of the biosphere
 * block, run after `marineLife` (whose field it reads) and before `biome`. It
 * integrates the well-mixed atmospheric O₂ reservoir `globals.oxygen` (in
 * present-atmospheric-level units) and emits the emergent **Great Oxidation**.
 *
 * The balance, per step (rates per Myr, integrated with `dt` — a SLOW reservoir,
 * §0):
 *
 *     grossSource     = OXY_SOURCE · meanProductivity · BURIAL_FRACTION · dtMyr
 *     volcanicSink    = OXY_VOLC_SINK · (tectonicActivity / activityRef) · dtMyr
 *     net             = grossSource − volcanicSink
 *     — while net > 0, it first oxidizes the reduced-species buffer
 *       (globals.oxygenReductant); only the remainder reaches the atmosphere —
 *     oxygen        += net_after_reductant
 *     oxygen        −= OXY_OX_SINK · oxygen · dtMyr           (oxidative sink ∝ O₂)
 *
 * `meanProductivity` is the mean of `marineLife` over ocean cells. The reductant
 * buffer is the physical origin of the **anoxic latency**: photosynthesis can be
 * running (net > 0) yet atmospheric O₂ stays pinned near zero until the buffer is
 * spent, after which O₂ rises over a few hundred Myr to a bounded plateau
 * (`net_source / OXY_OX_SINK`) and holds — the Great-Oxidation S-curve. Its
 * *timing and shape vary with the seed's climate and tectonic history* (through
 * productivity and the activity-scaled reductant sink), so the GOE is emergent,
 * not scripted: the `greatOxidation` event fires on the first crossing of
 * `GOE_THRESHOLD_PAL` — a threshold ~200× below the plateau, crossed once,
 * monotonically, on the way up.
 *
 * Redox budget closes (spec §5): every PAL of atmospheric O₂ ties to organic
 * carbon buried (grossSource) minus the reductant and oxidative sinks —
 * `solveOxygen` returns each flux so the invariant is directly testable. This
 * milestone tracks only the O₂ half of the redox pair: the matching CO₂ drawdown
 * of that buried carbon is NOT subtracted from `globals.co2` (the #34 carbon
 * thermostat is unchanged), so the budget is self-contained and the CO₂↔O₂
 * coupling into the carbon cycle is deferred beyond #37.
 *
 * Pure `(state, dt, ctx) => state`: no `Math.random`/`Date.now`, no key-order
 * iteration, no input mutation; dt-correct (a coarser `stepYears` rescales the
 * increments, not the trajectory). Inert (identity) when `biosphereEnabled` is
 * false — O₂ then holds its `initialOxygenPAL` seed. Not run at init.
 */

import {
  BURIAL_FRACTION,
  CO2_OUTGAS_ACTIVITY_REF_M_PER_YR,
  GOE_THRESHOLD_PAL,
  OXY_OX_SINK_PER_MYR,
  OXY_SOURCE_PAL_PER_MYR,
  OXY_VOLC_SINK_PAL_PER_MYR,
  OXYGEN_MAX_PAL,
} from '../constants';
import { EVENT_KINDS, type SimEvent } from '../events';
import { cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';
import { tectonicActivity } from './carbon';

/** Mean marine photosynthetic productivity over ocean cells — the O₂ source
 *  driver. `marineLife` is 0 on land, so the ocean sum equals the field sum; only
 *  the ocean cell count is needed to form the mean. 0 for a land-only world or
 *  before abiogenesis (the field is all zero). */
export function meanMarineProductivity(state: PlanetState): number {
  const count = cellCount(state.params.gridN);
  const { elevation, marineLife } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let sum = 0;
  let ocean = 0;
  for (let i = 0; i < count; i++) {
    if (elevation[i]! >= seaLevel) continue; // land
    ocean++;
    sum += marineLife[i]!;
  }
  return ocean > 0 ? sum / ocean : 0;
}

export interface OxygenSolution {
  /** Next atmospheric O₂, PAL (clamped to [0, OXYGEN_MAX_PAL]). */
  readonly oxygen: number;
  /** Remaining reduced-species buffer, PAL (monotonically non-increasing). */
  readonly reductant: number;
  /** Mean marine productivity this step (the O₂ source driver). */
  readonly productivity: number;
  /** Gross photosynthetic O₂ produced this step (organic burial), PAL. */
  readonly grossSource: number;
  /** Volcanic/mantle reductant draw this step, PAL. */
  readonly volcanicSink: number;
  /** O₂-equivalent flux absorbed oxidizing the reductant buffer this step, PAL. */
  readonly reductantAbsorbed: number;
  /** Oxidative-weathering removal this step (∝ O₂), PAL. */
  readonly oxidativeSink: number;
}

/**
 * Solve the next O₂ and reductant from the current climate/biosphere state. Pure;
 * O(cells) for the productivity mean, O(1) otherwise. Returns every flux so the
 * redox budget invariant (§5) is exact: for the returned solution,
 * `oxygen === clamp(state.oxygen + grossSource − volcanicSink − reductantAbsorbed
 * − oxidativeSink, 0, OXYGEN_MAX_PAL)` and `reductant === state.oxygenReductant −
 * reductantAbsorbed`.
 */
export function solveOxygen(state: PlanetState, dtYears: number): OxygenSolution {
  const dtMyr = dtYears / 1e6;
  const productivity = meanMarineProductivity(state);
  const activityRatio = tectonicActivity(state) / CO2_OUTGAS_ACTIVITY_REF_M_PER_YR;

  const grossSource = OXY_SOURCE_PAL_PER_MYR * productivity * BURIAL_FRACTION * dtMyr;
  const volcanicSink = OXY_VOLC_SINK_PAL_PER_MYR * activityRatio * dtMyr;

  let net = grossSource - volcanicSink;
  let reductant = state.globals.oxygenReductant;
  let reductantAbsorbed = 0;
  // Net positive O₂ flux oxidizes the reduced buffer before it can accumulate in
  // the atmosphere — the anoxic latency. (A net *negative* flux draws O₂ down but
  // never re-reduces the buffer: the buffer is monotone.)
  if (net > 0 && reductant > 0) {
    reductantAbsorbed = net < reductant ? net : reductant;
    reductant -= reductantAbsorbed;
    net -= reductantAbsorbed;
  }

  const oxygenAfterNet = state.globals.oxygen + net;
  const oxidativeSink = OXY_OX_SINK_PER_MYR * oxygenAfterNet * dtMyr;
  let oxygen = oxygenAfterNet - oxidativeSink;
  if (oxygen < 0) oxygen = 0;
  else if (oxygen > OXYGEN_MAX_PAL) oxygen = OXYGEN_MAX_PAL;

  return { oxygen, reductant, productivity, grossSource, volcanicSink, reductantAbsorbed, oxidativeSink };
}

/** Integrate `globals.oxygen`/`oxygenReductant` one step and emit
 *  `greatOxidation` on the first crossing of the oxidation threshold. */
export function applyOxygen(state: PlanetState, dtYears: number): PlanetState {
  if (!state.params.biosphereEnabled) return state; // ablation: O₂ holds its seed
  const sol = solveOxygen(state, dtYears);
  let events = state.events;
  // The Great Oxidation is the FIRST rising crossing of the GOE threshold. The
  // reductant buffer makes O₂ rise monotonically through it to a plateau ~200×
  // the threshold, so in practice it crosses once; the event-log guard also makes
  // it fire exactly once even in the pathological case where a prolonged total
  // productivity collapse (a deep snowball freezing every ocean) later let O₂ dip
  // back below the threshold and re-rise. The `some` scan runs only on a crossing
  // (rare), so it costs nothing amortized.
  if (
    state.globals.oxygen < GOE_THRESHOLD_PAL &&
    sol.oxygen >= GOE_THRESHOLD_PAL &&
    !state.events.some((e) => e.kind === EVENT_KINDS.greatOxidation)
  ) {
    const event: SimEvent = { timeYears: state.timeYears, kind: EVENT_KINDS.greatOxidation };
    events = [...events, event];
  }
  return {
    ...state,
    globals: { ...state.globals, oxygen: sol.oxygen, oxygenReductant: sol.reductant },
    events,
  };
}

export const oxygenSystem: System = {
  name: 'oxygen',
  apply: (state, dtYears) => applyOxygen(state, dtYears),
};
