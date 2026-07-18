/**
 * Stage 5 (#115) — slab-attachment correlation window study (THROWAWAY).
 *
 * Option B: the deep-time MEAN of per-keyframe speed–slab-attachment pearson
 * washes to ~0.07 under the full promotion stack (churn drowns the small-sample
 * per-keyframe correlation), yet the signal is strongly positive at plate birth.
 * This spike measures candidate gate definitions under the full three-flag stack
 * so we pick a principled, robust one — NOT a cherry-picked window:
 *
 *   1. meanPerKeyframe  — reproduce the ~0.07 baseline (mean of per-frame pearson).
 *   2. pooledAll        — ONE pearson over all (speed, slabStress) pairs pooled
 *                         across every past-1-Gyr keyframe (large-sample estimate).
 *   3. pooledOceanic    — pooledAll restricted to oceanic plates (contFrac < 0.5),
 *                         the Forsyth & Uyeda slab-eligible subpopulation.
 *   4. engagedTransient — mean per-keyframe pearson over the t=10–200 Myr window
 *                         (fresh, slab-driven plate population, the promise made
 *                         to the owner).
 *
 * Pearson is scale-invariant, so R and cellArea (per-run constants) are dropped:
 * speed ∝ |angularVelRadPerYr|, slabStress ∝ slabPullN/ownedCells.
 *
 * Run: pnpm --filter sim-cli exec tsx src/spikes/stage5_slabcorr.ts --seed 42 --n 64
 * Changes no kernel bytes, produces no goldens.
 */
import {
  cellCount,
  createPlanetParams,
  createInitialState,
  createRng,
  step,
  type PlanetState,
  type SimContext,
} from 'sim-kernel';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : def;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den > 0 ? sxy / den : NaN;
}

const seed = parseInt(arg('seed', '42'), 10);
const gridN = parseInt(arg('n', '64'), 10);
const until = 4.5e9;
const stepYears = 1e6;
const sampleEvery = 10; // 10 Myr, mirrors the census keyframe cadence

const params = createPlanetParams({
  seed,
  gridN,
  forceKinematics: true,
  emergentSuture: true,
  tensionRift: true,
});
const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
let state: PlanetState = createInitialState(params);

// Pooled accumulators (past 1 Gyr).
const poolSpeedAll: number[] = [];
const poolSlabAll: number[] = [];
const poolSpeedOce: number[] = [];
const poolSlabOce: number[] = [];
const perFrameAll: number[] = []; // mean-per-keyframe reference
const perFrameTransient: number[] = []; // t=10–200 Myr

const count = cellCount(gridN);
let stepNo = 0;
for (let t = 0; t < until; t += stepYears) {
  state = step(state, stepYears, ctx);
  stepNo++;
  if (stepNo % sampleEvery !== 0) continue;
  const timeYears = state.timeYears;

  const plateId = state.fields.plateId;
  const crustType = state.fields.crustType;
  const plates = state.plates;
  const np = plates.length;
  const owned = new Int32Array(np);
  const cont = new Int32Array(np);
  for (let i = 0; i < count; i++) {
    const p = plateId[i]!;
    if (p >= 0 && p < np) {
      owned[p]!++;
      if (crustType[i]! === 1) cont[p]!++;
    }
  }
  const fSpeed: number[] = [];
  const fSlab: number[] = [];
  for (let p = 0; p < np; p++) {
    const plate = plates[p]!;
    const own = owned[p]!;
    if (!plate.alive || own === 0) continue;
    const speed = Math.abs(plate.angularVelRadPerYr);
    const slab = plate.slabPullN / own;
    const frac = cont[p]! / own;
    fSpeed.push(speed);
    fSlab.push(slab);
    if (timeYears >= 1e9) {
      poolSpeedAll.push(speed);
      poolSlabAll.push(slab);
      if (frac < 0.5) {
        poolSpeedOce.push(speed);
        poolSlabOce.push(slab);
      }
    }
  }
  const r = pearson(fSpeed, fSlab);
  if (!Number.isNaN(r)) {
    if (timeYears >= 1e9) perFrameAll.push(r);
    if (timeYears >= 10e6 && timeYears <= 200e6) perFrameTransient.push(r);
  }
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

console.log(`seed ${seed} N=${gridN} full-stack 4.5 Gyr`);
console.log(`  1. meanPerKeyframe (past 1 Gyr, n=${perFrameAll.length} frames): ${mean(perFrameAll).toFixed(3)}`);
console.log(`  2. pooledAll       (past 1 Gyr, n=${poolSpeedAll.length} pairs):  ${pearson(poolSpeedAll, poolSlabAll).toFixed(3)}`);
console.log(`  3. pooledOceanic   (past 1 Gyr, n=${poolSpeedOce.length} pairs):  ${pearson(poolSpeedOce, poolSlabOce).toFixed(3)}`);
console.log(`  4. engagedTransient(10–200 Myr, n=${perFrameTransient.length} frames): ${mean(perFrameTransient).toFixed(3)}`);
