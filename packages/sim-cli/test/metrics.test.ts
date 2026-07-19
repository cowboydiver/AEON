import { describe, expect, it } from 'vitest';
import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  cellCount,
  EVENT_KINDS,
  faceRCToIndex,
  FIELD_NAMES,
  type Fields,
  type Keyframe,
  type SimEvent,
} from 'sim-kernel';
import {
  computeCrustStats,
  computeKeyframeMetrics,
  computePlateCensusRow,
  computeReorgTempo,
  computeReSutureIntervals,
  createRiftConvergenceProbe,
  CONVERGENCE_LOOKAHEAD_YEARS,
  DISPERSED_MAX_PLATE_FRAC,
  isReorgEvent,
  PLATENESS_TOP_DECILE,
  RE_SUTURE_FLOOR_YEARS,
  SEAFLOOR_AGE_BIN_COUNT,
  SEAFLOOR_AGE_BIN_WIDTH_YR,
  SHALLOW_OCEAN_DEPTH_M,
  summarizeMetrics,
  summarizePairedMetrics,
  summarizePlateCensus,
  summarizeReorgTempo,
  summarizeReSutureIntervals,
  summarizeRiftConvergence,
  type KeyframeMetrics,
  type PlateCensusRow,
} from '../src/metrics';

/**
 * The findings tables and the #67 acceptance numbers flow through this
 * module, so its three nontrivial pieces — the connected-components BFS,
 * the monopoly-window scan, and the per-Gyr bucketing — get pinned against
 * hand-built keyframes here.
 */

const N = 8;
const MID = N / 2;

function emptyKeyframe(timeYears: number): Keyframe {
  const count = cellCount(N);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((name) => [name, new Float32Array(count)]),
  ) as Fields;
  // Ocean floor everywhere so landFrac counts only painted cells.
  fields.elevation.fill(-4000);
  // computeKeyframeMetrics reads only `.fields`; globals is required by the
  // Keyframe type but unused here, so a zeroed set suffices.
  const globals = { landFraction: 0, co2: 0, meanTemperatureK: 0, seaLevelM: 0, waterInventoryM: 0, oxygen: 0, oxygenReductant: 0, abiogenesisYear: -1, plateSpeedMedianMPerYr: 0, plateSpeedMinMPerYr: 0, plateSpeedMaxMPerYr: 0, oceanicContinentalSpeedRatio: 0, speedContinentalityCorr: 0, speedSlabAttachmentCorr: 0, poleStability: 0, marginConsolidationFlipsTotal: 0 };
  return { timeYears, fields, globals, events: [] };
}

function metricsOf(keyframe: Keyframe): KeyframeMetrics {
  return computeKeyframeMetrics(keyframe, N);
}

