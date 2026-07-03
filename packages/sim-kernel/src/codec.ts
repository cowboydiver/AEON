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
 * (`plateId`, `crustType`). Ranges are verified against Phase 1 reality; see
 * docs/PHASE_2_SPEC.md and the fidelity tests. Precision at the shipped ranges:
 * elevation ~0.31 m (Uint16 over −11,000…+9,500 m), crustAge ~107 kyr, and
 * temperature ~0.55 K.
 */

import { FIELD_NAMES, type FieldName, type Fields } from './fields';

/**
 * Container-layout version. Bump on ANY change to the byte layout, the stored
 * field set, or a field's quantization mapping. It is one of the IndexedDB
 * cache keys (#24) — a bump invalidates every persisted keyframe.
 */
export const HISTORY_FORMAT_VERSION = 1;

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
 * order. `precipitation` is analytic (recomputed from latitude at render),
 * `boundaryStress` is derivable and visually unused, and `iceFraction`/`biome`
 * are still zero — none are stored. Categorical ranges are the type's full
 * unsigned span; only the round/assert matters for them, not min/max.
 */
export const QUANT_TABLE = {
  elevation: { format: 'u16', min: -11000, max: 9500, categorical: false },
  crustAge: { format: 'u16', min: 0, max: 7.0e9, categorical: false },
  temperature: { format: 'u8', min: 180, max: 320, categorical: false },
  plateId: { format: 'u8', min: 0, max: LEVELS_U8, categorical: true },
  crustType: { format: 'u8', min: 0, max: LEVELS_U8, categorical: true },
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
