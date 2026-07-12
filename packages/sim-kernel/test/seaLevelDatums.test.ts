import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge } from '../src/bathymetry';
import {
  ARC_MATURATION_ELEVATION_M,
  ARC_MAX_ELEVATION_M,
  CRUST_FATE_SUBSIDENCE_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OROGENY_STRESS_REF_M_PER_YR,
} from '../src/constants';
import { cellCount, faceRCToIndex, neighbors } from '../src/grid';
import { applyConvergentTopography } from '../src/systems/boundaries';
import { blockElevationCap } from '../src/systems/blockIsostasy';
import { crustFatesSystem } from '../src/systems/crustFates';
import { tectonicsSystem } from '../src/systems/tectonics';
import type { PlanetState } from '../src/state';
import { erosionSystem } from '../src/systems/erosion';
import { runSystems, twoPlateState, type TestPlateSpec } from './helpers';

/**
 * Sea-level-anchored datums (the seaLevelDatums mechanism, datums.ts).
 *
 * The dynamic sea level (#33) falls kilometres below the 0 m crust datum
 * over deep time (docs/SEA_LEVEL_DATUM_FINDINGS.md), so every "submerged
 * platform" constant written as an absolute elevation ends up stranded
 * above the real waterline. These tests hand a world a deeply fallen sea
 * (globals.seaLevelM = −3000 m) and pin, mechanism by mechanism, that the
 * flag re-anchors the datum while flag-off keeps the exact legacy level.
 * The flag-off byte-identity of full runs is pinned by the main goldens;
 * the onset contract by onsetGating.test.ts.
 */
const N = 32;
const MID = N / 2;
const DT = 1e6;
const STATIC: TestPlateSpec = { pole: [0, 0, 1], omega: 0 };
const FALLEN_SEA_M = -3000;

/** Two static plates, given crust/elevation edits and a fallen sea level. */
function world(
  edit: (fields: { crustType: Float32Array; elevation: Float32Array; crustAge: Float32Array }) => void,
  params: Partial<PlanetState['params']> = {},
): PlanetState {
  const base = twoPlateState(N, STATIC, STATIC);
  const crustType = base.fields.crustType.slice();
  const elevation = base.fields.elevation.slice();
  const crustAge = base.fields.crustAge.slice();
  edit({ crustType, elevation, crustAge });
  return {
    ...base,
    params: { ...base.params, ...params },
    globals: { ...base.globals, seaLevelM: FALLEN_SEA_M },
    fields: { ...base.fields, crustType, elevation, crustAge },
  };
}

