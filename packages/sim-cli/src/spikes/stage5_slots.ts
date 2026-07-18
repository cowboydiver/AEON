/** Stage 5 (#115) slot-headroom study (THROWAWAY): final plates.length (= max
 *  plate-id + 1, the u8/256 codec ceiling risk) and peak live plate count, at the
 *  promotion config over 4.5 Gyr. */
import {
  createPlanetParams, createInitialState, createRng, step,
  type PlanetState, type SimContext,
} from 'sim-kernel';

function arg(n: string, d: string): string {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : d;
}
const seed = parseInt(arg('seed', '42'), 10);
const gridN = parseInt(arg('n', '64'), 10);
const params = createPlanetParams({ seed, gridN, forceKinematics: true, emergentSuture: true, tensionRift: true });
const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
let state: PlanetState = createInitialState(params);
let peakLive = 0;
for (let t = 0; t < 4.5e9; t += 1e6) {
  state = step(state, 1e6, ctx);
  const live = state.plates.filter((p) => p.alive).length;
  if (live > peakLive) peakLive = live;
}
console.log(`seed ${seed} N=${gridN}: final plates.length (max slot id+1) = ${state.plates.length}, peak live = ${peakLive}, headroom to u8 256 = ${256 - state.plates.length}`);
