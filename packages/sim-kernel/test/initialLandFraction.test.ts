import { describe, expect, it } from 'vitest';
import { CONTINENTAL_CRUST_FRACTION, DEFAULT_INITIAL_LAND_FRACTION } from '../src/constants';
import { FIELD_NAMES } from '../src/fields';
import { hashFloat32Array } from '../src/hash';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';

/**
 * #106 — the initial land fraction is a planet parameter. `initialLandFraction`
 * sets the t=0 coastline: `applyInitialTerrain` places its sea quantile at
 * `1 − initialLandFraction`. Default 0.3 must be byte-identical to the pre-#106
 * kernel; other values must place a coherent coastline and re-derive a
 * self-consistent water inventory. The hard edge is the continental crust
 * fraction (0.4): at land fraction ≥ it every continental cell is emergent and
 * the initial submerged shelf starves (the CLI clamps below it; the kernel
 * trusts the value, so we can measure the degenerate regime directly here).
 *
 * Init-only checks, so N=32 and a light seed spread keep them well inside the
 * kernel suite's time budget.
 */

const SEEDS = [1, 42, 1337] as const;
const N = 32;

function fieldHash(field: Float32Array): string {
  return hashFloat32Array(field).toString(16).padStart(8, '0');
}

function initState(seed: number, extra: Record<string, number> = {}): PlanetState {
  return createInitialState(createPlanetParams({ seed, gridN: N, ...extra }));
}

/** Cells at or above the 0 m datum after the full init pipeline (the real t=0
 *  coastline — globals.landFraction is set by terrain and can be stale in the
 *  degenerate f ≥ crust-fraction regime, so measure elevation directly). */
function emergentFraction(elevation: Float32Array): number {
  let land = 0;
  for (const e of elevation) if (e >= 0) land++;
  return land / elevation.length;
}

