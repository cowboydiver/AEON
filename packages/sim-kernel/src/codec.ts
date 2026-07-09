/**
 * Field quantization codec (#22) — Phase 2 storage/upload compression.
 *
 * Encodes the display-relevant subset of a keyframe's float fields into a
 * compact, versioned, self-describing binary container: a header naming each
 * stored field with its quantization (format + range + categorical flag +
 * byte offset), followed by the quantized data. Decoding needs only the buffer
 * — the range table travels in the header — so pruning or adding fields (Phase
 * 3) does not break old readers of the same HISTORY_FORMAT_VERSION.
 *
 * This is pure and lives in the kernel by the dependency rule (zero-dep, shared
 * by the worker that produces history and the renderer that uploads it). It
 * **never touches simulation bytes**: encode/decode are pure functions of a
 * field array, so quantization can never perturb the deterministic sim.
 *
 * Quantization is a linear map float -> unsigned integer over a fixed range for
 * continuous fields, and an *identity* map (round, range-assert) for
 * categorical fields, which must round-trip bit-exact and never be interpolated
 * (`plateId`, `crustType`, `biome`). Ranges are verified against Phase 1/3
 * reality; see docs/PHASE_2_SPEC.md and the fidelity tests. Precision at the
 * shipped ranges: elevation ~0.31 m (Uint16 over −11,000…+9,500 m), crustAge
 * ~107 kyr, temperature ~0.59 K (Uint8 over 180…330 K), and the Phase 3 viz
 * fields precipitation ~31 kg/m²/yr, iceFraction ~1/255, winds ~0.47 m/s.
 */

import { FIELD_NAMES, type FieldName, type Fields } from './fields';
import { cellCount } from './grid';
import type { PlanetParams } from './state';
import { keyframes } from './step';

/**
 * Container-layout version. Bump on ANY change to the byte layout, the stored
 * field set, or a field's quantization mapping. It is one of the IndexedDB
 * cache keys (#24) — a bump invalidates every persisted keyframe.
 *
 * 2 — Phase 3 stored-field-set growth (#35, the §1 deferred bump): the render
 *     path now needs the climate viz fields, so `precipitation`, `iceFraction`,
 *     `biome`, `windU` and `windV` join `STORED_FIELDS` and `temperature`'s max
 *     widens 320→330 K for hot-CO₂ states. The container is self-describing (the
 *     range table travels in the header) so this is purely a cache-buster, not a
 *     format rewrite; old histories miss and re-simulate.
 */
export const HISTORY_FORMAT_VERSION = 2;

/** Wire codes for the per-field quantized element type. */
const FORMAT_U8 = 0;
const FORMAT_U16 = 1;
const LEVELS_U8 = 255;
const LEVELS_U16 = 65535;

/** Per-field quantization. `categorical` fields use identity (exact) mapping. */
interface FieldQuant {
  readonly format: 'u8' | 'u16';
  readonly min: number;
  readonly max: number;
  readonly categorical: boolean;
}

/**
 * The stored field set and its quantization. Insertion order is the on-wire
 * order. The Phase 3 climate viz fields join the set here (#35): `precipitation`
 * (moisture #32), `iceFraction` (ice #33), `biome` (Whittaker #35), and the
 * `windU`/`windV` prevailing winds (#31) — all consumed at render, biome the one
 * that drives the from-orbit colour ramp. `biome` is CATEGORICAL (exact
 * round-trip, never lerped — the GPU nearest-picks it like `plateId`);
 * `iceFraction`/`precipitation`/`windU`/`windV` are continuous. `temperature`'s
 * max widens 320→330 K for hot-CO₂ states (#34). `boundaryStress` stays out
 * (derivable, visually unused). New fields are APPENDED so their on-wire
 * `fieldId` (the `FIELD_NAMES` index) is stable; the header is self-describing so
 * old bytes of the same `HISTORY_FORMAT_VERSION` still decode. Categorical ranges
 * are the type's full unsigned span; only the round/assert matters for them.
 */
