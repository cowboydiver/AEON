import { copyEvents, type SimEvent } from './events';
import { FIELD_NAMES, type Fields } from './fields';
import { createRng, type Rng } from './rng';
import { createInitialState, type Globals, type PlanetState, type PlanetParams } from './state';
import { biomeSystem } from './systems/biome';
import { blockIsostasySystem } from './systems/blockIsostasy';
import { carbonSystem } from './systems/carbon';
import { crustFatesSystem } from './systems/crustFates';
import { energyBalanceSystem } from './systems/energyBalance';
import { erosionSystem } from './systems/erosion';
import { freeboardSystem } from './systems/freeboard';
import { iceSystem } from './systems/ice';
import { marineLifeSystem } from './systems/marineLife';
import { moistureSystem } from './systems/moisture';
import { oxygenSystem } from './systems/oxygen';
import { seaLevelSystem } from './systems/seaLevel';
import { tectonicsSystem } from './systems/tectonics';
import { wilsonSystem } from './systems/wilson';
import { windsSystem } from './systems/winds';

/** Per-run context threaded through systems. Never global. */
export interface SimContext {
  rng: Rng;
}

/**
 * A system is a pure function of (state, dt, ctx). It must not mutate the
 * input state; it returns either the same state (no change) or a new one
 * with replaced field arrays.
 */
export interface System {
  name: string;
  apply: (state: PlanetState, dtYears: number, ctx: SimContext) => PlanetState;
}

/** No-op system, kept for tests and as the pipeline-shape reference. */
export const identitySystem: System = {
  name: 'identity',
  apply: (state) => state,
};

/**
 * Ordered system pipeline applied by every step: tectonics moves crust and
 * builds topography, wilson reorganizes plates, erosion redistributes relief,
 * then energyBalance re-solves the zonal temperature (#30) against the final
 * elevation and land mask, winds derive the prevailing wind field (#31) from
 * rotation and that temperature gradient, moisture advects ocean evaporation
 * along that wind to precipitate real, orographic precipitation (#32), ice
 * integrates the `iceFraction` mass balance (#33) from that temperature and
 * precipitation, seaLevel re-solves the global sea level (#33) from the
 * conserved water inventory minus grounded ice, and carbon integrates the slow
 * carbonate–silicate CO₂ reservoir (#34) from tectonic outgassing minus
 * silicate weathering. The globals/fields those last systems write are read back
 * at the TOP of the next step — energyBalance takes the previous step's
 * `iceFraction` (albedo), `seaLevelM` (land mask) and `co2` (greenhouse), and
 * erosion the previous `seaLevelM` (base level) — closing the feedbacks with a
 * one-step explicit lag rather than a joint solve. Finally biome (#35) runs last
 * of all, classifying the fully-solved temperature/precipitation over the
 * dynamic sea-level mask into the categorical `biome` field the renderer colours
 * the planet by; nothing downstream reads it. Between carbon and biome the Phase 4
 * biosphere block runs — marineLife (abiogenesis + marine productivity) then
 * oxygen (the O₂ reservoir + the emergent Great Oxidation) — so life reads this
 * step's fully-solved climate and land mask; in this milestone (#37) it feeds back
 * into no physical field (the albedo/weathering coupling arrives with vegetation,
 * #39), and both systems are identity when `biosphereEnabled` is false.
 */
export const SYSTEMS: readonly System[] = [
  tectonicsSystem,
  wilsonSystem,
  // Crust fates + terrane docking (#88, default-off prototype): after wilson
  // so it consolidates the post-reorg crust map (and never hands wilson a
  // plateId/boundaryStress pair from different partitions), before erosion
  // so welded/retired crust erodes as what it now is. Identity when off.
  crustFatesSystem,
  erosionSystem,
  // Crustal-block isostasy (#84, default-off prototype): after erosion so it
  // caps the fully-reworked relief, before the climate stack so temperature/
  // winds/moisture see the capped elevation. Identity when the param is off.
  blockIsostasySystem,
  // Freeboard regulation (default-off prototype, the SEA_LEVEL_DATUM_FINDINGS
  // follow-up): after the tectonic/erosive reworking so it re-floats the
  // finished relief, before the climate stack so temperature/winds/moisture
  // and this step's sea-level solve see the adjusted elevation. Identity
  // when the param is off.
  freeboardSystem,
  energyBalanceSystem,
  windsSystem,
  moistureSystem,
  iceSystem,
  seaLevelSystem,
  carbonSystem,
  // Biosphere block (#37): abiogenesis + marine productivity, then the O₂
  // reservoir + Great Oxidation. After carbon (reads the fully-solved climate),
  // before biome (which stays terminal and climate-only). Identity when the
  // biosphere is disabled.
  marineLifeSystem,
  oxygenSystem,
  biomeSystem,
];

