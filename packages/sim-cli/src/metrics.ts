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
  /**
   * Connected components of emergent LAND (elevation >= the keyframe's
   * dynamic sea level) under 4-adjacency (#84). The crustType metrics above
   * are blind to the block-isostasy founder by design (foundering keeps the
   * crustal ledger intact); the user-visible "tall-island confetti"
   * complaint is about land, so land gets its own shape numbers.
   */
  landComponents: number;
  /** The largest land component's share of land area (#84). */
  largestLandCompFrac: number;
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

  // Land components (#84): same BFS over the emergent-land mask, measured
  // against the keyframe's dynamic sea level (#33) — the mask the viewer
  // actually sees. (landFrac above keeps its historical 0 m-datum definition;
  // the findings tables were computed with it — don't rebaseline.)
  const seaLevel = keyframe.globals.seaLevelM;
  const isLand = (i: number): boolean => elevation[i]! >= seaLevel;
  seen.fill(0);
  let landComponents = 0;
  let largestLand = 0;
  let landCells = 0;
  for (let i = 0; i < count; i++) {
    if (!isLand(i) || seen[i]) continue;
    landComponents++;
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
        if (isLand(nb) && !seen[nb]) {
          seen[nb] = 1;
          queue[tail++] = nb;
        }
      }
    }
    landCells += size;
    if (size > largestLand) largestLand = size;
  }

  return {
    timeYears: keyframe.timeYears,
    landFrac: land / count,
    maxPlateFrac: maxPlate / count,
    contFrac: cont / count,
    contComponents: components,
    largestCompFrac: cont > 0 ? largest / cont : 0,
    edgeToArea: cont > 0 ? edges / cont : 0,
    landComponents,
    largestLandCompFrac: landCells > 0 ? largestLand / landCells : 0,
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

  // Longest consecutive monopoly window, reported in sim time. Convention:
  // the window spans first-to-last monopoly KEYFRAME, so a single monopoly
  // keyframe reports 0 Myr even though the true window could extend up to
  // one keyframe interval either side — matching how the findings tables
  // were computed. Don't "fix" this without re-baselining those tables.
  let monopolyStart = -1;
  let longestMonopolyYears = 0;
  for (let i = 0; i < n; i++) {
    if (series[i]!.maxPlateFrac > MONOPOLY_MAX_PLATE_FRAC) {
      if (monopolyStart === -1) monopolyStart = i;
      const run = series[i]!.timeYears - series[monopolyStart]!.timeYears;
      if (run > longestMonopolyYears) longestMonopolyYears = run;
    } else {
      monopolyStart = -1;
    }
  }

  // Per-Gyr dispersal buckets. Buckets clamp at index 8: a run past 9 Gyr
  // aggregates everything beyond into the last printed bucket (runs are
  // 4.5 Gyr in practice; the clamp only bounds the output width).
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
  // A run shorter than the settling window has no shape sample at all —
  // print n/a rather than zeros that read like a catastrophic measurement.
  if (late.length === 0) {
    lines.push(
      `metrics: shape past ${SHAPE_METRICS_AFTER_YEARS / 1e9} Gyr: n/a (run too short — 0 keyframes past the settling window)`,
    );
  } else {
    lines.push(
      `metrics: shape past ${SHAPE_METRICS_AFTER_YEARS / 1e9} Gyr (${late.length} keyframes):` +
        ` cont components ${mean(late.map((m) => m.contComponents)).toFixed(0)}` +
        `, largest comp ${mean(late.map((m) => m.largestCompFrac)).toFixed(3)} of cont area` +
        `, edge/area ${mean(late.map((m) => m.edgeToArea)).toFixed(3)}` +
        `, cont crust ${mean(late.map((m) => m.contFrac)).toFixed(3)} of sphere`,
    );
    lines.push(
      `metrics: land shape past ${SHAPE_METRICS_AFTER_YEARS / 1e9} Gyr:` +
        ` land components ${mean(late.map((m) => m.landComponents)).toFixed(0)}` +
        `, largest land comp ${mean(late.map((m) => m.largestLandCompFrac)).toFixed(3)} of land area`,
    );
  }
  lines.push(
    `metrics: final frame: cont components ${final.contComponents}` +
      `, largest comp ${final.largestCompFrac.toFixed(3)}` +
      `, edge/area ${final.edgeToArea.toFixed(3)}` +
      `, land ${(final.landFrac * 100).toFixed(1)}%` +
      `, land components ${final.landComponents}` +
      `, largest land comp ${final.largestLandCompFrac.toFixed(3)}`,
  );
  return lines.join('\n');
}

