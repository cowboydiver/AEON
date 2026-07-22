import { describe, expect, it } from 'vitest';
import {
  CONTINENTAL_BUOYANCY_FACTOR,
  CONTINENTAL_ISOSTASY_DATUM_M,
  CONTINENTAL_THICKNESS_MIN_M,
  CRUST_DENSITY_CONTINENTAL_KG_M3,
  CRUST_FATE_SUBSIDENCE_M_PER_YR,
  MICROCONTINENT_FOUNDER_ELEVATION_M,
  OCEANIC_CRUST_THICKNESS_M,
  SEDIMENT_DENSITY_KG_M3,
} from '../src/constants';
import { cellSolidAngleTable, faceRCToIndex } from '../src/grid';
import {
  CONTINENTAL_FLOOR_ELEVATION_M,
  continentalElevationForThicknessM,
  continentalThicknessForElevationM,
  foundCrustalThickness,
} from '../src/isostasy';
import { crustFatesSystem } from '../src/systems/crustFates';
import type { PlanetState } from '../src/state';
import { runSystems, twoPlateState } from './helpers';

/**
 * Small-component crust fates + terrane docking invariants (#88). Worlds are
 * static two-plate states (zero angular velocity) run through
 * [crustFatesSystem] alone, so the system under test is the only writer.
 *
 * N=32 sizing (same as the #84 tests): true cell areas at the face center
 * run ~9.8e10 m², so a 1×2 block (~2e11 m²) is below the small threshold
 * (3e11) and a 6×6 block (~3.5e12 m²) is far above it.
 */
const N = 32;
const MID = N / 2;

/** Ocean world (crustType 0 everywhere) with crust fates enabled. */
function oceanWorld(): PlanetState {
  const base = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 0, 1], omega: 0 });
  const crustType = base.fields.crustType.slice().fill(0);
  const elevation = base.fields.elevation.slice().fill(-4000);
  return {
    ...base,
    params: { ...base.params, crustFates: true },
    fields: { ...base.fields, crustType, elevation },
  };
}

/** Paint a rows×cols continental block at `elev` on `face`, offset from MID. */
function paintBlock(
  state: PlanetState,
  face: number,
  rows: number,
  cols: number,
  elev: number,
  colOffset = 0,
  plate?: number,
): PlanetState {
  const crustType = state.fields.crustType.slice();
  const elevation = state.fields.elevation.slice();
  const plateId = state.fields.plateId.slice();
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      const i = faceRCToIndex(face, MID + dr, MID + colOffset + dc, N);
      crustType[i] = 1;
      elevation[i] = elev;
      if (plate !== undefined) plateId[i] = plate;
    }
  }
  return { ...state, fields: { ...state.fields, crustType, elevation, plateId } };
}

function blockCells(face: number, rows: number, cols: number, colOffset = 0): number[] {
  const cells: number[] = [];
  for (let dr = 0; dr < rows; dr++) {
    for (let dc = 0; dc < cols; dc++) {
      cells.push(faceRCToIndex(face, MID + dr, MID + colOffset + dc, N));
    }
  }
  return cells;
}

