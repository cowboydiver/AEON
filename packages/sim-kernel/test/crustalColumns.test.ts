import { describe, expect, it } from 'vitest';
import {
  CONTINENTAL_BUOYANCY_FACTOR,
  CONTINENTAL_ISOSTASY_DATUM_M,
  CONTINENTAL_REFERENCE_ELEVATION_M,
  CONTINENTAL_REFERENCE_THICKNESS_M,
  OCEANIC_CRUST_THICKNESS_M,
} from '../src/constants';
import {
  computeCrustalMassLedger,
  continentalElevationForThicknessM,
  continentalThicknessForElevationM,
  crustalColumnsOnsetReinversion,
  foundCrustalThickness,
} from '../src/isostasy';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { run, type Keyframe } from '../src/step';
import { freeboardSystem } from '../src/systems/freeboard';
import { twoPlateState } from './helpers';

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
