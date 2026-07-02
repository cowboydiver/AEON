/**
 * Deterministic binary min-heap over (cost, cell, plate) triples, stored as
 * flat parallel arrays (no per-entry objects). The order is total — cost,
 * then cell index, then plate index — so heap pop order (and therefore any
 * flood fill built on it) is a pure function of the pushed entries.
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
