import { beforeAll, describe, expect, it } from 'vitest';
import { ICE_SHEET_WATER_EQUIV_M } from '../../src/constants';
import { cellCount } from '../../src/grid';
import { createRng } from '../../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../../src/state';
import { step, type SimContext } from '../../src/step';
import { solveEnergyBalance } from '../../src/systems/energyBalance';
import { oceanVolumeMean } from '../../src/systems/seaLevel';

/**
 * Phase 3 acceptance invariants (#36): the phase-level checks that the whole
 * climate stack holds together across deep time — as opposed to the per-system
 * invariants (energy closes at a single checkpoint in `energyBalance.test.ts`,
 * water conserved over 80 Myr in `seaLevel.test.ts`, the snowball episode in
 * `invariants/carbon.test.ts`). This file asserts the phase's *standing*
 * invariants over ONE integrated multi-Gyr run per golden seed:
 *
 *   1. Energy balance closes — global net top-of-atmosphere flux ≈ 0 — at EVERY
 *      checkpoint, not just once (§5, the phase's named risk: a diverging
 *      feedback would open the balance).
 *   2. Water mass is conserved — liquid ocean + grounded ice = the init
 *      inventory — at every checkpoint (§5).
 *   3. Ice caps *breathe*: mean cover advances and retreats repeatedly over the
 *      timeline (the #33 done-criterion), without ever tipping the default
 *      planet into a spurious snowball (§5).
 *
 * All three read off a single ~2 Gyr pipeline run at coarse N (shared via
 * `beforeAll`) so the file stays well inside the <30 s kernel-suite budget. The
 * rain-shadow acceptance is `moisture.test.ts` (windward/lee emergence on the
 * golden planets) plus the committed `docs/phase3-evidence` PNGs; the
 * parameterized snowball-and-recovery is `invariants/carbon.test.ts`.
 */

const SEEDS = [1, 42, 1337] as const;
const GRID_N = 16; // 1536 cells: cheap, and deep-time climate structure is grid-robust
const STEP_YEARS = 4e6;
const UNTIL_YEARS = 2e9; // 500 steps — long enough for several ice-age cycles
const CHECKPOINT_EVERY = 10; // sample every 40 Myr

interface AcceptanceRun {
  /** Worst |net TOA flux| seen at any checkpoint (W/m²) — the energy closure. */
  worstNetFlux: number;
  /** Worst |ocean + grounded ice − inventory| (m) — the water partition slack. */
  worstWaterErr: number;
  /** Worst |waterInventoryM − init| (m) — the hard conserved quantity; ≡ 0. */
  worstInvDrift: number;
  /** The conserved inventory the water closure is measured against (m). */
  inventoryM: number;
  /** Mean ice cover sampled at each checkpoint — the breathing series. */
  iceSeries: number[];
  /** Every field finite at every checkpoint. */
  allFinite: boolean;
  /** Bounds seen across the run, for the physical-range assertions. */
  tMin: number;
  tMax: number;
  meanTMin: number;
  meanTMax: number;
  co2Min: number;
  co2Max: number;
  landMin: number;
  landMax: number;
}

/** Grounded-ice water-equivalent: ice on cells at or above the current sea level. */
function groundedIceEquivM(s: PlanetState, count: number): number {
  let grounded = 0;
  for (let c = 0; c < count; c++) {
    if (s.fields.elevation[c]! >= s.globals.seaLevelM) grounded += s.fields.iceFraction[c]!;
  }
  return (grounded * ICE_SHEET_WATER_EQUIV_M) / count;
}

function meanIce(s: PlanetState): number {
  let sum = 0;
  for (const f of s.fields.iceFraction) sum += f;
  return sum / s.fields.iceFraction.length;
}

function fieldsFinite(s: PlanetState): boolean {
  for (const name of Object.keys(s.fields) as (keyof typeof s.fields)[]) {
    for (const v of s.fields[name]) if (!Number.isFinite(v)) return false;
  }
  return true;
}