export const QUANT_TABLE = {
  elevation: { format: 'u16', min: -11000, max: 9500, categorical: false },
  crustAge: { format: 'u16', min: 0, max: 7.0e9, categorical: false },
  temperature: { format: 'u8', min: 180, max: 330, categorical: false },
  plateId: { format: 'u8', min: 0, max: LEVELS_U8, categorical: true },
  crustType: { format: 'u8', min: 0, max: LEVELS_U8, categorical: true },
  precipitation: { format: 'u8', min: 0, max: 8000, categorical: false },
  iceFraction: { format: 'u8', min: 0, max: 1, categorical: false },
  biome: { format: 'u8', min: 0, max: LEVELS_U8, categorical: true },
  windU: { format: 'u8', min: -60, max: 60, categorical: false },
  windV: { format: 'u8', min: -60, max: 60, categorical: false },
} as const satisfies Partial<Record<FieldName, FieldQuant>>;

export type StoredFieldName = keyof typeof QUANT_TABLE;

/** On-wire field order; also the fixed iteration order for encode. */
export const STORED_FIELD_NAMES = Object.keys(QUANT_TABLE) as readonly StoredFieldName[];

const MAGIC = 0x41454f4e; // 'AEON', big-endian mnemonic; guards against wrong buffers
const HEADER_BYTES = 12; // magic u32 | version u16 | fieldCount u8 | pad u8 | count u32
const ENTRY_BYTES = 16; // fieldId u8 | format u8 | flags u8 | pad u8 | min f32 | max f32 | dataOffset u32

function levelsFor(format: 'u8' | 'u16'): number {
  return format === 'u16' ? LEVELS_U16 : LEVELS_U8;
}

/** Encode a keyframe's stored fields into one transferable container buffer. */
export function encodeKeyframe(fields: Fields, count: number): ArrayBuffer {
  // Lay out the header, then each field's data, keeping u16 blocks 2-aligned so
  // typed-array views are valid. count = 6*N*N is always even, so u8 blocks
  // never break alignment, but align defensively anyway.
  let offset = HEADER_BYTES + STORED_FIELD_NAMES.length * ENTRY_BYTES;
  const layout = STORED_FIELD_NAMES.map((name) => {
    const q = QUANT_TABLE[name];
    if (q.format === 'u16' && offset % 2 !== 0) offset += 1;
    const dataOffset = offset;
    offset += (q.format === 'u16' ? 2 : 1) * count;
    return { name, dataOffset };
  });

  const buffer = new ArrayBuffer(offset);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, HISTORY_FORMAT_VERSION, true);
  view.setUint8(6, STORED_FIELD_NAMES.length);
  view.setUint8(7, 0);
  view.setUint32(8, count, true);

  let entryPos = HEADER_BYTES;
  for (const { name, dataOffset } of layout) {
    const q = QUANT_TABLE[name];
    const src = fields[name];
    if (src.length < count) {
      throw new Error(`codec: field ${name} has ${src.length} cells, need ${count}`);
    }
    view.setUint8(entryPos, FIELD_NAMES.indexOf(name));
    view.setUint8(entryPos + 1, q.format === 'u16' ? FORMAT_U16 : FORMAT_U8);
    view.setUint8(entryPos + 2, q.categorical ? 1 : 0);
    view.setUint8(entryPos + 3, 0);
    view.setFloat32(entryPos + 4, q.min, true);
    view.setFloat32(entryPos + 8, q.max, true);
    view.setUint32(entryPos + 12, dataOffset, true);
    entryPos += ENTRY_BYTES;
    quantizeInto(buffer, dataOffset, q, name, src, count);
  }
  return buffer;
}

