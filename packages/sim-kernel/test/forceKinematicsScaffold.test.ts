import { describe, expect, it } from 'vitest';
import { MECHANISMS, defaultMechanismToggles } from '../src/mechanisms';
import { createInitialState, createPlanetParams } from '../src/state';

/**
 * Stage-1 scaffolding contract (Tectonics V2, #111, proposal §2.2/§2.3): the
 * `forceKinematics` mechanism and the extended `PlateRecord` state exist, and
 * the kinematic state zero-initializes at t=0. As of the stage-5 promotion
 * (#115, KERNEL_BEHAVIOR_VERSION 17) the mechanism is default-ON with onset 0
 * (active from formation); the flag-OFF path's byte-identity to the pre-#111
 * kernel is now pinned by the pre-V2-promotion default golden spine.
 */
describe('forceKinematics scaffolding', () => {
  it('exposes forceKinematics=true and forceKinematicsOnsetYears=0 by default (#115 promotion)', () => {
    const params = createPlanetParams({ seed: 1 });
    expect(params.forceKinematics).toBe(true);
    expect(params.forceKinematicsOnsetYears).toBe(0);
  });

  it('registers forceKinematics as a mechanism, on by default (#115 promotion)', () => {
    const entry = MECHANISMS.find((m) => m.key === 'forceKinematics');
    expect(entry).toBeDefined();
    expect(entry?.issue).toBe(111);
    expect(defaultMechanismToggles().forceKinematics).toBe(true);
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
