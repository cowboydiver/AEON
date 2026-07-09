import { describe, expect, it } from 'vitest';
import {
  EARTH_DAY_HOURS,
  WIND_GRADIENT_FACTOR_MAX,
  WIND_GRADIENT_FACTOR_MIN,
  WIND_MAX_CELLS_PER_HEMISPHERE,
  WIND_MAX_M_PER_S,
} from '../src/constants';
import { cellCenterTable, cellCount } from '../src/grid';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import { solveEnergyBalance } from '../src/systems/energyBalance';
import {
  meridionalTemperatureGradientK,
  rotationCellCount,
  solveWinds,
  windAtLatitude,
  windGradientFactor,
} from '../src/systems/winds';

/**
 * Prevailing wind band model (#31). The band count is a deterministic function
 * of rotation rate and the field strength scales with the equator-to-pole
 * temperature gradient; the pattern must reproduce the qualitative Earth
 * structure (trade easterlies, mid-latitude westerlies, an ITCZ) at Earth
 * params, stay inside the codec bound, and be a pure function of state.
 */

const SEEDS = [1, 42, 1337] as const;

function stepped(seed: number, n: number, gridN = 32): PlanetState {
  const params = createPlanetParams({ seed, gridN });
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

describe('winds: band count from rotation (#31)', () => {
  it('Earth rotation gives the three-cell (Hadley/Ferrel/Polar) structure', () => {
    expect(rotationCellCount(EARTH_DAY_HOURS)).toBe(3);
  });

  it('faster rotators get more, narrower bands; slower rotators approach single-cell', () => {
    const fast = rotationCellCount(6);
    const earth = rotationCellCount(EARTH_DAY_HOURS);
    const slow = rotationCellCount(240);
    expect(fast).toBeGreaterThan(earth);
    expect(slow).toBe(1); // a >96 h day collapses to a single Hadley cell
  });

  it('band count is monotonic non-increasing in day length and clamped to [1, MAX]', () => {
    let prev = Infinity;
    for (const day of [2, 4, 6, 12, 24, 48, 96, 240, 6000]) {
      const cells = rotationCellCount(day);
      expect(cells).toBeGreaterThanOrEqual(1);
      expect(cells).toBeLessThanOrEqual(WIND_MAX_CELLS_PER_HEMISPHERE);
      expect(cells).toBeLessThanOrEqual(prev);
      prev = cells;
    }
  });

  it('a nonpositive or NaN day length degrades to a bounded cell count, never NaN', () => {
    // Nonsense inputs map to a finite, in-range count (0 / negative ⇒ treated as
    // infinitely fast ⇒ the cap), never NaN or Infinity.
    expect(rotationCellCount(0)).toBe(WIND_MAX_CELLS_PER_HEMISPHERE);
    expect(rotationCellCount(-5)).toBe(WIND_MAX_CELLS_PER_HEMISPHERE);
    const nan = rotationCellCount(Number.NaN);
    expect(Number.isFinite(nan)).toBe(true);
    expect(nan).toBeGreaterThanOrEqual(1);
    expect(nan).toBeLessThanOrEqual(WIND_MAX_CELLS_PER_HEMISPHERE);
  });
});

describe('winds: directional physics at Earth params (#31)', () => {
  const nCells = 3;
  const gf = 1;

  it('trades near the equator are easterly, mid-latitudes westerly (alternating bands)', () => {
    expect(windAtLatitude(15, nCells, gf).u).toBeLessThan(0); // NE trades (easterly)
    expect(windAtLatitude(45, nCells, gf).u).toBeGreaterThan(0); // Ferrel westerlies
    expect(windAtLatitude(75, nCells, gf).u).toBeLessThan(0); // polar easterlies
  });

  it('surface flow within the Hadley cell is a diagonal (equatorward + westward) trade wind', () => {
    // Northern-hemisphere trades blow toward the SW: both components negative.
    const nh = windAtLatitude(15, nCells, gf);
    expect(nh.u).toBeLessThan(0);
    expect(nh.v).toBeLessThan(0);
    // Southern-hemisphere trades blow toward the NW: zonal still easterly (< 0),
    // meridional now northward (toward the equator, > 0).
    const sh = windAtLatitude(-15, nCells, gf);
    expect(sh.u).toBeLessThan(0);
    expect(sh.v).toBeGreaterThan(0);
  });

  it('windU is even and windV is odd about the equator', () => {
    for (const lat of [8, 22, 51, 78]) {
      const n = windAtLatitude(lat, nCells, gf);
      const s = windAtLatitude(-lat, nCells, gf);
      expect(s.u).toBeCloseTo(n.u, 10); // zonal: symmetric
      expect(s.v).toBeCloseTo(-n.v, 10); // meridional: antisymmetric
    }
  });

  it('the equator and cell boundaries are calm (ITCZ / subtropical highs)', () => {
    expect(Math.abs(windAtLatitude(0, nCells, gf).u)).toBeLessThan(1e-9);
    expect(Math.abs(windAtLatitude(0, nCells, gf).v)).toBeLessThan(1e-9);
    // Cell boundary at 30° (90/nCells): the envelope zeroes there.
    expect(Math.abs(windAtLatitude(30, nCells, gf).u)).toBeLessThan(1e-9);
    expect(Math.abs(windAtLatitude(60, nCells, gf).v)).toBeLessThan(1e-9);
  });

  it('a slow single-cell rotator has easterlies everywhere and one overturning cell', () => {
    // nCells = 1: the whole hemisphere is one Hadley cell — surface easterlies
    // throughout, meridional flow equatorward everywhere (no sign flips).
    for (const lat of [10, 30, 50, 70, 85]) {
      expect(windAtLatitude(lat, 1, gf).u).toBeLessThanOrEqual(0); // easterly
      expect(windAtLatitude(lat, 1, gf).v).toBeLessThanOrEqual(0); // NH: equatorward
      expect(windAtLatitude(-lat, 1, gf).v).toBeGreaterThanOrEqual(0); // SH: equatorward
    }
  });
});

describe('winds: temperature-gradient modulation (#31)', () => {
  it('the gradient factor is clamped to [MIN, MAX] and folds inverted gradients to the floor', () => {
    expect(windGradientFactor(0)).toBe(WIND_GRADIENT_FACTOR_MIN);
    expect(windGradientFactor(-30)).toBe(WIND_GRADIENT_FACTOR_MIN); // inverted ⇒ floor
    expect(windGradientFactor(1e6)).toBe(WIND_GRADIENT_FACTOR_MAX);
    expect(windGradientFactor(Number.NaN)).toBe(WIND_GRADIENT_FACTOR_MIN);
  });

  it('a steeper equator-to-pole gradient strengthens the winds', () => {
    const s = stepped(42, 10, 32);
    const base = solveWinds(s);
    // Cool the poles (indices with |sin lat| large) to steepen the gradient.
    const centers = cellCenterTable(s.params.gridN);
    const count = cellCount(s.params.gridN);
    const colder = s.fields.temperature.slice();
    for (let i = 0; i < count; i++) {
      const a = Math.abs(centers[i * 3 + 1]!);
      if (a > 0.75) colder[i] -= 20;
    }
    const steep = solveWinds({ ...s, fields: { ...s.fields, temperature: colder } });
    expect(steep.gradientK).toBeGreaterThan(base.gradientK);
    expect(steep.gradientFactor).toBeGreaterThanOrEqual(base.gradientFactor);
    // Peak |windU| grows with the gradient factor (until the clamp).
    const peak = (f: Float32Array) => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (steep.gradientFactor > base.gradientFactor) {
      expect(peak(steep.windU)).toBeGreaterThan(peak(base.windU));
    }
  });

  it('the Earth equator-to-pole gradient sits near the reference (factor ≈ 1)', () => {
    for (const seed of SEEDS) {
      const s = stepped(seed, 10, 32);
      const g = meridionalTemperatureGradientK(s);
      expect(g, `seed ${seed}`).toBeGreaterThan(10); // equator warmer than poles
      const f = solveWinds(s).gradientFactor;
      expect(f, `seed ${seed}`).toBeGreaterThan(0.5);
      expect(f, `seed ${seed}`).toBeLessThan(2);
    }
  });
});

describe('winds: bounds & determinism (#31)', () => {
  it('per-cell winds stay inside the codec bound and are finite', () => {
    for (const seed of SEEDS) {
      const sol = solveWinds(stepped(seed, 10, 32));
      for (let i = 0; i < sol.windU.length; i++) {
        expect(Number.isFinite(sol.windU[i]!)).toBe(true);
        expect(Number.isFinite(sol.windV[i]!)).toBe(true);
        expect(Math.abs(sol.windU[i]!)).toBeLessThanOrEqual(WIND_MAX_M_PER_S);
        expect(Math.abs(sol.windV[i]!)).toBeLessThanOrEqual(WIND_MAX_M_PER_S);
      }
    }
  });

  it('is a pure function of state: re-solving yields bit-identical winds', () => {
    const s = stepped(1337, 10, 32);
    const a = solveWinds(s);
    const b = solveWinds(s);
    for (let i = 0; i < a.windU.length; i++) {
      expect(b.windU[i]).toBe(a.windU[i]);
      expect(b.windV[i]).toBe(a.windV[i]);
    }
  });

  it('the step pipeline populates a non-trivial wind field without disturbing temperature', () => {
    const s = stepped(42, 10, 32);
    // Winds are populated (some cell has a real prevailing wind).
    const anyWind = s.fields.windU.some((v) => Math.abs(v) > 0.5);
    expect(anyWind).toBe(true);
    // Winds run after — and never write — temperature: the energy balance still
    // closes on the post-winds state.
    expect(Math.abs(solveEnergyBalance(s).netTopFlux)).toBeLessThan(1e-6);
  });
});