/** Advance the state by dtYears through the ordered system pipeline. */
export function step(
  state: PlanetState,
  dtYears: number,
  ctx: SimContext,
  systems: readonly System[] = SYSTEMS,
): PlanetState {
  let next = state;
  for (const system of systems) {
    next = system.apply(next, dtYears, ctx);
  }
  return { ...next, timeYears: next.timeYears + dtYears };
}

/**
 * Deep snapshot of the per-cell fields at a point in time, plus the scalar
 * globals and the full event log so far. Arrays and events are copies, safe to
 * transfer/mutate; `globals` is a shallow copy of the whole-planet scalars
 * (co2, meanTemperatureK, seaLevelM, landFraction, waterInventoryM) so a
 * consumer (the CLI report, a HUD) can read them without re-deriving. The codec
 * ignores it — `encodeKeyframe` reads `.fields` only — so this does not touch
 * the stored/rendered path.
 */
export interface Keyframe {
  timeYears: number;
  fields: Fields;
  globals: Globals;
  events: SimEvent[];
}

export function snapshotKeyframe(state: PlanetState): Keyframe {
  const fields = Object.fromEntries(
    FIELD_NAMES.map((name) => [name, state.fields[name].slice()]),
  ) as Fields;
  return {
    timeYears: state.timeYears,
    fields,
    globals: { ...state.globals },
    events: copyEvents(state.events),
  };
}

/**
 * Lazily generate a full simulation's keyframes from t=0 to untilYears: one for
 * the initial state, then one every params.keyframeIntervalYears (and a final
 * one at untilYears if it does not land on the interval). Both the loop bound
 * and keyframe emission are integer-derived: comparing accumulated float time
 * against untilYears could spin forever when the final remainder is below one
 * ULP of the elapsed time.
 *
 * This is the single source of truth for keyframe cadence. A consumer that
 * pulls one keyframe at a time (the Phase 2 worker, #23) can yield to its event
 * loop between pulls for cooperative cancellation while producing byte-identical
 * history to a straight-through `run()`. The generator returns the final state.
 */
export function* keyframes(
  params: PlanetParams,
  untilYears: number,
): Generator<Keyframe, PlanetState> {
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  const stepsPerKeyframe = Math.max(1, Math.round(params.keyframeIntervalYears / params.stepYears));
  const totalSteps = Math.max(0, Math.ceil(untilYears / params.stepYears));

  let state = createInitialState(params);
  yield snapshotKeyframe(state);

  for (let i = 1; i <= totalSteps; i++) {
    const dt = Math.min(params.stepYears, untilYears - state.timeYears);
    if (dt <= 0) break; // float ties: nothing left to simulate
    state = step(state, dt, ctx);
    if (i % stepsPerKeyframe === 0 || i === totalSteps || state.timeYears >= untilYears) {
      yield snapshotKeyframe(state);
    }
  }
  return state;
}

/**
 * Eager convenience wrapper over `keyframes`: run to completion, invoking
 * `onKeyframe` for each, and return the final state. Existing callers (the CLI,
 * tests) keep their callback shape; the cadence lives in `keyframes`.
 */
export function run(
  params: PlanetParams,
  untilYears: number,
  onKeyframe: (keyframe: Keyframe) => void,
): PlanetState {
  const gen = keyframes(params, untilYears);
  let r = gen.next();
  while (!r.done) {
    onKeyframe(r.value);
    r = gen.next();
  }
  // On the `done` result, `value` is the generator's return (the final state).
  return r.value;
}