/** Run one integrated pipeline to UNTIL_YEARS, measuring the standing invariants. */
function runAcceptance(seed: number): AcceptanceRun {
  const params = createPlanetParams({ seed, gridN: GRID_N, stepYears: STEP_YEARS });
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  const count = cellCount(GRID_N);
  let s = createInitialState(params);
  const inventoryM = s.globals.waterInventoryM;

  const run: AcceptanceRun = {
    worstNetFlux: 0,
    worstWaterErr: 0,
    worstInvDrift: 0,
    inventoryM,
    iceSeries: [],
    allFinite: true,
    tMin: Infinity,
    tMax: -Infinity,
    meanTMin: Infinity,
    meanTMax: -Infinity,
    co2Min: Infinity,
    co2Max: -Infinity,
    landMin: Infinity,
    landMax: -Infinity,
  };

  const steps = Math.round(UNTIL_YEARS / STEP_YEARS);
  for (let i = 1; i <= steps; i++) {
    s = step(s, STEP_YEARS, ctx);
    if (i % CHECKPOINT_EVERY !== 0) continue;

    if (!fieldsFinite(s)) run.allFinite = false;

    // Energy closure: recompute net TOA flux against the freshly-solved state.
    run.worstNetFlux = Math.max(run.worstNetFlux, Math.abs(solveEnergyBalance(s).netTopFlux));

    // Water closure. The hard conserved quantity is the inventory global itself
    // (never mutated — drift must be exactly 0). The partition reconstruction
    // (ocean volume at the solved level + independently-classified grounded ice)
    // matches it within a small slack — the documented one-step grounded-ice
    // classification lag (ice typed against the previous step's sea level).
    run.worstInvDrift = Math.max(run.worstInvDrift, Math.abs(s.globals.waterInventoryM - inventoryM));
    const ocean = oceanVolumeMean(s.fields.elevation, count, s.globals.seaLevelM);
    run.worstWaterErr = Math.max(
      run.worstWaterErr,
      Math.abs(ocean + groundedIceEquivM(s, count) - inventoryM),
    );

    run.iceSeries.push(meanIce(s));

    for (const t of s.fields.temperature) {
      run.tMin = Math.min(run.tMin, t);
      run.tMax = Math.max(run.tMax, t);
    }
    run.meanTMin = Math.min(run.meanTMin, s.globals.meanTemperatureK);
    run.meanTMax = Math.max(run.meanTMax, s.globals.meanTemperatureK);
    run.co2Min = Math.min(run.co2Min, s.globals.co2);
    run.co2Max = Math.max(run.co2Max, s.globals.co2);
    run.landMin = Math.min(run.landMin, s.globals.landFraction);
    run.landMax = Math.max(run.landMax, s.globals.landFraction);
  }
  return run;
}

// --- Ice-breathing metric (a detector, tested against planted series below) ---

interface Breathing {
  span: number; // max − min cover
  advance: number; // Σ positive step-to-step deltas
  retreat: number; // Σ |negative deltas|
  reversals: number; // sign changes in successive deltas
  max: number; // peak cover — the anti-snowball ceiling
}

function iceBreathing(series: readonly number[]): Breathing {
  let max = -Infinity;
  let min = Infinity;
  let advance = 0;
  let retreat = 0;
  let reversals = 0;
  let prevDir = 0;
  for (let k = 0; k < series.length; k++) {
    max = Math.max(max, series[k]!);
    min = Math.min(min, series[k]!);
    if (k === 0) continue;
    const d = series[k]! - series[k - 1]!;
    if (d > 0) advance += d;
    else if (d < 0) retreat += -d;
    const dir = Math.sign(d);
    if (dir !== 0) {
      if (prevDir !== 0 && dir !== prevDir) reversals++;
      prevDir = dir;
    }
  }
  return { span: max - min, advance, retreat, reversals, max };
}

/**
 * "Breathing" = ice caps that repeatedly advance AND retreat with real
 * amplitude, and that never freeze the planet over. A monotonic drift, a frozen
 * constant, or a single one-off ice age all fail this. Thresholds sit well below
 * the measured golden values at this config (span 0.09–0.11, 15–25 reversals,
 * advance ~0.18, retreat 0.11–0.14 across seeds {1, 42, 1337}) so the check is
 * robust, not brittle.
 */
function isBreathing(b: Breathing): boolean {
  return (
    b.span > 0.04 &&
    b.advance > 0.05 &&
    b.retreat > 0.05 &&
    b.reversals >= 3 &&
    b.max < 0.4 // anti-snowball: the default planet never ices over
  );
}

// --- The standing invariants --------------------------------------------------