describe('computeKeyframeMetrics', () => {
  it('counts continental components, largest fraction, and edge/area on a painted map', () => {
    const kf = emptyKeyframe(0);
    // Component A: a 2x2 block on face 0 (4 cells, 8 boundary edges).
    for (const [r, c] of [
      [MID, MID],
      [MID, MID + 1],
      [MID + 1, MID],
      [MID + 1, MID + 1],
    ] as const) {
      kf.fields.crustType[faceRCToIndex(0, r, c, N)] = 1;
    }
    // Component B: one isolated cell on face 1 (1 cell, 4 edges).
    kf.fields.crustType[faceRCToIndex(1, MID, MID, N)] = 1;

    const m = metricsOf(kf);
    expect(m.contComponents).toBe(2);
    expect(m.largestCompFrac).toBeCloseTo(4 / 5, 10);
    // 2x2 block contributes 8 continent-ocean edges, the singleton 4.
    expect(m.edgeToArea).toBeCloseTo(12 / 5, 10);
    expect(m.contFrac).toBeCloseTo(5 / cellCount(N), 10);
  });

  it('a sphere-spanning single component has no edges', () => {
    const kf = emptyKeyframe(0);
    kf.fields.crustType.fill(1);
    const m = metricsOf(kf);
    expect(m.contComponents).toBe(1);
    expect(m.largestCompFrac).toBe(1);
    expect(m.edgeToArea).toBe(0);
  });

  it('counts land components against the dynamic sea level (#84)', () => {
    const kf = emptyKeyframe(0);
    kf.globals.seaLevelM = 50;
    // Component A: a 2x2 emergent block on face 0.
    for (const [r, c] of [
      [MID, MID],
      [MID, MID + 1],
      [MID + 1, MID],
      [MID + 1, MID + 1],
    ] as const) {
      kf.fields.elevation[faceRCToIndex(0, r, c, N)] = 100;
    }
    // Component B: a singleton exactly at sea level (>= counts as land).
    kf.fields.elevation[faceRCToIndex(1, MID, MID, N)] = 50;
    // Below the dynamic sea level but above the 0 m datum: NOT land.
    kf.fields.elevation[faceRCToIndex(2, MID, MID, N)] = 20;

    const m = metricsOf(kf);
    expect(m.landComponents).toBe(2);
    expect(m.largestLandCompFrac).toBeCloseTo(4 / 5, 10);
  });

  it('computes land fraction and max plate fraction', () => {
    const kf = emptyKeyframe(0);
    const count = cellCount(N);
    // Land: exactly 10 cells at/above the datum (>= 0 counts as land).
    for (let i = 0; i < 10; i++) kf.fields.elevation[i] = i === 0 ? 0 : 100;
    // Plates: cell 0 owned by plate 1, everything else plate 0.
    kf.fields.plateId[0] = 1;
    const m = metricsOf(kf);
    expect(m.landFrac).toBeCloseTo(10 / count, 10);
    expect(m.maxPlateFrac).toBeCloseTo((count - 1) / count, 10);
  });
});

describe('computeCrustStats (#101 calibration harness)', () => {
  it('computes the flooding shares against the dynamic sea level on a painted map', () => {
    const kf = emptyKeyframe(2e9);
    const count = cellCount(N);
    kf.globals.seaLevelM = -3000;
    // Ocean floor everywhere at −6000 m (from emptyKeyframe's fill at −4000).
    kf.fields.elevation.fill(-6000);
    // Five continental cells: three emergent at −2000 m, one flooded shelf at
    // −3400 m (400 m deep — shallow), one flooded interior at −3600 m (600 m
    // deep — below the shallow cutoff). Mean cont elevation −2600 m ⇒ mean
    // freeboard exactly +400 m over the −3000 m sea.
    const cont: Array<[number, number]> = [
      [0, -2000],
      [1, -2000],
      [2, -2000],
      [3, -3400],
      [4, -3600],
    ];
    for (const [i, e] of cont) {
      kf.fields.crustType[i] = 1;
      kf.fields.elevation[i] = e;
    }
    // One emergent oceanic ridge crest above the fallen sea: land, not ocean.
    kf.fields.elevation[10] = -2500;

    const s = computeCrustStats(kf);
    expect(s.timeYears).toBe(2e9);
    expect(s.seaLevelM).toBe(-3000);
    expect(s.contFrac).toBeCloseTo(5 / count, 10);
    expect(s.meanFreeboardM).toBeCloseTo(400, 6);
    // 2 of 5 continental cells sit below the sea.
    expect(s.submergedContFrac).toBeCloseTo(2 / 5, 10);
    // Ocean = cells below the sea: count − 3 emergent cont − 1 ridge.
    expect(s.oceanOnContFrac).toBeCloseTo(2 / (count - 4), 10);
    // Only the −3400 m shelf cell is within SHALLOW_OCEAN_DEPTH_M of the sea
    // (the −3600 m interior is 600 m deep); share of the SPHERE, per #101.
    expect(SHALLOW_OCEAN_DEPTH_M).toBe(500);
    expect(s.shallowOceanFrac).toBeCloseTo(1 / count, 10);
    expect(s.landFrac).toBeCloseTo(4 / count, 10);
    expect(s.minElevationM).toBe(-6000);
  });

  it('a waterworld reports zero freeboard and zero flooding shares, not NaN', () => {
    const kf = emptyKeyframe(0);
    kf.globals.seaLevelM = -3000;
    const s = computeCrustStats(kf);
    expect(s.contFrac).toBe(0);
    expect(s.meanFreeboardM).toBe(0);
    expect(s.submergedContFrac).toBe(0);
    expect(s.oceanOnContFrac).toBeCloseTo(0, 10);
    expect(s.landFrac).toBe(0);
  });

  it('an all-land world reports zero ocean shares, not NaN', () => {
    const kf = emptyKeyframe(0);
    kf.globals.seaLevelM = -3000;
    kf.fields.crustType.fill(1);
    kf.fields.elevation.fill(0);
    const s = computeCrustStats(kf);
    expect(s.landFrac).toBe(1);
    expect(s.submergedContFrac).toBe(0);
    expect(s.oceanOnContFrac).toBe(0);
    expect(s.shallowOceanFrac).toBe(0);
    expect(s.meanFreeboardM).toBeCloseTo(3000, 6);
  });
});

