import { describe, expect, it } from 'vitest';
import { cellCount, faceRCToIndex, FIELD_NAMES, type Fields, type Keyframe } from 'sim-kernel';
import {
  computeKeyframeMetrics,
  DISPERSED_MAX_PLATE_FRAC,
  summarizeMetrics,
  type KeyframeMetrics,
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
  const globals = { landFraction: 0, co2: 0, meanTemperatureK: 0, seaLevelM: 0, waterInventoryM: 0 };
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

describe('summarizeMetrics', () => {
  const point = (timeYears: number, maxPlateFrac: number, landFrac = 0.2): KeyframeMetrics => ({
    timeYears,
    landFrac,
    maxPlateFrac,
    contFrac: 0.2,
    contComponents: 10,
    largestCompFrac: 0.5,
    edgeToArea: 1,
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
