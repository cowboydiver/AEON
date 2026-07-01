import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

describe('createRng (sfc32)', () => {
  it('same seed produces the same first 1000 draws', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different streams', () => {
    const a = createRng(1);
    const b = createRng(2);
    const drawsA = Array.from({ length: 20 }, () => a.next());
    const drawsB = Array.from({ length: 20 }, () => b.next());
    expect(drawsA).not.toEqual(drawsB);
  });

  it('next() stays in [0, 1)', () => {
    const rng = createRng(1337);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('next() is roughly uniform', () => {
    const rng = createRng(7);
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += rng.next();
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });

  it('nextInt(n) stays in [0, n) and hits all small values', () => {
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(8);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(8);
      seen.add(v);
    }
    expect(seen.size).toBe(8);
  });

  it('fork streams are deterministic and independent of parent draws', () => {
    const parentA = createRng(42);
    const parentB = createRng(42);
    // Consume parentB heavily before forking; forks must still agree.
    for (let i = 0; i < 500; i++) parentB.next();
    const forkA = parentA.fork('tectonics');
    const forkB = parentB.fork('tectonics');
    for (let i = 0; i < 1000; i++) {
      expect(forkA.next()).toBe(forkB.next());
    }
  });

  it('forks with different labels are different streams', () => {
    const rng = createRng(42);
    const a = rng.fork('a');
    const b = rng.fork('b');
    const drawsA = Array.from({ length: 20 }, () => a.next());
    const drawsB = Array.from({ length: 20 }, () => b.next());
    expect(drawsA).not.toEqual(drawsB);
  });

  it('forks differ from the parent stream and support nesting', () => {
    const parent = createRng(42);
    const child = createRng(42).fork('x');
    const grandchild = createRng(42).fork('x').fork('x');
    const p = Array.from({ length: 20 }, () => parent.next());
    const c = Array.from({ length: 20 }, () => child.next());
    const g = Array.from({ length: 20 }, () => grandchild.next());
    expect(p).not.toEqual(c);
    expect(c).not.toEqual(g);
  });
});
