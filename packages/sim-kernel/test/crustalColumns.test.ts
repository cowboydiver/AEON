import { describe, expect, it } from 'vitest';
import {
  CONTINENTAL_BUOYANCY_FACTOR,
  CONTINENTAL_ISOSTASY_DATUM_M,
  CONTINENTAL_REFERENCE_ELEVATION_M,
  CONTINENTAL_REFERENCE_THICKNESS_M,
  CONTINENTAL_THICKNESS_MIN_M,
  CRUST_DENSITY_CONTINENTAL_KG_M3,
  OCEANIC_CRUST_THICKNESS_M,
  SEDIMENT_DENSITY_KG_M3,
} from '../src/constants';
import { cellSolidAngleTable, faceRCToIndex, neighborTable } from '../src/grid';
import {
  CONTINENTAL_FLOOR_ELEVATION_M,
  computeCrustalMassLedger,
  continentalElevationForThicknessM,
  continentalThicknessForElevationM,
  crustalColumnsOnsetReinversion,
  foundCrustalThickness,
} from '../src/isostasy';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { run, type Keyframe } from '../src/step';
import { erosionSystem } from '../src/systems/erosion';
import { freeboardSystem } from '../src/systems/freeboard';
import { tectonicsSystem } from '../src/systems/tectonics';
import { runSystems, twoPlateState } from './helpers';

/**
 * Crustal-column model, stage C1 (docs/CRUSTAL_COLUMN_PROPOSAL.md §6/§7):
 * the derivation itself, the founding synthesis, the onset re-inversion's
 * zero-snap rule, and the derivation-coherence invariant through the full
 * pipeline — asserted BIT-EXACTLY (every continental elevation writer under
 * the active mechanism stores thickness first and re-derives elevation from
 * the stored Float32, so cached == recomputed with zero tolerance).
 */

/** The bit-exact coherence check: e === fround(C + k·T) for continental cells. */
function assertCoherent(fields: Keyframe['fields'] | PlanetState['fields'], label: string): void {
  const { elevation, crustType, crustalThicknessM } = fields;
  let bad = 0;
  let firstBad = -1;
  for (let i = 0; i < elevation.length; i++) {
    if (crustType[i] !== 1) continue;
    const derived = Math.fround(
      CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * crustalThicknessM[i]!,
    );
    if (elevation[i] !== derived) {
      bad++;
      if (firstBad === -1) firstBad = i;
    }
  }
  expect(bad, `${label}: ${bad} incoherent continental cells (first at ${firstBad})`).toBe(0);
}

describe('the derivation (proposal §2.3 closure checks)', () => {
  it('pins the anchor arithmetic: k ≈ 0.1424, C ≈ −5154.5 m', () => {
    expect(CONTINENTAL_BUOYANCY_FACTOR).toBeCloseTo(1 - 2830 / 3300, 12);
    expect(CONTINENTAL_ISOSTASY_DATUM_M).toBeCloseTo(-5154.545454545, 6);
  });

  it('reproduces the worked-example elevations: e(20 km), e(39 km), e(70 km)', () => {
    expect(continentalElevationForThicknessM(20000)).toBeCloseTo(-2306.06, 1);
    expect(continentalElevationForThicknessM(CONTINENTAL_REFERENCE_THICKNESS_M)).toBeCloseTo(
      CONTINENTAL_REFERENCE_ELEVATION_M,
      6,
    );
    expect(continentalElevationForThicknessM(70000)).toBeCloseTo(4815.15, 1);
  });

  it('inversion is the exact inverse (round trip to float tolerance)', () => {
    for (const t of [20000, 32700, 39000, 55000, 70000]) {
      expect(continentalThicknessForElevationM(continentalElevationForThicknessM(t))).toBeCloseTo(
        t,
        6,
      );
    }
  });
});

