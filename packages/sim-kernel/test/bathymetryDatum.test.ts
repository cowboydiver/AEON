import { describe, expect, it } from 'vitest';
import { oceanicDepthForAge, seaKeyedOceanicDepthForAge } from '../src/bathymetry';
import {
  OCEAN_ABYSSAL_DEPTH_M,
  OCEAN_RELIEF_RELAX_M_PER_YR,
  OCEAN_RIDGE_DEPTH_M,
  OCEAN_RIDGE_MIN_SUBMERGENCE_M,
  OROGENY_STRESS_REF_M_PER_YR,
  TRENCH_EXTRA_DEPTH_M,
} from '../src/constants';
import { bathymetryDatumOffsetM } from '../src/datums';
import { cellCount, faceRCToIndex, neighbors } from '../src/grid';
import { createPlanetParams } from '../src/state';
import type { PlanetState } from '../src/state';
import { run } from '../src/step';
import { applyConvergentTopography } from '../src/systems/boundaries';
import { erosionSystem } from '../src/systems/erosion';
import { oceanVolumeMean } from '../src/systems/seaLevel';
import { tectonicsSystem } from '../src/systems/tectonics';
import { runSystems, twoPlateState, type TestPlateSpec } from './helpers';

/**
 * Sea-level-keyed bathymetry (the bathymetryDatum mechanism, #102): the
 * age-depth curve's CREST rides the dynamic sea level (capped at
 * OCEAN_RIDGE_MIN_SUBMERGENCE_M below it; the abyssal end stays absolute —
 * the volume anchor, see bathymetry.ts for why full 1:1 tracking is
 * measurably divergent), so ridge crests stay submerged instead of standing
 * proud of a sea that fell kilometres past them. These tests hand a world a
 * deeply fallen sea (globals.seaLevelM = −3000 m) and pin, call site by
 * call site, that the flag re-keys the age-depth reference while flag-off
 * keeps the exact legacy absolute curve. Flag-off byte-identity of full
 * runs is pinned by the main goldens; the onset contract by
 * onsetGating.test.ts.
 */
const N = 32;
const MID = N / 2;
const DT = 1e6;
const STATIC: TestPlateSpec = { pole: [0, 0, 1], omega: 0 };
const FALLEN_SEA_M = -3000;

function world(
  edit: (fields: {
    crustType: Float32Array;
    elevation: Float32Array;
    crustAge: Float32Array;
    sedimentM: Float32Array;
  }) => void,
  params: Partial<PlanetState['params']> = {},
  plates: [TestPlateSpec, TestPlateSpec] = [STATIC, STATIC],
): PlanetState {
  const base = twoPlateState(N, plates[0], plates[1]);
  const crustType = base.fields.crustType.slice();
  const elevation = base.fields.elevation.slice();
  const crustAge = base.fields.crustAge.slice();
  const sedimentM = base.fields.sedimentM.slice();
  edit({ crustType, elevation, crustAge, sedimentM });
  return {
    ...base,
    params: { ...base.params, ...params },
    globals: { ...base.globals, seaLevelM: FALLEN_SEA_M },
    fields: { ...base.fields, crustType, elevation, crustAge, sedimentM },
  };
}

