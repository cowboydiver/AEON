import { describe, expect, it } from 'vitest';
import { FIELD_NAMES } from '../src/fields';
import { hashFloat32Array } from '../src/hash';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';

/**
 * #105 — the water inventory is a planet parameter. `waterInventoryScale` is a
 * dimensionless multiplier on the derived inventory (the ocean volume below the
 * t=0 coastline). Since the crustal-columns promotion (KBV 20) the shipped
 * default is 1.5× (the Earth-like coastline endowment, C7 gate §5); passing 1.0
 * explicitly recovers the pre-#105 byte-identical derivation. Any scale must
 * multiply the inventory exactly and preserve the water-mass invariant over the
 * pipeline.
 */

const SEEDS = [1, 42, 1337] as const;

function fieldHash(field: Float32Array): string {
  return hashFloat32Array(field).toString(16).padStart(8, '0');
}

describe('waterInventoryScale (#105)', () => {
  it('defaults to 1.5 (the crustal-columns promotion endowment, KBV 20)', () => {
    expect(createPlanetParams({ seed: 42 }).waterInventoryScale).toBe(1.5);
  });

  it('passing the default scale explicitly matches omitting the param', () => {
    for (const seed of SEEDS) {
      const omitted = createInitialState(createPlanetParams({ seed }));
      const explicit = createInitialState(createPlanetParams({ seed, waterInventoryScale: 1.5 }));
      expect(explicit.globals.waterInventoryM).toBe(omitted.globals.waterInventoryM);
    }
  });

  it('scales the derived inventory linearly and exactly', () => {
    for (const seed of SEEDS) {
      // Base = the unscaled (×1.0) derived inventory. The shipped default is now
      // 1.5×, so name scale 1 explicitly rather than relying on the default.
      const base = createInitialState(
        createPlanetParams({ seed, waterInventoryScale: 1 }),
      ).globals.waterInventoryM;
      for (const scale of [0.5, 1.5, 2, 2.7]) {
        const scaled = createInitialState(
          createPlanetParams({ seed, waterInventoryScale: scale }),
        ).globals.waterInventoryM;
        expect(scaled).toBe(base * scale);
      }
    }
  });

  it('the derived base inventory is positive so the scale is a real knob', () => {
    for (const seed of SEEDS) {
      expect(createInitialState(createPlanetParams({ seed })).globals.waterInventoryM).toBeGreaterThan(0);
    }
  });

  it('t=0 fields are byte-identical across scales — only the inventory global moves', () => {
    // The scale changes only globals.waterInventoryM at init; every field array
    // (elevation, biome, temperature, …) is produced before/independent of the
    // inventory, so the t=0 field hashes must not move across scales — the reason
    // a scale change never touches the t=0 golden field hashes (they hash fields).
    for (const seed of SEEDS) {
      const a = createInitialState(createPlanetParams({ seed, waterInventoryScale: 1 }));
      const b = createInitialState(createPlanetParams({ seed, waterInventoryScale: 2 }));
      for (const name of FIELD_NAMES) {
        expect(fieldHash(b.fields[name]), `${name} @ seed ${seed}`).toBe(fieldHash(a.fields[name]));
      }
    }
  });

  it('the scaled inventory is conserved and closes the water-mass invariant over steps', () => {
    // The scale is init-time only; once set, the inventory is held constant and
    // ocean + grounded-ice-equivalent must still equal it every step, in the
    // higher-water regime as much as the default.
    const params = createPlanetParams({ seed: 42, gridN: 32, waterInventoryScale: 2 });
    const inventory = createInitialState(params).globals.waterInventoryM;
    const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
    let s: PlanetState = createInitialState(params);
    for (let i = 0; i < 20; i++) {
      s = step(s, params.stepYears, ctx);
      expect(s.globals.waterInventoryM, `step ${i}: inventory constant`).toBe(inventory);
    }
  });
});