describe('initialLandFraction (#106)', () => {
  it('defaults to DEFAULT_INITIAL_LAND_FRACTION (0.3)', () => {
    expect(createPlanetParams({ seed: 42 }).initialLandFraction).toBe(DEFAULT_INITIAL_LAND_FRACTION);
    expect(DEFAULT_INITIAL_LAND_FRACTION).toBe(0.3);
  });

  it('omitting the param is byte-identical to passing the default 0.3', () => {
    // The whole point of the default being the same `0.3` literal: every t=0
    // field — the goldens hash these — is bit-for-bit identical to the pre-#106
    // kernel. This is the byte-identity guard the main goldens also enforce.
    for (const seed of SEEDS) {
      const base = initState(seed);
      const explicit = initState(seed, { initialLandFraction: 0.3 });
      for (const name of FIELD_NAMES) {
        expect(fieldHash(explicit.fields[name]), `${name} @ seed ${seed}`).toBe(
          fieldHash(base.fields[name]),
        );
      }
      expect(explicit.globals.waterInventoryM).toBe(base.globals.waterInventoryM);
    }
  });

  it('places the measured t=0 coastline at the requested fraction, sea level pinned to 0', () => {
    // For any land fraction below the crust fraction the sea quantile sits above
    // the crust quantile, so every emergent cell is continental and no oceanic
    // high survives the plates snap: the measured emergent fraction equals the
    // requested one to grid quantization, globals.landFraction agrees, and the
    // inventory is calibrated so t=0 sea level is exactly 0 at every value.
    for (const f of [0.1, 0.3, 0.39]) {
      for (const seed of [1, 42] as const) {
        const state = initState(seed, { initialLandFraction: f });
        expect(emergentFraction(state.fields.elevation), `emergent @ f=${f} seed ${seed}`).toBeCloseTo(f, 2);
        expect(state.globals.landFraction, `landFraction @ f=${f} seed ${seed}`).toBeCloseTo(f, 2);
        expect(state.globals.seaLevelM, `seaLevelM @ f=${f} seed ${seed}`).toBe(0);
      }
    }
  });

  it('lower land fraction re-derives a larger, finite water inventory (monotone)', () => {
    // More cells below the datum ⇒ more ocean volume ⇒ larger derived inventory.
    // Strictly monotone decreasing in the land fraction, and always positive.
    for (const seed of [1, 42] as const) {
      let prev = Infinity;
      for (const f of [0.1, 0.2, 0.3, 0.39]) {
        const inv = initState(seed, { initialLandFraction: f }).globals.waterInventoryM;
        expect(Number.isFinite(inv)).toBe(true);
        expect(inv, `inventory should fall as land rises (f=${f}, seed ${seed})`).toBeLessThan(prev);
        expect(inv).toBeGreaterThan(0);
        prev = inv;
      }
    }
  });

  it('composes with waterInventoryScale as base(f) × scale, exactly', () => {
    // land fraction shapes the derived base; the water scale multiplies it. The
    // two knobs are independent and compose by construction.
    for (const f of [0.1, 0.39]) {
      // base = the unscaled (×1.0) derived inventory. The shipped default scale
      // is 1.5 since the KBV 20 promotion, so name scale 1 explicitly here.
      const base = initState(42, { initialLandFraction: f, waterInventoryScale: 1 }).globals
        .waterInventoryM;
      for (const scale of [0.5, 2]) {
        const scaled = initState(42, { initialLandFraction: f, waterInventoryScale: scale }).globals.waterInventoryM;
        expect(scaled).toBe(base * scale);
      }
    }
  });

  it('edge case f → 0: a single emergent cell, everything else ocean, all fields finite', () => {
    // At the quantile clamp the sea index is count−1, so only the noise maximum
    // stands above the datum — a near-waterworld, but a well-formed one.
    const state = initState(42, { initialLandFraction: 1e-6 });
    const frac = emergentFraction(state.fields.elevation);
    expect(frac).toBeGreaterThan(0); // at least the max cell
    expect(frac).toBeLessThan(0.02); // but essentially no land
    for (const name of FIELD_NAMES) {
      for (const v of state.fields[name]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('edge case f just under the crust fraction: a thin but nonzero submerged shelf', () => {
    // At f = 0.39 with crust fraction 0.4 the coastline rides ~1% of the sphere
    // below the crust quantile: still an Earth-like construction (some
    // continental crust flooded), just a thin shelf — not yet the degenerate
    // regime. Confirms the shelf does not vanish right up to the edge.
    for (const seed of [1, 42] as const) {
      const state = initState(seed, { initialLandFraction: 0.39 });
      const elevation = state.fields.elevation;
      const crustType = state.fields.crustType;
      let submergedContinental = 0;
      let emergentOceanic = 0;
      for (let i = 0; i < elevation.length; i++) {
        if (crustType[i] === 1 && elevation[i]! < 0) submergedContinental++;
        if (crustType[i] === 0 && elevation[i]! >= 0) emergentOceanic++;
      }
      // Some continental crust is still flooded (the shelf survives to the edge)…
      expect(submergedContinental, `submerged shelf @ seed ${seed}`).toBeGreaterThan(0);
      // …and no oceanic crust stands as land (that is the over-edge regime).
      expect(emergentOceanic, `emergent oceanic @ seed ${seed}`).toBe(0);
    }
  });

  it('degenerate f ≥ crust fraction (0.5): emergent land caps at the crust fraction, shelf starved', () => {
    // The hard edge decision (2) names: at f = 0.5 (> the 0.4 crust fraction) the
    // sea quantile sits BELOW the crust quantile, so the cells between them are
    // oceanic-but-above-datum. The plates pass snaps them onto the age-depth
    // curve (down to the ridge crest), so the real emergent land caps near the
    // crust fraction and NO continental crust is submerged — the shelf is gone.
    // This is why the CLI validates f < CONTINENTAL_CRUST_FRACTION; the kernel
    // trusts the value, so we can still measure the regime here.
    for (const seed of [1, 42] as const) {
      const state = initState(seed, { initialLandFraction: 0.5 });
      const elevation = state.fields.elevation;
      const crustType = state.fields.crustType;
      const emergent = emergentFraction(elevation);
      // Emergent land is pinned near the crust fraction, NOT the requested 0.5.
      expect(emergent).toBeLessThan(CONTINENTAL_CRUST_FRACTION + 0.02);
      expect(emergent).toBeGreaterThan(CONTINENTAL_CRUST_FRACTION - 0.05);
      // The stale terrain-set landFraction still reads ~0.5 — the tell that this
      // regime is inconsistent and why the coastline knob is clamped below it.
      expect(state.globals.landFraction).toBeCloseTo(0.5, 1);
      let submergedContinental = 0;
      for (let i = 0; i < elevation.length; i++) {
        if (crustType[i] === 1 && elevation[i]! < 0) submergedContinental++;
      }
      expect(submergedContinental, `shelf starved @ seed ${seed}`).toBe(0);
    }
  });
});
