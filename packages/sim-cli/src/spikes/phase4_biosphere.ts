/**
 * Phase 4 Milestone 0 — biosphere de-risking prototype (THROWAWAY).
 *
 * Per `docs/PHASE_4_SPEC.md` §2 M0: measure before wiring the biosphere into the
 * kernel. This script composes a *custom* step pipeline from the kernel's
 * exported systems — the stock climate block with `carbon` replaced by a
 * biotic-weathering variant — and runs an external biosphere reservoir model
 * (abiogenesis → marine productivity → O₂ → land vegetation) alongside it. It
 * changes NO kernel bytes and produces no goldens; it answers three questions:
 *
 *   Q1  Does oxygenation emerge as a Great-Oxidation-like S-curve — a long anoxic
 *       latency then a rise to a plateau — reliably completing yet seed-dependent?
 *   Q2  Is the coupled biosphere↔carbon↔climate loop stable — no O₂ runaway, no
 *       spurious *permanent* snowball from biotic weathering drawdown?
 *   Q3  Do two seeds tell visibly different life stories, and does disabling the
 *       biosphere (biotic weathering off) measurably change late-history climate?
 *
 * The biosphere's randomness is drawn from a DEDICATED forked stream
 * (`fork('phase4-bio')`), independent of the sim stream, so biosphere-OFF is
 * bit-for-bit the stock kernel and the ablation's climate delta is causal — it
 * flows only through enhanced silicate weathering, not through perturbed
 * tectonics. The one-step explicit lag is honoured: `carbon` at step N reads the
 * vegetation produced by the biosphere update at step N−1.
 *
 * Run:  pnpm --filter sim-cli exec tsx src/spikes/phase4_biosphere.ts [--n 32] [--until 4.5e9] [--fast]
 */

import {
  CO2_MAX_CHANGE_FRAC_PER_MYR,
  CO2_MAX_PPM,
  CO2_MIN_PPM,
  CO2_OUTGAS_ACTIVITY_REF_M_PER_YR,
  annualMeanInsolation,
  cellCenterTable,
  cellCount,
  createPlanetParams,
  createInitialState,
  createRng,
  outgassingPpmPerYr,
  step,
  tectonicActivity,
  weatheringPpmPerYr,
  weatheringPrecipFactor,
  weatheringTempFactor,
  SYSTEMS,
  type PlanetState,
  type SimContext,
  type System,
} from 'sim-kernel';

// ---------------------------------------------------------------------------
// Biosphere model constants (M0 tunables — the output of this spike is a
// recommended set of these, to seed #37/#39's `constants.ts`). Rates are per
// Myr, so at the default 1 Myr step they are per-step increments.
// ---------------------------------------------------------------------------

const INITIAL_OXYGEN_PAL = 1e-6; // anoxic Archean-like start
const ABIOGENESIS_RATE_PER_YR = 8e-9; // onset hazard (× ocean-habitability), ~10²-Myr scale

// Marine productivity → O₂ source; reductant sinks create the anoxic latency.
// Balance (at typical productivity Π≈0.2, activity≈ref): gross source
// OXY_SOURCE·Π·BURIAL ≈ 0.006/Myr must exceed the volcanic reductant sink so O₂
// can accumulate once the reductant buffer is oxidized; the O₂ plateau is
// net/OXY_OX_SINK.
const OXY_SOURCE_PAL_PER_MYR = 0.1; // gross photosynthetic O₂ per unit productivity
const BURIAL_FRACTION = 0.3; // fraction of organic C buried (net O₂ that survives respiration)
const OXY_VOLC_SINK_PAL_PER_MYR = 0.002; // mantle/volcanic reductant draw at reference activity
const OXY_OX_SINK_PER_MYR = 0.004; // oxidative-weathering removal ∝ O₂ (sets the plateau ≈1 PAL)
const REDUCTANT_BUFFER_PAL = 1.0; // reduced crust/mantle to oxidize before O₂ can rise (the GOE delay)