describe('seaKeyedOceanicDepthForAge (bathymetry.ts)', () => {
  it('offset 0 is the absolute curve exactly (the byte-identity path)', () => {
    for (const age of [0, 1e6, 25e6, 50e6, 100e6, 500e6]) {
      expect(seaKeyedOceanicDepthForAge(age, 0)).toBe(oceanicDepthForAge(age));
    }
  });

  it('a sea within 1.5 km of the datum leaves the design curve untouched', () => {
    // crest cap = sea − 1000 ≥ −2500 ⇔ sea ≥ −1500: the mechanism engages
    // smoothly only once the sea has genuinely fallen past the design crest.
    for (const age of [0, 25e6, 200e6]) {
      expect(seaKeyedOceanicDepthForAge(age, -1400)).toBe(oceanicDepthForAge(age));
    }
  });

  it('fallen sea: crest rides at minimum submergence, abyss stays absolute', () => {
    const sea = -3000;
    expect(seaKeyedOceanicDepthForAge(0, sea)).toBe(sea - OCEAN_RIDGE_MIN_SUBMERGENCE_M);
    // The rescaled curve still reaches the abyss at the design abyssal age
    // (100 Myr under the shipped constants) and stays there.
    expect(seaKeyedOceanicDepthForAge(100e6, sea)).toBeCloseTo(OCEAN_ABYSSAL_DEPTH_M, 6);
    expect(seaKeyedOceanicDepthForAge(500e6, sea)).toBe(OCEAN_ABYSSAL_DEPTH_M);
    // Monotonically deepening in age between crest and abyss.
    let prev = seaKeyedOceanicDepthForAge(0, sea);
    for (const age of [5e6, 20e6, 50e6, 80e6]) {
      const d = seaKeyedOceanicDepthForAge(age, sea);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });

  it('a hypothetical sea below the abyss flattens the relief instead of inverting it', () => {
    expect(seaKeyedOceanicDepthForAge(0, -8000)).toBe(OCEAN_ABYSSAL_DEPTH_M);
    expect(seaKeyedOceanicDepthForAge(300e6, -8000)).toBe(OCEAN_ABYSSAL_DEPTH_M);
  });
});

describe('bathymetryDatumOffsetM (datums.ts)', () => {
  const state = world(() => {});

  it('is exactly 0 with the flag off', () => {
    expect(bathymetryDatumOffsetM({ ...state, params: { ...state.params, bathymetryDatum: false } })).toBe(0);
  });

  it('is exactly 0 before the onset year', () => {
    expect(
      bathymetryDatumOffsetM({
        ...state,
        timeYears: 10e6,
        params: { ...state.params, bathymetryDatum: true, bathymetryDatumOnsetYears: 20e6 },
      }),
    ).toBe(0);
  });

  it('is the previous step sea level at/after the onset year', () => {
    expect(
      bathymetryDatumOffsetM({
        ...state,
        timeYears: 20e6,
        params: { ...state.params, bathymetryDatum: true, bathymetryDatumOnsetYears: 20e6 },
      }),
    ).toBe(FALLEN_SEA_M);
  });
});

describe('sea-level-keyed bathymetry (bathymetryDatum)', () => {
  it('thermal subsidence relaxes toward the re-keyed age-depth curve', () => {
    // An all-oceanic world sitting exactly ON the absolute curve. Flag-off:
    // already at target, nothing moves. Flag-on: the target drops to the
    // sea-keyed curve, and the cell descends at the bounded relax rate.
    const AGE = 50e6;
    const make = (bathymetryDatum: boolean): PlanetState =>
      world(
        ({ crustType, elevation, crustAge }) => {
          crustType.fill(0);
          crustAge.fill(AGE);
          for (let i = 0; i < cellCount(N); i++) elevation[i] = oceanicDepthForAge(AGE);
        },
        { bathymetryDatum },
      );
    const probe = faceRCToIndex(0, MID, MID, N);

    // Crust ages by DT within the step, so the flag-off cell tracks the
    // absolute curve at its new age (ordinary thermal subsidence).
    const off = runSystems(make(false), 1, [tectonicsSystem]);
    expect(off.fields.elevation[probe]).toBeCloseTo(oceanicDepthForAge(AGE + DT), 1);

    // Flag-on the target is the sea-keyed curve (~450 m lower here), beyond
    // one step's relax bound: the cell descends from its start by the bound.
    const on = runSystems(make(true), 1, [tectonicsSystem]);
    expect(on.fields.elevation[probe]).toBeCloseTo(
      oceanicDepthForAge(AGE) - OCEAN_RELIEF_RELAX_M_PER_YR * DT,
      1,
    );
  });

  it('trench floor is pinned below the re-keyed curve', () => {
    // Converging oceanic plates; the older (plate 1) side subducts. The
    // trench hard-set is curve − extra·norm; under the mechanism the curve
    // reference rides the sea level.
    const OMEGA = 4e-9;
    const build = (bathymetryDatum: boolean): { state: PlanetState; cell: number } => {
      const state = world(
        ({ crustType, elevation, crustAge }) => {
          crustType.fill(0);
          for (let i = 0; i < cellCount(N); i++) {
            crustAge[i] = 90e6;
            elevation[i] = oceanicDepthForAge(90e6);
          }
        },
        { bathymetryDatum },
        [
          { pole: [1, 0, 0], omega: OMEGA },
          { pole: [1, 0, 0], omega: -OMEGA },
        ],
      );
      // Make plate 0 younger so plate 1 subducts.
      const crustAge = state.fields.crustAge;
      for (let i = 0; i < cellCount(N); i++) if (state.fields.plateId[i] === 0) crustAge[i] = 10e6;
      // A plate-1 boundary cell (has a plate-0 neighbor).
      let cell = -1;
      for (let i = 0; i < cellCount(N) && cell === -1; i++) {
        if (state.fields.plateId[i] !== 1) continue;
        if (neighbors(i, N).some((nb) => state.fields.plateId[nb] === 0)) cell = i;
      }
      return { state, cell };
    };

    const runTrench = (bathymetryDatum: boolean): number => {
      const { state, cell } = build(bathymetryDatum);
      const stress = new Float32Array(cellCount(N));
      stress[cell] = OROGENY_STRESS_REF_M_PER_YR; // norm = 1
      const workElev = state.fields.elevation.slice();
      const workCrust = state.fields.crustType.slice();
      applyConvergentTopography(state, stress, workElev, workCrust, DT);
      return workElev[cell]!;
    };

    expect(runTrench(false)).toBeCloseTo(oceanicDepthForAge(90e6) - TRENCH_EXTRA_DEPTH_M, 1);
    expect(runTrench(true)).toBeCloseTo(
      seaKeyedOceanicDepthForAge(90e6, FALLEN_SEA_M) - TRENCH_EXTRA_DEPTH_M,
      1,
    );
  });

  it('divergent gap fill creates new seafloor at the re-keyed ridge depth', () => {
    // A fast plate pulling away from a static one opens gap cells; they are
    // filled as fresh ridge crust. Under the mechanism the crest is
    // seaLevelM + OCEAN_RIDGE_DEPTH_M, not the absolute constant.
    const make = (bathymetryDatum: boolean): PlanetState =>
      world(
        ({ crustType, elevation, crustAge }) => {
          crustType.fill(0);
          crustAge.fill(80e6);
          for (let i = 0; i < cellCount(N); i++) elevation[i] = oceanicDepthForAge(80e6);
        },
        { bathymetryDatum },
        // Fast enough that the advection quantum triggers within two steps.
        [{ pole: [1, 0, 0], omega: 1.5e-7 }, STATIC],
      );

    const freshRidgeElevations = (bathymetryDatum: boolean): number[] => {
      // Two steps: gap cells created in the SECOND step still carry age 0
      // (the first step's fills have already aged and begun relaxing).
      const end = runSystems(make(bathymetryDatum), 2, [tectonicsSystem]);
      const out: number[] = [];
      for (let i = 0; i < cellCount(N); i++) {
        if (end.fields.crustAge[i] === 0 && end.fields.crustType[i] === 0) {
          out.push(end.fields.elevation[i]!);
        }
      }
      return out;
    };

    const off = freshRidgeElevations(false);
    expect(off.length).toBeGreaterThan(0);
    for (const e of off) expect(e).toBeCloseTo(OCEAN_RIDGE_DEPTH_M, 3);

    const on = freshRidgeElevations(true);
    expect(on.length).toBeGreaterThan(0);
    for (const e of on) {
      expect(e).toBeCloseTo(FALLEN_SEA_M - OCEAN_RIDGE_MIN_SUBMERGENCE_M, 3);
    }
  });

  it('sediment shelf room is measured against the re-keyed floor', () => {
    // Coastal export into an oceanic neighbor whose absolute floor (−3100 m)
    // already crowds the re-keyed shelf ceiling (seaLevelDatums on: −3200 m):
    // room is −100 m and export is refused. With bathymetryDatum also on the
    // floor reference subsides to seaLevelM − 3100, reopening ~2.9 km of
    // room — the shelf genuinely rides the datum stack.
    const coast = faceRCToIndex(0, MID, MID, N);
    const shelf = faceRCToIndex(0, MID, MID + 1, N);
    const shelfAge = ((3100 - 2500) / 0.35) ** 2; // oceanicDepthForAge → −3100 m
    const make = (bathymetryDatum: boolean): PlanetState =>
      world(
        ({ crustType, elevation, crustAge }) => {
          crustType[shelf] = 0;
          crustAge[shelf] = shelfAge;
          elevation[shelf] = -3100;
          elevation[coast] = 100;
        },
        { seaLevelDatums: true, bathymetryDatum },
      );

    const off = runSystems(make(false), 1, [erosionSystem]);
    expect(off.fields.sedimentM[shelf]).toBe(0);

    const on = runSystems(make(true), 1, [erosionSystem]);
    expect(on.fields.sedimentM[shelf]!).toBeGreaterThan(0);
  });
});

describe('sea-level solve conditioning under the full datum stack (#102)', () => {
  it('bisection keeps slope and the (sea, floor) pair moves at physical rates', () => {
    // The design risk of a sea-tracking floor is not the per-step solve (each
    // step bisects a FIXED hypsometry) but the dynamics of the lagged pair:
    // oscillation or runaway drift would show up as super-physical per-step
    // sea-level moves, and a hypsometry collapsing onto the waterline would
    // strip the bisection of slope. Run the full stack (seaLevelDatums +
    // freeboard + bathymetryDatum) through the early, fastest-moving 100 Myr
    // and assert every step stays inside the physical envelope.
    const params = createPlanetParams({
      seed: 42,
      gridN: N,
      keyframeIntervalYears: 1e6, // per-step keyframes: the assertions are per-step bounds
      seaLevelDatums: true,
      freeboard: true,
      bathymetryDatum: true,
    });
    const seas: number[] = [];
    let minSlope = Infinity;
    run(params, 100e6, (kf) => {
      const sea = kf.globals.seaLevelM;
      expect(Number.isFinite(sea)).toBe(true);
      seas.push(sea);
      // Central-difference slope of the ocean-volume function at the solved
      // level: the flooded fraction near the waterline. If the sea-tracking
      // floor ever degenerates the solve, this is what goes to 0.
      const count = cellCount(N);
      const dV =
        oceanVolumeMean(kf.fields.elevation, count, sea + 100) -
        oceanVolumeMean(kf.fields.elevation, count, sea - 100);
      minSlope = Math.min(minSlope, dV / 200);
    });
    expect(seas.length).toBeGreaterThan(50);
    expect(minSlope).toBeGreaterThan(0.2);
    // Per-step move bounded by the fastest datum-coupled process (ocean
    // relief relax, 200 m/Myr) plus margin for climate-driven ice/volume
    // shifts. A runaway or step-to-step oscillation of the lagged pair
    // breaks this immediately.
    const stepBound = OCEAN_RELIEF_RELAX_M_PER_YR * DT + 200;
    for (let i = 1; i < seas.length; i++) {
      expect(Math.abs(seas[i]! - seas[i - 1]!)).toBeLessThan(stepBound);
    }
  });
});
