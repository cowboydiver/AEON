import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCenterDirection, cellCount, type Vec3 } from '../src/grid';
import type { PlateRecord } from '../src/plates';
import { createRng } from '../src/rng';
import { createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext, type System } from '../src/step';
import { tectonicsSystem } from '../src/systems/tectonics';
import { dot3, normalize3 } from '../src/vec';

export interface TestPlateSpec {
  pole: Vec3;
  omega: number;
}

export function makePlate(spec: TestPlateSpec): PlateRecord {
  return {
    eulerPole: normalize3(spec.pole),
    angularVelRadPerYr: spec.omega,
    accumulatedRadians: 0,
    advectionCount: 0,
    createdAtYears: 0,
    continentalFraction: 0,
    alive: true,
  };
}

/**
 * Hand-built two-plate state for directional tests: plate 0 is the z >= 0
 * hemisphere, plate 1 the rest. All fields zero unless the caller paints
 * them. Params default to seed 7 at the given N.
 */
export function twoPlateState(
  N: number,
  plate0: TestPlateSpec,
  plate1: TestPlateSpec,
): PlanetState {
  const params = createPlanetParams({ seed: 7, gridN: N, numPlates: 2 });
  const count = cellCount(N);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
  ) as Fields;
  for (let i = 0; i < count; i++) {
    fields.plateId[i] = dot3(cellCenterDirection(i, N), [0, 0, 1]) >= 0 ? 0 : 1;
    // Continental everywhere by default so painted elevation is not
    // overwritten by oceanic thermal subsidence; tests that need oceanic
    // crust set crustType/crustAge explicitly.
    fields.crustType[i] = 1;
  }
  return {
    timeYears: 0,
    params,
    globals: { landFraction: 0 },
    fields,
    plates: [makePlate(plate0), makePlate(plate1)],
    events: [],
  };
}

export function runSystems(
  state: PlanetState,
  steps: number,
  systems: readonly System[] = [tectonicsSystem],
): PlanetState {
  const ctx: SimContext = { rng: createRng(state.params.seed).fork('sim') };
  let s = state;
  for (let i = 0; i < steps; i++) {
    s = step(s, state.params.stepYears, ctx, systems);
  }
  return s;
}
