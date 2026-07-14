import { describe, expect, it } from 'vitest';
import { MECHANISMS, defaultMechanismToggles } from '../src/mechanisms';
import { createInitialState, createPlanetParams } from '../src/state';

/**
 * Stage-1 scaffolding contract (Tectonics V2, #111, proposal §2.2/§2.3): the
 * `forceKinematics` mechanism and the extended `PlateRecord` state exist and
 * default to OFF / zero, so the default (flag-off) path is byte-identical to
 * the pre-#111 kernel. The physics pass (`plateDynamics`) lands in chunk 2.
 */
describe('forceKinematics scaffolding', () => {
  it('exposes forceKinematics=false and forceKinematicsOnsetYears=0 by default', () => {
    const params = createPlanetParams({ seed: 1 });
    expect(params.forceKinematics).toBe(false);
    expect(params.forceKinematicsOnsetYears).toBe(0);
  });

  it('registers forceKinematics as a mechanism, off by default', () => {
    const entry = MECHANISMS.find((m) => m.key === 'forceKinematics');
    expect(entry).toBeDefined();
    expect(entry?.issue).toBe(111);
    expect(defaultMechanismToggles().forceKinematics).toBe(false);
  });

  it('zero-initializes the new PlateRecord kinematic state', () => {
    const state = createInitialState(createPlanetParams({ seed: 42 }));
    expect(state.plates.length).toBeGreaterThan(0);
    for (const p of state.plates) {
      expect(p.omegaVec).toEqual([0, 0, 0]);
      expect(p.tensionN).toBe(0);
      expect(p.stallSinceYears).toBe(0);
      expect(p.blanketYears).toBe(0);
    }
  });
});
