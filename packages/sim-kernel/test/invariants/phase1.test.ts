import { describe, expect, it } from 'vitest';
import { faceSTToDirection, cellCount, indexToFaceRC, type Vec3 } from '../../src/grid';
import { createRng } from '../../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../../src/state';
import { SYSTEMS, step, type SimContext, type System } from '../../src/step';
import { cross3, dot3 } from '../../src/vec';

/**
 * Phase-1-level invariants (#20): checks that only make sense against the
 * integrated pipeline. Each invariant is a boolean detector so the mutation
 * sanity-checks below can assert the detectors FAIL against deliberately
 * broken systems — a test suite that cannot catch a planted bug is
 * decoration, not a spine.
 */

const SEEDS = [1, 42, 1337] as const;

// --- Invariant detectors -----------------------------------------------------

/** Van Oosterom–Strackee solid angle of a spherical triangle (unit vectors). */
function triSolidAngle(a: Vec3, b: Vec3, c: Vec3): number {
  return 2 * Math.atan2(Math.abs(dot3(a, cross3(b, c))), 1 + dot3(a, b) + dot3(b, c) + dot3(a, c));
}

function cellSolidAngle(i: number, N: number): number {
  const [face, row, col] = indexToFaceRC(i, N);
  const a = faceSTToDirection(face, (col / N) * 2 - 1, (row / N) * 2 - 1);
  const b = faceSTToDirection(face, ((col + 1) / N) * 2 - 1, (row / N) * 2 - 1);
  const c = faceSTToDirection(face, ((col + 1) / N) * 2 - 1, ((row + 1) / N) * 2 - 1);
  const d = faceSTToDirection(face, (col / N) * 2 - 1, ((row + 1) / N) * 2 - 1);
  return triSolidAngle(a, b, c) + triSolidAngle(a, c, d);
}

/**
 * Crust covers the sphere: every cell owned by a live plate, and the
 * per-plate solid angles sum to 4π (exact partition, not approximate —
 * tolerance only absorbs the solid-angle quadrature itself).
 */
function crustCoversSphere(state: PlanetState, solidAngles: Float64Array): boolean {
  const { plateId } = state.fields;
  const perPlate = new Array<number>(state.plates.length).fill(0);
  for (let i = 0; i < plateId.length; i++) {
    const p = plateId[i]!;
    if (!Number.isInteger(p) || p < 0 || p >= state.plates.length) return false;
    if (!state.plates[p]!.alive) return false;
    perPlate[p]! += solidAngles[i]!;
  }
  let total = 0;
  for (const a of perPlate) total += a;
  return Math.abs(total - 4 * Math.PI) < 4 * Math.PI * 0.01;
}

/**
 * Hypsometric bimodality: a persistent abyssal mode well below the datum and
 * a continental-platform mode near/above it, separated by a real trough.
 */
function isBimodal(elevation: Float32Array): boolean {
  const lo = -8000;
  const hi = 4000;
  const bins = 48;
  const hist = new Array<number>(bins).fill(0);
  for (const e of elevation) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((e - lo) / (hi - lo)) * bins)));
    hist[b]!++;
  }
  const binOf = (elev: number) => Math.floor(((elev - lo) / (hi - lo)) * bins);
  const maxIn = (a: number, b: number) => Math.max(...hist.slice(binOf(a), binOf(b)));
  const minIn = (a: number, b: number) => Math.min(...hist.slice(binOf(a), binOf(b)));
  const abyssalMode = maxIn(-7000, -3000);
  const platformMode = maxIn(-1500, 1500);
  const trough = minIn(-3000, -1500);
  return abyssalMode > 2 * trough && platformMode > 1.5 * trough;
}

function allFinite(state: PlanetState): boolean {
  for (const name of Object.keys(state.fields) as (keyof typeof state.fields)[]) {
    for (const v of state.fields[name]) if (!Number.isFinite(v)) return false;
  }
  return true;
}

function runPipeline(
  params: ReturnType<typeof createPlanetParams>,
  steps: number,
  onStep?: (s: PlanetState, i: number) => void,
  systems: readonly System[] = SYSTEMS,
): PlanetState {
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let state = createInitialState(params);
  for (let i = 1; i <= steps; i++) {
    state = step(state, params.stepYears, ctx, systems);
    onStep?.(state, i);
  }
  return state;
}

// --- The invariants ----------------------------------------------------------