describe('summarizeMetrics', () => {
  const point = (timeYears: number, maxPlateFrac: number, landFrac = 0.2): KeyframeMetrics => ({
    timeYears,
    landFrac,
    maxPlateFrac,
    contFrac: 0.2,
    contComponents: 10,
    largestCompFrac: 0.5,
    edgeToArea: 1,
    landComponents: 12,
    largestLandCompFrac: 0.4,
  });

  it('reports the longest monopoly window in sim time (first-to-last monopoly keyframe)', () => {
    // Monopoly (>0.85) at 100-120 Myr (window 20 Myr) and a longer one at
    // 200-250 Myr (window 50 Myr); a single monopoly keyframe alone is 0.
    const series = [
      point(90e6, 0.5),
      point(100e6, 0.9),
      point(110e6, 0.9),
      point(120e6, 0.9),
      point(130e6, 0.5),
      point(200e6, 0.95),
      point(210e6, 0.9),
      point(250e6, 0.9),
      point(260e6, 0.5),
    ];
    const out = summarizeMetrics(series, undefined);
    expect(out).toContain('longest >85% monopoly window 50 Myr');
  });

  it('computes dispersed fraction and per-Gyr buckets', () => {
    // Gyr bucket 0: 2 of 2 dispersed; bucket 1: 1 of 2 dispersed.
    const series = [
      point(0.2e9, 0.3),
      point(0.8e9, DISPERSED_MAX_PLATE_FRAC - 0.01),
      point(1.2e9, DISPERSED_MAX_PLATE_FRAC + 0.01),
      point(1.8e9, 0.3),
    ];
    const out = summarizeMetrics(series, 1.7e9);
    expect(out).toContain('dispersed 75.0% of 4 keyframes');
    expect(out).toContain('per-Gyr 1.00/0.50');
    expect(out).toContain('last tectonic event 1700 Myr');
  });

  it('prints n/a instead of zero shape means for a run shorter than the settling window', () => {
    const series = [point(0, 0.5), point(500e6, 0.5)];
    const out = summarizeMetrics(series, undefined);
    expect(out).toContain('shape past 1 Gyr: n/a');
    expect(out).not.toContain('largest comp 0.000');
  });
});

describe('summarizePairedMetrics (#84 branched A/B)', () => {
  const point = (
    timeYears: number,
    landComponents: number,
    largestLandCompFrac: number,
    landFrac = 0.2,
  ): KeyframeMetrics => ({
    timeYears,
    landFrac,
    maxPlateFrac: 0.5,
    contFrac: 0.2,
    contComponents: 10,
    largestCompFrac: 0.5,
    edgeToArea: 1,
    landComponents,
    largestLandCompFrac,
  });

  it('reports only the post-branch window and the mean off->on deltas', () => {
    const off = [point(0, 5, 0.5), point(10e6, 10, 0.3), point(20e6, 12, 0.3)];
    const on = [point(0, 5, 0.5), point(10e6, 8, 0.4), point(20e6, 8, 0.5)];
    const out = summarizePairedMetrics(off, on, 10e6);
    // Pre-branch keyframe (t=0) is not part of the comparison window.
    expect(out).not.toContain('      0 Myr');
    expect(out).toContain('10 -> 8');
    expect(out).toContain('12 -> 8');
    // Mean deltas over the two post-branch keyframes: components (8-10 + 8-12)/2 = -3,
    // largest land comp (0.1 + 0.2)/2 = +0.15.
    expect(out).toContain('Δ land components -3.0');
    expect(out).toContain('Δ largest land comp +0.150');
  });

  it('flags unpaired arms instead of fabricating deltas', () => {
    const off = [point(0, 5, 0.5)];
    const out = summarizePairedMetrics(off, [], 0);
    expect(out).toContain('not paired');
  });
});

