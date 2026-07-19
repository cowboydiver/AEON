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

import {
  ACTIVE_MARGIN_STRESS_M_PER_YR,
  cellCount,
  EVENT_KINDS,
  neighborTable,
  type Keyframe,
  type SimEvent,
} from 'sim-kernel';

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

/**
 * Sea-level/flooding stats per keyframe (the #101 freeboard-calibration
 * harness, promoted from prototype scratch tooling). Everything is measured
 * against the keyframe's DYNAMIC sea level — the kernel's actual coastline —
 * matching the tables in docs/SEA_LEVEL_DATUM_FINDINGS.md. "Ocean" is a cell
 * strictly below the level; "land" is at-or-above, matching the report's
 * land% convention.
 */
export interface CrustStats {
  timeYears: number;
  seaLevelM: number;
  /** Continental crust as a fraction of the sphere. */
  contFrac: number;
  /** Mean continental elevation minus seaLevelM — what freeboard regulates. */
  meanFreeboardM: number;
  /** Share of continental crust sitting below the sea (Earth: ~25%). */
  submergedContFrac: number;
  /** Share of OCEAN AREA sitting on continental crust (Earth: ~17%). */
  oceanOnContFrac: number;
  /** Ocean cells shallower than SHALLOW_OCEAN_DEPTH_M, as a share of the
   *  SPHERE (Earth's shelf seas: ~7-8%). */
  shallowOceanFrac: number;
  /** Emergent share of the sphere (Earth: ~29%). NOTE: measured against the
   *  dynamic sea level, unlike KeyframeMetrics.landFrac, which keeps its
   *  historical 0 m-datum definition — don't join the two tables on this. */
  landFrac: number;
  /** Minimum elevation — the buoyancy-floor ratchet tripwire (#101): healthy
   *  is trench order (−6..−9 km), not the pre-floor −17 km runaway. */
  minElevationM: number;
}

/** Ocean shallower than this counts as shelf sea in CrustStats. */
export const SHALLOW_OCEAN_DEPTH_M = 500;

