import { describe, expect, it } from 'vitest';
import { fnv1a32, hash2, hash3, hashFloat32Array, hashString } from '../src/hash';

describe('position hashes', () => {
  it('are pure functions of their arguments', () => {
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash3(1, 2, 3, 4)).toBe(hash3(1, 2, 3, 4));
  });

  it('return uint32 values', () => {
    for (const v of [hash2(0, 0, 0), hash3(0, 0, 0, 0), hash2(-1, -2, -3), hash3(7, -8, 9, -10)]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('change when any argument changes (including sign)', () => {
    const base = hash3(1, 10, 20, 30);
    expect(hash3(2, 10, 20, 30)).not.toBe(base);
    expect(hash3(1, 11, 20, 30)).not.toBe(base);
    expect(hash3(1, 10, 21, 30)).not.toBe(base);
    expect(hash3(1, 10, 20, 31)).not.toBe(base);
    expect(hash3(1, -10, 20, 30)).not.toBe(base);
  });

  it('are not order-symmetric in their arguments', () => {
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2));
    expect(hash3(1, 2, 3, 4)).not.toBe(hash3(1, 4, 3, 2));
  });

  it('distribute across the uint32 range', () => {
    // Bucket 10k lattice hashes into 16 bins; each should get a fair share.
    const bins = new Array<number>(16).fill(0);
    for (let i = 0; i < 10_000; i++) {
      bins[hash3(42, i, i * 3 + 1, -i) >>> 28]!++;
    }
    for (const count of bins) {
      expect(count).toBeGreaterThan(400);
      expect(count).toBeLessThan(850);
    }
  });
});

describe('fnv1a32', () => {
  it('matches the FNV-1a offset basis for empty input', () => {
    expect(fnv1a32(new Uint8Array(0))).toBe(0x811c9dc5);
  });

  it('matches the published FNV-1a test vector for "a"', () => {
    // http://www.isthe.com/chongo/tech/comp/fnv/ : fnv1a32("a") = 0xe40c292c
    expect(fnv1a32(new Uint8Array([0x61]))).toBe(0xe40c292c);
  });

  it('hashFloat32Array is sensitive to every element', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    const b = new Float32Array([1, 2, 3, 5]);
    expect(hashFloat32Array(a)).not.toBe(hashFloat32Array(b));
    expect(hashFloat32Array(a)).toBe(hashFloat32Array(new Float32Array([1, 2, 3, 4])));
  });
});

describe('hashString', () => {
  it('is deterministic and label-sensitive', () => {
    expect(hashString('tectonics')).toBe(hashString('tectonics'));
    expect(hashString('tectonics')).not.toBe(hashString('climate'));
    expect(hashString('')).toBe(0x811c9dc5);
  });
});
