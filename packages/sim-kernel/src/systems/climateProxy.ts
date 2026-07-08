/**
 * Phase 1 precipitation placeholder (#19): a static latitude-band precipitation
 * proxy. It is filled once at state creation and read by erosion (#19) as the
 * only precipitation signal until Phase 3 moisture transport (#32) computes real
 * precipitation and RETIRES this module.
 *
 * Temperature is no longer here: the Phase 3 zonal energy-balance model (#30,
 * `systems/energyBalance.ts`) owns `temperature`, replacing the Phase 0/1
 * latitude + lapse-rate placeholder that used to live in this file.
 */

import {
  PRECIP_FLOOR,
  PRECIP_ITCZ_PEAK,
  PRECIP_ITCZ_WIDTH_DEG,
  PRECIP_STORMTRACK_LAT_DEG,
  PRECIP_STORMTRACK_PEAK,
  PRECIP_STORMTRACK_WIDTH_DEG,
} from '../constants';
import { cellCenterTable, cellCount } from '../grid';
import type { PlanetState } from '../state';

/** Annual precipitation for a latitude, kg/m^2/yr. Pure function of |lat|. */
export function precipitationForLatitude(latDeg: number): number {
  const a = Math.abs(latDeg);
  const itcz = PRECIP_ITCZ_PEAK * Math.exp(-((a / PRECIP_ITCZ_WIDTH_DEG) ** 2));
  const storm =
    PRECIP_STORMTRACK_PEAK *
    Math.exp(-(((a - PRECIP_STORMTRACK_LAT_DEG) / PRECIP_STORMTRACK_WIDTH_DEG) ** 2));
  return PRECIP_FLOOR + itcz + storm;
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