describe('computePlateCensusRow — seafloor age (CLI-side, over oceanic crust)', () => {
  it('reports mean/median/max and an area histogram over oceanic cells', () => {
    const kf = emptyKeyframe(0); // all cells oceanic (crustType 0) by default
    const count = cellCount(N);
    for (let i = 0; i < count; i++) {
      kf.fields.crustAge[i] = i < count / 2 ? 10e6 : 210e6;
    }
    const row = computePlateCensusRow(kf);
    expect(row.seafloorAgeMeanYr).toBeCloseTo(110e6, -3);
    expect(row.seafloorAgeMedianYr).toBeCloseTo(110e6, -3); // even count: mean of the two middles
    expect(row.seafloorAgeMaxYr).toBe(210e6);
    // Half in bin 0 (0–20 Myr), half in the ≥200 Myr overflow bin.
    expect(row.ageAreaHistogram).toHaveLength(SEAFLOOR_AGE_BIN_COUNT);
    expect(row.ageAreaHistogram[0]!).toBeCloseTo(0.5, 6);
    expect(row.ageAreaHistogram[SEAFLOOR_AGE_BIN_COUNT - 1]!).toBeCloseTo(0.5, 6);
    const total = row.ageAreaHistogram.reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('excludes continental crust from the seafloor-age reduction', () => {
    const kf = emptyKeyframe(0);
    const count = cellCount(N);
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) {
        kf.fields.crustType[i] = 1; // continental — must be ignored
        kf.fields.crustAge[i] = 2e9; // the 2 Gyr continental seed
      } else {
        kf.fields.crustType[i] = 0;
        kf.fields.crustAge[i] = 50e6;
      }
    }
    const row = computePlateCensusRow(kf);
    expect(row.seafloorAgeMeanYr).toBe(50e6);
    expect(row.seafloorAgeMedianYr).toBe(50e6);
    expect(row.seafloorAgeMaxYr).toBe(50e6);
  });

  it('reports zeros when there is no oceanic crust', () => {
    const kf = emptyKeyframe(0);
    kf.fields.crustType.fill(1);
    const row = computePlateCensusRow(kf);
    expect(row.seafloorAgeMeanYr).toBe(0);
    expect(row.seafloorAgeMedianYr).toBe(0);
    expect(row.seafloorAgeMaxYr).toBe(0);
    expect(row.ageAreaHistogram.every((x) => x === 0)).toBe(true);
  });
});

describe('computePlateCensusRow — plateness (top-decile boundary-stress share)', () => {
  it('is the top-decile share of total boundary |stress|', () => {
    const kf = emptyKeyframe(0);
    // Ten boundary cells: one at 10, nine at 1 (|stress|). Interiors stay 0.
    kf.fields.boundaryStress[0] = 10;
    for (let i = 1; i < 10; i++) kf.fields.boundaryStress[i] = -1; // sign ignored (abs)
    const row = computePlateCensusRow(kf);
    // top decile of 10 cells = 1 cell (the 10); total = 19.
    expect(Math.floor(10 * PLATENESS_TOP_DECILE)).toBe(1);
    expect(row.plateness).toBeCloseTo(10 / 19, 6);
  });

  it('is the decile itself when all boundary stresses are equal', () => {
    const kf = emptyKeyframe(0);
    for (let i = 0; i < 10; i++) kf.fields.boundaryStress[i] = 2;
    const row = computePlateCensusRow(kf);
    expect(row.plateness).toBeCloseTo(0.1, 6); // 1 of 10 equal cells
  });

  it('is 0 with no boundary cells', () => {
    const kf = emptyKeyframe(0);
    expect(computePlateCensusRow(kf).plateness).toBe(0);
  });
});