/** At most this many per-keyframe rows in a paired A/B table (evenly thinned). */
const AB_MAX_ROWS = 16;

/**
 * Format the paired branched-A/B comparison (#84): both arms are bit-identical
 * until `branchYears` (the flag-on arm's onset), so per-keyframe "off → on"
 * deltas in the window right after the branch are the mechanism's direct
 * effect. The whole-history on/off comparison in ISSUE_84_PROTOTYPE_FINDINGS
 * could not separate mechanism from chaotic trajectory divergence — this can,
 * for as long as the arms stay comparable (the deltas themselves compound, so
 * trust the early window most and treat deep-window rows as trajectory again).
 */
export function summarizePairedMetrics(
  off: readonly KeyframeMetrics[],
  on: readonly KeyframeMetrics[],
  branchYears: number,
): string {
  if (off.length !== on.length) {
    // Cadence is params-derived and the arms share params except the flag —
    // a length mismatch means the instrument itself is broken.
    return `ab: keyframe count mismatch (off ${off.length}, on ${on.length}) — arms are not paired`;
  }
  const rows: string[] = [];
  const window: Array<{ off: KeyframeMetrics; on: KeyframeMetrics }> = [];
  for (let i = 0; i < off.length; i++) {
    if (off[i]!.timeYears >= branchYears) window.push({ off: off[i]!, on: on[i]! });
  }
  if (window.length === 0) return 'ab: no keyframes at or after the branch point';

  const stride = Math.max(1, Math.ceil(window.length / AB_MAX_ROWS));
  const fmt = (o: number, n2: number, digits: number): string =>
    `${o.toFixed(digits)} -> ${n2.toFixed(digits)}`;
  rows.push(
    ['t', 'land comps', 'largest land comp', 'land%'].map((h, i) => (i === 0 ? h.padStart(10) : h.padStart(22))).join('  '),
  );
  for (let i = 0; i < window.length; i++) {
    if (i % stride !== 0 && i !== window.length - 1) continue;
    const { off: a, on: b } = window[i]!;
    rows.push(
      [
        `${(a.timeYears / 1e6).toFixed(0).padStart(7)} Myr`,
        fmt(a.landComponents, b.landComponents, 0).padStart(22),
        fmt(a.largestLandCompFrac, b.largestLandCompFrac, 3).padStart(22),
        fmt(a.landFrac * 100, b.landFrac * 100, 1).padStart(22),
      ].join('  '),
    );
  }

  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const dComps = mean(window.map((w) => w.on.landComponents - w.off.landComponents));
  const dLargest = mean(window.map((w) => w.on.largestLandCompFrac - w.off.largestLandCompFrac));
  const dLand = mean(window.map((w) => (w.on.landFrac - w.off.landFrac) * 100));
  const minLandOn = Math.min(...window.map((w) => w.on.landFrac * 100));
  rows.push(
    `ab: window means (off -> on, ${window.length} keyframes past ${(branchYears / 1e6).toFixed(0)} Myr):` +
      ` Δ land components ${dComps >= 0 ? '+' : ''}${dComps.toFixed(1)}` +
      `, Δ largest land comp ${dLargest >= 0 ? '+' : ''}${dLargest.toFixed(3)}` +
      `, Δ land ${dLand >= 0 ? '+' : ''}${dLand.toFixed(2)} pts` +
      `; land min (on) ${minLandOn.toFixed(1)}%`,
  );
  return rows.join('\n');
}