describe('founding synthesis (proposal §2.5, closure check 2)', () => {
  const params = createPlanetParams({ seed: 42, gridN: 32 });
  const initial = createInitialState(params);

  it('inverts continental cells and resets oceanic cells to 7.1 km, zero RNG', () => {
    const { elevation, crustType, crustalThicknessM } = initial.fields;
    for (let i = 0; i < elevation.length; i++) {
      if (crustType[i] === 1) {
        // Bit-exact against the f32-stored inversion.
        expect(crustalThicknessM[i]).toBe(
          Math.fround(continentalThicknessForElevationM(elevation[i]!)),
        );
      } else {
        expect(crustalThicknessM[i]).toBe(OCEANIC_CRUST_THICKNESS_M);
      }
    }
    // Re-founding is reproducible (pure function of the terrain).
    const again = foundCrustalThickness(elevation, crustType);
    expect(again).toEqual(crustalThicknessM);
  });

  it('the t=0 thickness distribution is realistic without new noise design', () => {
    const { crustType, crustalThicknessM } = initial.fields;
    let sum = 0;
    let n = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < crustType.length; i++) {
      if (crustType[i] !== 1) continue;
      const t = crustalThicknessM[i]!;
      sum += t;
      n++;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    // Mean near the 39 km reference (the t=0 mean elevation ≈ +400 m anchor),
    // every column positive and below the ~70 km collapse ceiling's order.
    expect(sum / n).toBeGreaterThan(30000);
    expect(sum / n).toBeLessThan(45000);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(75000);
  });

  it('t=0 elevation is untouched by the founding (flag-off byte-identity)', () => {
    // The founding writes ONLY crustalThicknessM: an initial state with the
    // mechanism ON is field-identical to one with it off at t=0.
    const on = createInitialState(createPlanetParams({ seed: 42, gridN: 32, crustalColumns: true }));
    expect(on.fields.elevation).toEqual(initial.fields.elevation);
    expect(on.fields.crustalThicknessM).toEqual(initial.fields.crustalThicknessM);
  });
});

describe('onset re-inversion (proposal §2.5, the zero-snap rule)', () => {
  it('fires only on the onset step, snaps ≤ 1 f32 ULP, leaves oceanic elevation alone', () => {
    const params = createPlanetParams({ seed: 42, gridN: 32, crustalColumns: true });
    const state = createInitialState(params);
    const dt = params.stepYears;

    // Off the onset step (onset far in the future): identity, same reference.
    const future: PlanetState = {
      ...state,
      params: { ...params, crustalColumnsOnsetYears: 50e6 },
    };
    expect(crustalColumnsOnsetReinversion(future, dt)).toBe(future);

    // On the onset step (onset 0, t=0): thickness re-founds, continental
    // elevation snaps onto the derived manifold by at most ~1 f32 ULP
    // (< 1 mm at crustal magnitudes — no physical snap), oceanic untouched.
    const after = crustalColumnsOnsetReinversion(state, dt);
    expect(after).not.toBe(state);
    const { elevation: e0, crustType } = state.fields;
    const { elevation: e1, crustalThicknessM } = after.fields;
    let maxSnap = 0;
    for (let i = 0; i < e0.length; i++) {
      if (crustType[i] === 1) {
        const snap = Math.abs(e1[i]! - e0[i]!);
        if (snap > maxSnap) maxSnap = snap;
      } else {
        expect(e1[i]).toBe(e0[i]);
        expect(crustalThicknessM[i]).toBe(OCEANIC_CRUST_THICKNESS_M);
      }
    }
    expect(maxSnap).toBeLessThan(1e-3);
    assertCoherent(after.fields, 'post-reinversion');
  });
});