describe('computePlateCensusRow — passes kernel globals through', () => {
  it('copies the six globals census scalars onto the row', () => {
    const kf = emptyKeyframe(0);
    Object.assign(kf.globals, {
      plateSpeedMedianMPerYr: 0.04,
      plateSpeedMinMPerYr: 0.01,
      plateSpeedMaxMPerYr: 0.08,
      oceanicContinentalSpeedRatio: 2.5,
      speedContinentalityCorr: -0.7,
      poleStability: 0.95,
    });
    const row = computePlateCensusRow(kf);
    expect(row.speedMedianMPerYr).toBe(0.04);
    expect(row.speedMinMPerYr).toBe(0.01);
    expect(row.speedMaxMPerYr).toBe(0.08);
    expect(row.oceanicContinentalSpeedRatio).toBe(2.5);
    expect(row.speedContinentalityCorr).toBe(-0.7);
    expect(row.poleStability).toBe(0.95);
  });
});

describe('summarizePlateCensus', () => {
  function row(timeYears: number, over: Partial<PlateCensusRow>): PlateCensusRow {
    return {
      timeYears,
      speedMedianMPerYr: 0,
      speedMinMPerYr: 0,
      speedMaxMPerYr: 0,
      oceanicContinentalSpeedRatio: 0,
      speedContinentalityCorr: 0,
      speedSlabAttachmentCorr: 0,
      poleStability: 0,
      marginConsolidationFlipsTotal: 0,
      seafloorAgeMeanYr: 0,
      seafloorAgeMedianYr: 0,
      seafloorAgeMaxYr: 0,
      plateness: 0,
      ageAreaHistogram: new Array<number>(SEAFLOOR_AGE_BIN_COUNT).fill(0),
      ...over,
    };
  }

  it('excludes the census-absent t=0 keyframe from the means', () => {
    // t=0 has all-zero census (pass not run at init). A single post-t=0
    // keyframe with poleStability 1 must summarize to 1, not 0.5.
    const rows = [row(0, {}), row(2e9, { poleStability: 1, speedMedianMPerYr: 0.05 })];
    const s = summarizePlateCensus(rows);
    expect(s).toContain('pole stability (mean cosine): 1.0000');
    // 0.05 m/yr = 5 cm/yr on the speed line.
    expect(s).toContain('speed cm/yr: min 0.00 median 5.00');
  });

  it('handles an empty series without throwing', () => {
    expect(summarizePlateCensus([])).toContain('no keyframes');
  });

  it('differences the cumulative flip total into a per-100-Myr churn rate', () => {
    // Cumulative flips 0 -> 30 -> 90 over t=1e9..3e9 (a 2 Gyr span past 1 Gyr):
    // 90 flips / 2000 Myr * 100 = 4.5 per 100 Myr.
    const rows = [
      row(0, {}),
      row(1e9, { marginConsolidationFlipsTotal: 0 }),
      row(3e9, { marginConsolidationFlipsTotal: 90 }),
    ];
    expect(summarizePlateCensus(rows)).toContain('boundary churn (#67 pair-flips / 100 Myr): 4.50');
  });

  // Reference the width const so an accidental unit drift trips a test.
  it('bins span 20 Myr', () => {
    expect(SEAFLOOR_AGE_BIN_WIDTH_YR).toBe(20e6);
  });
});

/* ------------------------------------------------------------------------- *
 * Stage-4 rift-lifecycle instrumentation (#114, proposal §5). Two gates the
 * cooldown-retirement measurement is written against: the re-suture interval
 * of rifted halves (the pre-#59 ~16 Myr re-suture pathology tripwire) and the
 * fraction of a fresh rift seam still convergent 50 Myr later (the direct
 * proof ridge push, not the timer, separates the halves).
 * ------------------------------------------------------------------------- */

