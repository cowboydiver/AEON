/**
 * Integer hashing primitives. Everything here is exact 32-bit integer math
 * (Math.imul + shifts) so results are bit-identical on every platform. These
 * are the primitives that make any surface location at any time reproducible.
 */

/** murmur3 32-bit finalizer: avalanches all input bits. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** murmur3_x86_32 body step for one 32-bit block. */
function mixStep(h: number, k: number): number {
  k = Math.imul(k | 0, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h = (h | 0) ^ k;
  h = (h << 13) | (h >>> 19);
  h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  return h;
}

/** Position hash of two signed 32-bit ints -> uint32. Murmur3-style. */
export function hash2(seed: number, a: number, b: number): number {
  let h = seed | 0;
  h = mixStep(h, a);
  h = mixStep(h, b);
  return fmix32(h ^ 8);
}

/** Position hash of three signed 32-bit ints -> uint32. Murmur3-style. */
export function hash3(seed: number, a: number, b: number, c: number): number {
  let h = seed | 0;
  h = mixStep(h, a);
  h = mixStep(h, b);
  h = mixStep(h, c);
  return fmix32(h ^ 12);
}

/** FNV-1a over UTF-16 code units. Used to hash stream labels for rng.fork. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a over raw bytes -> uint32. The project's golden-hash checksum. */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * FNV-1a of a Float32Array's underlying bytes. Byte order is the platform's;
 * all supported targets (x86, ARM, wasm) are little-endian, which is the
 * documented canonical order for golden hashes.
 */
export function hashFloat32Array(field: Float32Array): number {
  return fnv1a32(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
}