// Thresholds that become emergent events.
const GOE_THRESHOLD_PAL = 0.01; // "Great Oxidation": O₂ first crosses ~1% PAL
const OZONE_THRESHOLD_PAL = 0.1; // land habitable (UV shield) → colonization can begin
const FIRST_FORESTS_MEAN_VEG = 0.05; // "First forests": mean land vegetation crosses this

// Marine productivity shape.
const PROD_TEMP_OPT_K = 293;
const PROD_TEMP_WIDTH_K = 22;
const PROD_TEMP_MIN_K = 273; // needs liquid water
const PROD_TEMP_MAX_K = 323;

// Land vegetation dynamics.
const VEG_GROWTH_PER_MYR = 0.03;
const VEG_DIEBACK_PER_MYR = 0.01;
const VEG_TEMP_OPT_K = 291;
const VEG_TEMP_WIDTH_K = 24;
const VEG_TEMP_MIN_K = 273;
const VEG_TEMP_MAX_K = 318;
const VEG_PRECIP_REF_KG_PER_M2_YR = 500;

// The climate lever behind the ablation: vegetation multiplies silicate
// weathering (roots/organic acids). Full cover → this-fold enhancement.
const BIOTIC_WEATHER_FACTOR = 3;

// ---------------------------------------------------------------------------
// External biosphere state (prototype-only; the real kernel carries this in
// PlanetState / Globals — see spec §1).
// ---------------------------------------------------------------------------

interface Bio {
  oxygenPAL: number;
  reductant: number;
  abiogenesisYear: number; // -1 until life originates
  greatOxidationYear: number; // -1 until O₂ crosses GOE threshold
  firstForestsYear: number; // -1 until mean veg crosses threshold
  vegetation: Float32Array; // per land cell, 0..1
  marineLife: Float32Array; // per ocean cell, 0..1 (diagnostic)
  enabled: boolean; // false = ablation: biosphere inert, weathering un-enhanced
}

function createBio(count: number, enabled: boolean): Bio {
  return {
    oxygenPAL: INITIAL_OXYGEN_PAL,
    reductant: REDUCTANT_BUFFER_PAL,
    abiogenesisYear: -1,
    greatOxidationYear: -1,
    firstForestsYear: -1,
    vegetation: new Float32Array(count),
    marineLife: new Float32Array(count),
    enabled,
  };
}

function gaussianWindow(x: number, opt: number, width: number, lo: number, hi: number): number {
  if (x < lo || x > hi) return 0;
  const z = (x - opt) / width;
  return Math.exp(-z * z);
}

/** Normalized per-cell annual-mean light (equator ≈ 1, poles ≈ 0.5), constant
 *  across the run — depends only on the grid and obliquity. */
function computeLight(N: number, obliquityDeg: number): Float32Array {
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const obliquityRad = (obliquityDeg * Math.PI) / 180;
  const equator = annualMeanInsolation(0, obliquityRad);
  const light = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const sinLat = centers[i * 3 + 1]!;
    light[i] = annualMeanInsolation(sinLat, obliquityRad) / equator;
  }
  return light;
}

/** Mean marine photosynthetic productivity over ocean cells, 0..1, gated on
 *  abiogenesis. Also fills `bio.marineLife` for the record. */
function marineProductivity(state: PlanetState, bio: Bio, light: Float32Array): number {
  const count = cellCount(state.params.gridN);
  const { elevation, temperature } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  bio.marineLife.fill(0);
  if (bio.abiogenesisYear < 0) return 0;
  let sum = 0;
  let ocean = 0;
  for (let i = 0; i < count; i++) {
    const depth = seaLevel - elevation[i]!;
    if (depth <= 0) continue; // land
    ocean++;
    const tW = gaussianWindow(temperature[i]!, PROD_TEMP_OPT_K, PROD_TEMP_WIDTH_K, PROD_TEMP_MIN_K, PROD_TEMP_MAX_K);
    // Shelf/upwelling nutrient proxy: shallow seas near continents are richer.
    const nutrient = Math.max(0.25, Math.min(1, 1 - depth / 6000));
    const p = light[i]! * tW * nutrient;
    bio.marineLife[i] = p;
    sum += p;
  }
  return ocean > 0 ? sum / ocean : 0;
}