function quantizeInto(
  buffer: ArrayBuffer,
  dataOffset: number,
  q: FieldQuant,
  name: FieldName,
  src: Float32Array,
  count: number,
): void {
  const levels = levelsFor(q.format);
  const out =
    q.format === 'u16'
      ? new Uint16Array(buffer, dataOffset, count)
      : new Uint8Array(buffer, dataOffset, count);
  if (q.categorical) {
    // Identity map: the value IS the code. Round defensively, then assert it
    // fits — a plateId ≥ 256 (or negative) is a real invariant break, not
    // something to silently clamp.
    for (let i = 0; i < count; i++) {
      const v = Math.round(src[i]!);
      if (v < 0 || v > levels) {
        throw new Error(`codec: categorical ${name}=${src[i]} out of [0, ${levels}] at cell ${i}`);
      }
      out[i] = v;
    }
  } else {
    const scale = levels / (q.max - q.min);
    for (let i = 0; i < count; i++) {
      const v = Math.round((src[i]! - q.min) * scale);
      out[i] = v < 0 ? 0 : v > levels ? levels : v;
    }
  }
}

export interface DecodedKeyframe {
  readonly version: number;
  readonly count: number;
  readonly fields: Partial<Record<FieldName, Float32Array>>;
}

/** Decode a container back to dequantized float fields (CPU-side consumers). */
export function decodeKeyframe(buffer: ArrayBuffer): DecodedKeyframe {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('codec: bad magic (not a keyframe container)');
  const version = view.getUint16(4, true);
  if (version !== HISTORY_FORMAT_VERSION) {
    throw new Error(`codec: unsupported HISTORY_FORMAT_VERSION ${version} (reader is ${HISTORY_FORMAT_VERSION})`);
  }
  const fieldCount = view.getUint8(6);
  const count = view.getUint32(8, true);

  const fields: Partial<Record<FieldName, Float32Array>> = {};
  let entryPos = HEADER_BYTES;
  for (let f = 0; f < fieldCount; f++) {
    const fieldId = view.getUint8(entryPos);
    const format = view.getUint8(entryPos + 1);
    const categorical = view.getUint8(entryPos + 2) === 1;
    const min = view.getFloat32(entryPos + 4, true);
    const max = view.getFloat32(entryPos + 8, true);
    const dataOffset = view.getUint32(entryPos + 12, true);
    entryPos += ENTRY_BYTES;

    const name = FIELD_NAMES[fieldId];
    if (name === undefined) throw new Error(`codec: unknown field id ${fieldId}`);
    const out = new Float32Array(count);
    if (format === FORMAT_U16) {
      const data = new Uint16Array(buffer, dataOffset, count);
      if (categorical) for (let i = 0; i < count; i++) out[i] = data[i]!;
      else {
        const s = (max - min) / LEVELS_U16;
        for (let i = 0; i < count; i++) out[i] = min + data[i]! * s;
      }
    } else {
      const data = new Uint8Array(buffer, dataOffset, count);
      if (categorical) for (let i = 0; i < count; i++) out[i] = data[i]!;
      else {
        const s = (max - min) / LEVELS_U8;
        for (let i = 0; i < count; i++) out[i] = min + data[i]! * s;
      }
    }
    fields[name] = out;
  }
  return { version, count, fields };
}

/** Quantization step (float units per code) for a stored field — the coarsest
 *  round-trip error is half this. Exposed for fidelity tests and UI tooltips. */
export function quantStep(name: StoredFieldName): number {
  const q = QUANT_TABLE[name];
  return q.categorical ? 0 : (q.max - q.min) / levelsFor(q.format);
}

/** Exact byte length `encodeKeyframe` produces for a grid — the container
 *  header/entries plus each field's aligned data — without allocating it.
 *  Used to size a history against the memory budget before generating it. */
export function encodedKeyframeBytes(gridN: number): number {
  const count = cellCount(gridN);
  let offset = HEADER_BYTES + STORED_FIELD_NAMES.length * ENTRY_BYTES;
  for (const name of STORED_FIELD_NAMES) {
    const q = QUANT_TABLE[name];
    if (q.format === 'u16' && offset % 2 !== 0) offset += 1;
    offset += (q.format === 'u16' ? 2 : 1) * count;
  }
  return offset;
}