describe('derivation coherence through the full pipeline (the C1 invariant fixture)', () => {
  it('DEFAULT world + crustalColumns: bit-exact after every keyframe', () => {
    // The shipped default stack (crustFates, marinePlanation, the datum trio,
    // V2 kinematics) exercises tectonics/boundaries/erosion/crustFates/
    // freeboard shims; blockIsostasy added to cover site 17's reconcile too.
    const params = createPlanetParams({
      seed: 42,
      gridN: 32,
      crustalColumns: true,
      blockIsostasy: true,
    });
    let frames = 0;
    run(params, 30e6, (kf) => {
      // The t=0 keyframe predates the onset step: the init founding
      // deliberately does NOT snap elevation (flag-off byte-identity), so
      // bit-exact coherence begins with the first stepped keyframe.
      if (kf.timeYears === 0) return;
      assertCoherent(kf.fields, `t=${kf.timeYears}`);
      frames++;
    });
    expect(frames).toBeGreaterThan(1);
  });

  it('ENGAGEMENT: the flag-off world fails the bit-exact check (the derivation owns elevation only flag-on)', () => {
    // Guard against this fixture silently pinning an inert path (#102
    // engaged-golden precedent): with the flag off, elevation evolves rawly
    // and thickness goes stale, so coherence must NOT hold after stepping.
    const params = createPlanetParams({ seed: 42, gridN: 32 });
    let last: Keyframe | undefined;
    run(params, 30e6, (kf) => {
      last = kf;
    });
    const { elevation, crustType, crustalThicknessM } = last!.fields;
    let incoherent = 0;
    for (let i = 0; i < elevation.length; i++) {
      if (crustType[i] !== 1) continue;
      const derived = Math.fround(
        CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * crustalThicknessM[i]!,
      );
      if (elevation[i] !== derived) incoherent++;
    }
    expect(incoherent).toBeGreaterThan(0);
  });
});

