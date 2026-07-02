/**
 * Phase 1 climate placeholder (#19): a latitude-band precipitation proxy and
 * a per-step temperature refresh. Real moisture transport, wind bands and
 * energy balance arrive in Phase 3 and REPLACE this module — nothing here is
 * physics, it is the minimum climate needed to drive erosion and keep the
 * temperature field honest as mountains move.
 */

import {
  EQUATOR_POLE_TEMPERATURE_DROP_K,
  LAPSE_RATE_K_PER_M,
  MEAN_SIN2_LATITUDE,
  MEAN_SURFACE_TEMPERATURE_K,
  PRECIP_FLOOR,
  PRECIP_ITCZ_PEAK,
  PRECIP_ITCZ_WIDTH_DEG,
  PRECIP_STORMTRACK_LAT_DEG,
  PRECIP_STORMTRACK_PEAK,
  PRECIP_STORMTRACK_WIDTH_DEG,
} from '../constants';
import { cellCenterTable, cellCount } from '../grid';
import type { PlanetState } from '../state';
import type { System } from '../step';

/** Annual precipitation for a latitude, kg/m^2/yr. Pure function of |lat|. */
export function precipitationForLatitude(latDeg: number): number {
  const a = Math.abs(latDeg);
  const itcz = PRECIP_ITCZ_PEAK * Math.exp(-((a / PRECIP_ITCZ_WIDTH_DEG) ** 2));
  const storm =
    PRECIP_STORMTRACK_PEAK *
    Math.exp(-(((a - PRECIP_STORMTRACK_LAT_DEG) / PRECIP_STORMTRACK_WIDTH_DEG) ** 2));
  return PRECIP_FLOOR + itcz + storm;
}

/** Latitude + lapse-rate temperature, K (the Phase 0 placeholder formula). */
export function temperatureFor(sinLat: number, elevation: number): number {
  const s = Math.max(-1, Math.min(1, sinLat));
  return (
    MEAN_SURFACE_TEMPERATURE_K +
    EQUATOR_POLE_TEMPERATURE_DROP_K * (MEAN_SIN2_LATITUDE - s * s) -
    LAPSE_RATE_K_PER_M * Math.max(0, elevation)
  );
}

/** Fill the static precipitation proxy; run once at state creation. */
export function applyPrecipitationProxy(state: PlanetState): PlanetState {
  const N = state.params.gridN;
  const count = cellCount(N);
  const centers = cellCenterTable(N);
  const precipitation = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const latDeg = (Math.asin(Math.max(-1, Math.min(1, centers[i * 3 + 1]!))) * 180) / Math.PI;
    precipitation[i] = precipitationForLatitude(latDeg);
  }
  return { ...state, fields: { ...state.fields, precipitation } };
}

/**
 * Per-step temperature refresh: same formula as the initial terrain pass but
 * against the CURRENT elevation, so mountain belts stay cold as they drift
 * and erode. Precipitation is latitude-only and never changes in Phase 1.
 */
export const climateProxySystem: System = {
  name: 'climateProxy',
  apply: (state) => {
    const N = state.params.gridN;
    const count = cellCount(N);
    const centers = cellCenterTable(N);
    const elevation = state.fields.elevation;
    const temperature = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      temperature[i] = temperatureFor(centers[i * 3 + 1]!, elevation[i]!);
    }
    return { ...state, fields: { ...state.fields, temperature } };
  },
};
