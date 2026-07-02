/**
 * Shared helpers for the Phase 1 spike scripts (#9 plate seeding, #10 crust
 * advection shootout). Prototype-only code: nothing here ships in the kernel,
 * but everything uses the kernel's real grid math and PRNG — no parallel
 * implementations of either (issue #9 requirement).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  cellCenterDirection,
  cellCount,
  hash2,
  neighbors,
  type Rng,
  type Vec3,
} from 'sim-kernel';
import { renderFieldPng } from '../src/render';

// --- Deterministic binary min-heap ----------------------------------------

/**
 * Min-heap over (cost, cell, plate) with a total deterministic order:
 * cost, then cell index, then plate index. Stored as a flat number triple
 * array to avoid per-entry objects.
 */
export class TriHeap {
  private cost: number[] = [];
  private cell: number[] = [];
  private plate: number[] = [];

  get size(): number {
    return this.cost.length;
  }

  private less(a: number, b: number): boolean {
    const dc = this.cost[a]! - this.cost[b]!;
    if (dc !== 0) return dc < 0;
    const di = this.cell[a]! - this.cell[b]!;
    if (di !== 0) return di < 0;
    return this.plate[a]! < this.plate[b]!;
  }

  private swap(a: number, b: number): void {
    [this.cost[a], this.cost[b]] = [this.cost[b]!, this.cost[a]!];
    [this.cell[a], this.cell[b]] = [this.cell[b]!, this.cell[a]!];
    [this.plate[a], this.plate[b]] = [this.plate[b]!, this.plate[a]!];
  }

  push(cost: number, cell: number, plate: number): void {
    this.cost.push(cost);
    this.cell.push(cell);
    this.plate.push(plate);
    let i = this.cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Pops the minimum entry as [cost, cell, plate]. Heap must be non-empty. */
  pop(): [number, number, number] {
    const out: [number, number, number] = [this.cost[0]!, this.cell[0]!, this.plate[0]!];
    const last = this.cost.length - 1;
    this.swap(0, last);
    this.cost.pop();
    this.cell.pop();
    this.plate.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.cost.length && this.less(l, m)) m = l;
      if (r < this.cost.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return out;
  }
}

// --- Vector helpers ---------------------------------------------------------

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const inv = 1 / Math.sqrt(dot(v, v));
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}

/** Rodrigues rotation of v about unit axis k by angle (radians). */
export function rotateAboutAxis(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [
    v[0] * c + kxv[0] * s + k[0] * kd,
    v[1] * c + kxv[1] * s + k[1] * kd,
    v[2] * c + kxv[2] * s + k[2] * kd,
  ];
}

export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

// --- Plate seeding + Voronoi-style flood fill (#9) --------------------------

export interface PartitionOptions {
  /** Jitter amplitude on the per-cell step cost (0 = clean Voronoi). */
  jitter: number;
  /** Minimum angular separation between seed sites, radians. */
  minSeparation?: number;
}

export interface Partition {
  plateId: Float32Array;
  sites: number[];
}

/**
 * Seed `numPlates` sites from the rng (rejection-sampled for minimum angular
 * separation, relaxing the constraint deterministically if unlucky), then
 * grow all plates simultaneously with Dijkstra over the 4-neighbor graph.
 * Edge cost = 1 + jitter * hash01(cell), i.e. a deterministic warped-metric
 * Voronoi: organic boundaries, still contiguous by construction.
 */
export function partitionPlates(
  rng: Rng,
  jitterSeed: number,
  numPlates: number,
  N: number,
  opts: PartitionOptions,
): Partition {
  const count = cellCount(N);
  const defaultSep = 0.7 * Math.sqrt((4 * Math.PI) / numPlates);
  let minSep = opts.minSeparation ?? defaultSep;

  const sites: number[] = [];
  const siteDirs: Vec3[] = [];
  while (sites.length < numPlates) {
    let placed = false;
    for (let attempt = 0; attempt < 64 && !placed; attempt++) {
      const candidate = rng.nextInt(count);
      const dir = cellCenterDirection(candidate, N);
      if (siteDirs.every((s) => angleBetween(s, dir) >= minSep)) {
        sites.push(candidate);
        siteDirs.push(dir);
        placed = true;
      }
    }
    // Deterministic relaxation: same rng draw sequence, looser constraint.
    if (!placed) minSep *= 0.85;
  }

  const plateId = new Float32Array(count).fill(-1);
  const heap = new TriHeap();
  for (let p = 0; p < numPlates; p++) heap.push(0, sites[p]!, p);

  let assigned = 0;
  while (assigned < count && heap.size > 0) {
    const [cost, cell, plate] = heap.pop();
    if (plateId[cell] !== -1) continue;
    plateId[cell] = plate;
    assigned++;
    for (const nb of neighbors(cell, N)) {
      if (plateId[nb] === -1) {
        const stepCost = 1 + opts.jitter * (hash2(jitterSeed, nb, 0) / 4294967296);
        heap.push(cost + stepCost, nb, plate);
      }
    }
  }
  if (assigned !== count) throw new Error(`partition left ${count - assigned} cells unassigned`);
  return { plateId, sites };
}

/** Per-plate cell counts. */
export function plateSizes(plateId: Float32Array, numPlates: number): number[] {
  const sizes = new Array<number>(numPlates).fill(0);
  for (const p of plateId) sizes[p]!++;
  return sizes;
}

/** True iff every plate is a single 4-connected component. */
export function allPlatesContiguous(plateId: Float32Array, numPlates: number, N: number): boolean {
  const sizes = plateSizes(plateId, numPlates);
  const seen = new Uint8Array(plateId.length);
  for (let p = 0; p < numPlates; p++) {
    const start = plateId.indexOf(p);
    if (start === -1) return false;
    const stack = [start];
    seen[start] = 1;
    let reached = 0;
    while (stack.length > 0) {
      const cell = stack.pop()!;
      reached++;
      for (const nb of neighbors(cell, N)) {
        if (!seen[nb] && plateId[nb] === p) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (reached !== sizes[p]) return false;
  }
  return true;
}

/** Count of cells with at least one 4-neighbor on a different plate. */
export function boundaryCellCount(plateId: Float32Array, N: number): number {
  let boundary = 0;
  for (let i = 0; i < plateId.length; i++) {
    for (const nb of neighbors(i, N)) {
      if (plateId[nb] !== plateId[i]) {
        boundary++;
        break;
      }
    }
  }
  return boundary;
}

/** Count of single-cell enclaves (all 4 neighbors belong to other plates). */
export function enclaveCount(plateId: Float32Array, N: number): number {
  let enclaves = 0;
  for (let i = 0; i < plateId.length; i++) {
    if (neighbors(i, N).every((nb) => plateId[nb] !== plateId[i])) enclaves++;
  }
  return enclaves;
}

// --- Output ------------------------------------------------------------------

export function writeFieldPng(
  outDir: string,
  name: string,
  hintField: string,
  field: Float32Array,
  N: number,
): void {
  mkdirSync(outDir, { recursive: true });
  const png = renderFieldPng(hintField, field, N);
  writeFileSync(join(outDir, `${name}.png`), PNG.sync.write(png));
}
