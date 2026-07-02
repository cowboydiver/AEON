/**
 * Spike #9: plate seeding & Voronoi-style flood-fill partition.
 *
 * Runs the partition for numPlates x seeds x jitter settings, writes
 * categorical plateId PNGs, and prints per-run stats: contiguity, coverage,
 * size distribution, boundary/enclave counts, seam behavior, and a
 * determinism check (two runs must produce identical FNV-1a hashes).
 *
 * Usage: pnpm -F sim-cli exec tsx spikes/plate-seeding.ts [--out tmp/spike9]
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cellCount, createRng, hash2, hashFloat32Array, hashString } from 'sim-kernel';
import { allPlatesContiguous, partitionPlates, plateSizes, boundaryCellCount, enclaveCount, writeFieldPng } from './lib';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    out: { type: 'string', default: 'tmp/spike9' },
    'grid-n': { type: 'string', default: '128' },
  },
});

const N = Number(values['grid-n']);
const outDir = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);

const SEEDS = [1, 42, 1337];
const PLATE_COUNTS = [6, 8, 12, 20];
const JITTERS = [0, 1.5, 3];

function runOnce(seed: number, numPlates: number, jitter: number): Float32Array {
  const rng = createRng(seed).fork('plates');
  const jitterSeed = hash2(seed >>> 0, hashString('plateJitter'), 0);
  return partitionPlates(rng, jitterSeed, numPlates, N, { jitter }).plateId;
}

console.log(`spike #9: N=${N} (${cellCount(N)} cells)`);
console.log(
  ['seed'.padStart(5), 'plates'.padStart(6), 'jitter'.padStart(6), 'contig', 'min%'.padStart(6), 'max%'.padStart(6), 'bound%'.padStart(7), 'encl'.padStart(5), 'det', 'hash'.padStart(9)].join('  '),
);

for (const numPlates of PLATE_COUNTS) {
  for (const seed of SEEDS) {
    for (const jitter of JITTERS) {
      const plateId = runOnce(seed, numPlates, jitter);
      const again = runOnce(seed, numPlates, jitter);
      const h1 = hashFloat32Array(plateId);
      const deterministic = h1 === hashFloat32Array(again);

      const sizes = plateSizes(plateId, numPlates);
      const total = plateId.length;
      const contiguous = allPlatesContiguous(plateId, numPlates, N);
      const covered = sizes.reduce((a, b) => a + b, 0) === total && sizes.every((s) => s > 0);
      if (!covered) throw new Error('coverage violated');

      console.log(
        [
          String(seed).padStart(5),
          String(numPlates).padStart(6),
          String(jitter).padStart(6),
          contiguous ? '  yes' : '   NO',
          ((Math.min(...sizes) / total) * 100).toFixed(1).padStart(6),
          ((Math.max(...sizes) / total) * 100).toFixed(1).padStart(6),
          ((boundaryCellCount(plateId, N) / total) * 100).toFixed(1).padStart(7),
          String(enclaveCount(plateId, N)).padStart(5),
          deterministic ? 'yes' : ' NO',
          h1.toString(16).padStart(8, '0'),
        ].join('  '),
      );

      writeFieldPng(outDir, `plateId-s${seed}-p${numPlates}-j${jitter}`, 'plateId', plateId, N);
    }
  }
}
console.log(`PNGs in ${outDir}`);
