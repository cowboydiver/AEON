import { describe, expect, it } from 'vitest';
import { ICE_SHEET_WATER_EQUIV_M } from '../src/constants';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCount } from '../src/grid';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import {
  applySeaLevel,
  oceanVolumeMean,
  solveSeaLevel,
  solveSeaLevelState,
} from '../src/systems/seaLevel';

const GOLDEN_SEEDS = [1, 42, 1337] as const;

/**
 * Minimal state with a per-cell elevation/iceFraction and a chosen water
 * inventory + previous sea level. Everything else zero.
 */
function bathyState(
  N: number,
  fill: (i: number) => { elev: number; ice: number },
  waterInventoryM: number,
  prevSeaLevelM = 0,
): PlanetState {
  const params = createPlanetParams({ seed: 7, gridN: N });
  const count = cellCount(N);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
  ) as Fields;
  for (let i = 0; i < count; i++) {
    const c = fill(i);
    fields.elevation[i] = c.elev;
    fields.iceFraction[i] = c.ice;
  }
  return {
    timeYears: 0,
    params,
    globals: {
      landFraction: 0,
      co2: params.initialCo2Ppm,
      meanTemperatureK: 0,
      seaLevelM: prevSeaLevelM,
      waterInventoryM,
      oxygen: 0,
      oxygenReductant: 0,
      abiogenesisYear: -1,
      plateSpeedMedianMPerYr: 0,
      plateSpeedMinMPerYr: 0,
      plateSpeedMaxMPerYr: 0,
      oceanicContinentalSpeedRatio: 0,
      speedContinentalityCorr: 0,
      speedSlabAttachmentCorr: 0,
      poleStability: 0,
      marginConsolidationFlipsTotal: 0,
      columnsExportedRockM3: 0,
      columnsExportShelfLimited: 0,
      columnsExportVisits: 0,
      columnsSedimentZeroedM3: 0,
      columnsThicknessCapBinds: 0,
      columnsMaturationFlips: 0,
      columnsMaturationElevSumM: 0,
      columnsMaturationCreditM3: 0,
      columnsRegularizedCreditM3: 0,
      columnsFounderTrimM3: 0,
      columnsRetiredDebitM3: 0,
      columnsRetiredCells: 0,
      columnsMarginThinnedM3: 0,
    },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {}, stallSince: {}, shorteningIntegral: {} },
  };
}

describe('seaLevel: hypsometric solve (#33)', () => {
  it('oceanVolumeMean sums flooded depth as a cell-count mean', () => {
    // Two cells at -100, two at +100; at sea level 0 the flooded mean is 50.
    const elev = new Float32Array([-100, -100, 100, 100]);
    expect(oceanVolumeMean(elev, 4, 0)).toBeCloseTo(50, 9);
    expect(oceanVolumeMean(elev, 4, 100)).toBeCloseTo(100, 9); // all four flooded to +100
    expect(oceanVolumeMean(elev, 4, -100)).toBe(0); // nothing below the deepest cell
  });

  it('solveSeaLevel inverts oceanVolumeMean to float precision', () => {
    const elev = new Float32Array([-500, -200, -50, 300, 800, 1500]);
    for (const target of [10, 100, 250, 600]) {
      const s = solveSeaLevel(elev, elev.length, target);
      expect(oceanVolumeMean(elev, elev.length, s)).toBeCloseTo(target, 4);
    }
  });

  it('is monotonic: a larger target gives a higher sea level', () => {
    const elev = new Float32Array([-500, -200, -50, 300, 800, 1500]);
    const lo = solveSeaLevel(elev, elev.length, 50);
    const hi = solveSeaLevel(elev, elev.length, 400);
    expect(hi).toBeGreaterThan(lo);
  });

  it('a non-positive target (all water iced) yields no ocean', () => {
    const elev = new Float32Array([-500, -200, 300, 800]);
    const s = solveSeaLevel(elev, elev.length, 0);
    expect(oceanVolumeMean(elev, elev.length, s)).toBe(0);
  });
});