describe('phase 1 invariants (#20)', () => {
  it('crust covers the sphere after every step of a multi-hundred-step run', () => {
    const N = 16;
    const solidAngles = new Float64Array(cellCount(N));
    for (let i = 0; i < solidAngles.length; i++) solidAngles[i] = cellSolidAngle(i, N);
    runPipeline(createPlanetParams({ seed: 42, gridN: N }), 300, (s) => {
      expect(crustCoversSphere(s, solidAngles)).toBe(true);
    });
  });

  it('hypsometry stays bimodal at fixed checkpoints for all golden seeds', () => {
    for (const seed of SEEDS) {
      const params = createPlanetParams({ seed, gridN: 32 });
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let state = createInitialState(params);
      expect(isBimodal(state.fields.elevation), `seed ${seed} t=0`).toBe(true);
      for (const checkpoint of [150, 300, 450] as const) {
        while (state.timeYears < checkpoint * 1e6) {
          state = step(state, params.stepYears, ctx);
        }
        expect(isBimodal(state.fields.elevation), `seed ${seed} t=${checkpoint} Myr`).toBe(true);
      }
    }
  });

  it('2 Gyr coarse-grid runs stay finite, in physical bounds, with sane land', () => {
    const started = performance.now();
    for (const seed of SEEDS) {
      // N=16 with 2 Myr steps: 1000 steps to 2 Gyr, protecting the budget.
      const params = createPlanetParams({ seed, gridN: 16, stepYears: 2e6 });
      const end = runPipeline(params, 1000, (s, i) => {
        if (i % 50 !== 0) return;
        expect(allFinite(s), `seed ${seed} step ${i}: non-finite field value`).toBe(true);
        let land = 0;
        let min = Infinity;
        let max = -Infinity;
        for (const e of s.fields.elevation) {
          if (e >= 0) land++;
          min = Math.min(min, e);
          max = Math.max(max, e);
        }
        const landFraction = land / s.fields.elevation.length;
        expect(min, `seed ${seed} step ${i}`).toBeGreaterThanOrEqual(-11_000);
        expect(max, `seed ${seed} step ${i}`).toBeLessThanOrEqual(9_000);
        expect(landFraction, `seed ${seed} step ${i}`).toBeGreaterThan(0.1);
        expect(landFraction, `seed ${seed} step ${i}`).toBeLessThan(0.6);
      });
      expect(end.timeYears).toBe(2e9);
      // The plate count bound (#18) over deep time.
      const live = end.plates.filter((p) => p.alive).length;
      expect(live).toBeGreaterThanOrEqual(6);
      expect(live).toBeLessThanOrEqual(16);
    }
    // Soft budget guard: this is the suite's most expensive test; if it
    // alone crosses ~20 s the <30 s whole-suite budget is gone.
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});

// --- Mutation sanity: the detectors must catch planted bugs -------------------

describe('phase 1 invariant detectors catch planted bugs (#20)', () => {
  it('coverage detector fails when a system drops cell ownership', () => {
    const N = 16;
    const solidAngles = new Float64Array(cellCount(N));
    for (let i = 0; i < solidAngles.length; i++) solidAngles[i] = cellSolidAngle(i, N);
    const dropCells: System = {
      name: 'brokenDropCells',
      apply: (state) => {
        const plateId = state.fields.plateId.slice();
        plateId[123] = -1; // hole in the partition
        return { ...state, fields: { ...state.fields, plateId } };
      },
    };
    const end = runPipeline(
      createPlanetParams({ seed: 42, gridN: N }),
      1,
      undefined,
      [...SYSTEMS, dropCells],
    );
    expect(crustCoversSphere(end, solidAngles)).toBe(false);
  });

  it('bimodality detector fails on unimodal terrain', () => {
    // All-abyssal world: one mode, no platform.
    const flat = new Float32Array(cellCount(16)).fill(-5000);
    expect(isBimodal(flat)).toBe(false);
  });

  it('stability bounds catch uplift with no ceiling', () => {
    const runaway: System = {
      name: 'brokenRunawayUplift',
      apply: (state) => {
        const elevation = state.fields.elevation.slice();
        for (let i = 0; i < elevation.length; i++) elevation[i]! += 50;
        return { ...state, fields: { ...state.fields, elevation } };
      },
    };
    const end = runPipeline(
      createPlanetParams({ seed: 42, gridN: 16 }),
      400,
      undefined,
      [...SYSTEMS, runaway],
    );
    let max = -Infinity;
    for (const e of end.fields.elevation) max = Math.max(max, e);
    expect(max).toBeGreaterThan(9_000); // the bound the real pipeline must hold
  });
});
