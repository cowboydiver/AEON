/**
 * Whittaker biome classification (#35) — the last system in the Phase 3 climate
 * block. It fills the categorical `biome` field from a lookup over this step's
 * (temperature, precipitation), and drives the renderer's from-orbit colour ramp
 * in place of raw hypsometry, so the planet finally reads *alive* from orbit.
 *
 * FAST diagnostic (§0): recomputed from scratch every step, no cross-step memory
 * — a step just re-classifies the current climate. It runs LAST (after `carbon`)
 * so it sees the fully-solved temperature, precipitation and the dynamic
 * `seaLevelM` land/ocean mask; nothing downstream reads it. Pure: a function of
 * `temperature`, `precipitation`, `elevation` and `seaLevelM` only. Being
 * categorical, `biome` round-trips BIT-EXACT through the codec and is
 * nearest-picked (never lerped) across keyframes on the GPU — the same rule as
 * `plateId`/`crustType`. Same seed + params ⇒ bit-identical biomes on every
 * machine.
 *
 * The classification tiles the Whittaker plane. Ocean is its own class (the
 * sea-level mask wins over any (T, precip) point). Land is split by two
 * mean-annual-temperature cutoffs into boreal / temperate / tropical bands, then
 * by precipitation within each band, with the aridity boundary rising from the
 * cool half to the warm half — a discretized nod to the Whittaker diagonal
 * (hotter land needs more rain to escape desert, because evaporative demand is
 * higher). Cold desert (dry boreal/temperate) and hot desert (dry tropical)
 * share one DESERT class; the renderer/CLI palette gives them a single arid hue.
 */

import {
  BIOME_ARID_MAX_PRECIP_COOL,
  BIOME_ARID_MAX_PRECIP_WARM,
  BIOME_BOREAL_MAX_C,
  BIOME_TEMPERATE_FOREST_MIN_PRECIP,
  BIOME_TEMPERATE_MAX_C,
  BIOME_TROPICAL_FOREST_MIN_PRECIP,
  BIOME_TUNDRA_MAX_C,
} from '../constants';
import { cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/**
 * The biome class set — the single source of truth for the `biome` field's
 * integer codes (like `FIELDS` for field names). Insertion order is the class
 * index; the codec stores these exactly and the renderer/CLI palette is keyed by
 * them. Ocean is 0 so a zeroed field reads as all-ocean.
 */
export const BIOMES = {
  ocean: 0,
  tundra: 1,
  taiga: 2,
  grassland: 3,
  temperateForest: 4,
  desert: 5,
  savanna: 6,
  tropicalForest: 7,
} as const;

export type BiomeName = keyof typeof BIOMES;

/** The valid biome codes, for range assertions in tests (the codec asserts a
 *  generic `< 256` categorical bound, not this set). */
export const BIOME_INDICES = Object.values(BIOMES) as readonly number[];

/** Kelvin at 0 °C — the classification's temperature cutoffs are quoted in °C. */
const KELVIN_0C = 273.15;

/**
 * Classify one cell into a biome code from its temperature (K), annual
 * precipitation (kg/m²/yr) and the land/ocean mask. Pure, branch-only (no float
 * tolerance) so it is exactly reproducible. Ocean short-circuits; land walks the
 * temperature bands coldest-first, then precipitation within the band.
 */
export function classifyBiome(tempK: number, precipitation: number, isOcean: boolean): number {
  if (isOcean) return BIOMES.ocean;
  const tempC = tempK - KELVIN_0C;

  if (tempC < BIOME_TUNDRA_MAX_C) return BIOMES.tundra;

  if (tempC < BIOME_BOREAL_MAX_C) {
    // Boreal: dry → cold desert (steppe), otherwise taiga (boreal forest).
    return precipitation < BIOME_ARID_MAX_PRECIP_COOL ? BIOMES.desert : BIOMES.taiga;
  }

  if (tempC < BIOME_TEMPERATE_MAX_C) {
    // Temperate: desert → grassland → forest by precipitation.
    if (precipitation < BIOME_ARID_MAX_PRECIP_COOL) return BIOMES.desert;
    if (precipitation < BIOME_TEMPERATE_FOREST_MIN_PRECIP) return BIOMES.grassland;
    return BIOMES.temperateForest;
  }

  // Tropical/subtropical: the aridity cutoff is higher (warm-air moisture demand),
  // then savanna → rainforest.
  if (precipitation < BIOME_ARID_MAX_PRECIP_WARM) return BIOMES.desert;
  if (precipitation < BIOME_TROPICAL_FOREST_MIN_PRECIP) return BIOMES.savanna;
  return BIOMES.tropicalForest;
}

/**
 * Solve the `biome` field from the current state. Pure; O(cells). A cell is
 * ocean when `elevation < seaLevelM` — the same dynamic land/ocean mask the rest
 * of the climate block keys off, so the rendered biome shoreline follows sea
 * level for free.
 */
export function solveBiome(state: PlanetState): Float32Array {
  const count = cellCount(state.params.gridN);
  const { temperature, precipitation, elevation } = state.fields;
  const seaLevel = state.globals.seaLevelM;
  const biome = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    biome[i] = classifyBiome(temperature[i]!, precipitation[i]!, elevation[i]! < seaLevel);
  }
  return biome;
}

/** Fill the `biome` field from the Whittaker classification. */
export function applyBiome(state: PlanetState): PlanetState {
  const biome = solveBiome(state);
  return { ...state, fields: { ...state.fields, biome } };
}

export const biomeSystem: System = {
  name: 'biome',
  apply: (state) => applyBiome(state),
};