/** Build a plateRift event (data {plate, newPlate, newPlateCells}). */
function rift(timeYears: number, plate: number, newPlate: number): SimEvent {
  return { timeYears, kind: EVENT_KINDS.plateRift, data: { plate, newPlate, newPlateCells: 1 } };
}
/** Build a plateSuture (or sutureTimeout) event (data {absorbed, into, absorbedCells}). */
function suture(timeYears: number, absorbed: number, into: number, timeout = false): SimEvent {
  return {
    timeYears,
    kind: timeout ? EVENT_KINDS.sutureTimeout : EVENT_KINDS.plateSuture,
    data: { absorbed, into, absorbedCells: 1 },
  };
}

describe('computeReSutureIntervals (#114 re-suture gate)', () => {
  it('matches each rift to the first later suture of the same unordered pair', () => {
    const events: SimEvent[] = [
      rift(100e6, 0, 5),
      suture(250e6, 5, 0), // pair {0,5} re-merges 150 Myr later (healthy)
      rift(300e6, 1, 6),
      suture(310e6, 1, 6, true), // pair {1,6} re-merges 10 Myr later (pathology)
      suture(400e6, 2, 3), // matches no rift pair
    ];
    const r = computeReSutureIntervals(events);
    expect(r.count).toBe(2);
    // Intervals stored in rift order: 150 Myr then 10 Myr.
    expect(r.intervalsMyr).toEqual([150, 10]);
    expect(r.minMyr).toBe(10);
    expect(r.medianMyr).toBe(80); // mean of the two middle values
    expect(r.underFloorCount).toBe(1); // only the 10 Myr one is <= 100 Myr
  });

  it('ignores a suture that precedes the rift (only forward matches count)', () => {
    const events: SimEvent[] = [suture(50e6, 0, 5), rift(100e6, 0, 5)];
    expect(computeReSutureIntervals(events).count).toBe(0);
  });

  it('consumes each suture at most once, so two rifts of a pair need two sutures', () => {
    const events: SimEvent[] = [
      rift(100e6, 0, 5),
      rift(120e6, 0, 5), // same pair rifts again before any re-merge
      suture(200e6, 0, 5), // only one re-suture available
    ];
    const r = computeReSutureIntervals(events);
    // The earliest rift claims the suture (100 Myr interval); the second finds none.
    expect(r.count).toBe(1);
    expect(r.intervalsMyr).toEqual([100]);
  });

  it('reports zero re-sutures cleanly (the healthy deep-time case)', () => {
    const r = computeReSutureIntervals([rift(100e6, 0, 5)]);
    expect(r.count).toBe(0);
    expect(r.minMyr).toBe(0);
    expect(r.medianMyr).toBe(0);
    expect(r.underFloorCount).toBe(0);
  });

  it('summary states the >100 Myr floor and the pathology tripwire', () => {
    const s = summarizeReSutureIntervals([rift(100e6, 0, 5), suture(310e6, 5, 0)]);
    expect(s).toContain('re-suture');
    expect(s).toContain(`${RE_SUTURE_FLOOR_YEARS / 1e6}`); // the 100 Myr floor
  });
});