/**
 * Main-thread retained-history budget, bytes (#27). The full history's quantized
 * keyframes live in memory for scrubbing; this caps that. 0.5 GB holds 4.5 Gyr @
 * 10 Myr @ N=128 (~0.50 GB now the Phase 3 viz fields are stored — 12 B/cell,
 * up from 7) with a few MB to spare, and `planHistory` coarsens the keyframe
 * interval to stay under it for heavier requests.
 */
export const MAX_RETAINED_HISTORY_BYTES = 0.5 * 1024 * 1024 * 1024;

export interface HistoryPlan {
  readonly untilYears: number;
  readonly keyframeIntervalYears: number;
  readonly keyframeCount: number;
  readonly bytes: number;
  /** True if the interval was coarsened from the request to fit the budget. */
  readonly clamped: boolean;
}

/**
 * Fit a requested history to a retained-memory budget by coarsening the
 * keyframe interval (keeping the full time span). Pure: given the same inputs it
 * returns the same plan. The interval only ever grows by an integer factor, so
 * it stays a multiple of the requested one (and thus of the step).
 */
export function planHistory(
  gridN: number,
  untilYears: number,
  keyframeIntervalYears: number,
  budgetBytes: number = MAX_RETAINED_HISTORY_BYTES,
): HistoryPlan {
  const per = encodedKeyframeBytes(gridN);
  const countFor = (interval: number) => Math.floor(untilYears / interval) + 1; // +1 for t=0
  const requested = countFor(keyframeIntervalYears);
  if (per * requested <= budgetBytes) {
    return { untilYears, keyframeIntervalYears, keyframeCount: requested, bytes: per * requested, clamped: false };
  }
  const maxKeyframes = Math.max(2, Math.floor(budgetBytes / per));
  const factor = Math.max(2, Math.ceil(requested / maxKeyframes));
  const interval = keyframeIntervalYears * factor;
  const count = countFor(interval);
  return { untilYears, keyframeIntervalYears: interval, keyframeCount: count, bytes: per * count, clamped: true };
}

/** One streamed history keyframe: metadata + the transferable encoded payload. */
export interface EncodedKeyframe {
  /** 0-based index in emission order (0 = initial state). */
  readonly index: number;
  readonly timeYears: number;
  /** Fraction of cells above the fixed 0 m datum — derived from elevation, so
   *  the UI needn't decode to show it. NOTE: since #33 this is a *proxy* that no
   *  longer equals `PlanetState.globals.landFraction` (now emergent from the
   *  dynamic `seaLevelM`); the two diverge whenever `seaLevelM ≠ 0`. It stays on
   *  the 0 m datum as a decode-free HUD convenience. The rendered shoreline no
   *  longer needs `seaLevelM` on the wire: since #35 it follows sea level through
   *  the stored `biome` field's ocean class (masked at `elevation < seaLevelM` in
   *  the kernel), so only this HUD number lags the datum. */
  readonly landFraction: number;
  /** Codec container for this keyframe; a fresh ArrayBuffer, safe to transfer. */
  readonly payload: ArrayBuffer;
}

/**
 * Lazily generate a full history as encoded, transferable keyframes (#23). Pure
 * and deterministic — it wraps the `keyframes` cadence and the codec, so a
 * worker can pull one at a time, `postMessage` its payload with transfer, and
 * yield to its event loop between pulls for cooperative cancellation. Keeping
 * the loop here (not in the worker) makes it unit-testable off the DOM.
 */
export function* encodeHistory(
  params: PlanetParams,
  untilYears: number,
): Generator<EncodedKeyframe> {
  const count = cellCount(params.gridN);
  let index = 0;
  for (const kf of keyframes(params, untilYears)) {
    const elevation = kf.fields.elevation;
    let land = 0;
    for (let i = 0; i < count; i++) if (elevation[i]! >= 0) land++;
    yield {
      index: index++,
      timeYears: kf.timeYears,
      landFraction: land / count,
      payload: encodeKeyframe(kf.fields, count),
    };
  }
}
