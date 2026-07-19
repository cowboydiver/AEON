/** Stage 5 (#115) hypsometry diagnostic (THROWAWAY): reproduce the phase1
 *  isBimodal check on the PROMOTED default world (V2 on) and print the mode/trough
 *  margins at each checkpoint, to judge blocker-2 (marginal rebaseline vs real
 *  loss of bimodality). Mirrors invariants/phase1.test.ts: N=32, 3 Myr steps. */
import { createPlanetParams, createInitialState, createRng, step, type SimContext } from 'sim-kernel';

function arg(n: string, d: string): string {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : d;
}
function modes(elevation: Float32Array) {
  const lo = -8000, hi = 4000, bins = 48;
  const hist = new Array<number>(bins).fill(0);
  for (const e of elevation) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((e - lo) / (hi - lo)) * bins)));
    hist[b]!++;
  }
  const binOf = (elev: number) => Math.floor(((elev - lo) / (hi - lo)) * bins);
  const maxIn = (a: number, b: number) => Math.max(...hist.slice(binOf(a), binOf(b)));
  const minIn = (a: number, b: number) => Math.min(...hist.slice(binOf(a), binOf(b)));
  const abyssalMode = maxIn(-7000, -3000);
  const platformMode = maxIn(-1500, 1500);
  const trough = minIn(-3000, -1500);
  const bimodal = abyssalMode > 2 * trough && platformMode > 1.5 * trough;
  return { abyssalMode, platformMode, trough, bimodal };
}
const seed = parseInt(arg('seed', '42'), 10);
const gridN = parseInt(arg('n', '32'), 10);
const params = createPlanetParams({ seed, gridN, stepYears: 3e6 }); // promoted defaults (V2 on), matches phase1 test
const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
let state = createInitialState(params);
const report = (label: string) => {
  const m = modes(state.fields.elevation);
  console.log(`  ${label}: abyssal=${m.abyssalMode} platform=${m.platformMode} trough=${m.trough} ` +
    `(abyssal/trough=${(m.abyssalMode / Math.max(1, m.trough)).toFixed(2)}x need>2, ` +
    `platform/trough=${(m.platformMode / Math.max(1, m.trough)).toFixed(2)}x need>1.5) bimodal=${m.bimodal}`);
};
console.log(`seed ${seed} N=${gridN} promoted (V2 on):`);
report('t=0');
for (const checkpoint of [150, 300, 450]) {
  while (state.timeYears < checkpoint * 1e6) state = step(state, params.stepYears, ctx);
  report(`t=${checkpoint} Myr`);
}