/** Fraction of ocean cells in the liquid-water productivity window — the
 *  habitability gate on abiogenesis onset. */
function oceanHabitableFraction(state: PlanetState): number {
  const count = cellCount(state.params.gridN);
  const { elevation, temperature } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let warm = 0;
  let ocean = 0;
  for (let i = 0; i < count; i++) {
    if (seaLevel - elevation[i]! <= 0) continue;
    ocean++;
    if (temperature[i]! >= PROD_TEMP_MIN_K && temperature[i]! <= PROD_TEMP_MAX_K) warm++;
  }
  return ocean > 0 ? warm / ocean : 0;
}

/** Advance the biosphere one step from this step's climate. Mutates `bio`. */
function updateBiosphere(
  state: PlanetState,
  dtYears: number,
  bio: Bio,
  bioRng: { next: () => number },
  light: Float32Array,
): void {
  if (!bio.enabled) return;
  const dtMyr = dtYears / 1e6;
  const now = state.timeYears;

  // Abiogenesis: gated-stochastic onset, drawn from the dedicated stream.
  if (bio.abiogenesisYear < 0) {
    const habitable = oceanHabitableFraction(state);
    const pOnset = (1 - Math.exp(-ABIOGENESIS_RATE_PER_YR * dtYears)) * habitable;
    if (bioRng.next() < pOnset) bio.abiogenesisYear = now;
  }

  // Marine productivity → O₂ reservoir with a reductant buffer (the GOE delay).
  const productivity = marineProductivity(state, bio, light);
  const activityRatio = tectonicActivity(state) / CO2_OUTGAS_ACTIVITY_REF_M_PER_YR;
  const grossO2 = OXY_SOURCE_PAL_PER_MYR * productivity * BURIAL_FRACTION * dtMyr;
  const volcSink = OXY_VOLC_SINK_PAL_PER_MYR * activityRatio * dtMyr;
  let net = grossO2 - volcSink;
  if (net > 0 && bio.reductant > 0) {
    const used = Math.min(net, bio.reductant);
    bio.reductant -= used;
    net -= used;
  }
  bio.oxygenPAL += net;
  bio.oxygenPAL -= OXY_OX_SINK_PER_MYR * bio.oxygenPAL * dtMyr;
  if (bio.oxygenPAL < 0) bio.oxygenPAL = 0;
  if (bio.greatOxidationYear < 0 && bio.oxygenPAL >= GOE_THRESHOLD_PAL) bio.greatOxidationYear = now;

  // Land vegetation: colonization gated on the ozone (O₂) threshold; then a
  // climate-driven grow/dieback reservoir.
  const gate = bio.oxygenPAL >= OZONE_THRESHOLD_PAL;
  const count = cellCount(state.params.gridN);
  const { elevation, temperature, precipitation, iceFraction } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  const veg = bio.vegetation;
  for (let i = 0; i < count; i++) {
    if (elevation[i]! < seaLevel) {
      veg[i] = 0; // ocean
      continue;
    }
    const tW = gaussianWindow(temperature[i]!, VEG_TEMP_OPT_K, VEG_TEMP_WIDTH_K, VEG_TEMP_MIN_K, VEG_TEMP_MAX_K);
    const moist = Math.max(0, Math.min(1, precipitation[i]! / VEG_PRECIP_REF_KG_PER_M2_YR));
    const h = tW * moist * (1 - iceFraction[i]!);
    const grow = gate ? VEG_GROWTH_PER_MYR * h * (1 - veg[i]!) : 0;
    const die = VEG_DIEBACK_PER_MYR * (1 - h) * veg[i]! + (gate ? 0 : VEG_DIEBACK_PER_MYR * veg[i]!);
    let v = veg[i]! + (grow - die) * dtMyr;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    veg[i] = v;
  }
}

/** Vegetation-enhanced weathering potential: the stock #34 computation with a
 *  per-land-cell biotic multiplier (1 + BIOTIC·vegetation). With vegetation = 0
 *  everywhere this is IDENTICAL to `weatheringPotential`, so biosphere-OFF
 *  reproduces the stock kernel exactly. */
