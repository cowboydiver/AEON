import { copyEvents, type SimEvent } from './events';
import { FIELD_NAMES, type Fields } from './fields';
import { createRng, type Rng } from './rng';
import { createInitialState, type PlanetState, type PlanetParams } from './state';

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

/** Phase 0 pipeline: a single no-op. The point is the pipeline shape. */
export const identitySystem: System = {
  name: 'identity',
  apply: (state) => state,
};

/** Ordered system pipeline applied by every step. */
export const SYSTEMS: readonly System[] = [identitySystem];

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
 * Run a full simulation from t=0 to untilYears, emitting a keyframe for the
 * initial state and then one every params.keyframeIntervalYears (and a final
 * one at untilYears if it does not land on the interval). Both the loop bound
 * and keyframe emission are integer-derived: comparing accumulated float time
 * against untilYears could spin forever when the final remainder is below one
 * ULP of the elapsed time.
 */
export function run(
  params: PlanetParams,
  untilYears: number,
  onKeyframe: (keyframe: Keyframe) => void,
): PlanetState {
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  const stepsPerKeyframe = Math.max(1, Math.round(params.keyframeIntervalYears / params.stepYears));
  const totalSteps = Math.max(0, Math.ceil(untilYears / params.stepYears));

  let state = createInitialState(params);
  onKeyframe(snapshotKeyframe(state));

  for (let i = 1; i <= totalSteps; i++) {
    const dt = Math.min(params.stepYears, untilYears - state.timeYears);
    if (dt <= 0) break; // float ties: nothing left to simulate
    state = step(state, dt, ctx);
    if (i % stepsPerKeyframe === 0 || i === totalSteps || state.timeYears >= untilYears) {
      onKeyframe(snapshotKeyframe(state));
    }
  }
  return state;
}
