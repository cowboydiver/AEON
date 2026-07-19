import { describe, expect, it } from 'vitest';

import {
  createInitialState,
  createPlanetParams,
  resolveMechanismDependencies,
  validateKinematicDependencies,
  type MechanismToggles,
} from '../src/index';

/**
 * #127 item 6: guard the degenerate Tectonics-V2 partial-flag configs. Both
 * `tensionRift` and `emergentSuture` require `forceKinematics`; enabling either
 * without it is a silently dead world (rift-dead / suture-timeout grinding), so
 * `createPlanetParams` and `createInitialState` must reject the combo, and the
 * UI resolver must cascade the dependents off.
 */
describe('kinematic dependency guard (#127 item 6)', () => {
  it('rejects tensionRift on with forceKinematics off', () => {
    expect(() =>
      createPlanetParams({
        seed: 42,
        forceKinematics: false,
        tensionRift: true,
        emergentSuture: false,
      }),
    ).toThrow(/tensionRift.*forceKinematics/);
  });

  it('rejects emergentSuture on with forceKinematics off', () => {
    expect(() =>
      createPlanetParams({
        seed: 42,
        forceKinematics: false,
        tensionRift: false,
        emergentSuture: true,
      }),
    ).toThrow(/emergentSuture.*forceKinematics/);
  });

  it('rejects the default dependents when only forceKinematics is turned off', () => {
    // The dangerous ergonomic footgun: --no-force-kinematics / a lone UI uncheck
    // leaves tensionRift + emergentSuture at their default ON.
    expect(() => createPlanetParams({ seed: 1, forceKinematics: false })).toThrow(
      /tensionRift and emergentSuture require forceKinematics/,
    );
  });

  it('accepts the legacy all-off triple (the byte-identical main spine)', () => {
    expect(() =>
      createPlanetParams({
        seed: 42,
        forceKinematics: false,
        tensionRift: false,
        emergentSuture: false,
      }),
    ).not.toThrow();
  });

  it('accepts the promoted default world (all three on)', () => {
    expect(() => createPlanetParams({ seed: 42 })).not.toThrow();
  });

  it('accepts forceKinematics on with the dependents off', () => {
    expect(() =>
      createPlanetParams({
        seed: 42,
        forceKinematics: true,
        tensionRift: false,
        emergentSuture: false,
      }),
    ).not.toThrow();
  });

  it('is satisfied by an onset-gated (flag-on) forceKinematics', () => {
    // Flag-level dependency: forceKinematics on but inert until its onset year
    // still satisfies the guard — the onset-window transient self-heals.
    expect(() =>
      createPlanetParams({
        seed: 42,
        forceKinematics: true,
        forceKinematicsOnsetYears: 3e9,
        tensionRift: true,
      }),
    ).not.toThrow();
  });

  it('createInitialState rejects a raw degenerate params object (step-wiring backstop)', () => {
    const good = createPlanetParams({ seed: 42, gridN: 16 });
    // Bypass createPlanetParams by spreading a raw params object, as a codec /
    // hand-assembled caller might.
    const degenerate = { ...good, forceKinematics: false };
    expect(() => createInitialState(degenerate)).toThrow(/forceKinematics/);
  });

  it('createInitialState accepts the legacy triple-off params', () => {
    const legacy = createPlanetParams({
      seed: 42,
      gridN: 16,
      forceKinematics: false,
      tensionRift: false,
      emergentSuture: false,
    });
    expect(() => createInitialState(legacy)).not.toThrow();
  });

  it('validateKinematicDependencies is a pure predicate over the three flags', () => {
    expect(() =>
      validateKinematicDependencies({
        forceKinematics: false,
        tensionRift: true,
        emergentSuture: true,
      }),
    ).toThrow();
    expect(() =>
      validateKinematicDependencies({
        forceKinematics: true,
        tensionRift: true,
        emergentSuture: true,
      }),
    ).not.toThrow();
  });
});

describe('resolveMechanismDependencies (#127 item 6)', () => {
  const base = (): MechanismToggles => ({
    blockIsostasy: false,
    crustFates: true,
    compactArcs: false,
    marinePlanation: true,
    emergentArcTaper: false,
    seaLevelDatums: false,
    freeboard: false,
    bathymetryDatum: false,
    forceKinematics: true,
    emergentSuture: true,
    tensionRift: true,
  });

  it('cascades tensionRift + emergentSuture off when forceKinematics is off', () => {
    const resolved = resolveMechanismDependencies({ ...base(), forceKinematics: false });
    expect(resolved.forceKinematics).toBe(false);
    expect(resolved.tensionRift).toBe(false);
    expect(resolved.emergentSuture).toBe(false);
    // The cascaded set is a valid (non-degenerate) config.
    expect(() => createPlanetParams({ seed: 1, ...resolved })).not.toThrow();
  });

  it('returns the same reference (no-op) when the config is already coherent', () => {
    const toggles = base();
    expect(resolveMechanismDependencies(toggles)).toBe(toggles);
  });

  it('leaves an all-off legacy set unchanged', () => {
    const legacy = { ...base(), forceKinematics: false, tensionRift: false, emergentSuture: false };
    expect(resolveMechanismDependencies(legacy)).toBe(legacy);
  });
});
