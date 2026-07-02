/**
 * Seeded PRNG: sfc32 (Chris Doty-Humphrey's Small Fast Counting RNG, from
 * PractRand). Chosen for excellent statistical quality at 4x32-bit state and
 * pure 32-bit integer transitions (exact in JS). State is seeded from a single
 * uint32 via splitmix32, then warmed up 12 rounds as recommended for sfc32.
 *
 * `fork(label)` derives an independent stream purely from (parent seed, label),
 * so fork results never depend on how many draws the parent has made. The same
 * label on the same parent always yields the same stream — use distinct labels
 * for distinct subsystems.
 */

import { hash2, hashString } from './hash';

export interface Rng {
  /** Uniform float in [0, 1) with 32 bits of randomness. */
  next(): number;
  /** Uniform integer in [0, n). n must be a positive integer <= 2^32. */
  nextInt(n: number): number;
  /** Derived deterministic stream, independent of draws made on this Rng. */
  fork(label: string): Rng;
}

/** splitmix32: expands one uint32 seed into a stream of well-mixed uint32s. */
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = z ^ (z >>> 15);
    return z >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const baseSeed = seed >>> 0;
  const sm = splitmix32(baseSeed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();

  const nextUint32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  for (let i = 0; i < 12; i++) nextUint32();

  return {
    next: () => nextUint32() / 4294967296,
    nextInt: (n: number) => Math.floor((nextUint32() / 4294967296) * n),
    fork: (label: string) => createRng(hash2(baseSeed, hashString(label), 0x666f726b)),
  };
}
