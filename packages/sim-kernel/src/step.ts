import { copyEvents, type SimEvent } from './events';
import { FIELD_NAMES, type Fields } from './fields';
import { createRng, type Rng } from './rng';
import { createInitialState, type PlanetState, type PlanetParams } from './state';
import { energyBalanceSystem } from './systems/energyBalance';
import { erosionSystem } from './systems/erosion';
import { moistureSystem } from './systems/moisture';
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
 * rotation and that temperature gradient, and moisture advects ocean
 * evaporation along that wind to precipitate real, orographic precipitation
 * (#32) — which erosion reads on the next step (a one-step lag, like the energy
 * balance reads the previous step's ice/CO₂). The rest of the Phase 3 climate
 * block (ice → seaLevel → carbon → biome) extends this after moisture as it
 * lands.
 */
export const SYSTEMS: readonly System[] = [
  tectonicsSystem,
  wilsonSystem,
  erosionSystem,
  energyBalanceSystem,
  windsSystem,
  moistureSystem,
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
 * Deep snapshot of the per-cell fields at a point in time, plus the full
 * event log so far. Arrays and events are copies, safe to transfer/mutate.
 */
export interface Keyframe {
  timeYears: number;
  fields: Fields;
  events: SimEvent[];
}

export function snapshotKeyframe(state: PlanetState): Keyframe {
  const fields = Object.fromEntries(
    FIELD_NAMES.map((name) => [name, state.fields[name].slice()]),
  ) as Fields;
  return { timeYears: state.timeYears, fields, events: copyEvents(state.events) };
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