function bioticWeatheringPotential(state: PlanetState, veg: Float32Array): number {
  const count = cellCount(state.params.gridN);
  const { elevation, temperature, precipitation, iceFraction } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (elevation[i]! < seaLevel) continue;
    const iceFree = 1 - iceFraction[i]!;
    if (iceFree <= 0) continue;
    const biotic = 1 + BIOTIC_WEATHER_FACTOR * veg[i]!;
    sum += iceFree * weatheringTempFactor(temperature[i]!) * weatheringPrecipFactor(precipitation[i]!) * biotic;
  }
  return sum / count;
}

/** A drop-in replacement for `carbonSystem` that reads the external vegetation
 *  array through a closure. Mirrors `solveCarbon` exactly except for the biotic
 *  weathering potential. */
function makeBioticCarbonSystem(bio: Bio): System {
  return {
    name: 'carbon-biotic',
    apply: (state, dtYears) => {
      const co2 = state.globals.co2;
      const activity = tectonicActivity(state);
      const outgassing = outgassingPpmPerYr(activity);
      const potential = bioticWeatheringPotential(state, bio.vegetation);
      const weathering = weatheringPpmPerYr(co2, potential);
      let d = dtYears * (outgassing - weathering);
      const maxChange = CO2_MAX_CHANGE_FRAC_PER_MYR * co2 * (dtYears / 1e6);
      if (d > maxChange) d = maxChange;
      else if (d < -maxChange) d = -maxChange;
      let next = co2 + d;
      if (next < CO2_MIN_PPM) next = CO2_MIN_PPM;
      else if (next > CO2_MAX_PPM) next = CO2_MAX_PPM;
      return { ...state, globals: { ...state.globals, co2: next } };
    },
  };
}

/** Build the custom pipeline: stock systems with `carbon` swapped for the
 *  biotic variant, preserving order. */
function bioticPipeline(bio: Bio): readonly System[] {
  return SYSTEMS.map((s) => (s.name === 'carbon' ? makeBioticCarbonSystem(bio) : s));
}

interface Sample {
  year: number;
  oxygenPAL: number;
  meanVeg: number;
  greenedLandFrac: number;
  co2: number;
  meanTemperatureK: number;
  iceCover: number;
  productivity: number;
}

interface RunResult {
  seed: number;
  enabled: boolean;
  abiogenesisYear: number;
  greatOxidationYear: number;
  firstForestsYear: number;
  finalOxygenPAL: number;
  maxOxygenPAL: number;
  finalGreenedLandFrac: number;
  lateCo2: number; // mean over final 1 Gyr
  lateMeanTempK: number; // mean over final 1 Gyr
  maxIceCover: number;
  finalIceCover: number;
  nonFinite: boolean;
  samples: Sample[];
}

function meanIceCover(state: PlanetState): number {
  const ice = state.fields.iceFraction;
  let s = 0;
  for (let i = 0; i < ice.length; i++) s += ice[i]!;
  return s / ice.length;
}

function greenedLandFraction(state: PlanetState, veg: Float32Array): number {
  const { elevation } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let green = 0;
  let land = 0;
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i]! < seaLevel) continue;
    land++;
    if (veg[i]! > 0.25) green++;
  }
  return land > 0 ? green / land : 0;
}

function meanVegetation(state: PlanetState, veg: Float32Array): number {
  const { elevation } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  let s = 0;
  let land = 0;
  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i]! < seaLevel) continue;
    land++;
    s += veg[i]!;
  }
  return land > 0 ? s / land : 0;
}

