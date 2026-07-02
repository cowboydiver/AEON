/**
 * Spike #10: crust advection on the discrete sphere grid — candidate shootout.
 *
 * Two candidates, identical inputs, identical quantized sub-cell accumulation:
 *
 *  A. Semi-Lagrangian GATHER: each cell asks every moved plate "if I rotate
 *     backward by your applied rotation, do you own the source cell?" —
 *     claims resolved deterministically; unclaimed cells are divergent gaps.
 *  B. SCATTER + repair: each cell's crust is rotated forward to its landing
 *     cell; multi-claimed cells resolved deterministically; unclaimed cells
 *     repaired the same way as A's gaps.
 *
 * Shared quantization: per-plate accumulated rotation angle; a plate only
 * advects when its accumulated angle crosses one cell's angular width, and
 * then by the FULL accumulated angle (no sub-cell remainder is discarded).
 *
 * Overlap precedence (spike-only; the kernel replaces this with subduction
 * density rules in #16): moving claims beat static claims, then lower plate
 * index, then lower source cell index.
 *
 * Metrics per candidate: coverage repairs per step, boundary width/enclaves
 * over time, interior transport fidelity vs the analytic rigid rotation,
 * per-plate area drift, determinism (full rerun hash), ms/step.
 *
 * Usage: pnpm -F sim-cli exec tsx spikes/advection-shootout.ts [--out tmp/spike10]
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  cellCenterDirection,
  cellCount,
  createRng,
  directionToIndex,
  fractalNoise3,
  hash2,
  hashFloat32Array,
  hashString,
  neighbors,
  type Vec3,
} from 'sim-kernel';
import {
  boundaryCellCount,
  enclaveCount,
  normalize,
  partitionPlates,
  plateSizes,
  rotateAboutAxis,
  writeFieldPng,
} from './lib';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    out: { type: 'string', default: 'tmp/spike10' },
    'grid-n': { type: 'string', default: '128' },
    steps: { type: 'string', default: '500' },
    'dump-every': { type: 'string', default: '50' },
  },
});

const N = Number(values['grid-n']);
const STEPS = Number(values.steps);
const DUMP_EVERY = Number(values['dump-every']);
const outRoot = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
const COUNT = cellCount(N);
const DT_MYR = 1;
/** One cell's angular width at a face center, radians. */
const THETA_MIN = Math.PI / 2 / N;

// --- Shared setup -----------------------------------------------------------

const SEED = 42;
const NUM_PLATES = 3;

interface PlateDef {
  pole: Vec3;
  /** rad/Myr. 6.4e-3 rad/Myr ~ 4 cm/yr on an Earth-radius sphere. */
  omegaRadPerMyr: number;
}

const PLATES: PlateDef[] = [
  { pole: normalize([0.2, 1, 0.1]), omegaRadPerMyr: 6.4e-3 },
  { pole: normalize([1, -0.3, 0.2]), omegaRadPerMyr: -4.0e-3 },
  { pole: normalize([-0.1, 0.4, 1]), omegaRadPerMyr: 2.4e-3 },
];

const rng = createRng(SEED).fork('plates');
const jitterSeed = hash2(SEED, hashString('plateJitter'), 0);
const initialPlateId = partitionPlates(rng, jitterSeed, NUM_PLATES, N, { jitter: 1.5 }).plateId;

const terrainSeed = hash2(SEED, hashString('spikeTerrain'), 0);
const initialElev = new Float32Array(COUNT);
const centers: Vec3[] = new Array(COUNT) as Vec3[];
for (let i = 0; i < COUNT; i++) {
  centers[i] = cellCenterDirection(i, N);
  const [x, y, z] = centers[i]!;
  initialElev[i] = fractalNoise3(terrainSeed, x * 2.3 + 17.1, y * 2.3 + 47.7, z * 2.3 + 89.0, 5) * 8000 - 5000;
}

const GAP_ELEVATION = -2500; // "young ocean crust" marker for repaired gaps

// --- Candidate machinery ------------------------------------------------------

interface SimState {
  plateId: Float32Array;
  elev: Float32Array;
  /** Accumulated un-applied rotation per plate, radians. */
  theta: number[];
  /** Total applied rotation per plate, radians (for the analytic reference). */
  applied: number[];
  gapCells: number;
  overlapCells: number;
}

function freshState(): SimState {
  return {
    plateId: initialPlateId.slice(),
    elev: initialElev.slice(),
    theta: PLATES.map(() => 0),
    applied: PLATES.map(() => 0),
    gapCells: 0,
    overlapCells: 0,
  };
}

