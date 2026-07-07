/**
 * Continental-shape and dispersal metrics (#60/#67 measurement harness).
 *
 * The #59/#60/#61/#66 passes measured every candidate against the same
 * numbers; this module makes that harness a durable part of sim-cli instead
 * of scratch tooling. Per keyframe:
 *
 *  - maxPlateFrac: largest plate's share of all cells (dispersal — a
 *    keyframe is "dispersed" when this is < 0.6);
 *  - contFrac: continental crust as a fraction of the sphere;
 *  - contComponents: connected components of crustType==1 under 4-adjacency
 *    (shape fragmentation — lace scores high);
 *  - largestCompFrac: the largest component's share of continental AREA
 *    (coherence — the #67 acceptance metric, ↑ from the ~0.11 baseline);
 *  - edgeToArea: continent-ocean 4-adjacent pairs per continental cell
 *    (coastline raggedness, ↓).
 *
 * The summary aggregates them the way the findings tables do: dispersed
 * fraction overall and per Gyr bucket, land min/max, the longest >85%
 * monopoly window, and the shape metrics averaged over keyframes past 1 Gyr
 * (early keyframes still remember the initial partition and would flatter
 * every candidate).
 */

import { cellCount, neighborTable, type Keyframe } from 'sim-kernel';

export interface KeyframeMetrics {
  timeYears: number;
  landFrac: number;
  maxPlateFrac: number;
  contFrac: number;
  contComponents: number;
  largestCompFrac: number;
  edgeToArea: number;
}

/** Threshold below which a keyframe counts as dispersed (findings tables). */
export const DISPERSED_MAX_PLATE_FRAC = 0.6;

/** Threshold above which a keyframe counts as a monopoly (findings tables). */
export const MONOPOLY_MAX_PLATE_FRAC = 0.85;

/** Shape metrics start counting after this time (initial-partition memory). */
export const SHAPE_METRICS_AFTER_YEARS = 1e9;

export function computeKeyframeMetrics(keyframe: Keyframe, gridN: number): KeyframeMetrics {
  const count = cellCount(gridN);
  const nbTable = neighborTable(gridN);
  const { plateId, crustType, elevation } = keyframe.fields;

  const plateCells = new Map<number, number>();
  let land = 0;
  let cont = 0;
  let edges = 0;
  for (let i = 0; i < count; i++) {
    const p = plateId[i]!;
    plateCells.set(p, (plateCells.get(p) ?? 0) + 1);
    if (elevation[i]! >= 0) land++;
    if (crustType[i] === 1) {
      cont++;
      for (let k = 0; k < 4; k++) {
        if (crustType[nbTable[i * 4 + k]!] !== 1) edges++;
      }
    }
  }
  let maxPlate = 0;
  for (const c of plateCells.values()) if (c > maxPlate) maxPlate = c;

  // Connected components of continental crust, iterative BFS (a deep-time
  // supercontinent at N=128 would overflow a recursive flood fill).
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let components = 0;
  let largest = 0;
  for (let i = 0; i < count; i++) {
    if (crustType[i] !== 1 || seen[i]) continue;
    components++;
    let size = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    while (head < tail) {
      const c = queue[head++]!;
      size++;
      for (let k = 0; k < 4; k++) {
        const nb = nbTable[c * 4 + k]!;
        if (crustType[nb] === 1 && !seen[nb]) {
          seen[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }
    if (size > largest) largest = size;
  }

  return {
    timeYears: keyframe.timeYears,
    landFrac: land / count,
    maxPlateFrac: maxPlate / count,
    contFrac: cont / count,
    contComponents: components,
    largestCompFrac: cont > 0 ? largest / cont : 0,
    edgeToArea: cont > 0 ? edges / cont : 0,
  };
}

/** Format the end-of-run summary block the findings tables are built from. */
export function summarizeMetrics(
  series: readonly KeyframeMetrics[],
  lastEventYears: number | undefined,
): string {
  const lines: string[] = [];
  const n = series.length;
  if (n === 0) return 'metrics: no keyframes\n';

  const dispersed = series.filter((m) => m.maxPlateFrac < DISPERSED_MAX_PLATE_FRAC).length;
  let landMin = Infinity;
  let landMax = -Infinity;
  for (const m of series) {
    if (m.landFrac < landMin) landMin = m.landFrac;
    if (m.landFrac > landMax) landMax = m.landFrac;
  }

  // Longest consecutive monopoly window, reported in sim time.
  let monopolyRun = 0;
  let monopolyStart = -1;
  let longestMonopolyYears = 0;
  for (let i = 0; i < n; i++) {
    if (series[i]!.maxPlateFrac > MONOPOLY_MAX_PLATE_FRAC) {
      if (monopolyStart === -1) monopolyStart = i;
      monopolyRun = series[i]!.timeYears - series[monopolyStart]!.timeYears;
      if (monopolyRun > longestMonopolyYears) longestMonopolyYears = monopolyRun;
    } else {
      monopolyStart = -1;
    }
  }

  // Per-Gyr dispersal buckets.
  const bucketTotals: number[] = [];
  const bucketDispersed: number[] = [];
  for (const m of series) {
    const b = Math.min(Math.floor(m.timeYears / 1e9), 8);
    bucketTotals[b] = (bucketTotals[b] ?? 0) + 1;
    bucketDispersed[b] = (bucketDispersed[b] ?? 0) + (m.maxPlateFrac < DISPERSED_MAX_PLATE_FRAC ? 1 : 0);
  }

  // Shape metrics past the settling window.
  const late = series.filter((m) => m.timeYears >= SHAPE_METRICS_AFTER_YEARS);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const meanComponents = mean(late.map((m) => m.contComponents));
  const meanLargest = mean(late.map((m) => m.largestCompFrac));
  const meanEdge = mean(late.map((m) => m.edgeToArea));
  const meanCont = mean(late.map((m) => m.contFrac));
  const final = series[n - 1]!;

  lines.push(
    `metrics: dispersed ${((dispersed / n) * 100).toFixed(1)}% of ${n} keyframes` +
      ` (max plate < ${DISPERSED_MAX_PLATE_FRAC})` +
      `; per-Gyr ${bucketTotals
        .map((t, b) => ((bucketDispersed[b] ?? 0) / t).toFixed(2))
        .join('/')}`,
  );
  lines.push(
    `metrics: land min ${(landMin * 100).toFixed(1)}% max ${(landMax * 100).toFixed(1)}%` +
      `; longest >${MONOPOLY_MAX_PLATE_FRAC * 100}% monopoly window ${(longestMonopolyYears / 1e6).toFixed(0)} Myr` +
      (lastEventYears !== undefined
        ? `; last tectonic event ${(lastEventYears / 1e6).toFixed(0)} Myr`
        : ''),
  );
  lines.push(
    `metrics: shape past ${SHAPE_METRICS_AFTER_YEARS / 1e9} Gyr (${late.length} keyframes):` +
      ` cont components ${meanComponents.toFixed(0)}` +
      `, largest comp ${meanLargest.toFixed(3)} of cont area` +
      `, edge/area ${meanEdge.toFixed(3)}` +
      `, cont crust ${meanCont.toFixed(3)} of sphere`,
  );
  lines.push(
    `metrics: final frame: cont components ${final.contComponents}` +
      `, largest comp ${final.largestCompFrac.toFixed(3)}` +
      `, edge/area ${final.edgeToArea.toFixed(3)}` +
      `, land ${(final.landFrac * 100).toFixed(1)}%`,
  );
  return lines.join('\n');
}
