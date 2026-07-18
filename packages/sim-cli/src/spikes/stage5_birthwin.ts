/** Stage 5 (#115) birth-window study (THROWAWAY): per-keyframe speed–slab pearson
 *  mean over several early windows, full promotion stack, to 300 Myr. */
import {
  cellCount, createPlanetParams, createInitialState, createRng, step,
  type PlanetState, type SimContext,
} from 'sim-kernel';

function arg(n: string, d: string): string {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : d;
}
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 3) return NaN;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]!; my += ys[i]!; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; sxy += dx*dy; sxx += dx*dx; syy += dy*dy; }
  const den = Math.sqrt(sxx*syy); return den > 0 ? sxy/den : NaN;
}
const seed = parseInt(arg('seed', '42'), 10);
const gridN = parseInt(arg('n', '64'), 10);
const params = createPlanetParams({ seed, gridN, forceKinematics: true, emergentSuture: true, tensionRift: true });
const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
let state: PlanetState = createInitialState(params);
const count = cellCount(gridN);
const rows: { t: number; r: number }[] = [];
let stepNo = 0;
for (let t = 0; t < 300e6; t += 1e6) {
  state = step(state, 1e6, ctx); stepNo++;
  if (stepNo % 10 !== 0) continue;
  const plateId = state.fields.plateId, plates = state.plates, np = plates.length;
  const owned = new Int32Array(np);
  for (let i = 0; i < count; i++) { const p = plateId[i]!; if (p >= 0 && p < np) owned[p]!++; }
  const sp: number[] = [], sl: number[] = [];
  for (let p = 0; p < np; p++) { const pl = plates[p]!; const o = owned[p]!; if (!pl.alive || o === 0) continue;
    sp.push(Math.abs(pl.angularVelRadPerYr)); sl.push(pl.slabPullN / o); }
  const r = pearson(sp, sl); if (!Number.isNaN(r)) rows.push({ t: state.timeYears, r });
}
const mean = (a: number[]) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : NaN;
const win = (lo: number, hi: number) => mean(rows.filter(x => x.t >= lo && x.t <= hi).map(x => x.r));
console.log(`seed ${seed} N=${gridN}: 10-50=${win(10e6,50e6).toFixed(3)} 10-80=${win(10e6,80e6).toFixed(3)} 10-100=${win(10e6,100e6).toFixed(3)} 10-150=${win(10e6,150e6).toFixed(3)} 10-200=${win(10e6,200e6).toFixed(3)}`);