describe('phase 3 acceptance: standing invariants (#36)', () => {
  const runs = new Map<number, AcceptanceRun>();
  beforeAll(() => {
    for (const seed of SEEDS) runs.set(seed, runAcceptance(seed));
  });

  it('every field stays finite across the whole integrated run, for all golden seeds', () => {
    for (const seed of SEEDS) {
      expect(runs.get(seed)!.allFinite, `seed ${seed}`).toBe(true);
    }
  });

  it('energy balance closes — net TOA flux ≈ 0 — at every checkpoint (the §5 risk)', () => {
    for (const seed of SEEDS) {
      // Linear OLR + conservative diffusion ⇒ the balance closes to machine
      // precision, not merely a tolerance; measured worst ~2e-11 W/m². A
      // diverging feedback (the named risk) could not hold this over 2 Gyr.
      expect(runs.get(seed)!.worstNetFlux, `seed ${seed}: worst |net TOA|`).toBeLessThan(1e-6);
    }
  });

  it('water mass is conserved — the inventory is bit-constant and the ocean/ice partition reconstructs it', () => {
    for (const seed of SEEDS) {
      const r = runs.get(seed)!;
      // The conserved quantity — total water (ocean + ice) as the inventory
      // global — never drifts by a single ULP over the whole run.
      expect(r.worstInvDrift, `seed ${seed}: inventory drift`).toBe(0);
      // And the independently-reconstructed partition (liquid ocean at the
      // solved sea level + grounded ice) recovers that inventory within 0.3% —
      // the bounded one-step classification lag, which peaks early and decays,
      // not a growing leak. Measured worst ~0.12% (≈ 2.3 m on a ~1860 m inventory).
      expect(
        r.worstWaterErr,
        `seed ${seed}: worst partition error (inv ${r.inventoryM.toFixed(0)} m)`,
      ).toBeLessThan(r.inventoryM * 0.003);
    }
  });

  it('climate quantities stay in physical bounds over the whole timeline (no divergence)', () => {
    for (const seed of SEEDS) {
      const r = runs.get(seed)!;
      // Per-cell temperature inside the widened codec window [180, 330] K.
      expect(r.tMin, `seed ${seed}: temperature floor`).toBeGreaterThanOrEqual(180);
      expect(r.tMax, `seed ${seed}: temperature ceiling`).toBeLessThanOrEqual(330);
      // Global mean temperature Earth-like — never a runaway hot/cold house.
      expect(r.meanTMin, `seed ${seed}: coldest mean T`).toBeGreaterThan(250);
      expect(r.meanTMax, `seed ${seed}: warmest mean T`).toBeLessThan(315);
      // CO₂ regulated far inside its clamps (thermostat never rides a bound).
      expect(r.co2Min, `seed ${seed}: CO₂ floor`).toBeGreaterThan(50);
      expect(r.co2Max, `seed ${seed}: CO₂ ceiling`).toBeLessThan(8000);
      // Land fraction, emergent from the dynamic sea level, stays in band.
      expect(r.landMin, `seed ${seed}: least land`).toBeGreaterThan(0.15);
      expect(r.landMax, `seed ${seed}: most land`).toBeLessThan(0.7);
    }
  });

  it('ice caps breathe over the timeline — repeated advance and retreat, no spurious snowball (#33)', () => {
    for (const seed of SEEDS) {
      const b = iceBreathing(runs.get(seed)!.iceSeries);
      expect(
        isBreathing(b),
        `seed ${seed}: ice breathes (span ${b.span.toFixed(3)}, ${b.reversals} reversals, ` +
          `advance ${b.advance.toFixed(3)}, retreat ${b.retreat.toFixed(3)}, max ${b.max.toFixed(3)})`,
      ).toBe(true);
      // There IS ice (caps exist to breathe) and it is never absent at every sample.
      expect(b.max, `seed ${seed}: ice present`).toBeGreaterThan(0.02);
    }
  });
});

// --- The breathing detector must catch planted non-breathing series -----------

