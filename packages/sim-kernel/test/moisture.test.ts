import { describe, expect, it } from 'vitest';
import {
  MOIST_EVAP_FACTOR_MAX,
  MOIST_EVAP_FACTOR_MIN,
  MOIST_EVAP_REF_TEMP_K,
  MOIST_RELAX_SWEEPS_MIN,
} from '../src/constants';
import { FIELD_NAMES, type Fields } from '../src/fields';
import { cellCenterDirection, cellCount, directionToIndex } from '../src/grid';
import { createRng } from '../src/rng';
import { createInitialState, createPlanetParams, type PlanetState } from '../src/state';
import { step, type SimContext } from '../src/step';
import {
  applyMoisture,
  evaporationFactor,
  relaxSweepCount,
  solveMoisture,
} from '../src/systems/moisture';

/**
 * Moisture transport + orographic precipitation invariants (#32). The headline
 * ones: water mass is conserved across evaporate/transport/precipitate
 * (Σ precipitation = Σ evaporation), and rain shadows EMERGE from the transport
 * — windward slopes wet, lee slopes dry — rather than being painted on. The
 * rest are source/directional-physics and bounds/determinism checks.
 */

const SEEDS = [1, 42, 1337] as const;

function stepped(seed: number, n: number, gridN = 32): PlanetState {
  const params = createPlanetParams({ seed, gridN });
  const ctx: SimContext = { rng: createRng(params.seed).fork('sim') };
  let s = createInitialState(params);
  for (let i = 0; i < n; i++) s = step(s, params.stepYears, ctx);
  return s;
}

/** Kahan-summed field total — the precip/evap sums span a wide magnitude range. */
function kahanSum(a: ArrayLike<number>): number {
  let sum = 0;
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    const y = a[i]! - c;
    const t = sum + y;
    c = t - sum - y;
    sum = t;
  }
  return sum;
}

/**
 * A controlled world: ocean (below datum) everywhere except a Gaussian mountain
 * ridge running N–S at longitude 0 (the +X meridian), a uniform zonal wind, and
 * a uniform temperature. Everything the moisture solve reads is set explicitly,
 * so any precipitation structure is the transport's doing, not the climate's.
 */
function ridgeWorld(gridN: number, windUms: number, ridgePeakM = 3500): PlanetState {
  const params = createPlanetParams({ seed: 7, gridN });
  const count = cellCount(gridN);
  const fields = Object.fromEntries(
    FIELD_NAMES.map((n) => [n, new Float32Array(count)]),
  ) as Fields;
  for (let i = 0; i < count; i++) {
    const d = cellCenterDirection(i, gridN);
    const lon = Math.atan2(d[2], d[0]); // 0 at +X, the ridge crest meridian
    const ridge = ridgePeakM * Math.exp(-((lon / 0.25) ** 2));
    fields.elevation[i] = ridge > 50 ? ridge : -3000; // emergent ridge, else ocean
    fields.temperature[i] = 288;
    fields.windU[i] = windUms;
  }
  return {
    timeYears: 0,
    params,
    globals: {
      landFraction: 0,
      co2: params.initialCo2Ppm,
      meanTemperatureK: 288,
      seaLevelM: 0,
      waterInventoryM: 0,
    },
    fields,
    plates: [],
    events: [],
    wilson: { contactSince: {} },
  };
}

/** Precipitation sampled at an equatorial longitude (degrees, + = east of crest). */
function precipAtLon(state: PlanetState, precip: Float32Array, deg: number): number {
  const lon = (deg * Math.PI) / 180;
  const idx = directionToIndex([Math.cos(lon), 0, Math.sin(lon)], state.params.gridN);
  return precip[idx]!;
}