describe('computeReorgTempo (#66 Wilson tempo; #127 item 2 sutureTimeout)', () => {
  it('counts a sutureTimeout merge as a suture (the #127 undercount fix)', () => {
    // The old `plateRift || plateSuture` filter dropped this event entirely.
    const t = computeReorgTempo([suture(100e6, 1, 2, /* timeout */ true)], 1e9);
    expect(t.sutures).toBe(1);
    expect(t.rifts).toBe(0);
    expect(t.reorgs).toBe(1);
  });

  it('splits reorganizations into rifts and sutures across all three kinds', () => {
    const events: SimEvent[] = [
      rift(100e6, 0, 5),
      suture(200e6, 5, 0), // normal plateSuture
      suture(300e6, 2, 3, true), // sutureTimeout backstop — still a merge
    ];
    const t = computeReorgTempo(events, 1e9);
    expect(t.rifts).toBe(1);
    expect(t.sutures).toBe(2);
    expect(t.reorgs).toBe(3);
    // 3 reorganizations over 1000 Myr = 0.3 per 100 Myr.
    expect(t.per100Myr).toBeCloseTo(0.3, 10);
  });

  it('means the interval between consecutive reorganizations on the same plate', () => {
    // Plate 0 rifts at 100 Myr, then is absorbed via a timeout suture at 250 Myr:
    // one 150 Myr interval for plate 0; the fresh ids (5, 7) contribute nothing.
    const t = computeReorgTempo([rift(100e6, 0, 5), suture(250e6, 0, 7, true)], 1e9);
    expect(t.meanIntervalYears).toBe(150e6);
  });

  it('reports a null interval when no plate appears in two reorganizations', () => {
    const t = computeReorgTempo([rift(100e6, 0, 5)], 1e9);
    expect(t.meanIntervalYears).toBeNull();
  });

  it('handles an empty / zero-duration event log without dividing by zero', () => {
    const t = computeReorgTempo([], 0);
    expect(t).toEqual({ rifts: 0, sutures: 0, reorgs: 0, per100Myr: 0, meanIntervalYears: null });
  });

  it('isReorgEvent accepts rifts and both suture kinds, rejects others', () => {
    expect(isReorgEvent(rift(0, 0, 1))).toBe(true);
    expect(isReorgEvent(suture(0, 0, 1))).toBe(true);
    expect(isReorgEvent(suture(0, 0, 1, true))).toBe(true);
    expect(isReorgEvent({ timeYears: 0, kind: EVENT_KINDS.plateConsumed, data: { plate: 0 } })).toBe(
      false,
    );
  });

  it('summary line reports counts, tempo, and mean interval, counting the timeout', () => {
    const s = summarizeReorgTempo(
      [rift(100e6, 0, 5), suture(200e6, 5, 0), suture(300e6, 2, 3, true)],
      1e9,
    );
    expect(s).toContain('1 rifts + 2 sutures'); // the timeout is in the suture count
    expect(s).toContain('0.30 reorganizations / 100 Myr');
    expect(s).toContain('100 Myr'); // mean interval per plate involved
  });
});

const CN = 8; // grid N for the convergence-probe tests

/** A zeroed keyframe with all fields present, at time t. */
function probeKeyframe(timeYears: number, events: SimEvent[] = []): Keyframe {
  const count = cellCount(CN);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((name) => [name, new Float32Array(count)]),
  ) as Fields;
  const globals = {
    landFraction: 0, co2: 0, meanTemperatureK: 0, seaLevelM: 0, waterInventoryM: 0,
    oxygen: 0, oxygenReductant: 0, abiogenesisYear: -1, plateSpeedMedianMPerYr: 0,
    plateSpeedMinMPerYr: 0, plateSpeedMaxMPerYr: 0, oceanicContinentalSpeedRatio: 0,
    speedContinentalityCorr: 0, speedSlabAttachmentCorr: 0, poleStability: 0,
    marginConsolidationFlipsTotal: 0,
  };
  return { timeYears, fields, globals, events };
}