export function computeCrustStats(keyframe: Keyframe): CrustStats {
  const { crustType, elevation } = keyframe.fields;
  const count = elevation.length;
  const seaLevelM = keyframe.globals.seaLevelM;
  let cont = 0;
  let contSum = 0;
  let submergedCont = 0;
  let ocean = 0;
  let shallow = 0;
  let minElevation = Infinity;
  for (let i = 0; i < count; i++) {
    const e = elevation[i]!;
    if (e < minElevation) minElevation = e;
    const isCont = crustType[i] === 1;
    if (isCont) {
      cont++;
      contSum += e;
    }
    if (e < seaLevelM) {
      ocean++;
      if (isCont) submergedCont++;
      if (seaLevelM - e < SHALLOW_OCEAN_DEPTH_M) shallow++;
    }
  }
  return {
    timeYears: keyframe.timeYears,
    seaLevelM,
    contFrac: cont / count,
    meanFreeboardM: cont > 0 ? contSum / cont - seaLevelM : 0,
    submergedContFrac: cont > 0 ? submergedCont / cont : 0,
    oceanOnContFrac: ocean > 0 ? submergedCont / ocean : 0,
    shallowOceanFrac: shallow / count,
    landFrac: (count - ocean) / count,
    minElevationM: minElevation,
  };
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
    ['t', 'land comps', 'largest land comp', 'land%', 'cont comps'].map((h, i) => (i === 0 ? h.padStart(10) : h.padStart(22))).join('  '),
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
        fmt(a.contComponents, b.contComponents, 0).padStart(22),
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
  // Crust-map deltas — the #88 (crust fates) and #89 (compact maturation)
  // acceptance axes: the land rows above are blind to crustType by design,
  // and Δ cont crust doubles as the #89 creation-budget check (a gate that
  // STARVES creation shows up as a steadily negative Δ, one that reshapes
  // it holds Δ near zero while cont components fall).
  const dContComps = mean(window.map((w) => w.on.contComponents - w.off.contComponents));
  const dContLargest = mean(window.map((w) => w.on.largestCompFrac - w.off.largestCompFrac));
  const dContFrac = mean(window.map((w) => (w.on.contFrac - w.off.contFrac) * 100));
  rows.push(
    `ab: crust window means:` +
      ` Δ cont components ${dContComps >= 0 ? '+' : ''}${dContComps.toFixed(1)}` +
      `, Δ largest cont comp ${dContLargest >= 0 ? '+' : ''}${dContLargest.toFixed(3)}` +
      `, Δ cont crust ${dContFrac >= 0 ? '+' : ''}${dContFrac.toFixed(2)} pts of sphere`,
  );
  // Net crust production per 100 Myr bucket (#89): the paired difference in
  // how much continental-crust STOCK each arm gained over each 100 Myr of
  // the window — net creation minus consumption, the closest observable to
  // the issue's "arc-crust production totals" without a kernel counter. A
  // gate that merely RESHAPES creation holds these near zero; one that
  // STARVES it goes monotonically negative. Dispersal is paired the same
  // way ("dispersal/liveness unchanged" is an acceptance clause).
  const bucketDeltas: string[] = [];
  for (let start = 0; start + 1 < window.length; ) {
    const t0 = window[start]!.off.timeYears;
    let end = start;
    while (end + 1 < window.length && window[end + 1]!.off.timeYears - t0 <= 100e6) end++;
    if (end === start) {
      start++;
      continue;
    }
    const gOff = (window[end]!.off.contFrac - window[start]!.off.contFrac) * 100;
    const gOn = (window[end]!.on.contFrac - window[start]!.on.contFrac) * 100;
    const d = gOn - gOff;
    bucketDeltas.push(`${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
    start = end;
  }
  const dispersedOff = window.filter((w) => w.off.maxPlateFrac < DISPERSED_MAX_PLATE_FRAC).length;
  const dispersedOn = window.filter((w) => w.on.maxPlateFrac < DISPERSED_MAX_PLATE_FRAC).length;
  rows.push(
    `ab: Δ net crust production per 100 Myr (pts of sphere): ${bucketDeltas.join(' / ')}` +
      `; dispersed in window ${((dispersedOff / window.length) * 100).toFixed(0)}% -> ${((dispersedOn / window.length) * 100).toFixed(0)}%`,
  );
  return rows.join('\n');
}

/* ------------------------------------------------------------------------- *
 * Plate census (Tectonics V2 stage 0, #110; proposal §3/§5).
 *
 * The force-balance scoreboard. The per-plate quantities that need the plate
 * table (speed distribution, ocean/continental ratio, speed–continentality
 * correlation, pole stability) are computed KERNEL-side by `plateCensusSystem`
 * and ride each keyframe's `globals` (keyframes never carry plate records).
 * The field-derivable half lives here: seafloor age over oceanic crust and the
 * plateness (margin-organization) scalar. Enable with sim-cli `--plate-census`,
 * which sets `params.plateCensus`; without it the globals scalars stay 0.
 * ------------------------------------------------------------------------- */

/** Seafloor-age histogram bin width (yr) and count: ten 20-Myr bins spanning
 *  0–200 Myr plus a final ≥200 Myr overflow bin. The §3 target is a roughly
 *  triangular age–area distribution with a ~180–200 Myr ceiling. */
export const SEAFLOOR_AGE_BIN_WIDTH_YR = 20e6;
export const SEAFLOOR_AGE_BIN_COUNT = 11;

/** Fraction of boundary cells forming the "top decile" for the plateness scalar. */
export const PLATENESS_TOP_DECILE = 0.1;

/** Boundary cells carry |boundaryStress| above this (m/yr); interiors are
 *  exactly 0, so any positive epsilon separates them (matches the kernel). */
const BOUNDARY_STRESS_EPSILON = 1e-9;

export interface PlateCensusRow {
  timeYears: number;
  /** Median plate characteristic speed |ω|·R, m/yr (globals; 0 if census off). */
  speedMedianMPerYr: number;
  speedMinMPerYr: number;
  speedMaxMPerYr: number;
  /** Ocean-dominated ÷ continent-dominated mean speed (globals). */
  oceanicContinentalSpeedRatio: number;
  /** Pearson speed-vs-continentality (globals; descriptive, washes to 0 deep-time). */
  speedContinentalityCorr: number;
  /** Pearson speed-vs-slab-attachment (globals) — the Forsyth & Uyeda stage-1
   *  gate variable (#111): positive ⇒ more-slab-attached plates move faster. */
  speedSlabAttachmentCorr: number;
  /** Count-mean cosine between consecutive Euler poles (globals; 1.0 baseline). */
  poleStability: number;
  /** Cumulative #67 margin-consolidation pair-flips since t=0 (globals;
   *  boundary-churn proxy). Differenced between keyframes into a rate below. */
  marginConsolidationFlipsTotal: number;
  /** Mean crustAge over oceanic (crustType 0) cells, yr. NOTE: the current
   *  kernel seeds continental crust at CONTINENTAL_INITIAL_AGE_YEARS (2 Gyr)
   *  and converts continent→ocean at some margins WITHOUT resetting age (only
   *  the fresh-spreading path zeroes it), so a heavy ~2 Gyr tail of
   *  former-continental "oceanic" crust drags the mean far above the genuine
   *  young-seafloor age. The median below is the robust central tendency for
   *  the §3 triangular-distribution target; the mean/max expose the tail. This
   *  contamination is itself a stage-0 baseline finding. */
  seafloorAgeMeanYr: number;
  /** Median crustAge over oceanic cells, yr — robust to the old-continental
   *  tail, the number to compare against the §3 target (mean 60–80 Myr). */
  seafloorAgeMedianYr: number;
  /** Max crustAge over oceanic cells, yr. */
  seafloorAgeMaxYr: number;
  /** Share of total boundary |stress| held by the top-decile stress cells —
   *  the single "margins are organizing" scalar (litho graft). In [decile, 1];
   *  higher = dissipation concentrated at few sharp margins. 0 with no
   *  boundary. */
  plateness: number;
  /** Fractional oceanic AREA per age bin (length SEAFLOOR_AGE_BIN_COUNT; sums
   *  to 1 when any oceanic cell exists, else all 0). */
  ageAreaHistogram: number[];
}

/**
 * Per-keyframe plate census. Pure over the keyframe: the speed/pole scalars are
 * read straight off `globals` (they are 0 unless the run enabled the kernel
 * census); seafloor age and plateness are reduced from `crustType`/`crustAge`/
 * `boundaryStress`.
 */
export function computePlateCensusRow(keyframe: Keyframe): PlateCensusRow {
  const { crustType, crustAge, boundaryStress } = keyframe.fields;
  const count = crustType.length;
  const g = keyframe.globals;

  // Seafloor age + age–area histogram over oceanic crust.
  const histogram = new Array<number>(SEAFLOOR_AGE_BIN_COUNT).fill(0);
  const oceanAges: number[] = [];
  let ageSum = 0;
  let ageMax = 0;
  for (let i = 0; i < count; i++) {
    if (crustType[i] !== 0) continue;
    const age = crustAge[i]!;
    oceanAges.push(age);
    ageSum += age;
    if (age > ageMax) ageMax = age;
    let bin = Math.floor(age / SEAFLOOR_AGE_BIN_WIDTH_YR);
    if (bin < 0) bin = 0;
    if (bin >= SEAFLOOR_AGE_BIN_COUNT) bin = SEAFLOOR_AGE_BIN_COUNT - 1;
    histogram[bin]!++;
  }
  const oceanCells = oceanAges.length;
  let ageMedian = 0;
  if (oceanCells > 0) {
    oceanAges.sort((a, b) => a - b);
    const mid = oceanCells >> 1;
    ageMedian = oceanCells % 2 === 1 ? oceanAges[mid]! : (oceanAges[mid - 1]! + oceanAges[mid]!) / 2;
    for (let b = 0; b < SEAFLOOR_AGE_BIN_COUNT; b++) histogram[b]! /= oceanCells;
  }

  // Plateness: share of total boundary |stress| in the top-decile stress cells.
  const stresses: number[] = [];
  let totalStress = 0;
  for (let i = 0; i < count; i++) {
    const a = Math.abs(boundaryStress[i]!);
    if (a > BOUNDARY_STRESS_EPSILON) {
      stresses.push(a);
      totalStress += a;
    }
  }
  let plateness = 0;
  if (stresses.length > 0 && totalStress > 0) {
    stresses.sort((x, y) => y - x);
    const topN = Math.max(1, Math.floor(stresses.length * PLATENESS_TOP_DECILE));
    let topSum = 0;
    for (let i = 0; i < topN; i++) topSum += stresses[i]!;
    plateness = topSum / totalStress;
  }

  return {
    timeYears: keyframe.timeYears,
    speedMedianMPerYr: g.plateSpeedMedianMPerYr,
    speedMinMPerYr: g.plateSpeedMinMPerYr,
    speedMaxMPerYr: g.plateSpeedMaxMPerYr,
    oceanicContinentalSpeedRatio: g.oceanicContinentalSpeedRatio,
    speedContinentalityCorr: g.speedContinentalityCorr,
    speedSlabAttachmentCorr: g.speedSlabAttachmentCorr,
    poleStability: g.poleStability,
    marginConsolidationFlipsTotal: g.marginConsolidationFlipsTotal,
    seafloorAgeMeanYr: oceanCells > 0 ? ageSum / oceanCells : 0,
    seafloorAgeMedianYr: ageMedian,
    seafloorAgeMaxYr: ageMax,
    plateness,
    ageAreaHistogram: histogram,
  };
}

/** m/yr → cm/yr for the human-facing table (plate speeds read naturally there). */
const M_PER_YR_TO_CM_PER_YR = 100;

/** One formatted census row (per keyframe). Speeds in cm/yr, ages in Myr.
 *  `prevTotalFlips` is the previous keyframe's cumulative flip count, used to
 *  show this interval's incremental #67 pair-flips (boundary churn); omit it
 *  for the first row. */
export function formatPlateCensusRow(row: PlateCensusRow, prevTotalFlips?: number): string {
  const myr = (row.timeYears / 1e6).toFixed(0).padStart(5);
  const cm = (x: number): string => (x * M_PER_YR_TO_CM_PER_YR).toFixed(2).padStart(6);
  const age = (x: number): string => (x / 1e6).toFixed(0).padStart(4);
  const flips =
    prevTotalFlips === undefined ? '   -' : String(row.marginConsolidationFlipsTotal - prevTotalFlips).padStart(4);
  return (
    `t=${myr} Myr  ` +
    `speed cm/yr [min ${cm(row.speedMinMPerYr)} med ${cm(row.speedMedianMPerYr)} max ${cm(row.speedMaxMPerYr)}]  ` +
    `oc/cont ${row.oceanicContinentalSpeedRatio.toFixed(2).padStart(5)}  ` +
    `corr ${row.speedContinentalityCorr.toFixed(2).padStart(5)}  ` +
    `slab ${row.speedSlabAttachmentCorr.toFixed(2).padStart(5)}  ` +
    `pole ${row.poleStability.toFixed(3)}  ` +
    `sfage Myr [med ${age(row.seafloorAgeMedianYr)} mean ${age(row.seafloorAgeMeanYr)} max ${age(row.seafloorAgeMaxYr)}]  ` +
    `plateness ${row.plateness.toFixed(3)}  ` +
    `churn ${flips}`
  );
}

/**
 * Aggregate census summary over the series, averaged past 1 Gyr (early
 * keyframes still remember the initial partition, as in `summarizeMetrics`).
 * Prints the mean of each scalar and the mean age–area histogram — the baseline
 * table stage 1 A/Bs against. This is the durable Stage 0 findings block.
 */
export function summarizePlateCensus(rows: readonly PlateCensusRow[]): string {
  // The census pass is not run at init (the pipeline starts at step 1), so the
  // t=0 keyframe carries all-zero census scalars — exclude it always so it
  // never drags the speed/pole means. Past 1 Gyr is the shape-metrics window
  // (early keyframes still remember the initial partition); on a <1 Gyr run
  // fall back to every post-t=0 keyframe.
  const posted = rows.filter((r) => r.timeYears > 0);
  const late = posted.filter((r) => r.timeYears >= SHAPE_METRICS_AFTER_YEARS);
  const use = late.length > 0 ? late : posted;
  if (use.length === 0) return 'census: no keyframes';
  const mean = (f: (r: PlateCensusRow) => number): number =>
    use.reduce((s, r) => s + f(r), 0) / use.length;

  const hist = new Array<number>(SEAFLOOR_AGE_BIN_COUNT).fill(0);
  for (const r of use) {
    for (let b = 0; b < SEAFLOOR_AGE_BIN_COUNT; b++) hist[b]! += r.ageAreaHistogram[b]! / use.length;
  }
  const cm = (x: number): string => (x * M_PER_YR_TO_CM_PER_YR).toFixed(2);
  const histLine = hist
    .map((frac, b) => {
      const lo = ((b * SEAFLOOR_AGE_BIN_WIDTH_YR) / 1e6).toFixed(0);
      const label = b === SEAFLOOR_AGE_BIN_COUNT - 1 ? `${lo}+` : `${lo}-`;
      return `${label}:${(frac * 100).toFixed(1)}%`;
    })
    .join(' ');

  return [
    `census summary (mean over ${use.length} keyframes past ${
      late.length > 0 ? '1 Gyr' : 't=0 — <1 Gyr run'
    }):`,
    `  speed cm/yr: min ${cm(mean((r) => r.speedMinMPerYr))} median ${cm(
      mean((r) => r.speedMedianMPerYr),
    )} max ${cm(mean((r) => r.speedMaxMPerYr))}`,
    `  oceanic/continental speed ratio: ${mean((r) => r.oceanicContinentalSpeedRatio).toFixed(2)} (descriptive; degenerate under few-plate geometry)`,
    `  speed–continentality correlation: ${mean((r) => r.speedContinentalityCorr).toFixed(3)} (descriptive; washes to 0 deep-time)`,
    `  speed–slab-attachment correlation: ${mean((r) => r.speedSlabAttachmentCorr).toFixed(3)} (stage-1 gate, #111; want ≥ +0.3)`,
    `  pole stability (mean cosine): ${mean((r) => r.poleStability).toFixed(4)}`,
    `  seafloor age Myr: median ${(mean((r) => r.seafloorAgeMedianYr) / 1e6).toFixed(0)} mean ${(
      mean((r) => r.seafloorAgeMeanYr) / 1e6
    ).toFixed(0)} max ${(mean((r) => r.seafloorAgeMaxYr) / 1e6).toFixed(0)}`,
    `  plateness (top-decile stress share): ${mean((r) => r.plateness).toFixed(3)}`,
    `  boundary churn (#67 pair-flips / 100 Myr): ${churnRate(use).toFixed(2)}`,
    `  age–area histogram (Myr bins): ${histLine}`,
  ].join('\n');
}

/** Mean #67 margin-consolidation pair-flip rate over a keyframe window, flips
 *  per 100 Myr — the cumulative total differenced across the window's span.
 *  0 for a degenerate (single-keyframe or zero-span) window. */
function churnRate(use: readonly PlateCensusRow[]): number {
  if (use.length < 2) return 0;
  const first = use[0]!;
  const last = use[use.length - 1]!;
  const spanMyr = (last.timeYears - first.timeYears) / 1e6;
  if (spanMyr <= 0) return 0;
  return ((last.marginConsolidationFlipsTotal - first.marginConsolidationFlipsTotal) / spanMyr) * 100;
}

/* ------------------------------------------------------------------------- *
 * Stage-4 rift-lifecycle instrumentation (Tectonics V2, #114; proposal §5).
 *
 * The stage retires the 120 Myr post-rift suture cooldown under tensionRift,
 * measured 120 → 30 → 0 Myr. Two of the stage-4 gates cannot be read off the
 * shape/census tables and are measured here from the streamed keyframes + the
 * cumulative event log (NO kernel change — flag-off/main goldens untouched):
 *
 *  - re-suture interval of rifted halves (below): the pre-#59 ~16 Myr
 *    re-suture pathology is the tripwire — a cooldown of 0 is only acceptable
 *    if halves that DO re-merge take > 100 Myr to, i.e. ridge push, not the
 *    timer, kept them apart in the interim;
 *  - fraction of a fresh rift seam still convergent 50 Myr later (the probe):
 *    the direct measurement that ridge push separates the halves — a seam that
 *    is still closing at +50 Myr means the mechanism failed and only the timer
 *    was holding it open.
 * ------------------------------------------------------------------------- */

/** Re-suture floor: rifted halves that re-merge inside this window trip the
 *  pre-#59 re-suture pathology tripwire (healthy is > 100 Myr, or no re-suture). */
export const RE_SUTURE_FLOOR_YEARS = 100e6;

export interface ReSutureIntervals {
  /** One interval (Myr) per matched rift→re-suture of the same pair, in rift order. */
  intervalsMyr: number[];
  count: number;
  /** Minimum interval (Myr); 0 when there were no re-sutures. */
  minMyr: number;
  /** Median interval (Myr); 0 when there were no re-sutures. */
  medianMyr: number;
  /** Number of intervals ≤ RE_SUTURE_FLOOR_YEARS (the pathology count). */
  underFloorCount: number;
}

/** Unordered-pair key for two plate ids (order-independent, collision-free for
 *  the u8/event-log id range). */
function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * Re-suture intervals from the event log: for each `plateRift {plate, newPlate}`
 * at time tR, the FIRST later `plateSuture`/`sutureTimeout` whose
 * `{absorbed, into}` is the same unordered pair, interval = tS − tR. Each suture
 * is consumed by at most one rift (the earliest still-unmatched one), so two
 * rifts of a pair need two re-sutures to both count. Pure over the event list.
 *
 * Caveat: matching keys only on the unordered id pair, so if an id is recycled
 * after consumption a later unrelated `{a,b}` rift could match an `{a,b}` suture
 * that is not literally its own halves re-welding. This is inherent to reading
 * "the same pair re-merged" from the id log; it inflates the count conservatively
 * (toward MORE apparent re-sutures), so a clean min-interval > 100 Myr is still a
 * trustworthy pass — treat the raw count as an upper bound.
 */
export function computeReSutureIntervals(events: readonly SimEvent[]): ReSutureIntervals {
  const rifts: Array<{ t: number; key: string }> = [];
  const sutures: Array<{ t: number; key: string; used: boolean }> = [];
  for (const e of events) {
    if (e.kind === EVENT_KINDS.plateRift) {
      rifts.push({ t: e.timeYears, key: pairKey(e.data!.plate!, e.data!.newPlate!) });
    } else if (isMergeEvent(e)) {
      sutures.push({ t: e.timeYears, key: pairKey(e.data!.absorbed!, e.data!.into!), used: false });
    }
  }
  const intervalsMyr: number[] = [];
  let underFloorCount = 0;
  for (const r of rifts) {
    // Earliest unused suture of the same pair strictly after the rift. Sutures
    // are appended in sim (time) order, so the first match in list order is the
    // earliest in time.
    const match = sutures.find((s) => !s.used && s.t > r.t && s.key === r.key);
    if (!match) continue;
    match.used = true;
    const dtMyr = (match.t - r.t) / 1e6;
    intervalsMyr.push(dtMyr);
    if (match.t - r.t <= RE_SUTURE_FLOOR_YEARS) underFloorCount++;
  }
  const count = intervalsMyr.length;
  if (count === 0) {
    return { intervalsMyr, count: 0, minMyr: 0, medianMyr: 0, underFloorCount: 0 };
  }
  const sorted = [...intervalsMyr].sort((a, b) => a - b);
  const mid = count >> 1;
  const medianMyr = count % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { intervalsMyr, count, minMyr: sorted[0]!, medianMyr, underFloorCount };
}

/** One-line re-suture summary; states the > 100 Myr floor and the pathology count. */
export function summarizeReSutureIntervals(events: readonly SimEvent[]): string {
  const r = computeReSutureIntervals(events);
  if (r.count === 0) {
    return (
      `re-suture: 0 rifted pairs re-merged` +
      ` (gate: healthy — no pair re-sutured; floor > ${RE_SUTURE_FLOOR_YEARS / 1e6} Myr)`
    );
  }
  return (
    `re-suture: ${r.count} rifted pairs re-merged; interval Myr [min ${r.minMyr.toFixed(0)}` +
    ` median ${r.medianMyr.toFixed(0)}]; ${r.underFloorCount} ≤ ${RE_SUTURE_FLOOR_YEARS / 1e6} Myr` +
    ` (gate: min > ${RE_SUTURE_FLOOR_YEARS / 1e6} Myr — the pre-#59 ~16 Myr re-suture is the tripwire)`
  );
}

/**
 * A plate MERGE, for event accounting: both `plateSuture` and the
 * `sutureTimeout` backstop — the timeout is a real suture that merely hit the
 * stall-criterion deadline instead of closing fully (#127 item 2). This is the
 * one place the "a timeout is a suture" rule lives; `computeReSutureIntervals`
 * and `computeReorgTempo` both read it so the rule can never drift between them.
 */
export function isMergeEvent(e: SimEvent): boolean {
  return e.kind === EVENT_KINDS.plateSuture || e.kind === EVENT_KINDS.sutureTimeout;
}

/**
 * A plate reorganization for tempo accounting: a rift ({plate, newPlate}) OR a
 * merge ({absorbed, into}). Counting the `sutureTimeout` merge (via
 * `isMergeEvent`) is the #127 item 2 fix — the tempo line must not silently
 * drop it.
 */
export function isReorgEvent(e: SimEvent): boolean {
  return e.kind === EVENT_KINDS.plateRift || isMergeEvent(e);
}

export interface ReorgTempo {
  /** `plateRift` events over the run. */
  rifts: number;
  /** Merge events: `plateSuture` + `sutureTimeout`. */
  sutures: number;
  /** rifts + sutures. */
  reorgs: number;
  /** Reorganizations per 100 Myr over the simulated window. */
  per100Myr: number;
  /** Mean interval (years) between successive reorganizations that touch the
   *  same plate id, or `null` when no plate appears in two of them. */
  meanIntervalYears: number | null;
}

/**
 * Wilson-cycle tempo (#66): reorganizations per 100 Myr, plus the mean interval
 * between successive reorganizations that involve the same plate — the tracked
 * "does the clock feel Earth-like" number (target ~100–300 Myr). A rift
 * involves {plate, newPlate}; either suture kind involves {absorbed, into}.
 * Counts `sutureTimeout` as a merge (#127 item 2); before that fix the
 * seed-42 default run reported 4.71 reorg/100 Myr against a true ≈ 5.2 with 14
 * of 78 sutures dropped.
 */
export function computeReorgTempo(
  events: readonly SimEvent[],
  simulatedYears: number,
): ReorgTempo {
  const reorgEvents = events.filter(isReorgEvent);
  const rifts = reorgEvents.filter((e) => e.kind === EVENT_KINDS.plateRift).length;
  const reorgs = reorgEvents.length;
  const sutures = reorgs - rifts;
  const per100Myr = simulatedYears > 0 ? (reorgs / (simulatedYears / 1e6)) * 100 : 0;
  // Interval between consecutive reorganizations touching the same plate id.
  const lastSeen = new Map<number, number>();
  let intervalSum = 0;
  let intervalCount = 0;
  for (const e of reorgEvents) {
    const d = e.data!;
    const involved =
      e.kind === EVENT_KINDS.plateRift ? [d.plate!, d.newPlate!] : [d.absorbed!, d.into!];
    for (const p of involved) {
      const prev = lastSeen.get(p);
      if (prev !== undefined) {
        intervalSum += e.timeYears - prev;
        intervalCount++;
      }
      lastSeen.set(p, e.timeYears);
    }
  }
  const meanIntervalYears = intervalCount > 0 ? intervalSum / intervalCount : null;
  return { rifts, sutures, reorgs, per100Myr, meanIntervalYears };
}

/** One-line Wilson-tempo summary for `--report` (#66; counts sutureTimeout, #127 item 2). */
export function summarizeReorgTempo(
  events: readonly SimEvent[],
  simulatedYears: number,
): string {
  const t = computeReorgTempo(events, simulatedYears);
  const meanInterval =
    t.meanIntervalYears !== null ? `${(t.meanIntervalYears / 1e6).toFixed(0)} Myr` : 'n/a';
  return (
    `tempo: ${t.rifts} rifts + ${t.sutures} sutures in ${(simulatedYears / 1e6).toFixed(0)} Myr` +
    ` = ${t.per100Myr.toFixed(2)} reorganizations / 100 Myr` +
    `; mean interval per plate involved: ${meanInterval}`
  );
}

/** Look-ahead for the convergent-seam probe: measure the fresh rift seam this
 *  long after it forms. Ridge push should have flipped it fully divergent. */
export const CONVERGENCE_LOOKAHEAD_YEARS = 50e6;

export interface RiftConvergenceSummary {
  /** Probes that came due (run lasted ≥ 50 Myr past the rift) and were scored. */
  resolved: number;
  /** Probes still waiting at end of run (rift within 50 Myr of the finish). */
  pendingAtEnd: number;
  /** Rifts whose halves shared no boundary cell on the post-rift keyframe. */
  skippedEmpty: number;
  /** Mean over resolved probes of the seam's convergent-cell fraction; 0 when none. */
  meanConvergentFrac: number;
}

interface PendingProbe {
  dueTime: number;
  seamCells: number[];
}

export interface RiftConvergenceProbe {
  /** Feed one keyframe (in sim order): resolves any due probes, then opens
   *  probes for rifts newly appearing in this keyframe's event list. */
  observe(keyframe: Keyframe): void;
  summary(): RiftConvergenceSummary;
}

/**
 * Streaming probe for the "seam still convergent at +50 Myr" gate. Holds only
 * small seam-cell index lists between keyframes — never a retained field array.
 * On each keyframe it (a) scores every probe now due against THIS keyframe's
 * `boundaryStress`, then (b) opens a probe for each new `plateRift`, building
 * the seam from THIS keyframe's `plateId` (the first keyframe at/after the
 * rift). A cell is "still convergent" when its stress exceeds the active-margin
 * threshold (positive stress = closing).
 */
export function createRiftConvergenceProbe(gridN: number): RiftConvergenceProbe {
  const count = cellCount(gridN);
  const nb = neighborTable(gridN);
  let pending: PendingProbe[] = [];
  const fractions: number[] = [];
  let skippedEmpty = 0;
  let eventCursor = 0;

  return {
    observe(keyframe: Keyframe): void {
      const t = keyframe.timeYears;
      const stress = keyframe.fields.boundaryStress;
      const plateId = keyframe.fields.plateId;

      // (a) Resolve every probe now due against this keyframe's stress.
      const stillPending: PendingProbe[] = [];
      for (const p of pending) {
        if (p.dueTime <= t) {
          let convergent = 0;
          for (const c of p.seamCells) {
            if (stress[c]! > ACTIVE_MARGIN_STRESS_M_PER_YR) convergent++;
          }
          fractions.push(convergent / p.seamCells.length);
        } else {
          stillPending.push(p);
        }
      }
      pending = stillPending;

      // (b) Open a probe for each rift newly visible in the cumulative log.
      for (; eventCursor < keyframe.events.length; eventCursor++) {
        const e = keyframe.events[eventCursor]!;
        if (e.kind !== EVENT_KINDS.plateRift) continue;
        const a = e.data!.plate!;
        const b = e.data!.newPlate!;
        // Seam = cells of A adjacent to B, unioned with cells of B adjacent to
        // A. One ascending sweep keeps the list deterministic and in index
        // order (a cell belongs to at most one of A/B, so no dedup needed).
        const seamCells: number[] = [];
        for (let i = 0; i < count; i++) {
          const pid = plateId[i]!;
          if (pid !== a && pid !== b) continue;
          const other = pid === a ? b : a;
          for (let k = 0; k < 4; k++) {
            if (plateId[nb[i * 4 + k]!]! === other) {
              seamCells.push(i);
              break;
            }
          }
        }
        if (seamCells.length === 0) {
          skippedEmpty++;
          continue;
        }
        pending.push({ dueTime: e.timeYears + CONVERGENCE_LOOKAHEAD_YEARS, seamCells });
      }
    },

    summary(): RiftConvergenceSummary {
      const resolved = fractions.length;
      const meanConvergentFrac =
        resolved > 0 ? fractions.reduce((s, x) => s + x, 0) / resolved : 0;
      return { resolved, pendingAtEnd: pending.length, skippedEmpty, meanConvergentFrac };
    },
  };
}

/** One-line convergent-seam summary; states the ≈0 gate framing. */
export function summarizeRiftConvergence(s: RiftConvergenceSummary): string {
  return (
    `rift-convergence: ${s.resolved} seams scored at +${CONVERGENCE_LOOKAHEAD_YEARS / 1e6} Myr` +
    ` (${s.pendingAtEnd} pending at end, ${s.skippedEmpty} skipped no-seam);` +
    ` mean still-convergent fraction ${s.meanConvergentFrac.toFixed(3)}` +
    ` (gate: ≈ 0 — ridge push, not the timer, separates the halves)`
  );
}