/** Multi-pass deterministic gap repair, shared by both candidates. */
function repairGaps(plateId: Float32Array, elev: Float32Array): number {
  let repaired = 0;
  for (;;) {
    const fills: Array<[number, number]> = [];
    for (let i = 0; i < COUNT; i++) {
      if (plateId[i] !== -1) continue;
      // Majority assigned-neighbor owner; ties toward the lower plate id.
      const votes = new Map<number, number>();
      for (const nb of neighbors(i, N)) {
        const p = plateId[nb]!;
        if (p !== -1) votes.set(p, (votes.get(p) ?? 0) + 1);
      }
      if (votes.size === 0) continue; // interior of a wide gap: next pass
      let best = -1;
      let bestVotes = -1;
      for (const [p, v] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
        if (v > bestVotes) {
          best = p;
          bestVotes = v;
        }
      }
      fills.push([i, best]);
    }
    if (fills.length === 0) break;
    for (const [i, p] of fills) {
      plateId[i] = p;
      elev[i] = GAP_ELEVATION;
      repaired++;
    }
  }
  return repaired;
}

/** Advance accumulated angles; returns indices of plates crossing THETA_MIN. */
function accumulate(state: SimState): number[] {
  const moving: number[] = [];
  for (let p = 0; p < PLATES.length; p++) {
    state.theta[p]! += PLATES[p]!.omegaRadPerMyr * DT_MYR;
    if (Math.abs(state.theta[p]!) >= THETA_MIN) moving.push(p);
  }
  return moving;
}

function stepGather(state: SimState): void {
  const moving = accumulate(state);
  if (moving.length === 0) return;
  const movingSet = new Set(moving);

  const newPlate = new Float32Array(COUNT).fill(-1);
  const newElev = new Float32Array(COUNT);
  let gaps = 0;
  let overlaps = 0;

  for (let i = 0; i < COUNT; i++) {
    // Claim precedence: moving plates (ascending index) beat the static owner.
    let chosen = -1;
    let chosenSrc = -1;
    let claimCount = 0;
    for (const p of moving) {
      const src = directionToIndex(rotateAboutAxis(centers[i]!, PLATES[p]!.pole, -state.theta[p]!), N);
      if (state.plateId[src] === p) {
        claimCount++;
        if (chosen === -1) {
          chosen = p;
          chosenSrc = src;
        }
      }
    }
    const owner = state.plateId[i]!;
    if (!movingSet.has(owner)) {
      claimCount++;
      if (chosen === -1) {
        chosen = owner;
        chosenSrc = i;
      }
    }
    if (claimCount === 0) {
      gaps++;
      continue;
    }
    if (claimCount > 1) overlaps++;
    newPlate[i] = chosen;
    newElev[i] = state.elev[chosenSrc]!;
  }

  repairGaps(newPlate, newElev);
  state.plateId = newPlate;
  state.elev = newElev;
  state.gapCells += gaps;
  state.overlapCells += overlaps;
  for (const p of moving) {
    state.applied[p]! += state.theta[p]!;
    state.theta[p] = 0;
  }
}

function stepScatter(state: SimState): void {
  const moving = accumulate(state);
  if (moving.length === 0) return;
  const movingSet = new Set(moving);

  const newPlate = new Float32Array(COUNT).fill(-1);
  const newElev = new Float32Array(COUNT);
  // Priority per destination: moving beats static, then plate id, then source.
  const bestKey = new Float64Array(COUNT).fill(Infinity);
  let overlaps = 0;

  for (let i = 0; i < COUNT; i++) {
    const p = state.plateId[i]!;
    const isMoving = movingSet.has(p);
    const dst = isMoving
      ? directionToIndex(rotateAboutAxis(centers[i]!, PLATES[p]!.pole, state.theta[p]!), N)
      : i;
    const key = (isMoving ? 0 : 1) * PLATES.length * COUNT + p * COUNT + i;
    if (newPlate[dst] !== -1) overlaps++;
    if (key < bestKey[dst]!) {
      bestKey[dst] = key;
      newPlate[dst] = p;
      newElev[dst] = state.elev[i]!;
    }
  }

  let gaps = 0;
  for (let i = 0; i < COUNT; i++) if (newPlate[i] === -1) gaps++;
  repairGaps(newPlate, newElev);
  state.plateId = newPlate;
  state.elev = newElev;
  state.gapCells += gaps;
  state.overlapCells += overlaps;
  for (const p of moving) {
    state.applied[p]! += state.theta[p]!;
    state.theta[p] = 0;
  }
}

// --- Metrics -------------------------------------------------------------------

/** Cells at graph distance > `radius` from any plate boundary. */
function interiorMask(plateId: Float32Array, radius: number): Uint8Array {
  const dist = new Int32Array(COUNT).fill(radius + 1);
  const queue: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    for (const nb of neighbors(i, N)) {
      if (plateId[nb] !== plateId[i]) {
        dist[i] = 0;
        queue.push(i);
        break;
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q]!;
    if (dist[cell]! >= radius) continue;
    for (const nb of neighbors(cell, N)) {
      if (dist[nb]! > dist[cell]! + 1) {
        dist[nb] = dist[cell]! + 1;
        queue.push(nb);
      }
    }
  }
  const mask = new Uint8Array(COUNT);
  for (let i = 0; i < COUNT; i++) mask[i] = dist[i]! > radius ? 1 : 0;
  return mask;
}

