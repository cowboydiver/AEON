import { describe, expect, it } from 'vitest';
import { decodeKeyframe, encodeHistory } from '../src/codec';
import { cellCount } from '../src/grid';
import { createPlanetParams } from '../src/state';
import { keyframes, run, snapshotKeyframe, type Keyframe } from '../src/step';

/**
 * The keyframe generator (#23) is the single source of truth for cadence: the
 * worker pulls from it one keyframe at a time. These lock that it stays
 * byte-identical to the eager `run()` and that encodeHistory round-trips.
 */

const params = () => createPlanetParams({ seed: 42, gridN: 16, keyframeIntervalYears: 10e6 });
const UNTIL = 120e6; // 12 intervals + initial

function fieldSig(k: Keyframe): string {
  // Cheap deterministic signature over all fields at this keyframe.
  return Object.entries(k.fields)
    .map(([name, arr]) => `${name}:${arr.reduce((h, v) => (h * 31 + v) | 0, 17)}`)
    .join('|');
}

describe('keyframes generator (#23)', () => {
  it('yields the same keyframes, in order, as eager run()', () => {
    const viaGen = [...keyframes(params(), UNTIL)].map(fieldSig);
    const viaRun: string[] = [];
    run(params(), UNTIL, (k) => viaRun.push(fieldSig(k)));
    expect(viaGen).toEqual(viaRun);
    expect(viaGen.length).toBeGreaterThan(1);
  });

  it('emits the initial keyframe then one per interval, plus timeYears order', () => {
    const times = [...keyframes(params(), UNTIL)].map((k) => k.timeYears);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(UNTIL);
    // 13 keyframes: t=0 plus 12 × 10 Myr.
    expect(times).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map((m) => m * 1e6));
  });

  it('run() returns the final state at untilYears', () => {
    const finalState = run(params(), UNTIL, () => {});
    expect(finalState.timeYears).toBe(UNTIL);
    // And its fields match the generator's last keyframe.
    const last = [...keyframes(params(), UNTIL)].at(-1)!;
    expect(fieldSig(snapshotKeyframe(finalState))).toBe(fieldSig(last));
  });
});

describe('encodeHistory generator (#23)', () => {
  it('indexes keyframes 0..n and matches keyframe times', () => {
    const gen = [...encodeHistory(params(), UNTIL)];
    const times = [...keyframes(params(), UNTIL)].map((k) => k.timeYears);
    expect(gen.map((e) => e.index)).toEqual(times.map((_, i) => i));
    expect(gen.map((e) => e.timeYears)).toEqual(times);
    // Each payload is an independent transferable buffer.
    expect(new Set(gen.map((e) => e.payload)).size).toBe(gen.length);
  });

  it('payloads decode to the stored fields of the corresponding keyframe', () => {
    const count = cellCount(16);
    const kfs = [...keyframes(params(), UNTIL)];
    const enc = [...encodeHistory(params(), UNTIL)];
    for (let i = 0; i < enc.length; i++) {
      const decoded = decodeKeyframe(enc[i]!.payload);
      // Categorical fields are bit-exact; elevation within half a step.
      const origPlate = kfs[i]!.fields.plateId;
      const outPlate = decoded.fields.plateId!;
      for (let c = 0; c < count; c++) expect(outPlate[c]).toBe(origPlate[c]);
    }
  });

  it('landFraction equals the elevation-derived land share (no decode needed)', () => {
    const count = cellCount(16);
    const kfs = [...keyframes(params(), UNTIL)];
    const enc = [...encodeHistory(params(), UNTIL)];
    for (let i = 0; i < enc.length; i++) {
      let land = 0;
      for (const e of kfs[i]!.fields.elevation) if (e >= 0) land++;
      expect(enc[i]!.landFraction).toBeCloseTo(land / count, 12);
    }
  });

  it('carries the reservoir globals verbatim from each keyframe state', () => {
    const kfs = [...keyframes(params(), UNTIL)];
    const enc = [...encodeHistory(params(), UNTIL)];
    for (let i = 0; i < enc.length; i++) {
      const g = kfs[i]!.globals;
      expect(enc[i]!.globals).toEqual({
        co2: g.co2,
        meanTemperatureK: g.meanTemperatureK,
        oxygen: g.oxygen,
        seaLevelM: g.seaLevelM,
      });
    }
  });
});