function runOne(seed: number, N: number, untilYears: number, enabled: boolean): RunResult {
  const params = createPlanetParams({ seed, gridN: N });
  const count = cellCount(N);
  const light = computeLight(N, params.obliquityDeg);
  const bio = createBio(count, enabled);
  const ctx: SimContext = { rng: createRng(seed).fork('sim') };
  const bioRng = createRng(seed).fork('phase4-bio');
  const systems = bioticPipeline(bio);

  let state = createInitialState(params);
  const samples: Sample[] = [];
  const sampleEvery = 50e6; // 50 Myr
  let nextSample = 0;
  let nonFinite = false;
  let maxOxygen = bio.oxygenPAL;
  let maxIce = 0;
  const lateWindowStart = untilYears - 1e9;
  let lateCo2Sum = 0;
  let lateTempSum = 0;
  let lateCount = 0;

  const dt = params.stepYears;
  const totalSteps = Math.round(untilYears / dt);
  for (let i = 1; i <= totalSteps; i++) {
    state = step(state, dt, ctx, systems);
    updateBiosphere(state, dt, bio, bioRng, light);
    if (bio.firstForestsYear < 0 && meanVegetation(state, bio.vegetation) >= FIRST_FORESTS_MEAN_VEG) {
      bio.firstForestsYear = state.timeYears;
    }
    if (bio.oxygenPAL > maxOxygen) maxOxygen = bio.oxygenPAL;
    const ice = meanIceCover(state);
    if (ice > maxIce) maxIce = ice;
    if (!Number.isFinite(bio.oxygenPAL) || !Number.isFinite(state.globals.co2)) nonFinite = true;
    if (state.timeYears >= lateWindowStart) {
      lateCo2Sum += state.globals.co2;
      lateTempSum += state.globals.meanTemperatureK;
      lateCount++;
    }
    if (state.timeYears >= nextSample) {
      samples.push({
        year: state.timeYears,
        oxygenPAL: bio.oxygenPAL,
        meanVeg: meanVegetation(state, bio.vegetation),
        greenedLandFrac: greenedLandFraction(state, bio.vegetation),
        co2: state.globals.co2,
        meanTemperatureK: state.globals.meanTemperatureK,
        iceCover: ice,
        productivity: marineProductivity(state, bio, light),
      });
      nextSample += sampleEvery;
    }
  }

  return {
    seed,
    enabled,
    abiogenesisYear: bio.abiogenesisYear,
    greatOxidationYear: bio.greatOxidationYear,
    firstForestsYear: bio.firstForestsYear,
    finalOxygenPAL: bio.oxygenPAL,
    maxOxygenPAL: maxOxygen,
    finalGreenedLandFrac: greenedLandFraction(state, bio.vegetation),
    lateCo2: lateCount > 0 ? lateCo2Sum / lateCount : state.globals.co2,
    lateMeanTempK: lateCount > 0 ? lateTempSum / lateCount : state.globals.meanTemperatureK,
    maxIceCover: maxIce,
    finalIceCover: meanIceCover(state),
    nonFinite,
    samples,
  };
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

function parseArgs(): { N: number; untilYears: number } {
  const argv = process.argv.slice(2);
  let N = 32;
  let untilYears = 4.5e9;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--n') N = Number(argv[++i]);
    else if (argv[i] === '--until') untilYears = Number(argv[++i]);
    else if (argv[i] === '--fast') {
      N = 16;
      untilYears = 2e9;
    }
  }
  return { N, untilYears };
}

function gyr(y: number): string {
  return y < 0 ? '   —  ' : `${(y / 1e9).toFixed(2)}G`;
}