describe('crustFates system (#88)', () => {
  it('is the identity when the param is off', () => {
    const world = paintBlock(paintBlock(oceanWorld(), 0, 6, 6, 1000), 1, 1, 2, 500);
    const off: PlanetState = { ...world, params: { ...world.params, crustFates: false } };
    const out = crustFatesSystem.apply(off, off.params.stepYears, {
      rng: undefined as never, // system must not touch the rng
    });
    expect(out).toBe(off);
  });

  it('docks a small component across a 2-cell strait: bridge welds, terrane changes plate', () => {
    // Large block plate 0 at cols MID..MID+5 (elev 1000); small 1×2 terrane
    // plate 1 at cols MID+8..9 (elev 500); ocean strait at cols MID+6, MID+7.
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000, 0, 0);
    world = paintBlock(world, 0, 1, 2, 500, 8, 1);
    world = { ...world, timeYears: 5e6 };

    const out = crustFatesSystem.apply(world, world.params.stepYears, { rng: undefined as never });

    const bridge = [faceRCToIndex(0, MID, MID + 6, N), faceRCToIndex(0, MID, MID + 7, N)];
    for (const b of bridge) {
      expect(out.fields.crustType[b]).toBe(1);
      // The weld strait is the lower of the two continental endpoints.
      expect(out.fields.elevation[b]).toBe(500);
      // Docking is a suture: the weld line carries the stamp.
      expect(out.fields.sutureYears[b]).toBe(5e6);
      expect(out.fields.plateId[b]).toBe(0);
      expect(out.fields.sedimentM[b]).toBe(0);
    }
    // The whole terrane transferred to the large component's plate; its own
    // crust and relief are untouched (docking, not destruction).
    for (const m of blockCells(0, 1, 2, 8)) {
      expect(out.fields.plateId[m]).toBe(0);
      expect(out.fields.crustType[m]).toBe(1);
      expect(out.fields.elevation[m]).toBe(500);
    }
    // The large component is untouched.
    for (const c of blockCells(0, 6, 6)) {
      expect(out.fields.crustType[c]).toBe(1);
      expect(out.fields.elevation[c]).toBe(1000);
    }
  });

  it('C4 weld accretion (site 22, crustFates half): the strait sediment accretes into the founded column', () => {
    // The dock scenario above with sediment cover painted on the strait and
    // crustal columns active: each bridge cell founds its column by
    // inversion of the weld elevation (C1), then its cover accretes as
    // thickness — ΔT = sed·ρ_sed/ρ_cc, mass-conserving — instead of being
    // destroyed (C4). Elevation is re-derived from the stored thickness.
    const SED_M = 400;
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000, 0, 0);
    world = paintBlock(world, 0, 1, 2, 500, 8, 1);
    const bridge = [faceRCToIndex(0, MID, MID + 6, N), faceRCToIndex(0, MID, MID + 7, N)];
    const sedimentM = world.fields.sedimentM.slice();
    for (const b of bridge) sedimentM[b] = SED_M;
    world = {
      ...world,
      timeYears: 5e6,
      params: { ...world.params, crustalColumns: true },
      fields: { ...world.fields, sedimentM },
    };

    const out = crustFatesSystem.apply(world, world.params.stepYears, { rng: undefined as never });

    const weldT = Math.fround(continentalThicknessForElevationM(500));
    const dT = SED_M * (SEDIMENT_DENSITY_KG_M3 / CRUST_DENSITY_CONTINENTAL_KG_M3);
    let expectedZeroedM3 = 0;
    for (const b of bridge) {
      expect(out.fields.crustType[b]).toBe(1);
      expect(out.fields.sedimentM[b]).toBe(0);
      const t = out.fields.crustalThicknessM[b]!;
      expect(t).toBeCloseTo(weldT + dT, 1);
      // Coherent, and the accreted cover lifts the weld by k·ΔT ≈ 48 m.
      expect(out.fields.elevation[b]).toBe(
        Math.fround(CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * t),
      );
      expect(out.fields.elevation[b]).toBeGreaterThan(500);
      expectedZeroedM3 += SED_M * cellSolidAngleTable(N)[b]! * world.params.radiusMeters ** 2;
    }
    // The C2 exit counter keeps counting the same flux through this exit.
    expect(out.globals.columnsSedimentZeroedM3).toBeCloseTo(expectedZeroedM3, -6);
  });

  it('founders an out-of-range small component: rate-bounded sink, then crust retirement', () => {
    // Large anchor on face 1 (so the world is not all-small); isolated small
    // 1×2 block on face 0 at 3000 m — beyond any docking range.
    let world = paintBlock(oceanWorld(), 1, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, 3000);
    const cells = blockCells(0, 1, 2);
    const dt = world.params.stepYears;

    const one = runSystems(world, 1, [crustFatesSystem]);
    for (const c of cells) {
      // One step moves exactly relax·dt, and the crust record survives.
      expect(one.fields.elevation[c]).toBeCloseTo(3000 - CRUST_FATE_SUBSIDENCE_M_PER_YR * dt, 3);
      expect(one.fields.crustType[c]).toBe(1);
    }

    // 3000 m → founder level takes ceil(3200/1000) = 4 steps; retirement
    // reads the PRE-pass elevations, so it fires on the step after arrival.
    const sunk = runSystems(world, 4, [crustFatesSystem]);
    for (const c of cells) {
      expect(sunk.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 3);
      expect(sunk.fields.crustType[c]).toBe(1);
    }
    const retired = runSystems(world, 5, [crustFatesSystem]);
    for (const c of cells) {
      // The drowned platform's crust record retires — the deliberate ledger
      // debit — with elevation left where it is (no cliff; the oceanic
      // age-depth relaxation takes it from here).
      expect(retired.fields.crustType[c]).toBe(0);
      expect(retired.fields.sutureYears[c]).toBe(0);
      expect(retired.fields.elevation[c]).toBeCloseTo(MICROCONTINENT_FOUNDER_ELEVATION_M, 3);
    }
  });

  it('never founders when a dock is available (accretion beats sinking)', () => {
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, 5000, 8);
    const out = runSystems(world, 10, [crustFatesSystem]);
    for (const m of blockCells(0, 1, 2, 8)) {
      expect(out.fields.crustType[m]).toBe(1);
      expect(out.fields.elevation[m]).toBe(5000); // docked, never subsided
    }
  });

  it('a 3-cell strait is out of docking range: the component founders instead', () => {
    let world = paintBlock(oceanWorld(), 0, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, 500, 9); // strait: cols MID+6..8
    const out = runSystems(world, 1, [crustFatesSystem]);
    // No weld: the strait stays oceanic and the small block subsides.
    for (const dc of [6, 7, 8]) {
      expect(out.fields.crustType[faceRCToIndex(0, MID, MID + dc, N)]).toBe(0);
    }
    for (const m of blockCells(0, 1, 2, 9)) {
      // One relax quantum (1000 m) overshoots from 500 m, so the sink clamps
      // at the founder level — rate-bounded from above, never below it.
      expect(out.fields.elevation[m]).toBeCloseTo(
        Math.max(
          MICROCONTINENT_FOUNDER_ELEVATION_M,
          500 - CRUST_FATE_SUBSIDENCE_M_PER_YR * world.params.stepYears,
        ),
        3,
      );
    }
  });

  it('leaves large components untouched and does nothing in an all-small world', () => {
    // Only small components anywhere: no docking target — the pass must bail
    // rather than founder the planet's whole crust inventory.
    const world = paintBlock(paintBlock(oceanWorld(), 0, 1, 2, 4000), 1, 1, 2, 4000);
    const out = crustFatesSystem.apply(world, world.params.stepYears, { rng: undefined as never });
    expect(out).toBe(world);

    // And a lone large component is inert (nothing small to consolidate).
    const big = paintBlock(oceanWorld(), 0, 6, 6, 8000);
    const outBig = crustFatesSystem.apply(big, big.params.stepYears, { rng: undefined as never });
    expect(outBig).toBe(big);
  });

  it('C5 (site 19): the columns founder THINS to the identity floor, then retirement fires thickness-keyed', () => {
    // Anchor on face 1; isolated small 1×2 block on face 0 riding 100 m
    // above the floor. Columns found coherently by inversion. Sea at 0, so
    // the floor (−2306 m) is well below the waves.
    let world = paintBlock(oceanWorld(), 1, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, CONTINENTAL_FLOOR_ELEVATION_M + 100);
    const found = foundCrustalThickness(world.fields.elevation, world.fields.crustType);
    const elevation = world.fields.elevation.slice();
    for (let i = 0; i < elevation.length; i++) {
      if (world.fields.crustType[i] === 1) {
        elevation[i] = continentalElevationForThicknessM(found[i]!);
      }
    }
    world = {
      ...world,
      params: { ...world.params, crustalColumns: true },
      fields: { ...world.fields, elevation, crustalThicknessM: found },
    };
    const cells = blockCells(0, 1, 2);
    const startT = Math.fround(
      continentalThicknessForElevationM(Math.fround(CONTINENTAL_FLOOR_ELEVATION_M + 100)),
    );

    // Step 1: the subsidence quantum (1000 m surface ≈ 7 km of thickness)
    // overshoots — the thinning CLAMPS at the floor, never below, the trim
    // counted; the crust record survives (retirement reads pre-pass state).
    const one = runSystems(world, 1, [crustFatesSystem]);
    let expectedTrimM3 = 0;
    for (const c of cells) {
      expect(one.fields.crustType[c]).toBe(1);
      expect(one.fields.crustalThicknessM[c]).toBe(CONTINENTAL_THICKNESS_MIN_M);
      expect(one.fields.elevation[c]).toBe(
        Math.fround(continentalElevationForThicknessM(CONTINENTAL_THICKNESS_MIN_M)),
      );
      expectedTrimM3 +=
        (startT - CONTINENTAL_THICKNESS_MIN_M) *
        cellSolidAngleTable(N)[c]! *
        world.params.radiusMeters ** 2;
    }
    expect(one.globals.columnsFounderTrimM3).toBeCloseTo(expectedTrimM3, -9);
    expect(one.globals.columnsRetiredCells).toBe(0);

    // Step 2: the pre-pass component is wholly submerged AND wholly at the
    // floor — the thickness-keyed retirement fires: crustType → 0, the cell
    // re-founds a 7.1 km oceanic column, the debit counted, elevation left
    // in place for the oceanic relaxation (no cliff).
    const two = runSystems(world, 2, [crustFatesSystem]);
    let expectedDebitM3 = 0;
    for (const c of cells) {
      expect(two.fields.crustType[c]).toBe(0);
      expect(two.fields.sutureYears[c]).toBe(0);
      expect(two.fields.crustalThicknessM[c]).toBe(OCEANIC_CRUST_THICKNESS_M);
      expect(two.fields.elevation[c]).toBe(
        Math.fround(continentalElevationForThicknessM(CONTINENTAL_THICKNESS_MIN_M)),
      );
      expectedDebitM3 +=
        CONTINENTAL_THICKNESS_MIN_M *
        cellSolidAngleTable(N)[c]! *
        world.params.radiusMeters ** 2;
    }
    expect(two.globals.columnsRetiredCells).toBe(2);
    expect(two.globals.columnsRetiredDebitM3).toBeCloseTo(expectedDebitM3, -9);
  });

  it('C5 (site 19): on a sea BELOW the floor, foundered fragments stand emergent and never retire (crust is hoarded)', () => {
    // The retirement-reachability directional fixture: the same at-the-floor
    // fragment under a dry sea (−3000 m < e(T_min)) is EMERGENT — the
    // submergence half of the trigger can never pass, so the crust record
    // survives indefinitely (the documented dry-world hoarding consequence;
    // the legacy trigger would have retired it once it sat below sea − 200).
    let world = paintBlock(oceanWorld(), 1, 6, 6, 1000);
    world = paintBlock(world, 0, 1, 2, CONTINENTAL_FLOOR_ELEVATION_M);
    const found = foundCrustalThickness(world.fields.elevation, world.fields.crustType);
    const elevation = world.fields.elevation.slice();
    for (let i = 0; i < elevation.length; i++) {
      if (world.fields.crustType[i] === 1) {
        elevation[i] = continentalElevationForThicknessM(found[i]!);
      }
    }
    world = {
      ...world,
      params: { ...world.params, crustalColumns: true },
      globals: { ...world.globals, seaLevelM: -3000 },
      fields: { ...world.fields, elevation, crustalThicknessM: found },
    };
    const out = runSystems(world, 5, [crustFatesSystem]);
    for (const c of blockCells(0, 1, 2)) {
      expect(out.fields.crustType[c]).toBe(1);
      expect(out.fields.crustalThicknessM[c]!).toBeGreaterThanOrEqual(
        CONTINENTAL_THICKNESS_MIN_M - 0.01,
      );
    }
    expect(out.globals.columnsRetiredCells).toBe(0);
    expect(out.globals.columnsRetiredDebitM3).toBe(0);
  });

  it('is inert before crustFatesOnsetYears and active from it (#88 branched A/B)', () => {
    let base = paintBlock(oceanWorld(), 1, 6, 6, 1000);
    base = paintBlock(base, 0, 1, 2, 3000);
    const dt = base.params.stepYears;
    const world: PlanetState = {
      ...base,
      params: { ...base.params, crustFatesOnsetYears: 2 * dt },
    };
    const cells = blockCells(0, 1, 2);

    const preOnset = runSystems(world, 2, [crustFatesSystem]);
    for (const c of cells) expect(preOnset.fields.elevation[c]).toBe(3000);

    const postOnset = runSystems(world, 3, [crustFatesSystem]);
    for (const c of cells) {
      expect(postOnset.fields.elevation[c]).toBeCloseTo(
        3000 - CRUST_FATE_SUBSIDENCE_M_PER_YR * dt,
        3,
      );
    }
  });
});