/**
 * RMS error of the advected elevation vs the analytic rigid rotation, over
 * cells deep inside a plate both initially and finally, normalized by the
 * field's standard deviation. 0 = perfect transport, 1 = uncorrelated.
 */
function transportFidelity(state: SimState): number {
  const maskNow = interiorMask(state.plateId, 5);
  const maskInit = interiorMask(initialPlateId, 5);
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < COUNT; i++) {
    const p = state.plateId[i]!;
    if (!maskNow[i] || p !== initialPlateId[i]) continue;
    const src = directionToIndex(
      rotateAboutAxis(centers[i]!, PLATES[p]!.pole, -state.applied[p]!),
      N,
    );
    if (!maskInit[src] || initialPlateId[src] !== p) continue;
    const err = state.elev[i]! - initialElev[src]!;
    sumSq += err * err;
    n++;
  }
  let mean = 0;
  for (const e of initialElev) mean += e;
  mean /= COUNT;
  let varSum = 0;
  for (const e of initialElev) varSum += (e - mean) * (e - mean);
  const std = Math.sqrt(varSum / COUNT);
  return n > 0 ? Math.sqrt(sumSq / n) / std : NaN;
}

function stateHash(state: SimState): number {
  return hashFloat32Array(state.plateId) ^ hashFloat32Array(state.elev);
}

// --- Run both candidates ---------------------------------------------------------

interface RunResult {
  hash: number;
  msPerStep: number;
  boundaryStart: number;
  boundaryEnd: number;
  enclaves: number;
  fidelity: number;
  gapCells: number;
  overlapCells: number;
  areaDriftPct: number;
}

function runCandidate(name: string, stepFn: (s: SimState) => void, dump: boolean): RunResult {
  const state = freshState();
  const sizes0 = plateSizes(initialPlateId, NUM_PLATES);
  const boundaryStart = boundaryCellCount(state.plateId, N);
  const t0 = process.hrtime.bigint();
  for (let s = 1; s <= STEPS; s++) {
    stepFn(state);
    if (dump && s % DUMP_EVERY === 0) {
      writeFieldPng(`${outRoot}/${name}`, `plateId-${String(s).padStart(4, '0')}`, 'plateId', state.plateId, N);
      writeFieldPng(`${outRoot}/${name}`, `elev-${String(s).padStart(4, '0')}`, 'elevation', state.elev, N);
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const sizes1 = plateSizes(state.plateId, NUM_PLATES);
  let maxDrift = 0;
  for (let p = 0; p < NUM_PLATES; p++) {
    maxDrift = Math.max(maxDrift, Math.abs(sizes1[p]! - sizes0[p]!) / sizes0[p]!);
  }
  return {
    hash: stateHash(state),
    msPerStep: ms / STEPS,
    boundaryStart,
    boundaryEnd: boundaryCellCount(state.plateId, N),
    enclaves: enclaveCount(state.plateId, N),
    fidelity: transportFidelity(state),
    gapCells: state.gapCells,
    overlapCells: state.overlapCells,
    areaDriftPct: maxDrift * 100,
  };
}

console.log(`spike #10: N=${N}, ${STEPS} steps of ${DT_MYR} Myr, ${NUM_PLATES} plates, theta_min=${THETA_MIN.toExponential(3)}`);
writeFieldPng(outRoot, 'plateId-0000', 'plateId', initialPlateId, N);
writeFieldPng(outRoot, 'elev-0000', 'elevation', initialElev, N);

for (const [name, fn] of [
  ['gather', stepGather],
  ['scatter', stepScatter],
] as const) {
  const r1 = runCandidate(name, fn, true);
  const r2 = runCandidate(name, fn, false);
  console.log(`\n${name}:`);
  console.log(`  deterministic rerun:    ${r1.hash === r2.hash ? 'yes' : 'NO'} (hash ${r1.hash.toString(16)})`);
  console.log(`  ms/step (N=${N}):        ${r1.msPerStep.toFixed(2)}`);
  console.log(`  boundary cells:         ${r1.boundaryStart} -> ${r1.boundaryEnd} (${((r1.boundaryEnd / r1.boundaryStart - 1) * 100).toFixed(1)}%)`);
  console.log(`  single-cell enclaves:   ${r1.enclaves}`);
  console.log(`  transport fidelity RMS: ${r1.fidelity.toFixed(4)} (fraction of field std; 0 = perfect)`);
  console.log(`  gap cells repaired:     ${r1.gapCells} (${(r1.gapCells / STEPS).toFixed(1)}/step)`);
  console.log(`  overlap cells:          ${r1.overlapCells} (${(r1.overlapCells / STEPS).toFixed(1)}/step)`);
  console.log(`  max plate area drift:   ${r1.areaDriftPct.toFixed(1)}%`);
}
console.log(`\nflipbooks in ${outRoot}/{gather,scatter}`);