describe('moisture: evaporation source (#32)', () => {
  it('evaporation factor rises with temperature and clamps at both ends', () => {
    expect(evaporationFactor(MOIST_EVAP_REF_TEMP_K)).toBeCloseTo(1, 6);
    expect(evaporationFactor(300)).toBeGreaterThan(evaporationFactor(288));
    expect(evaporationFactor(288)).toBeGreaterThan(evaporationFactor(270));
    // Far outside the reference the exponential is clamped to the codec-safe band.
    expect(evaporationFactor(500)).toBe(MOIST_EVAP_FACTOR_MAX);
    expect(evaporationFactor(150)).toBe(MOIST_EVAP_FACTOR_MIN);
  });

  it('an ocean-free world produces no precipitation (land has no source)', () => {
    // Every cell above the datum: nothing evaporates, so nothing precipitates —
    // continents are watered only by moisture carried in from the sea.
    const s = ridgeWorld(32, 8, 0); // ridgePeak 0 ⇒ all ocean; override to all land
    const land = s.fields.elevation.slice().fill(500);
    const dry = { ...s, fields: { ...s.fields, elevation: land } };
    const sol = solveMoisture(dry);
    expect(sol.totalEvaporation).toBe(0);
    for (const p of sol.precipitation) expect(p).toBe(0);
  });

  it('precipitation is nonzero and Earth-like in the mean when oceans exist', () => {
    for (const seed of SEEDS) {
      const sol = solveMoisture(stepped(seed, 10, 32));
      const mean = kahanSum(sol.precipitation) / sol.precipitation.length;
      expect(mean, `seed ${seed}`).toBeGreaterThan(400); // mm/yr, global mean
      expect(mean, `seed ${seed}`).toBeLessThan(2000);
    }
  });
});

describe('moisture: water mass conservation (#32)', () => {
  it('Σ precipitation equals Σ evaporation to float tolerance (the closure)', () => {
    for (const seed of SEEDS) {
      for (const gridN of [16, 32]) {
        const sol = solveMoisture(stepped(seed, 10, gridN));
        // The solve closes the budget exactly in f64.
        expect(Math.abs(sol.totalPrecipitation - sol.totalEvaporation)).toBeLessThan(
          sol.totalEvaporation * 1e-9,
        );
        // And the field itself sums to the evaporation total within f32 rounding.
        const fieldSum = kahanSum(sol.precipitation);
        expect(Math.abs(fieldSum - sol.totalEvaporation), `seed ${seed} N=${gridN}`).toBeLessThan(
          sol.totalEvaporation * 1e-4,
        );
      }
    }
  });

  it('conserves water regardless of the wind pattern (transport only moves it)', () => {
    // Two very different winds over the same ridge world evaporate the same total
    // (evaporation depends on the ocean/temperature only), and both close to it.
    const calm = solveMoisture(ridgeWorld(48, 2));
    const gale = solveMoisture(ridgeWorld(48, 12));
    expect(calm.totalEvaporation).toBeCloseTo(gale.totalEvaporation, 3);
    expect(Math.abs(calm.totalPrecipitation - calm.totalEvaporation)).toBeLessThan(
      calm.totalEvaporation * 1e-9,
    );
    expect(Math.abs(gale.totalPrecipitation - gale.totalEvaporation)).toBeLessThan(
      gale.totalEvaporation * 1e-9,
    );
  });
});