describe('sea-level-anchored datums (seaLevelDatums)', () => {
  it('blockElevationCap shifts its whole ramp by the datum offset', () => {
    for (const area of [1e11, 3e11, 1e12, 2e12, 1e13]) {
      expect(blockElevationCap(area, FALLEN_SEA_M)).toBeCloseTo(
        FALLEN_SEA_M + blockElevationCap(area),
        6,
      );
    }
  });

  it('founder clamp pins an isolated continental cell below the DYNAMIC sea level', () => {
    // An isolated 500 m continental peak in an all-ocean world. Legacy: the
    // clamp pins it to −200 m absolute — 2.8 km ABOVE the fallen sea, a dry
    // island. Re-keyed: it founders to 200 m below the actual waterline.
    const peak = faceRCToIndex(0, MID, MID, N);
    const make = (seaLevelDatums: boolean): PlanetState =>
      world(
        ({ crustType, elevation, crustAge }) => {
          crustType.fill(0);
          crustAge.fill(50e6);
          for (let i = 0; i < cellCount(N); i++) elevation[i] = oceanicDepthForAge(50e6);
          crustType[peak] = 1;
          elevation[peak] = 500;
        },
        { seaLevelDatums },
      );

    const off = runSystems(make(false), 1, [tectonicsSystem]);
    expect(off.fields.elevation[peak]).toBe(MICROCONTINENT_FOUNDER_ELEVATION_M);

    const on = runSystems(make(true), 1, [tectonicsSystem]);
    expect(on.fields.elevation[peak]).toBe(FALLEN_SEA_M + MICROCONTINENT_FOUNDER_ELEVATION_M);
    expect(on.fields.elevation[peak]!).toBeLessThan(FALLEN_SEA_M);
  });

  it('arc maturation gate tracks the sea level: a deep arc matures only when the gate is re-keyed', () => {
    // Converging oceanic plates; plate 0 (younger) overrides. The arc cell
    // sits at −3400 m: far below the absolute −500 m gate, but within 500 m
    // of the FALLEN sea surface once grown. A continental same-plate
    // neighbor puts it inside the accretionary belt.
    const OMEGA = 4e-9;
    const build = (seaLevelDatums: boolean): { state: PlanetState; cell: number } => {
      const base = twoPlateState(N, { pole: [1, 0, 0], omega: OMEGA }, { pole: [1, 0, 0], omega: -OMEGA });
      const crustType = base.fields.crustType.slice().fill(0);
      const crustAge = base.fields.crustAge.slice();
      const elevation = base.fields.elevation.slice();
      for (let i = 0; i < cellCount(N); i++) {
        crustAge[i] = base.fields.plateId[i] === 0 ? 10e6 : 90e6;
        elevation[i] = oceanicDepthForAge(crustAge[i]!);
      }
      let cell = -1;
      let contNb = -1;
      for (let i = 0; i < cellCount(N) && cell === -1; i++) {
        if (base.fields.plateId[i] !== 0) continue;
        const nbs = neighbors(i, N);
        const other = nbs.filter((nb) => base.fields.plateId[nb] === 1);
        const same = nbs.filter((nb) => base.fields.plateId[nb] === 0);
        if (other.length >= 1 && same.length >= 1) {
          cell = i;
          contNb = same[0]!;
        }
      }
      crustType[contNb] = 1;
      elevation[cell] = -3400;
      const state: PlanetState = {
        ...base,
        params: { ...base.params, seaLevelDatums },
        globals: { ...base.globals, seaLevelM: FALLEN_SEA_M },
        fields: { ...base.fields, crustType, crustAge, elevation },
      };
      return { state, cell };
    };

    const run = (seaLevelDatums: boolean): { matured: boolean; elevation: number } => {
      const { state, cell } = build(seaLevelDatums);
      const stress = new Float32Array(cellCount(N));
      stress[cell] = OROGENY_STRESS_REF_M_PER_YR;
      const workElev = state.fields.elevation.slice();
      const workCrust = state.fields.crustType.slice();
      applyConvergentTopography(state, stress, workElev, workCrust, DT);
      return { matured: workCrust[cell] === 1, elevation: workElev[cell]! };
    };

    const off = run(false);
    // Legacy gate is −500 m absolute — 2.5 km above the fallen sea; the arc
    // grows but stays oceanic.
    expect(off.matured).toBe(false);
    expect(off.elevation).toBeLessThan(ARC_MATURATION_ELEVATION_M);

    const on = run(true);
    // Re-keyed gate = sea level − 500; the grown arc crosses it and matures
    // while still submerged (the design intent: accreted terranes are
    // largely submarine).
    expect(on.matured).toBe(true);
    expect(on.elevation).toBeGreaterThanOrEqual(FALLEN_SEA_M + ARC_MATURATION_ELEVATION_M);
    expect(on.elevation).toBeLessThanOrEqual(FALLEN_SEA_M + ARC_MAX_ELEVATION_M);
  });

  it('crustFates retirement stays "invisible in the land mask": a −250 m orphan retires only under the legacy datum', () => {
    // A one-cell continental orphan at −250 m, out of docking range of the
    // 3×3 anchor continent. Legacy: −250 ≤ −200 absolute, so the crust
    // record retires — but with the sea at −3000 m that cell is a VISIBLE
    // 2.75 km island, so retirement pops it out of the land mask. Re-keyed:
    // the founder level is −3200, the orphan is far above it, and crustFates
    // subsides it at the bounded rate instead — no pop.
    const orphan = faceRCToIndex(0, 4, 4, N);
    const make = (seaLevelDatums: boolean): PlanetState =>
      world(
        ({ crustType, elevation, crustAge }) => {
          crustType.fill(0);
          crustAge.fill(50e6);
          for (let i = 0; i < cellCount(N); i++) elevation[i] = oceanicDepthForAge(50e6);
          for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
              const i = faceRCToIndex(0, MID + dr, MID + dc, N);
              crustType[i] = 1;
              elevation[i] = 300;
            }
          }
          crustType[orphan] = 1;
          elevation[orphan] = -250;
        },
        { seaLevelDatums, crustFates: true },
      );

    const off = runSystems(make(false), 1, [crustFatesSystem]);
    expect(off.fields.crustType[orphan]).toBe(0);

    const on = runSystems(make(true), 1, [crustFatesSystem]);
    expect(on.fields.crustType[orphan]).toBe(1);
    expect(on.fields.elevation[orphan]).toBeCloseTo(-250 - CRUST_FATE_SUBSIDENCE_M_PER_YR * DT, 3);
  });

  it('sediment shelf ceiling tracks the sea level: a shelf above it stops accepting export', () => {
    // Coastal export into a submerged oceanic neighbor whose age-depth floor
    // (−3100 m) sits BETWEEN the fallen sea (−3000) and the re-keyed ceiling
    // (−3200). Legacy ceiling (−200 absolute) sees 2.9 km of room and
    // deposits; the re-keyed ceiling sees the shelf already 100 m too full
    // and refuses — a shelf is a feature of the waterline, not the datum.
    const coast = faceRCToIndex(0, MID, MID, N);
    const shelf = faceRCToIndex(0, MID, MID + 1, N);
    const shelfAge = ((3100 - 2500) / 0.35) ** 2; // oceanicDepthForAge → −3100 m
    const make = (seaLevelDatums: boolean): PlanetState =>
      world(
        ({ crustType, elevation, crustAge }) => {
          crustType[shelf] = 0;
          crustAge[shelf] = shelfAge;
          elevation[shelf] = -3100;
          elevation[coast] = 100;
        },
        { seaLevelDatums },
      );
    expect(oceanicDepthForAge(shelfAge)).toBeCloseTo(-3100, 6);

    const off = runSystems(make(false), 1, [erosionSystem]);
    expect(off.fields.sedimentM[shelf]!).toBeGreaterThan(0);

    const on = runSystems(make(true), 1, [erosionSystem]);
    expect(on.fields.sedimentM[shelf]).toBe(0);
  });
});