describe('createRiftConvergenceProbe (#114 ridge-push separation gate)', () => {
  it('records a fully-divergent seam as 0 convergent at +50 Myr', () => {
    // Rift at t=0 splits a 2x2 patch on face 0 (plate A=1) from its neighbor
    // column (plate B=2). Seam = A cells 4-adjacent to a B cell.
    const probe = createRiftConvergenceProbe(CN);
    const kf0 = probeKeyframe(0, [rift(0, 1, 2)]);
    // Paint plate A on face-0 col MID, plate B on col MID+1 (adjacent).
    for (let r = 0; r < CN; r++) {
      kf0.fields.plateId[faceRCToIndex(0, r, 4, CN)] = 1;
      kf0.fields.plateId[faceRCToIndex(0, r, 5, CN)] = 2;
    }
    probe.observe(kf0);
    // 50 Myr later: seam boundaryStress all negative (divergent) => 0 convergent.
    const kf1 = probeKeyframe(CONVERGENCE_LOOKAHEAD_YEARS);
    kf1.fields.plateId.set(kf0.fields.plateId);
    kf1.fields.boundaryStress.fill(-1); // everything opening
    probe.observe(kf1);
    const s = probe.summary();
    expect(s.resolved).toBe(1);
    expect(s.skippedEmpty).toBe(0);
    expect(s.pendingAtEnd).toBe(0);
    expect(s.meanConvergentFrac).toBe(0);
  });

  it('counts seam cells above the active-margin stress as convergent', () => {
    const probe = createRiftConvergenceProbe(CN);
    const kf0 = probeKeyframe(0, [rift(0, 1, 2)]);
    // A single A cell adjacent to a single B cell => a 2-cell seam (the A cell
    // adjacent to B, unioned with the B cell adjacent to A).
    kf0.fields.plateId[faceRCToIndex(0, 4, 4, CN)] = 1;
    kf0.fields.plateId[faceRCToIndex(0, 4, 5, CN)] = 2;
    probe.observe(kf0);
    const kf1 = probeKeyframe(CONVERGENCE_LOOKAHEAD_YEARS);
    kf1.fields.plateId.set(kf0.fields.plateId);
    // Both seam cells convergent above the threshold => fraction 1.
    kf1.fields.boundaryStress[faceRCToIndex(0, 4, 4, CN)] = ACTIVE_MARGIN_STRESS_M_PER_YR + 0.01;
    kf1.fields.boundaryStress[faceRCToIndex(0, 4, 5, CN)] = ACTIVE_MARGIN_STRESS_M_PER_YR + 0.01;
    probe.observe(kf1);
    expect(probe.summary().meanConvergentFrac).toBe(1);
  });

  it('treats exactly-threshold stress as NOT convergent (strict >)', () => {
    const probe = createRiftConvergenceProbe(CN);
    const kf0 = probeKeyframe(0, [rift(0, 1, 2)]);
    kf0.fields.plateId[faceRCToIndex(0, 4, 4, CN)] = 1;
    kf0.fields.plateId[faceRCToIndex(0, 4, 5, CN)] = 2;
    probe.observe(kf0);
    const kf1 = probeKeyframe(CONVERGENCE_LOOKAHEAD_YEARS);
    kf1.fields.plateId.set(kf0.fields.plateId);
    kf1.fields.boundaryStress[faceRCToIndex(0, 4, 4, CN)] = ACTIVE_MARGIN_STRESS_M_PER_YR;
    probe.observe(kf1);
    expect(probe.summary().meanConvergentFrac).toBe(0);
  });

  it('skips a rift whose halves share no boundary (empty seam)', () => {
    const probe = createRiftConvergenceProbe(CN);
    const kf0 = probeKeyframe(0, [rift(0, 1, 2)]);
    // Plate A present, plate B absent => no A cell is adjacent to a B cell.
    kf0.fields.plateId[faceRCToIndex(0, 4, 4, CN)] = 1;
    probe.observe(kf0);
    const s = probe.summary();
    expect(s.skippedEmpty).toBe(1);
    expect(s.resolved).toBe(0);
  });

  it('leaves a probe pending when the run ends < 50 Myr after the rift', () => {
    const probe = createRiftConvergenceProbe(CN);
    const kf0 = probeKeyframe(0, [rift(0, 1, 2)]);
    kf0.fields.plateId[faceRCToIndex(0, 4, 4, CN)] = 1;
    kf0.fields.plateId[faceRCToIndex(0, 4, 5, CN)] = 2;
    probe.observe(kf0);
    // Only 10 Myr elapses — the probe never comes due.
    probe.observe(probeKeyframe(10e6));
    const s = probe.summary();
    expect(s.resolved).toBe(0);
    expect(s.pendingAtEnd).toBe(1);
  });

  it('summary reports the mean and the ≈0 gate framing', () => {
    const probe = createRiftConvergenceProbe(CN);
    expect(summarizeRiftConvergence(probe.summary())).toContain('convergent');
  });
});