describe('moisture: rain shadows emerge from transport (#32, the bar)', () => {
  it('windward slope is wet, lee slope is dry across a ridge in a zonal wind', () => {
    const s = ridgeWorld(64, 8); // wind blows east (+lon), so −lon is windward
    const p = solveMoisture(s).precipitation;
    const windwardFoot = precipAtLon(s, p, -25);
    const windwardMid = precipAtLon(s, p, -18);
    const lee = precipAtLon(s, p, 18); // mirror-elevation lee slope
    const leeFoot = precipAtLon(s, p, 25);
    // Windward flank rains hard and dries out as the air climbs...
    expect(windwardFoot).toBeGreaterThan(windwardMid);
    expect(windwardMid).toBeGreaterThan(200);
    // ...leaving the lee (same elevations, other side) in the wrung-out air.
    expect(lee).toBeLessThan(windwardMid * 0.2);
    expect(leeFoot).toBeLessThan(windwardFoot * 0.2);
  });

  it('reversing the wind flips which slope is in the rain shadow', () => {
    const east = ridgeWorld(64, 8);
    const west = ridgeWorld(64, -8);
    const pe = solveMoisture(east).precipitation;
    const pw = solveMoisture(west).precipitation;
    // East wind: west (−lon) flank wet, east (+lon) dry.
    expect(precipAtLon(east, pe, -18)).toBeGreaterThan(precipAtLon(east, pe, 18) * 3);
    // West wind: mirror image.
    expect(precipAtLon(west, pw, 18)).toBeGreaterThan(precipAtLon(west, pw, -18) * 3);
  });

  it('the ridge collects far more rain on its windward half than its lee half', () => {
    // The rain shadow as an integral over the whole ridge, not point samples:
    // sum precipitation over every emergent (land) cell, split by which side of
    // the crest meridian it sits on. The windward half must dominate.
    const gridN = 64;
    const s = ridgeWorld(gridN, 8); // wind east ⇒ west (lon < 0) is windward
    const p = solveMoisture(s).precipitation;
    let windward = 0;
    let lee = 0;
    for (let i = 0; i < cellCount(gridN); i++) {
      if (s.fields.elevation[i]! <= 0) continue; // land only
      const d = cellCenterDirection(i, gridN);
      const lon = Math.atan2(d[2], d[0]);
      if (lon < 0) windward += p[i]!;
      else lee += p[i]!;
    }
    expect(windward).toBeGreaterThan(lee * 5);
  });

  it('is terrain-coupled on the real golden planets, not a painted latitude proxy', () => {
    // The retired proxy was a function of latitude alone: constant along every
    // parallel. Moisture transport makes precipitation vary strongly with
    // longitude at the SAME latitude (ocean vs interior, windward vs lee). Within
    // a narrow mid-latitude band a latitude proxy would show ~zero spread; here
    // the coefficient of variation is large — the field genuinely emerges.
    for (const seed of SEEDS) {
      const s = stepped(seed, 10, 64);
      const p = s.fields.precipitation;
      let sum = 0;
      let n = 0;
      const vals: number[] = [];
      for (let i = 0; i < cellCount(64); i++) {
        const sinLat = Math.abs(cellCenterDirection(i, 64)[1]);
        if (sinLat < 0.3 || sinLat > 0.45) continue; // a thin off-equatorial ring
        vals.push(p[i]!);
        sum += p[i]!;
        n++;
      }
      const mean = sum / n;
      let variance = 0;
      for (const v of vals) variance += (v - mean) ** 2;
      const cv = Math.sqrt(variance / n) / mean;
      expect(cv, `seed ${seed} longitudinal CV in a mid-latitude ring`).toBeGreaterThan(0.5);
    }
  });
});

describe('moisture: precipitate by saturation (#32)', () => {
  it('cold air sheds moisture sooner — a cold continent dries faster inland than a warm one', () => {
    // Ocean west of the crest meridian at a fixed 288 K (equal evaporation for
    // both cases); flat land to the east, wind blowing onto it. The ONLY
    // difference is the land temperature, so any difference in the inland
    // precipitation profile is the saturation term (cold air, capacity < 1,
    // rains out at a higher λ) — the "precipitate by saturation" pathway.
    const gridN = 64;
    function flatContinent(landTempK: number): PlanetState {
      const s = ridgeWorld(gridN, 8, 0); // all ocean, uniform 288 K, east wind
      const elevation = s.fields.elevation.slice();
      const temperature = s.fields.temperature.slice(); // ocean stays 288 K
      for (let i = 0; i < cellCount(gridN); i++) {
        const d = cellCenterDirection(i, gridN);
        if (Math.atan2(d[2], d[0]) > 0) {
          elevation[i] = 150; // flat land east of the meridian
          temperature[i] = landTempK;
        }
      }
      return { ...s, fields: { ...s.fields, elevation, temperature } };
    }
    const warmState = flatContinent(288); // capacity 1 ⇒ saturation term 0
    const coldState = flatContinent(255); // capacity < 1 ⇒ saturation term > 0
    const warm = solveMoisture(warmState).precipitation;
    const cold = solveMoisture(coldState).precipitation;
    // Cold land wrings the sea air out nearer the coast: wetter just inland...
    expect(precipAtLon(coldState, cold, 3)).toBeGreaterThan(precipAtLon(warmState, warm, 3));
    // ...and correspondingly drier deep inland (less moisture survives the trip).
    expect(precipAtLon(coldState, cold, 12)).toBeLessThan(precipAtLon(warmState, warm, 12));
  });
});

