import { describe, expect, it } from 'vitest';
import { cellCount, directionToIndex, neighbors } from '../src/grid';
import type { PlanetState } from '../src/state';
import { erosionSystem } from '../src/systems/erosion';
import { applyPrecipitationProxy, precipitationForLatitude } from '../src/systems/climateProxy';
import { normalize3 } from '../src/vec';
import { runSystems, twoPlateState } from './helpers';

const N = 32;

/** Static all-continental world with the precipitation proxy filled in. */
function erosionWorld(): PlanetState {
  const s = twoPlateState(N, { pole: [0, 0, 1], omega: 0 }, { pole: [0, 1, 0], omega: 0 });
  return applyPrecipitationProxy(s);
}

function continentalSum(state: PlanetState): number {
  // Kahan summation: the conservation check must not drown in float noise.
  let sum = 0;
  let c = 0;
  const { elevation, crustType } = state.fields;
  for (let i = 0; i < elevation.length; i++) {
    if (crustType[i] !== 1) continue;
    const y = elevation[i]! - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

describe('precipitation proxy (#19)', () => {
  it('produces the wet-equator / dry-subtropics / wetter-midlat / dry-pole profile', () => {
    const equator = precipitationForLatitude(0);
    const subtropics = precipitationForLatitude(27);
    const midlat = precipitationForLatitude(48);
    const pole = precipitationForLatitude(88);
    expect(equator).toBeGreaterThan(1500);
    expect(subtropics).toBeLessThan(500);
    expect(midlat).toBeGreaterThan(600);
    expect(pole).toBeLessThan(250);
    expect(equator).toBeGreaterThan(midlat);
    expect(midlat).toBeGreaterThan(subtropics);
    expect(subtropics).toBeGreaterThan(pole);
  });

  it('fills the field for every cell, in real units', () => {
    const state = erosionWorld();
    for (const p of state.fields.precipitation) {
      expect(p).toBeGreaterThan(50);
      expect(p).toBeLessThan(3000);
    }
  });
});

describe('erosion (#19)', () => {
  it('conserves total continental elevation with uplift disabled', () => {
    let state = erosionWorld();
    const elevation = state.fields.elevation.slice();
    // A rough mountain range plus noise so there is real relief to move.
    for (let i = 0; i < cellCount(N); i++) {
      elevation[i] = (i * 2654435761) % 7 === 0 ? 4000 : 200;
    }
    state = { ...state, fields: { ...state.fields, elevation } };
    const before = continentalSum(state);
    const after = runSystems(state, 50, [erosionSystem]);
    expect(Math.abs(continentalSum(after) - before)).toBeLessThan(Math.abs(before) * 1e-5 + 1);
  });

  it('spreads and lowers an isolated peak; max elevation decays monotonically', () => {
    let state = erosionWorld();
    const peak = directionToIndex(normalize3([0.2, 0.4, 0.9]), N);
    const elevation = state.fields.elevation.slice();
    elevation[peak] = 5000;
    state = { ...state, fields: { ...state.fields, elevation } };

    let lastMax = 5000;
    for (let k = 0; k < 10; k++) {
      state = runSystems(state, 5, [erosionSystem]);
      let max = -Infinity;
      for (const e of state.fields.elevation) max = Math.max(max, e);
      expect(max).toBeLessThan(lastMax);
      lastMax = max;
    }
    // The removed volume went to the peak's neighborhood.
    for (const nb of neighbors(peak, N)) {
      expect(state.fields.elevation[nb]).toBeGreaterThan(0);
    }
    expect(state.fields.elevation[peak]).toBeLessThan(5000);
    expect(state.fields.elevation[peak]).toBeGreaterThan(0);
  });

  it('erodes a wet-latitude peak faster than an identical dry-latitude peak', () => {
    let state = erosionWorld();
    const wet = directionToIndex(normalize3([0.95, 0.02, 0.3]), N); // ~1 deg lat: ITCZ
    const dry = directionToIndex(normalize3([0.85, Math.sin((27 * Math.PI) / 180), 0.3]), N); // ~27 deg: desert belt
    const elevation = state.fields.elevation.slice();
    elevation[wet] = 5000;
    elevation[dry] = 5000;
    state = { ...state, fields: { ...state.fields, elevation } };
    const end = runSystems(state, 20, [erosionSystem]);
    const wetDrop = 5000 - end.fields.elevation[wet]!;
    const dryDrop = 5000 - end.fields.elevation[dry]!;
    expect(wetDrop).toBeGreaterThan(dryDrop * 1.5);
  });

  it('never touches oceanic cells', () => {
    let state = erosionWorld();
    const crustType = state.fields.crustType.slice();
    const elevation = state.fields.elevation.slice();
    // Make plate 1 oceanic with a marker elevation.
    for (let i = 0; i < cellCount(N); i++) {
      if (state.fields.plateId[i] === 1) {
        crustType[i] = 0;
        elevation[i] = -4321;
      } else {
        elevation[i] = 2000;
      }
    }
    state = { ...state, fields: { ...state.fields, crustType, elevation } };
    const end = runSystems(state, 20, [erosionSystem]);
    for (let i = 0; i < cellCount(N); i++) {
      if (end.fields.crustType[i] === 0) expect(end.fields.elevation[i]).toBe(-4321);
    }
  });
});
