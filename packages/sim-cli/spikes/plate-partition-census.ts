/**
 * Spike (Tectonics V2 stage 1, #111): plate-census partition diagnostic.
 *
 * The stage-1 gate targets an oceanic/continental speed ratio of 1.5-4, but the
 * full 4.5 Gyr N=64 census reports it at ~0.2-0.4 on all three seeds. This spike
 * drives the kernel directly (bypassing the CLI's keyframe snapshot, which does
 * NOT carry plate records) and, at every keyframe, counts how many plates fall in
 * the census's binary "continent-dominated" partition (>= CONTINENT_DOMINATED_
 * FRACTION of cells continental) vs the oceanic partition, plus each partition's
 * mean speed. It exists to answer: is the low ratio a physics magnitude problem
 * (tunable via drag constants) or a measurement-definition degeneracy (an empty
 * partition making the ratio 0 by construction, untunable)?
 *
 * Finding: the continental partition is EMPTY ~68% of keyframes (a dispersed
 * world of 4-6 large plates each carrying continental crust as a MINORITY never
 * crosses the 50% threshold), so the summary-mean ratio is dragged to ~0 by
 * structural zeros that no drag constant can move. See
 * docs/TECTONICS_V2_STAGE1_CENSUS.md.
 *
 * Usage: pnpm -F sim-cli exec tsx spikes/plate-partition-census.ts [--seed 42] [--grid-n 64] [--until 4.5e9]
 */

import { parseArgs } from 'node:util';
import { createPlanetParams, createInitialState, step, createRng } from 'sim-kernel';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    seed: { type: 'string', default: '42' },
    'grid-n': { type: 'string', default: '64' },
    until: { type: 'string', default: '4.5e9' },
  },
});

// Must match systems/plateCensus.ts.
const CONTINENT_DOMINATED_FRACTION = 0.5;
const EARTH_RADIUS_M = 6371e3;
const M_PER_YR_TO_CM_PER_YR = 100;

const seed = Number(values.seed);
const gridN = Number(values['grid-n']);
const until = Number(values.until);

const params = createPlanetParams({ seed, gridN, forceKinematics: true, plateCensus: true });
const ctx = { rng: createRng(params.seed).fork('sim') };
const stepYears = params.stepYears;
const totalSteps = Math.ceil(until / stepYears);
const kfEvery = Math.round(params.keyframeIntervalYears / stepYears);

interface Row {
  t: number;
  alive: number;
  ocN: number;
  coN: number;
  ocMean: number;
  coMean: number;
}

function partition(state: ReturnType<typeof createInitialState>): Omit<Row, 't'> {
  const plateId = state.fields.plateId;
  const crustType = state.fields.crustType;
  const numCells = crustType.length;
  const numPlates = state.plates.length;
  const owned = new Array<number>(numPlates).fill(0);
  const continental = new Array<number>(numPlates).fill(0);
  for (let i = 0; i < numCells; i++) {
    const p = plateId[i]!;
    if (p < 0 || p >= numPlates) continue;
    owned[p]!++;
    if (crustType[i]! >= 0.5) continental[p]!++;
  }
  let ocN = 0;
  let ocSum = 0;
  let coN = 0;
  let coSum = 0;
  let alive = 0;
  for (let p = 0; p < numPlates; p++) {
    const plate = state.plates[p]!;
    if (!plate.alive || owned[p] === 0) continue;
    alive++;
    const speed = Math.abs(plate.angularVelRadPerYr) * EARTH_RADIUS_M * M_PER_YR_TO_CM_PER_YR;
    const frac = continental[p]! / owned[p]!;
    if (frac < CONTINENT_DOMINATED_FRACTION) {
      ocN++;
      ocSum += speed;
    } else {
      coN++;
      coSum += speed;
    }
  }
  return { alive, ocN, coN, ocMean: ocN ? ocSum / ocN : 0, coMean: coN ? coSum / coN : 0 };
}

let state = createInitialState(params);
const rows: Row[] = [];
for (let i = 1; i <= totalSteps; i++) {
  const dt = Math.min(stepYears, until - state.timeYears);
  if (dt <= 0) break;
  state = step(state, dt, ctx);
  if (i % kfEvery === 0) rows.push({ t: Math.round(state.timeYears / 1e6), ...partition(state) });
}

const both = rows.filter((r) => r.ocN > 0 && r.coN > 0);
const contEmpty = rows.filter((r) => r.coN === 0);
const ocEmpty = rows.filter((r) => r.ocN === 0);
const avg = (a: Row[], f: (r: Row) => number): number =>
  a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0;
const pct = (n: number): string => ((n / rows.length) * 100).toFixed(0) + '%';

console.log(`seed ${seed} grid-N ${gridN} until ${until / 1e9} Gyr -- ${rows.length} keyframes`);
console.log(`both partitions populated:  ${both.length} (${pct(both.length)})`);
console.log(`continental partition EMPTY: ${contEmpty.length} (${pct(contEmpty.length)})`);
console.log(`oceanic partition EMPTY:     ${ocEmpty.length} (${pct(ocEmpty.length)})`);
console.log(`mean alive plates ${avg(rows, (r) => r.alive).toFixed(1)}; mean ocN ${avg(rows, (r) => r.ocN).toFixed(1)}; mean coN ${avg(rows, (r) => r.coN).toFixed(1)}`);
console.log(
  `among both-populated: ocMean ${avg(both, (r) => r.ocMean).toFixed(2)} cm/yr  coMean ${avg(both, (r) => r.coMean).toFixed(2)} cm/yr  ratio ${(avg(both, (r) => r.ocMean) / avg(both, (r) => r.coMean)).toFixed(2)}`,
);