describe('phase 3 acceptance detectors catch planted bugs (#36)', () => {
  it('breathing detector rejects a frozen (constant) ice series', () => {
    // A cap stuck at one value neither advances nor retreats.
    expect(isBreathing(iceBreathing(new Array<number>(50).fill(0.08)))).toBe(false);
  });

  it('breathing detector rejects monotonic drift (advance with no retreat)', () => {
    // A steadily creeping glaciation is not "breathing" — no retreat, no reversals.
    const ramp = Array.from({ length: 50 }, (_, k) => 0.02 + k * 0.005);
    const b = iceBreathing(ramp);
    expect(b.retreat).toBe(0);
    expect(b.reversals).toBe(0);
    expect(isBreathing(b)).toBe(false);
  });

  it('breathing detector rejects a single one-off ice age (too few reversals)', () => {
    // One advance-then-retreat hump has amplitude but only one reversal — real
    // breathing is the repeated Wilson-cycle-driven oscillation, not one event.
    const hump = [0.05, 0.15, 0.3, 0.35, 0.3, 0.15, 0.05];
    const b = iceBreathing(hump);
    expect(b.reversals).toBe(1);
    expect(isBreathing(b)).toBe(false);
  });

  it('breathing detector rejects a snowball (cover pegged near 1)', () => {
    // An oscillation that rides near total cover is a frozen planet, not caps.
    const frozen = Array.from({ length: 50 }, (_, k) => 0.9 + 0.05 * Math.sin(k));
    expect(iceBreathing(frozen).max).toBeGreaterThan(0.9);
    expect(isBreathing(iceBreathing(frozen))).toBe(false);
  });

  it('breathing detector accepts a healthy oscillation with amplitude and reversals', () => {
    // Positive control: the shape the real golden runs produce (repeated
    // advance/retreat between ~0.02 and ~0.14) is recognized as breathing.
    const alive = Array.from({ length: 50 }, (_, k) => 0.08 + 0.06 * Math.sin(k * 0.7));
    expect(isBreathing(iceBreathing(alive))).toBe(true);
  });
});

// --- The from-orbit colour is biome-driven, not a relabelled height ramp ------

/** Step a fresh planet `n` macro steps at grid `gridN`. */
function stepped(seed: number, n: number, gridN: number): PlanetState {
  const params = createPlanetParams({ seed, gridN });
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

/**
 * Distinct land biome classes among cells inside a narrow elevation band, each
 * cell's class read through `biomeOf`. With the real `biome` field this counts
 * how many ecosystems share the SAME heights; with a height-only `biomeOf` it
 * collapses to one — the discriminator's negative control below.
 */
function distinctLandBiomesInBand(
  s: PlanetState,
  loM: number,
  hiM: number,
  biomeOf: (i: number) => number,
): Set<number> {
  const set = new Set<number>();
  for (let c = 0; c < s.fields.elevation.length; c++) {
    const e = s.fields.elevation[c]!;
    if (e < s.globals.seaLevelM || e < loM || e > hiM) continue;
    set.add(Math.round(biomeOf(c)));
  }
  return set;
}

describe('phase 3 acceptance: the from-orbit colour is biome-driven, not hypsometric (#36)', () => {
  // The renderer colours land by the categorical `biome` field (#35,
  // planet-renderer/src/material.ts `biomePalette`), NOT by elevation. The tell
  // that it is genuinely biome-driven — and not merely an earthlike palette that
  // resembles the old hypsometric ramp — is that land cells at the SAME height
  // take DIFFERENT colours (cold → tundra, dry → desert, wet → forest). A
  // height-only ramp cannot: equal elevation ⇒ equal colour.
  const BAND = { lo: 200, hi: 350 }; // a narrow 150 m land band

  it('land at the same elevation carries several biome classes (colour tracks climate, not height)', () => {
    for (const seed of SEEDS) {
      const s = stepped(seed, 30, 32);
      const classes = distinctLandBiomesInBand(s, BAND.lo, BAND.hi, (c) => s.fields.biome[c]!);
      // Measured 5–7 classes in the 200–350 m band on every golden seed; a
      // height-only ramp gives exactly 1. > 2 is a wide-margin gate.
      expect(
        classes.size,
        `seed ${seed}: biome classes at ${BAND.lo}–${BAND.hi} m {${[...classes].sort((a, b) => a - b).join(',')}}`,
      ).toBeGreaterThan(2);
    }
  });

  it('the discriminator CATCHES a height-only (hypsometric) colouring — it is not vacuous', () => {
    // Negative control: recolour by a pure function of elevation — what the
    // pre-#35 hypsometric renderer encoded. The same narrow band collapses to
    // ONE class, so the check above genuinely distinguishes biome from height.
    const s = stepped(42, 30, 32);
    const heightOnly = (c: number): number =>
      s.fields.elevation[c]! < s.globals.seaLevelM
        ? 0
        : 1 + Math.floor(Math.max(0, s.fields.elevation[c]!) / 500);
    expect(
      distinctLandBiomesInBand(s, BAND.lo, BAND.hi, heightOnly).size,
      'a height-only ramp collapses the band to a single class',
    ).toBeLessThanOrEqual(1);
  });
});