describe('moisture: continentality — interiors dry out downwind (#32)', () => {
  it('a flat continent gets drier with distance inland from the windward coast', () => {
    // Ocean west of longitude 0, flat low land (no orography) to the east, wind
    // blowing east: precipitation must fall off inland as the sea air rains out.
    const gridN = 64;
    const s = ridgeWorld(gridN, 8, 0); // no ridge; ridgeWorld makes it all ocean
    const elevation = s.fields.elevation.slice();
    for (let i = 0; i < cellCount(gridN); i++) {
      const d = cellCenterDirection(i, gridN);
      const lon = Math.atan2(d[2], d[0]);
      if (lon > 0) elevation[i] = 150; // flat land east of the +X meridian
    }
    const land = { ...s, fields: { ...s.fields, elevation } };
    const p = solveMoisture(land).precipitation;
    // Sample well within the moisture's reach (the fixed sweep count bounds the
    // fetch; far interiors are bone dry at exactly 0 — physical, but nothing to
    // order). At N=64 the fetch is ~12 cells, so stay inside ~13°.
    const coast = precipAtLon(land, p, 3);
    const inland = precipAtLon(land, p, 8);
    const deepInland = precipAtLon(land, p, 12);
    expect(coast).toBeGreaterThan(inland);
    expect(inland).toBeGreaterThan(deepInland);
    expect(deepInland).toBeGreaterThan(0); // still reached, just drier
  });
});

describe('moisture: bounds, sweeps & determinism (#32)', () => {
  it('precipitation is finite and non-negative everywhere', () => {
    for (const seed of SEEDS) {
      const p = solveMoisture(stepped(seed, 10, 32)).precipitation;
      for (const v of p) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('relaxation sweep count scales with grid resolution and has a floor', () => {
    expect(relaxSweepCount(128)).toBe(24);
    expect(relaxSweepCount(64)).toBe(12);
    expect(relaxSweepCount(16)).toBe(MOIST_RELAX_SWEEPS_MIN); // floored, not 3
    expect(relaxSweepCount(8)).toBe(MOIST_RELAX_SWEEPS_MIN);
    expect(relaxSweepCount(256)).toBe(48); // scales past the reference grid too
  });

  it('is a pure function of state: re-solving yields bit-identical precipitation', () => {
    const s = stepped(1337, 10, 32);
    const a = solveMoisture(s).precipitation;
    const b = solveMoisture(s).precipitation;
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]);
  });
});

describe('moisture: pipeline integration (#32)', () => {
  it('the step pipeline fills a non-trivial precipitation field erosion can read', () => {
    const s = stepped(42, 3, 32);
    const p = s.fields.precipitation;
    let min = Infinity;
    let max = -Infinity;
    for (const v of p) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    // Real spatial structure (a static proxy this is not): a wide wet/dry spread.
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(min + 500);
  });

  it('precipitation evolves over time as winds and topography change', () => {
    const early = stepped(42, 1, 32).fields.precipitation;
    const late = stepped(42, 10, 32).fields.precipitation;
    let changed = 0;
    for (let i = 0; i < early.length; i++) if (Math.abs(early[i]! - late[i]!) > 1) changed++;
    // A dynamic field re-solved every step, not frozen at init.
    expect(changed).toBeGreaterThan(early.length * 0.1);
  });

  it('applyMoisture only rewrites precipitation, leaving other fields untouched', () => {
    const s = stepped(1, 5, 16);
    const out = applyMoisture(s);
    for (const name of FIELD_NAMES) {
      if (name === 'precipitation') continue;
      expect(out.fields[name], name).toBe(s.fields[name]); // same reference, no copy
    }
  });
});
