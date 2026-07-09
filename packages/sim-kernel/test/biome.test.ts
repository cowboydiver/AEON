import { describe, expect, it } from 'vitest';
import { cellCount } from '../src/grid';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import { BIOMES, BIOME_INDICES, classifyBiome, solveBiome } from '../src/systems/biome';
import { solveEnergyBalance } from '../src/systems/energyBalance';

/**
 * Whittaker biome classification (#35). `biome` is a categorical field: an
 * exact small-integer class per cell from a lookup over (temperature,
 * precipitation), with ocean its own class. The tests pin the Whittaker
 * directional sanity (colder → tundra, wetter → forest, hot+dry → desert,
 * hot+wet → tropical forest), the categorical/exactness contract the codec and
 * GPU rely on, and purity/determinism.
 */

const SEEDS = [1, 42, 1337] as const;
const C = 273.15; // 0 °C in K

function stepped(seed: number, n: number, gridN = 32): PlanetState {
  const params = createPlanetParams({ seed, gridN });
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

describe('biome: Whittaker classification (#35)', () => {
  it('ocean is its own class regardless of the (T, precip) point', () => {
    // A warm, wet ocean cell is OCEAN, not tropical forest — the sea mask wins.
    expect(classifyBiome(300, 3000, true)).toBe(BIOMES.ocean);
    expect(classifyBiome(250, 0, true)).toBe(BIOMES.ocean);
  });

  it('colder land trends tundra → taiga → temperate → tropical forest (wet column)', () => {
    const wet = 2000; // wet enough that every warm-enough band is forested
    expect(classifyBiome(C - 10, wet, false)).toBe(BIOMES.tundra);
    expect(classifyBiome(C + 3, wet, false)).toBe(BIOMES.taiga);
    expect(classifyBiome(C + 12, wet, false)).toBe(BIOMES.temperateForest);
    expect(classifyBiome(C + 26, wet, false)).toBe(BIOMES.tropicalForest);
  });

  it('the temperate band splits desert → grassland → forest by precipitation', () => {
    const temperate = C + 12;
    expect(classifyBiome(temperate, 100, false)).toBe(BIOMES.desert);
    expect(classifyBiome(temperate, 400, false)).toBe(BIOMES.grassland);
    expect(classifyBiome(temperate, 1200, false)).toBe(BIOMES.temperateForest);
  });

  it('the tropical band splits desert → savanna → rainforest by precipitation', () => {
    const tropical = C + 26;
    expect(classifyBiome(tropical, 100, false)).toBe(BIOMES.desert);
    expect(classifyBiome(tropical, 800, false)).toBe(BIOMES.savanna);
    expect(classifyBiome(tropical, 3000, false)).toBe(BIOMES.tropicalForest);
  });

  it('the aridity boundary rises with warmth (Whittaker diagonal)', () => {
    // 300 kg/m²/yr is above the cool arid cutoff (200) but below the warm one
    // (400): grassland when temperate, still desert when hot — warm air needs
    // more rain to escape aridity.
    const pMid = 300;
    expect(classifyBiome(C + 12, pMid, false)).toBe(BIOMES.grassland);
    expect(classifyBiome(C + 26, pMid, false)).toBe(BIOMES.desert);
  });

  it('a cold-dry boreal cell is desert (cold steppe), not taiga', () => {
    expect(classifyBiome(C + 3, 100, false)).toBe(BIOMES.desert);
    expect(classifyBiome(C + 3, 800, false)).toBe(BIOMES.taiga);
  });

  it('every classification is an exact integer in the declared class set', () => {
    for (const t of [180, 250, 273, 285, 300, 330]) {
      for (const p of [0, 150, 300, 700, 1600, 5000]) {
        for (const ocean of [false, true]) {
          const b = classifyBiome(t, p, ocean);
          expect(Number.isInteger(b)).toBe(true);
          expect(BIOME_INDICES).toContain(b);
        }
      }
    }
  });
});

describe('biome: field solve over a real planet (#35)', () => {
  it('classifies every cell into the valid range, ocean where below sea level', () => {
    const s = stepped(42, 10, 32);
    const biome = solveBiome(s);
    const count = cellCount(s.params.gridN);
    const { elevation } = s.fields;
    const seaLevel = s.globals.seaLevelM;
    for (let i = 0; i < count; i++) {
      expect(BIOME_INDICES).toContain(biome[i]!);
      // The ocean class exactly tracks the sea-level land/ocean mask.
      const isOcean = elevation[i]! < seaLevel;
      expect(biome[i] === BIOMES.ocean).toBe(isOcean);
    }
  });

  it('a real planet carries several distinct land biomes (not one flat class)', () => {
    const s = stepped(42, 10, 32);
    const biome = solveBiome(s);
    const land = new Set<number>();
    for (const b of biome) if (b !== BIOMES.ocean) land.add(b);
    expect(land.size).toBeGreaterThanOrEqual(3);
  });

  it('is a pure function of state: re-solving yields bit-identical biomes', () => {
    const s = stepped(1337, 10, 32);
    const a = solveBiome(s);
    const b = solveBiome(s);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
  });

  it('runs last and never disturbs the closed energy balance', () => {
    // biome writes only the biome field; temperature (and its balance) is intact.
    const s = stepped(42, 10, 32);
    expect(Math.abs(solveEnergyBalance(s).netTopFlux)).toBeLessThan(1e-6);
  });

  it('populates biome at t=0 (a fast diagnostic, run at init)', () => {
    for (const seed of SEEDS) {
      const s = createInitialState(createPlanetParams({ seed, gridN: 32 }));
      const anyLand = s.fields.biome.some((b) => b !== BIOMES.ocean);
      expect(anyLand, `seed ${seed}`).toBe(true);
    }
  });
});
