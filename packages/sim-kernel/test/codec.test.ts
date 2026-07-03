import { describe, expect, it } from 'vitest';
import {
  HISTORY_FORMAT_VERSION,
  QUANT_TABLE,
  STORED_FIELD_NAMES,
  decodeKeyframe,
  encodeKeyframe,
  encodedKeyframeBytes,
  planHistory,
  quantStep,
} from '../src/codec';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCount } from '../src/grid';
import { fnv1a32 } from '../src/hash';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';

const GOLDEN_SEEDS = [1, 42, 1337] as const;

/** A real keyframe: initial state stepped `n` times (drives active margins,
 *  young ocean, a spread of plate ids — the values the codec must survive). */
function keyframeAfter(seed: number, n: number, gridN = 32): PlanetState {
  const params = createPlanetParams({ seed, gridN });
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

describe('codec container (#22)', () => {
  it('round-trips every stored field and drops the rest', () => {
    const state = keyframeAfter(42, 20);
    const count = cellCount(state.params.gridN);
    const decoded = decodeKeyframe(encodeKeyframe(state.fields, count));

    expect(decoded.version).toBe(HISTORY_FORMAT_VERSION);
    expect(decoded.count).toBe(count);
    expect(Object.keys(decoded.fields).sort()).toEqual([...STORED_FIELD_NAMES].sort());
    // Non-stored fields (precipitation, boundaryStress, ice, biome) are absent.
    expect(decoded.fields.boundaryStress).toBeUndefined();
    expect(decoded.fields.precipitation).toBeUndefined();
  });

  it('holds continuous fields within half a quantization step', () => {
    const state = keyframeAfter(42, 20);
    const count = cellCount(state.params.gridN);
    const decoded = decodeKeyframe(encodeKeyframe(state.fields, count));

    for (const name of ['elevation', 'crustAge', 'temperature'] as const) {
      const q = QUANT_TABLE[name];
      const half = quantStep(name) / 2;
      const orig = state.fields[name];
      const out = decoded.fields[name]!;
      let maxErr = 0;
      for (let i = 0; i < count; i++) {
        // Values inside the range must round-trip to within half a step; the
        // sim never leaves the ranges (checked separately), so no clamping here.
        expect(orig[i]!).toBeGreaterThanOrEqual(q.min);
        expect(orig[i]!).toBeLessThanOrEqual(q.max);
        maxErr = Math.max(maxErr, Math.abs(orig[i]! - out[i]!));
      }
      expect(maxErr, `${name} max round-trip error`).toBeLessThanOrEqual(half + 1e-6);
    }
  });

  it('round-trips categorical fields bit-exact (never lerped)', () => {
    const state = keyframeAfter(1337, 30);
    const count = cellCount(state.params.gridN);
    const decoded = decodeKeyframe(encodeKeyframe(state.fields, count));

    for (const name of ['plateId', 'crustType'] as const) {
      const orig = state.fields[name];
      const out = decoded.fields[name]!;
      for (let i = 0; i < count; i++) {
        expect(out[i]).toBe(orig[i]); // exact, including the float bit pattern
      }
    }
  });

  it('clamps out-of-range continuous values to the range ends', () => {
    const count = 4;
    const fields = blankFields(count);
    fields.elevation.set([-20000, 20000, 0, 9500]); // below min, above max, datum, at max
    const q = QUANT_TABLE.elevation;
    const out = decodeKeyframe(encodeKeyframe(fields, count)).fields.elevation!;
    expect(out[0]).toBeCloseTo(q.min, 3); // clamped up to min
    expect(out[1]).toBeCloseTo(q.max, 3); // clamped down to max
    expect(Math.abs(out[2]!)).toBeLessThanOrEqual(quantStep('elevation')); // ~datum
    expect(out[3]).toBeCloseTo(q.max, 3);
  });

  it('throws on a categorical value that overflows its byte (plateId ≥ 256)', () => {
    const count = 2;
    const fields = blankFields(count);
    fields.plateId.set([255, 256]); // 256 cannot be a Uint8 — a real invariant break
    expect(() => encodeKeyframe(fields, count)).toThrow(/plateId/);
  });

  it('rejects a foreign or wrong-version buffer', () => {
    expect(() => decodeKeyframe(new ArrayBuffer(64))).toThrow(/magic/);
  });

  it('preserves the land/ocean coastline across the 0 m crossing (Spike A)', () => {
    // The elevation sign flips land↔ocean; quantization must not migrate the
    // coastline. Only cells within half a step of 0 m could flip, and then only
    // by a sub-step (sub-0.31 m) amount — physically negligible.
    const state = keyframeAfter(42, 40);
    const count = cellCount(state.params.gridN);
    const out = decodeKeyframe(encodeKeyframe(state.fields, count)).fields.elevation!;
    const half = quantStep('elevation') / 2;
    let flipped = 0;
    for (let i = 0; i < count; i++) {
      const a = state.fields.elevation[i]!;
      const b = out[i]!;
      if (a >= 0 !== b >= 0) {
        flipped++;
        expect(Math.abs(a)).toBeLessThanOrEqual(half + 1e-6); // only hair's-breadth cells
      }
    }
    // A tiny handful at most; assert it never becomes a visible coastline shift.
    expect(flipped, 'coastline cells flipped by quantization').toBeLessThan(count * 0.001);
  });
});

describe('codec byte goldens (#22)', () => {
  // Hashes of the encoded container bytes. These lock the codec's output for a
  // fixed sim input; they change only when the codec layout/quantization or the
  // sim history deliberately changes. Regenerate on purpose:
  //   pnpm -F sim-kernel test -- -u
  for (const seed of GOLDEN_SEEDS) {
    it(`seed ${seed}: encoded keyframe byte hash`, () => {
      const state = keyframeAfter(seed, 10);
      const count = cellCount(state.params.gridN);
      const bytes = new Uint8Array(encodeKeyframe(state.fields, count));
      expect({
        byteLength: bytes.byteLength,
        hash: fnv1a32(bytes).toString(16).padStart(8, '0'),
      }).toMatchSnapshot();
    });
  }
});

describe('history memory budget (#27)', () => {
  it('encodedKeyframeBytes matches an actually-encoded keyframe', () => {
    for (const gridN of [16, 32, 64, 128]) {
      const count = cellCount(gridN);
      const fields = blankFields(count);
      expect(encodedKeyframeBytes(gridN)).toBe(encodeKeyframe(fields, count).byteLength);
    }
  });

  it('leaves a within-budget request unclamped', () => {
    // 4.5 Gyr @ 10 Myr @ N=128 is the headline history; it must fit 0.5 GB.
    const plan = planHistory(128, 4.5e9, 10e6);
    expect(plan.clamped).toBe(false);
    expect(plan.keyframeIntervalYears).toBe(10e6);
    expect(plan.keyframeCount).toBe(451); // t=0 plus 450 intervals
    expect(plan.bytes).toBeLessThanOrEqual(0.5 * 1024 * 1024 * 1024);
  });

  it('coarsens the interval by an integer factor to fit a tight budget', () => {
    const per = encodedKeyframeBytes(128);
    const budget = per * 60; // room for ~60 keyframes only
    const plan = planHistory(128, 4.5e9, 10e6, budget);
    expect(plan.clamped).toBe(true);
    expect(plan.keyframeIntervalYears % 10e6).toBe(0); // still a multiple of the request
    expect(plan.keyframeIntervalYears).toBeGreaterThan(10e6);
    expect(plan.keyframeCount).toBeLessThanOrEqual(60);
    expect(plan.bytes).toBeLessThanOrEqual(budget);
    expect(plan.untilYears).toBe(4.5e9); // full span preserved
  });
});

function blankFields(count: number): Fields {
  return Object.fromEntries(FIELD_NAMES.map((n) => [n, new Float32Array(count)])) as Fields;
}