describe('seaLevel: conservation and coupling (#33)', () => {
  it('conserves the water inventory: ocean liquid + grounded ice = inventory', () => {
    // Half ocean (-2000), half land (+500); a fifth of land carries ice.
    const N = 8;
    const count = cellCount(N);
    const state = bathyState(
      N,
      (i) => ({ elev: i % 2 === 0 ? -2000 : 500, ice: i % 10 === 1 ? 1 : 0 }),
      // Inventory: enough to sit sea level near the datum with the ice present.
      1100,
    );
    const sol = solveSeaLevelState(state);
    expect(sol.oceanEquivM + sol.lockedIceEquivM).toBeCloseTo(state.globals.waterInventoryM, 3);
    // Sanity: recomputing ocean volume at the solved level matches the reported.
    expect(oceanVolumeMean(state.fields.elevation, count, sol.seaLevelM)).toBeCloseTo(
      sol.oceanEquivM,
      6,
    );
  });

  it('grounded ice lowers sea level; more ice lowers it further', () => {
    const N = 8;
    const mk = (icedCells: number) =>
      bathyState(N, (i) => ({ elev: i % 2 === 0 ? -2000 : 800, ice: i % 2 === 1 && i < icedCells ? 1 : 0 }), 1000);
    const none = solveSeaLevelState(mk(0)).seaLevelM;
    const some = solveSeaLevelState(mk(40)).seaLevelM;
    const more = solveSeaLevelState(mk(cellCount(N))).seaLevelM;
    expect(some).toBeLessThan(none);
    expect(more).toBeLessThan(some);
  });

  it('floating SEA ice (below sea level) does not change sea level', () => {
    const N = 8;
    // Grounded ice on the land cells vs the SAME fraction placed on ocean cells.
    const grounded = bathyState(N, (i) => ({ elev: i % 2 === 0 ? -2000 : 800, ice: i % 2 === 1 ? 0.5 : 0 }), 1000);
    const floating = bathyState(N, (i) => ({ elev: i % 2 === 0 ? -2000 : 800, ice: i % 2 === 0 ? 0.5 : 0 }), 1000);
    const noIce = bathyState(N, (i) => ({ elev: i % 2 === 0 ? -2000 : 800, ice: 0 }), 1000);
    // Sea ice sits on cells below the previous sea level, so it is not counted.
    expect(solveSeaLevelState(floating).seaLevelM).toBeCloseTo(
      solveSeaLevelState(noIce).seaLevelM,
      6,
    );
    // Grounded ice, in contrast, drops the level.
    expect(solveSeaLevelState(grounded).seaLevelM).toBeLessThan(solveSeaLevelState(noIce).seaLevelM);
  });

  it('landFraction is emergent: the share of cells at or above sea level', () => {
    const N = 8;
    const count = cellCount(N);
    const state = bathyState(N, (i) => ({ elev: i % 4 === 0 ? 500 : -2000, ice: 0 }), 800);
    const out = applySeaLevel(state);
    let land = 0;
    for (const e of out.fields.elevation) if (e >= out.globals.seaLevelM) land++;
    expect(out.globals.landFraction).toBeCloseTo(land / count, 12);
  });

  it('locks water in proportion to the ice water-equivalent constant', () => {
    // A single fully-iced grounded cell locks ICE_SHEET_WATER_EQUIV_M / count.
    // The inventory is comfortably above that, so the locked-ice cap is inert.
    const N = 4;
    const count = cellCount(N);
    const state = bathyState(N, (i) => ({ elev: 500, ice: i === 0 ? 1 : 0 }), 1000, 0);
    const sol = solveSeaLevelState(state);
    expect(sol.lockedIceEquivM).toBeCloseTo(ICE_SHEET_WATER_EQUIV_M / count, 6);
  });

  it('caps grounded ice at the inventory (a fully glaciated world runs the ocean dry)', () => {
    // Inventory smaller than the ice would lock: locked is capped at the
    // inventory, the ocean empties, and the water-mass invariant still closes.
    const N = 4;
    const state = bathyState(N, () => ({ elev: 500, ice: 1 }), 5, 0);
    const sol = solveSeaLevelState(state);
    expect(sol.lockedIceEquivM).toBeCloseTo(5, 6); // capped at the inventory
    expect(sol.oceanEquivM).toBeCloseTo(0, 6); // no liquid ocean left
    expect(sol.oceanEquivM + sol.lockedIceEquivM).toBeCloseTo(state.globals.waterInventoryM, 6);
  });

  it('is deterministic and does not mutate the input', () => {
    const state = bathyState(8, (i) => ({ elev: i % 2 === 0 ? -1500 : 600, ice: i % 3 === 0 ? 0.4 : 0 }), 900);
    const beforeElev = state.fields.elevation.slice();
    const a = applySeaLevel(state);
    const b = applySeaLevel(state);
    expect(state.fields.elevation).toEqual(beforeElev);
    expect(a.globals.seaLevelM).toBe(b.globals.seaLevelM);
    expect(a.globals.landFraction).toBe(b.globals.landFraction);
  });
});

describe('seaLevel: water-mass invariant over the real pipeline (#33, §5)', () => {
  // The conserved inventory is calibrated at init; across the full climate
  // pipeline (ice grows/shrinks, sea level re-solves), liquid ocean + grounded
  // ice must always equal it. Grounded ice is classified in `seaLevel` against
  // the previous step's level, so recomputing it against the freshly-solved
  // level leaves a sub-metre slack — ice sheets sit far above the shoreline.
  it('conserves ocean liquid + grounded ice = the init inventory, every step', () => {
    for (const seed of GOLDEN_SEEDS) {
      const params = createPlanetParams({ seed, gridN: 16, stepYears: 2e6 });
      const count = cellCount(params.gridN);
      const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
      let s = createInitialState(params);
      const inventory = s.globals.waterInventoryM;
      // At t=0 there is no ice and sea level is exactly 0 by construction.
      expect(s.globals.seaLevelM).toBe(0);
      expect(oceanVolumeMean(s.fields.elevation, count, 0)).toBeCloseTo(inventory, 6);

      for (let i = 0; i < 40; i++) {
        s = step(s, params.stepYears, ctx);
        expect(s.globals.waterInventoryM, `seed ${seed} step ${i}: inventory constant`).toBe(inventory);
        let grounded = 0;
        for (let c = 0; c < count; c++) {
          if (s.fields.elevation[c]! >= s.globals.seaLevelM) grounded += s.fields.iceFraction[c]!;
        }
        const lockedEquiv = (grounded * ICE_SHEET_WATER_EQUIV_M) / count;
        const ocean = oceanVolumeMean(s.fields.elevation, count, s.globals.seaLevelM);
        // Within 1 m global-equivalent: bisection precision + the grounded-ice
        // classification lag. On a ~1800 m inventory that is < 0.06%.
        expect(ocean + lockedEquiv, `seed ${seed} step ${i}: water conserved`).toBeCloseTo(inventory, 0);
      }
    }
  });
});