describe('site-20 pump retirement (pulled forward from C5 — C3 gate record §5)', () => {
  it('the epeirogenic servo is inert on the columns path, alive on the legacy path', () => {
    // A landlocked all-continental world 2.6 km above the sea+400 target:
    // the passive-margin band (site 21, still a shim) has no ocean to seed
    // from, so the servo term is fully isolated. Legacy freeboard must pull
    // the whole stack down at the bounded rate; the columns arm must leave
    // every byte untouched — the servo and its buoyancy floor are retired,
    // freeboard is the mass budget's output there.
    const mk = (columns: boolean): PlanetState => {
      const s = twoPlateState(32, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
      const params = {
        ...s.params,
        freeboard: true, // twoPlateState pins the datum trio off; re-enable
        crustalColumns: columns,
        crustalColumnsOnsetYears: 0,
      };
      const elevation = s.fields.elevation.slice();
      elevation.fill(3000);
      const crustalThicknessM = foundCrustalThickness(elevation, s.fields.crustType);
      for (let i = 0; i < elevation.length; i++) {
        elevation[i] = continentalElevationForThicknessM(crustalThicknessM[i]!);
      }
      return { ...s, params, fields: { ...s.fields, elevation, crustalThicknessM } };
    };

    const on = mk(true);
    const off = mk(false);
    const dt = on.params.stepYears;
    const ctx = { rng: createRng(on.params.seed).fork('sim') };
    const onNext = freeboardSystem.apply(on, dt, ctx);
    const offNext = freeboardSystem.apply(off, dt, ctx);

    // Legacy: the uniform shift moved the whole stack down.
    let offMovedDown = 0;
    for (let i = 0; i < off.fields.elevation.length; i++) {
      if (offNext.fields.elevation[i]! < off.fields.elevation[i]!) offMovedDown++;
    }
    expect(offMovedDown).toBe(off.fields.elevation.length);
    // Columns: bit-identical fields — the servo contributes nothing.
    expect(onNext.fields.elevation).toEqual(on.fields.elevation);
    expect(onNext.fields.crustalThicknessM).toEqual(on.fields.crustalThicknessM);
    assertCoherent(onNext.fields, 'post-freeboard columns arm');
  });
});

describe('C4 sediment accretion (site 22 — the ledger leak closed)', () => {
  // Static all-continental two-plate world (zero motion, so the tectonics
  // maturation sweep is the only writer that can touch the planted cell):
  // one interior cell hand-planted with sediment cover, which the sweep —
  // the single enforcement point of "sedimentM = 0 on continental crust" —
  // must ACCRETE as thickness on the columns path and destroy flag-off.
  const N32 = 32;
  const CELL = faceRCToIndex(0, 16, 16, N32);
  const SED_M = 300;
  const SED_TO_ROCK = SEDIMENT_DENSITY_KG_M3 / CRUST_DENSITY_CONTINENTAL_KG_M3;

  function sedimentWorld(columns: boolean): PlanetState {
    const s = twoPlateState(N32, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
    const elevation = s.fields.elevation.slice();
    elevation.fill(500);
    const crustalThicknessM = foundCrustalThickness(elevation, s.fields.crustType);
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = continentalElevationForThicknessM(crustalThicknessM[i]!);
    }
    const sedimentM = s.fields.sedimentM.slice();
    sedimentM[CELL] = SED_M;
    return {
      ...s,
      params: { ...s.params, crustalColumns: columns },
      fields: { ...s.fields, elevation, crustalThicknessM, sedimentM },
    };
  }

  it('columns: the cover converts to thickness (ΔT = sed·ρ_sed/ρ_cc), coherent and counted', () => {
    const start = sedimentWorld(true);
    const tBefore = start.fields.crustalThicknessM[CELL]!;
    const out = runSystems(start, 1, [tectonicsSystem]);
    const tAfter = out.fields.crustalThicknessM[CELL]!;

    expect(out.fields.sedimentM[CELL]).toBe(0);
    // Mass-conserving conversion, to f32 store tolerance at ~40 km magnitude.
    expect(tAfter).toBeCloseTo(tBefore + SED_M * SED_TO_ROCK, 1);
    // Coherence: elevation re-derived from the STORED thickness, bit-exact.
    expect(out.fields.elevation[CELL]).toBe(
      Math.fround(CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * tAfter),
    );
    // A sediment-free neighbor is untouched by the sweep.
    const nb = faceRCToIndex(0, 16, 18, N32);
    expect(out.fields.crustalThicknessM[nb]).toBe(start.fields.crustalThicknessM[nb]);
    // The C2 exit counter keeps counting the same flux (m³ of sediment).
    const area = cellSolidAngleTable(N32)[CELL]! * start.params.radiusMeters ** 2;
    expect(out.globals.columnsSedimentZeroedM3).toBeCloseTo(SED_M * area, -6);
    // Per-cell mass equality IS the ledger closure: ΔT·ρ_cc = sed·ρ_sed.
    expect((tAfter - tBefore) * CRUST_DENSITY_CONTINENTAL_KG_M3).toBeCloseTo(
      SED_M * SEDIMENT_DENSITY_KG_M3,
      -3,
    );
  });

  it('columns: accretion clips at the 70 km collapse ceiling — above-cap remainder destroyed, bind counted', () => {
    // A near-ceiling column (the C3 cap semantics extend to the C4 adder):
    // elevation e(70 km) inverts to exactly the ceiling, so the whole
    // accretion is above-cap — thickness pins at 70 km, the destroyed
    // remainder is the declared loss, and the bind is counted.
    const start = sedimentWorld(true);
    const elevation = start.fields.elevation.slice();
    const crustalThicknessM = start.fields.crustalThicknessM.slice();
    crustalThicknessM[CELL] = 70000;
    elevation[CELL] = continentalElevationForThicknessM(70000);
    const world = { ...start, fields: { ...start.fields, elevation, crustalThicknessM } };
    const out = runSystems(world, 1, [tectonicsSystem]);
    expect(out.fields.sedimentM[CELL]).toBe(0);
    expect(out.fields.crustalThicknessM[CELL]).toBeLessThanOrEqual(70000);
    expect(out.fields.crustalThicknessM[CELL]).toBeCloseTo(70000, 0);
    expect(out.globals.columnsThicknessCapBinds).toBeGreaterThan(0);
  });

  it('flag-off: the cover is destroyed exactly as today and the columns stay untouched', () => {
    const start = sedimentWorld(false);
    const out = runSystems(start, 1, [tectonicsSystem]);
    expect(out.fields.sedimentM[CELL]).toBe(0);
    expect(out.fields.crustalThicknessM).toEqual(start.fields.crustalThicknessM);
    expect(out.fields.elevation[CELL]).toBe(start.fields.elevation[CELL]);
    expect(out.globals.columnsSedimentZeroedM3).toBe(0);
    expect(out.globals.columnsMaturationFlips).toBe(0);
    expect(out.globals.columnsMaturationCreditM3).toBe(0);
  });
});

describe('stage C5 — the structural floor (trap T2) and the founder re-keys', () => {
  const E_FLOOR_F32 = Math.fround(
    CONTINENTAL_ISOSTASY_DATUM_M + CONTINENTAL_BUOYANCY_FACTOR * CONTINENTAL_THICKNESS_MIN_M,
  );

  it('pins the floor arithmetic: e(T_min) ≈ −2306 m', () => {
    expect(CONTINENTAL_FLOOR_ELEVATION_M).toBeCloseTo(-2306.06, 1);
    expect(CONTINENTAL_FLOOR_ELEVATION_M).toBe(
      continentalElevationForThicknessM(CONTINENTAL_THICKNESS_MIN_M),
    );
  });

  it('onset regularization: below-floor inversions lift to T_min, counted; the rest is pure inversion', () => {
    // A continental world with one cell held at −4000 m (the legacy pump's
    // flooded-lobe shape): its inversion lands at ~8.1 km — below the floor —
    // and must be lifted to exactly T_min with the credit counted on true
    // areas; every other cell keeps the pure (unclamped) inversion and its
    // elevation is continuous through onset.
    const N32 = 32;
    const LOBE = faceRCToIndex(0, 16, 16, N32);
    const s = twoPlateState(N32, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
    const elevation = s.fields.elevation.slice();
    elevation.fill(500);
    elevation[LOBE] = -4000;
    const world: PlanetState = {
      ...s,
      params: { ...s.params, crustalColumns: true },
      fields: { ...s.fields, elevation },
    };
    const out = crustalColumnsOnsetReinversion(world, world.params.stepYears);

    // The lobe cell: lifted to the floor, elevation snapped up to e(T_min).
    expect(out.fields.crustalThicknessM[LOBE]).toBe(CONTINENTAL_THICKNESS_MIN_M);
    expect(out.fields.elevation[LOBE]).toBe(E_FLOOR_F32);
    // The credit is the lift × true area, and nothing else contributed.
    const liftM = CONTINENTAL_THICKNESS_MIN_M - continentalThicknessForElevationM(-4000);
    const areaM2 = cellSolidAngleTable(N32)[LOBE]! * world.params.radiusMeters ** 2;
    expect(out.globals.columnsRegularizedCreditM3).toBeCloseTo(liftM * areaM2, -8);
    // An above-floor cell: the pure inversion, elevation continuous (≤ 1 ULP).
    const other = faceRCToIndex(0, 16, 20, N32);
    expect(out.fields.crustalThicknessM[other]).toBe(
      Math.fround(continentalThicknessForElevationM(500)),
    );
    expect(Math.abs(out.fields.elevation[other]! - 500)).toBeLessThan(1e-3);
    assertCoherent(out.fields, 'post-C5-reinversion');
  });

  it('site 4: an isolated sliver TRIMS to the identity floor on the columns path (counted), clamps to the sea-keyed level on the legacy path', () => {
    const N32 = 32;
    const SLIVER = faceRCToIndex(0, 16, 16, N32);
    const mk = (columns: boolean): PlanetState => {
      const s = twoPlateState(N32, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
      const crustType = s.fields.crustType.slice().fill(0);
      const elevation = s.fields.elevation.slice().fill(-4000);
      crustType[SLIVER] = 1;
      elevation[SLIVER] = 3000; // ~57 km column — far above the floor
      return {
        ...s,
        params: { ...s.params, crustalColumns: columns },
        fields: { ...s.fields, crustType, elevation },
      };
    };

    const on = runSystems(mk(true), 1, [tectonicsSystem]);
    // The sliver is thinned crust: T := min(T, T_min), the surface at e(T_min).
    expect(on.fields.crustType[SLIVER]).toBe(1);
    expect(on.fields.crustalThicknessM[SLIVER]).toBe(CONTINENTAL_THICKNESS_MIN_M);
    expect(on.fields.elevation[SLIVER]).toBe(E_FLOOR_F32);
    // The trim is the declared founder debit, on true areas.
    const trimM = continentalThicknessForElevationM(3000) - CONTINENTAL_THICKNESS_MIN_M;
    const areaM2 = cellSolidAngleTable(N32)[SLIVER]! * on.params.radiusMeters ** 2;
    expect(on.globals.columnsFounderTrimM3).toBeCloseTo(trimM * areaM2, -9);
    // Idempotent: a second step trims nothing more.
    const twice = runSystems(mk(true), 2, [tectonicsSystem]);
    expect(twice.globals.columnsFounderTrimM3).toBeCloseTo(trimM * areaM2, -9);

    // Legacy arm: today's clamp to the founder level, no counters.
    const off = runSystems(mk(false), 1, [tectonicsSystem]);
    expect(off.fields.elevation[SLIVER]).toBe(-200);
    expect(off.globals.columnsFounderTrimM3).toBe(0);
  });

  it('site 21 shim floor: margin subsidence stops at e(T_min) on a low sea instead of grinding to sea − 150', () => {
    // A continental block with a same-plate oceanic fringe, sea at −4000 m
    // (the dry half of the water sweep): the legacy shelf target (−4150)
    // sits far below the identity floor, so on the columns path the coastal
    // subsidence must bottom out at e(T_min) — the T2 stop — not the sea.
    const N32 = 32;
    const s = twoPlateState(N32, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
    const crustType = s.fields.crustType.slice();
    const elevation = s.fields.elevation.slice();
    // Ocean strip at cols 0..7 of face 0's center rows; continent elsewhere.
    for (let r = 0; r < N32; r++) {
      for (let c = 0; c < 8; c++) {
        const i = faceRCToIndex(0, r, c, N32);
        crustType[i] = 0;
        elevation[i] = -5000;
      }
    }
    // Continental cells start 30 m above the floor (T = T_min + 30/k).
    const startT = CONTINENTAL_THICKNESS_MIN_M + 30 / CONTINENTAL_BUOYANCY_FACTOR;
    const crustalThicknessM = s.fields.crustalThicknessM.slice();
    for (let i = 0; i < crustType.length; i++) {
      if (crustType[i] === 1) {
        crustalThicknessM[i] = startT;
        elevation[i] = continentalElevationForThicknessM(Math.fround(startT));
      }
    }
    const world: PlanetState = {
      ...s,
      params: { ...s.params, freeboard: true, crustalColumns: true },
      globals: { ...s.globals, seaLevelM: -4000 },
      fields: { ...s.fields, crustType, elevation, crustalThicknessM },
    };
    // Two steps of 20 m/step subsidence would take the coast 10 m below the
    // floor — the floor must bind on the second step.
    const out = runSystems(world, 2, [freeboardSystem]);
    const nbTable = neighborTable(N32);
    let coastChecked = 0;
    for (let i = 0; i < crustType.length; i++) {
      if (out.fields.crustType[i] !== 1) continue;
      const e = out.fields.elevation[i]!;
      expect(e).toBeGreaterThanOrEqual(E_FLOOR_F32 - 0.01);
      expect(out.fields.crustalThicknessM[i]!).toBeGreaterThanOrEqual(
        CONTINENTAL_THICKNESS_MIN_M - 0.01,
      );
      // Coastal cells (oceanic 4-neighbor) provably subsided AND stopped.
      for (let k = 0; k < 4; k++) {
        if (out.fields.crustType[nbTable[i * 4 + k]!] === 0) {
          expect(e).toBeLessThan(continentalElevationForThicknessM(startT) - 1);
          coastChecked++;
          break;
        }
      }
    }
    expect(coastChecked).toBeGreaterThan(0);
    assertCoherent(out.fields, 'post-margin-floor');
  });

  it('erosion floor: coastal export on a low sea cannot thin a column below T_min', () => {
    // Sea at −4000 m: a near-floor emergent cell (relative to that sea) with
    // a submerged oceanic neighbor would legacy-erode toward the sea; the
    // columns path must stop the thinning at the identity floor.
    const N32 = 32;
    const s = twoPlateState(N32, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
    const crustType = s.fields.crustType.slice().fill(0);
    const elevation = s.fields.elevation.slice().fill(-5000);
    const crustalThicknessM = s.fields.crustalThicknessM.slice().fill(OCEANIC_CRUST_THICKNESS_M);
    // A 2×2 continental block a hair above the floor.
    const startT = CONTINENTAL_THICKNESS_MIN_M + 0.5 / CONTINENTAL_BUOYANCY_FACTOR;
    const block: number[] = [];
    for (const dr of [0, 1]) {
      for (const dc of [0, 1]) {
        const i = faceRCToIndex(0, 16 + dr, 16 + dc, N32);
        block.push(i);
        crustType[i] = 1;
        crustalThicknessM[i] = startT;
        elevation[i] = continentalElevationForThicknessM(Math.fround(startT));
      }
    }
    const world: PlanetState = {
      ...s,
      params: { ...s.params, crustalColumns: true },
      globals: { ...s.globals, seaLevelM: -4000 },
      fields: { ...s.fields, crustType, elevation, crustalThicknessM },
    };
    const out = runSystems(world, 5, [erosionSystem]);
    for (const i of block) {
      expect(out.fields.crustalThicknessM[i]!).toBeGreaterThanOrEqual(
        CONTINENTAL_THICKNESS_MIN_M - 0.01,
      );
      expect(out.fields.elevation[i]!).toBeGreaterThanOrEqual(E_FLOOR_F32 - 0.01);
    }
    assertCoherent(out.fields, 'post-erosion-floor');
  });

  it('T2 fixture: no continental cell below the floor through the full DEFAULT pipeline', () => {
    // The structural claim the stage exists for — active from C5 on (it
    // cannot hold in the shim era, and this fixture is why): after the onset
    // regularization, every continental cell of the default stack (+
    // blockIsostasy to cover site 17's floored cap) rides at or above
    // e(T_min) at every keyframe.
    const params = createPlanetParams({
      seed: 42,
      gridN: 32,
      crustalColumns: true,
      blockIsostasy: true,
    });
    let frames = 0;
    run(params, 30e6, (kf) => {
      if (kf.timeYears === 0) return; // predates the onset regularization
      const { elevation, crustType, crustalThicknessM } = kf.fields;
      let below = 0;
      for (let i = 0; i < elevation.length; i++) {
        if (crustType[i] !== 1) continue;
        if (elevation[i]! < E_FLOOR_F32 - 0.01) below++;
        if (crustalThicknessM[i]! < CONTINENTAL_THICKNESS_MIN_M - 0.01) below++;
      }
      expect(below, `t=${kf.timeYears}: ${below} below-floor continental cells`).toBe(0);
      frames++;
    });
    expect(frames).toBeGreaterThan(1);
  });
});

describe('mass-ledger diagnostic (proposal §5 — reported tripwire at C1)', () => {
  it('t=0 magnitudes are Earth-ordered and the reduction is deterministic', () => {
    const params = createPlanetParams({ seed: 42, gridN: 32 });
    const state = createInitialState(params);
    const a = computeCrustalMassLedger(state.fields, params.gridN, params.radiusMeters);
    const b = computeCrustalMassLedger(state.fields, params.gridN, params.radiusMeters);
    expect(a).toEqual(b);
    // Earth's continental crust ≈ 2.2e22 kg; this world holds 40% of the
    // sphere at ~36 km mean — same order.
    expect(a.continentalMassKg).toBeGreaterThan(1e22);
    expect(a.continentalMassKg).toBeLessThan(4e22);
    // 60% of the sphere at 7.1 km / 2900 kg/m³.
    expect(a.oceanicMassKg).toBeGreaterThan(3e21);
    expect(a.oceanicMassKg).toBeLessThan(1e22);
    expect(a.sedimentMassKg).toBe(0); // no erosion has run at t=0
  });

  it('flag-on, total crustal mass stays Earth-ordered over 30 Myr (no runaway)', () => {
    const params = createPlanetParams({ seed: 42, gridN: 32, crustalColumns: true });
    let last: Keyframe | undefined;
    run(params, 30e6, (kf) => {
      last = kf;
    });
    const ledger = computeCrustalMassLedger(last!.fields, params.gridN, params.radiusMeters);
    const total = ledger.continentalMassKg + ledger.oceanicMassKg + ledger.sedimentMassKg;
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeGreaterThan(1e22);
    expect(total).toBeLessThan(6e22);
  });
});