function main(): void {
  const { N, untilYears } = parseArgs();
  const seeds = [1, 42, 1337];
  const start = Date.now();
  console.log(`Phase 4 M0 biosphere prototype — N=${N}, until ${(untilYears / 1e9).toFixed(2)} Gyr, seeds ${seeds.join(', ')}`);
  console.log('');

  const on = seeds.map((s) => runOne(s, N, untilYears, true));
  const off = seeds.map((s) => runOne(s, N, untilYears, false));

  // --- Per-seed life story (biosphere ON) ---
  console.log('LIFE STORY (biosphere on)');
  console.log(
    ['seed'.padStart(5), 'abiogen'.padStart(8), 'GOE'.padStart(8), 'forests'.padStart(8), 'O2 fin'.padStart(8), 'O2 max'.padStart(8), 'green%'.padStart(7), 'maxIce'.padStart(7)].join('  '),
  );
  for (const r of on) {
    console.log(
      [
        String(r.seed).padStart(5),
        gyr(r.abiogenesisYear).padStart(8),
        gyr(r.greatOxidationYear).padStart(8),
        gyr(r.firstForestsYear).padStart(8),
        `${r.finalOxygenPAL.toFixed(2)}`.padStart(8),
        `${r.maxOxygenPAL.toFixed(2)}`.padStart(8),
        `${(r.finalGreenedLandFrac * 100).toFixed(0)}%`.padStart(7),
        `${(r.maxIceCover * 100).toFixed(0)}%`.padStart(7),
      ].join('  '),
    );
  }
  console.log('');

  // --- O₂ trajectory (S-curve check) for each seed ---
  console.log('O2 TRAJECTORY (PAL, every 500 Myr)');
  for (const r of on) {
    const marks = r.samples.filter((s) => Math.round(s.year / 1e6) % 500 === 0);
    console.log(
      `  seed ${String(r.seed).padStart(4)}: ` +
        marks.map((s) => `${(s.year / 1e9).toFixed(1)}G=${s.oxygenPAL.toFixed(2)}(Π${s.productivity.toFixed(2)})`).join('  '),
    );
  }
  console.log('');

  // --- Ablation: biosphere ON vs OFF, late-history climate delta ---
  console.log('ABLATION (late 1 Gyr mean; ΔCO2 & ΔT are ON − OFF)');
  console.log(
    ['seed'.padStart(5), 'CO2 on'.padStart(8), 'CO2 off'.padStart(8), 'ΔCO2'.padStart(8), 'T on'.padStart(8), 'T off'.padStart(8), 'ΔT'.padStart(7)].join('  '),
  );
  for (let i = 0; i < seeds.length; i++) {
    const a = on[i]!;
    const b = off[i]!;
    console.log(
      [
        String(seeds[i]).padStart(5),
        a.lateCo2.toFixed(0).padStart(8),
        b.lateCo2.toFixed(0).padStart(8),
        (a.lateCo2 - b.lateCo2).toFixed(0).padStart(8),
        `${a.lateMeanTempK.toFixed(1)}K`.padStart(8),
        `${b.lateMeanTempK.toFixed(1)}K`.padStart(8),
        `${(a.lateMeanTempK - b.lateMeanTempK).toFixed(1)}K`.padStart(7),
      ].join('  '),
    );
  }
  console.log('');

  // --- Verdicts ---
  const anyNonFinite = [...on, ...off].some((r) => r.nonFinite);
  const allOxidize = on.every((r) => r.greatOxidationYear >= 0 && r.greatOxidationYear < untilYears);
  const goeYears = on.map((r) => r.greatOxidationYear);
  const goeSpread = Math.max(...goeYears) - Math.min(...goeYears);
  const oxygenBounded = on.every((r) => r.maxOxygenPAL < 5); // no runaway
  const noPermanentSnowball = on.every((r) => r.finalIceCover < 0.6);
  const ablationBites = seeds.every((_, i) => Math.abs(on[i]!.lateMeanTempK - off[i]!.lateMeanTempK) >= 0.5);
  const storiesDiffer =
    goeSpread >= 100e6 ||
    Math.max(...on.map((r) => r.finalGreenedLandFrac)) - Math.min(...on.map((r) => r.finalGreenedLandFrac)) >= 0.1;

  console.log('VERDICTS');
  console.log(`  Q1 oxygenation S-curve completes on all seeds: ${allOxidize ? 'YES' : 'NO'} (GOE spread ${(goeSpread / 1e6).toFixed(0)} Myr)`);
  console.log(`  Q2 stable (finite, O2<5 PAL, no permanent snowball): ${!anyNonFinite && oxygenBounded && noPermanentSnowball ? 'YES' : 'NO'}`);
  console.log(`  Q3a two seeds differ (GOE timing / greening): ${storiesDiffer ? 'YES' : 'NO'}`);
  console.log(`  Q3b ablation changes late climate (|ΔT| ≥ 0.5 K): ${ablationBites ? 'YES' : 'NO'}`);
  console.log('');
  console.log(`(${((Date.now() - start) / 1000).toFixed(1)} s)`);
}

main();
