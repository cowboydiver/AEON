import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import {
  CONTINENTAL_CRUST_FRACTION,
  EVENT_KINDS,
  FIELD_NAMES,
  createPlanetParams,
  hashFloat32Array,
  run,
  type FieldName,
  type Keyframe,
  type PlanetParams,
  type SimEvent,
} from 'sim-kernel';
import {
  computeCrustStats,
  computeKeyframeMetrics,
  computePlateCensusRow,
  formatPlateCensusRow,
  summarizeMetrics,
  summarizePairedMetrics,
  summarizePlateCensus,
  type KeyframeMetrics,
  type PlateCensusRow,
} from './metrics';
import { fieldStats, renderFieldPng } from './render';

const HELP = `sim-cli — headless planet simulation harness

Usage: pnpm sim -- [options]

Options:
  --seed <int>                PRNG seed (default 1)
  --until <years>             simulate until this time, e.g. 100e6 (default 100e6)
  --keyframe-interval <years> keyframe spacing (default 10e6)
  --grid-n <int>              cells per cube-face edge (default 128)
  --report                    print a stats table per keyframe
  --metrics                   print the shape/dispersal summary (the #60/#67
                              measurement harness: continental components,
                              largest-component fraction, edge/area,
                              dispersed-keyframe fraction, monopoly window)
  --crust-stats               print the sea-level/flooding table per keyframe
                              (the #101 freeboard-calibration harness): sea
                              level, continental-crust share, mean freeboard,
                              submerged share of continental crust, share of
                              ocean area on continental crust, shallow-ocean
                              share of the sphere, land share, min elevation
  --plate-census              print the force-balance census per keyframe
                              (Tectonics V2 stage 0, #110): per-plate speed
                              distribution |ω|·R and oceanic/continental speed
                              ratio + speed-continentality correlation (the
                              Forsyth & Uyeda sign tests), Euler-pole stability
                              (1.0 on the immutable-pole baseline), seafloor
                              age mean/max + age-area histogram over oceanic
                              crust, and plateness (top-decile boundary-stress
                              share). Sets the kernel plateCensus diagnostic;
                              measurement only, main goldens byte-identical
  --block-isostasy            enable the crustal-block isostasy prototype (#84):
                              per-component elevation ceilings that founder
                              small continental blocks (default off —
                              superseded by crust-fates)
  --crust-fates               enable small-component crust fates + terrane
                              docking (#88): small components weld onto large
                              ones across short straits, isolated ones drown
                              and have their crust record retired (default ON
                              since the #88/#90 promotion)
  --compact-arcs              enable compact arc maturation (#89): belt arcs
                              mature only with >= 2 continental 4-neighbors,
                              so creation grows blobs, not chains (default off
                              — measured negative: starves continent creation)
  --marine-planation          enable marine planation for small components
                              (#90): wave attack planes small blocks toward
                              the shelf level, conservatively, into sedimentM
                              (default ON since the #88/#90 promotion)
  --emergent-arc-taper        enable the emergent-arc growth taper (#91): only
                              long-lived subduction builds emergent +1 km arc
                              chains; young margins stay submerged (default off
                              — measured negative: collapses land fraction)
  --sea-level-datums          anchor the platform/arc datums (founder level,
                              shelf ceiling, arc maturation gate + island
                              ceiling) to the dynamic sea level instead of the
                              fixed 0 m datum, so drowned platforms and shallow
                              shelves survive the deep-time sea-level fall
                              (default off — prototype; see
                              docs/SEA_LEVEL_DATUM_FINDINGS.md)
  --freeboard                 enable freeboard regulation (the findings-doc
                              follow-up): continental mean elevation relaxes
                              toward a target freeboard above the dynamic sea
                              level, passive margins subside toward shelf
                              depth, and the land-relief datums ride the sea
                              level (default off — prototype; measure with
                              --sea-level-datums also on)
  --bathymetry-datum          key the oceanic age-depth reference (ridge
                              crest, trench pinning, gap fill, shelf room) to
                              the dynamic sea level (#102), so ridge crests
                              stay submerged instead of crossing the deep-time
                              oceans as emergent island chains (default off —
                              prototype; measure with --sea-level-datums
                              --freeboard also on)
  --force-kinematics          enable force-driven plate kinematics (Tectonics
                              V2 stage 1, #111): a per-step rigid-plate torque
                              balance (slab pull, ridge push, collision damping,
                              basal drag) makes each plate's angular velocity
                              derived state instead of a fixed random draw
                              (default off — measure with --ab force-kinematics
                              and --plate-census)
  --emergent-suture           suture on kinematic stall instead of the fixed
                              contact countdown (Tectonics V2 stage 2, #112):
                              a cont-cont pair merges when force-balance collision
                              damping stalls its closing speed, with a loud
                              sutureTimeout backstop (default off — needs
                              --force-kinematics on; measure with
                              --ab emergent-suture)
  --step-years <years>        simulation step size (default 1e6); use e.g.
                              0.5e6 for dt-halving checks of lagged datums
  --water-scale <factor>      dimensionless multiplier on the derived water
                              inventory (#105): the planet's water endowment as
                              a chosen property rather than a terrain-noise
                              artifact (default 1.0 = the derived value, must be
                              > 0). Scale > 1 raises the deep-time sea and floods
                              the ridge crests natively (~2.6 ≈ Earth, ~3.4–4.7
                              submerges 1–2.5 km); see
                              docs/SEA_LEVEL_DATUM_FINDINGS.md
  --initial-land-fraction <f> fraction of cells above the 0 m datum at t=0
                              (#106): the initial coastline as a chosen property
                              rather than fixed at 30% (default 0.3, must be
                              0 < f < 0.4 = the continental crust fraction; the
                              gap to it is the initial submerged shelf). Lower f
                              starts an ocean-dominated world with a larger
                              derived water inventory; composes with
                              --water-scale as base × scale. See
                              docs/SEA_LEVEL_DATUM_FINDINGS.md
  --no-<mechanism>            disable a default-on mechanism for this run,
                              e.g. --no-crust-fates --no-marine-planation;
                              all eight --no-* forms exist. Composable with
                              the positive flags for any on/off combination.
  --ab <mechanism>            paired branched A/B (PR #87 instrument): run
                              flag-off and flag-on-with-onset arms that are
                              bit-identical until --ab-branch, then print
                              per-keyframe shape deltas — the mechanism's
                              direct effect, before chaotic trajectory
                              divergence swamps it. Trust the first few
                              hundred Myr after the branch most. Mechanisms:
                              block-isostasy, crust-fates, compact-arcs,
                              marine-planation, emergent-arc-taper,
                              sea-level-datums, freeboard, bathymetry-datum.
                              Mutually exclusive with the single-arm mechanism
                              flags and --dump. Since the #88-#91 promotion
                              BOTH arms inherit the promoted defaults for the
                              other mechanisms — the A/B measures the marginal
                              effect against the shipped default world.
  --ab-branch <years>         branch year for --ab (both arms identical before
                              it; required with --ab)
  --ab-block-isostasy <years> alias for --ab block-isostasy --ab-branch <years>
  --dump <fields>             comma-separated fields to dump as PNGs (e.g. elevation,temperature)
  --dump-every <k>            only dump every k-th keyframe (plus the final one);
                              default 1 = every keyframe. Use for long-run flipbooks.
  --out <dir>                 output directory for dumps (default tmp/)
  --help                      show this help

Exits non-zero if any field contains NaN or Infinity at any keyframe.
`;

const { values } = parseArgs({
  // Nested `pnpm run` forwarding can leave literal `--` separators in argv.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    seed: { type: 'string', default: '1' },
    until: { type: 'string', default: '100e6' },
    'keyframe-interval': { type: 'string' },
    'grid-n': { type: 'string' },
    'step-years': { type: 'string' },
    'water-scale': { type: 'string' },
    'initial-land-fraction': { type: 'string' },
    report: { type: 'boolean', default: false },
    metrics: { type: 'boolean', default: false },
    'crust-stats': { type: 'boolean', default: false },
    'plate-census': { type: 'boolean', default: false },
    'block-isostasy': { type: 'boolean', default: false },
    'crust-fates': { type: 'boolean', default: false },
    'compact-arcs': { type: 'boolean', default: false },
    'marine-planation': { type: 'boolean', default: false },
    'emergent-arc-taper': { type: 'boolean', default: false },
    'sea-level-datums': { type: 'boolean', default: false },
    freeboard: { type: 'boolean', default: false },
    'bathymetry-datum': { type: 'boolean', default: false },
    'force-kinematics': { type: 'boolean', default: false },
    'emergent-suture': { type: 'boolean', default: false },
    'no-block-isostasy': { type: 'boolean', default: false },
    'no-crust-fates': { type: 'boolean', default: false },
    'no-compact-arcs': { type: 'boolean', default: false },
    'no-marine-planation': { type: 'boolean', default: false },
    'no-emergent-arc-taper': { type: 'boolean', default: false },
    'no-sea-level-datums': { type: 'boolean', default: false },
    'no-freeboard': { type: 'boolean', default: false },
    'no-bathymetry-datum': { type: 'boolean', default: false },
    'no-force-kinematics': { type: 'boolean', default: false },
    'no-emergent-suture': { type: 'boolean', default: false },
    ab: { type: 'string' },
    'ab-branch': { type: 'string' },
    'ab-block-isostasy': { type: 'string' },
    dump: { type: 'string' },
    'dump-every': { type: 'string' },
    out: { type: 'string', default: 'tmp' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

function numArg(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    console.error(`sim-cli: invalid --${name}: ${raw}`);
    process.exit(2);
  }
  return v;
}

const seed = numArg(values.seed, 'seed')!;
const untilYears = numArg(values.until, 'until')!;
const keyframeIntervalYears = numArg(values['keyframe-interval'], 'keyframe-interval');
const gridN = numArg(values['grid-n'], 'grid-n');
const stepYears = numArg(values['step-years'], 'step-years');
const waterScale = numArg(values['water-scale'], 'water-scale');
if (waterScale !== undefined && waterScale <= 0) {
  console.error(`sim-cli: --water-scale must be > 0: ${waterScale}`);
  process.exit(2);
}
const initialLandFraction = numArg(values['initial-land-fraction'], 'initial-land-fraction');
// Range: 0 < f < CONTINENTAL_CRUST_FRACTION. At f ≥ the crust fraction every
// continental cell would be emergent and the initial submerged shelf (the gap
// between the two) starves; at f ≤ 0 there is no land to place a coastline for.
if (initialLandFraction !== undefined && !(initialLandFraction > 0 && initialLandFraction < CONTINENTAL_CRUST_FRACTION)) {
  console.error(
    `sim-cli: --initial-land-fraction must be in (0, ${CONTINENTAL_CRUST_FRACTION}): ${initialLandFraction}`,
  );
  process.exit(2);
}
const dumpEvery = Math.max(1, Math.round(numArg(values['dump-every'], 'dump-every') ?? 1));

/**
 * The togglable mechanisms the branched A/B harness can measure
 * (#84/#88/#89/#90/#91): CLI name -> single-arm flag + the kernel params an
 * arm gets. crust-fates and marine-planation default ON since the #88/#90
 * promotion (compact-arcs and emergent-arc-taper measured negative and stay
 * off; block-isostasy stays off, superseded by crust-fates); each has an
 * onset param with the same contract (bit-identical to flag-off before it,
 * no RNG consumed — pinned by the kernel's onset-gating tests), which is
 * what makes the paired arms a measurement.
 */
const MECHANISMS: Record<string, (on: boolean, onsetYears: number) => Partial<PlanetParams>> = {
  'block-isostasy': (on, onset) => ({ blockIsostasy: on, blockIsostasyOnsetYears: onset }),
  'crust-fates': (on, onset) => ({ crustFates: on, crustFatesOnsetYears: onset }),
  'compact-arcs': (on, onset) => ({ compactArcs: on, compactArcsOnsetYears: onset }),
  'marine-planation': (on, onset) => ({ marinePlanation: on, marinePlanationOnsetYears: onset }),
  'emergent-arc-taper': (on, onset) => ({ emergentArcTaper: on, emergentArcTaperOnsetYears: onset }),
  'sea-level-datums': (on, onset) => ({ seaLevelDatums: on, seaLevelDatumsOnsetYears: onset }),
  freeboard: (on, onset) => ({ freeboard: on, freeboardOnsetYears: onset }),
  'bathymetry-datum': (on, onset) => ({ bathymetryDatum: on, bathymetryDatumOnsetYears: onset }),
  'force-kinematics': (on, onset) => ({ forceKinematics: on, forceKinematicsOnsetYears: onset }),
  'emergent-suture': (on, onset) => ({ emergentSuture: on, emergentSutureOnsetYears: onset }),
};
const MECHANISM_FLAGS = Object.keys(MECHANISMS) as ReadonlyArray<
  | 'block-isostasy'
  | 'crust-fates'
  | 'compact-arcs'
  | 'marine-planation'
  | 'emergent-arc-taper'
  | 'sea-level-datums'
  | 'freeboard'
  | 'bathymetry-datum'
  | 'force-kinematics'
  | 'emergent-suture'
>;

// --ab-block-isostasy <years> predates --ab and is kept as its alias.
const abMechanism = values.ab ?? (values['ab-block-isostasy'] !== undefined ? 'block-isostasy' : undefined);
const abBranchYears =
  values.ab !== undefined
    ? numArg(values['ab-branch'], 'ab-branch')
    : numArg(values['ab-block-isostasy'], 'ab-block-isostasy');
if (abMechanism !== undefined && !(abMechanism in MECHANISMS)) {
  console.error(`sim-cli: unknown --ab mechanism "${abMechanism}" (known: ${Object.keys(MECHANISMS).join(', ')})`);
  process.exit(2);
}
if (values.ab !== undefined && abBranchYears === undefined) {
  console.error('sim-cli: --ab requires --ab-branch <years>');
  process.exit(2);
}

const dumpFields: FieldName[] = (values.dump ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => {
    if (!(FIELD_NAMES as readonly string[]).includes(s)) {
      console.error(`sim-cli: unknown field "${s}" (known: ${FIELD_NAMES.join(', ')})`);
      process.exit(2);
    }
    return s as FieldName;
  });

const params = createPlanetParams({
  seed,
  ...(gridN !== undefined ? { gridN } : {}),
  ...(keyframeIntervalYears !== undefined ? { keyframeIntervalYears } : {}),
  ...(stepYears !== undefined ? { stepYears } : {}),
  ...(waterScale !== undefined ? { waterInventoryScale: waterScale } : {}),
  ...(initialLandFraction !== undefined ? { initialLandFraction } : {}),
  // Stage-0 diagnostic (#110): turn on the kernel plate-census pass so each
  // keyframe's globals carry the force-balance scalars. Off ⇒ byte-identical.
  ...(values['plate-census'] ? { plateCensus: true } : {}),
  // Single-arm mechanism flags compose (e.g. --block-isostasy --crust-fates
  // measures the pair together); --no-* forms disable a default-on mechanism.
  // The paired --ab harness takes one at a time.
  ...MECHANISM_FLAGS.reduce<Partial<PlanetParams>>((acc, flag) => {
    const on = values[flag];
    const off = values[`no-${flag}`];
    if (on && off) {
      console.error(`sim-cli: --${flag} and --no-${flag} are mutually exclusive`);
      process.exit(2);
    }
    if (!on && !off) return acc; // kernel default rules
    return { ...acc, ...MECHANISMS[flag]!(on, 0) };
  }, {}),
});

// pnpm runs this script with cwd = packages/sim-cli; resolve --out relative
// to where the user actually invoked pnpm so `--out tmp/` means repo tmp/.
const outDir = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
if (dumpFields.length > 0) {
  mkdirSync(outDir, { recursive: true });
}

/** Tripwire: any non-finite value in any field is a hard failure. */
function checkFinite(keyframe: Keyframe): void {
  for (const name of FIELD_NAMES) {
    const field = keyframe.fields[name];
    for (let i = 0; i < field.length; i++) {
      if (!Number.isFinite(field[i]!)) {
        console.error(
          `sim-cli: non-finite value in field "${name}" at cell ${i}, t=${keyframe.timeYears} yr: ${field[i]}`,
        );
        process.exit(1);
      }
    }
  }
}

function formatYears(t: number): string {
  return `${(t / 1e6).toFixed(1).padStart(8)} Myr`;
}

const checksumHex = (f: Float32Array): string => hashFloat32Array(f).toString(16).padStart(8, '0');

let printedHeader = false;
let reportedEvents = 0;

/** Print events that arrived since the previous keyframe, indented under it. */
function reportEvents(keyframe: Keyframe): void {
  for (; reportedEvents < keyframe.events.length; reportedEvents++) {
    const e = keyframe.events[reportedEvents]!;
    const data = e.data
      ? ' ' +
        Object.entries(e.data)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : '';
    console.log(`  event @${formatYears(e.timeYears)}  ${e.kind}${data}`);
  }
}

function report(keyframe: Keyframe): void {
  if (!printedHeader) {
    console.log(
      ['time'.padStart(12), 'land%'.padStart(7), 'min elev'.padStart(10), 'mean elev'.padStart(10), 'max elev'.padStart(10), 'cont elev'.padStart(10), 'mean T'.padStart(8), 'CO2 ppm'.padStart(9), 'O2 PAL'.padStart(8), 'checksums (fnv1a32 per field)'].join('  '),
    );
    printedHeader = true;
  }
  const elevation = keyframe.fields.elevation;
  const crustType = keyframe.fields.crustType;
  const { min, max, mean } = fieldStats(elevation);
  // Land is emergence above the DYNAMIC sea level (#33) — the kernel's actual
  // coastline — not the fixed 0 m crust datum, which the deep-time sea-level
  // fall leaves ~3 km above the water (docs/SEA_LEVEL_DATUM_FINDINGS.md
  // measured the old >= 0 count under-reporting emergent area by every cell
  // between the two levels). >= : cells exactly at the level count as land,
  // matching globals.landFraction (identical at t=0, where seaLevelM is 0).
  const seaLevelM = keyframe.globals.seaLevelM;
  let land = 0;
  for (const e of elevation) if (e >= seaLevelM) land++;
  const landPct = ((land / elevation.length) * 100).toFixed(1);
  // Mean elevation over continental crust (#65's acceptance metric: it must
  // not ratchet monotonically upward over deep time).
  let contSum = 0;
  let contCount = 0;
  for (let i = 0; i < elevation.length; i++) {
    if (crustType[i] === 1) {
      contSum += elevation[i]!;
      contCount++;
    }
  }
  const contMean = contCount > 0 ? contSum / contCount : 0;
  // Climate scalars (#30/#34): the mean surface temperature and the dynamic CO₂
  // reservoir the carbonate–silicate thermostat regulates. The thermostat holds
  // mean T roughly steady while CO₂ swings — watch both to see it at work.
  const checksums = FIELD_NAMES.map((n) => `${n}:${checksumHex(keyframe.fields[n])}`).join(' ');
  console.log(
    [
      formatYears(keyframe.timeYears),
      `${landPct}%`.padStart(7),
      min.toFixed(0).padStart(10),
      mean.toFixed(0).padStart(10),
      max.toFixed(0).padStart(10),
      contMean.toFixed(0).padStart(10),
      `${keyframe.globals.meanTemperatureK.toFixed(1)}K`.padStart(8),
      keyframe.globals.co2.toFixed(0).padStart(9),
      keyframe.globals.oxygen.toFixed(3).padStart(8),
      checksums,
    ].join('  '),
  );
  reportEvents(keyframe);
}

let printedCrustStatsHeader = false;

/** Per-keyframe sea-level/flooding row (the #101 calibration table). */
function reportCrustStats(keyframe: Keyframe): void {
  if (!printedCrustStatsHeader) {
    console.log(
      [
        'time'.padStart(12),
        'seaLevel'.padStart(9),
        'cont%'.padStart(7),
        'freeboard'.padStart(10),
        'submerged%'.padStart(11),
        'oceanOnCont%'.padStart(13),
        'shallow%'.padStart(9),
        'land%'.padStart(7),
        'min elev'.padStart(10),
      ].join('  '),
    );
    printedCrustStatsHeader = true;
  }
  const s = computeCrustStats(keyframe);
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  console.log(
    [
      formatYears(s.timeYears),
      s.seaLevelM.toFixed(0).padStart(9),
      pct(s.contFrac).padStart(7),
      s.meanFreeboardM.toFixed(0).padStart(10),
      pct(s.submergedContFrac).padStart(11),
      pct(s.oceanOnContFrac).padStart(13),
      pct(s.shallowOceanFrac).padStart(9),
      pct(s.landFrac).padStart(7),
      s.minElevationM.toFixed(0).padStart(10),
    ].join('  '),
  );
}

function dump(keyframe: Keyframe): void {
  for (const name of dumpFields) {
    // The hypsometric ocean/land split follows the dynamic sea level, so the
    // dumped coastline is the kernel's actual coastline in any regime.
    const png = renderFieldPng(name, keyframe.fields[name], params.gridN, keyframe.globals.seaLevelM);
    const file = join(outDir, `${name}-${String(Math.round(keyframe.timeYears / 1e6)).padStart(6, '0')}Myr.png`);
    writeFileSync(file, PNG.sync.write(png));
    console.log(`wrote ${file}`);
  }
}

/**
 * Wilson-cycle tempo summary (#66): reorganizations (rifts + sutures) per
 * 100 Myr, and the mean interval between successive reorganizations that
 * involve the same plate — the tracked number for "does the clock feel
 * Earth-like" (target ~100-300 Myr), instead of an eyeball call on the
 * event log.
 */
function reportTempo(events: readonly SimEvent[], simulatedYears: number): void {
  const reorgs = events.filter(
    (e) => e.kind === EVENT_KINDS.plateRift || e.kind === EVENT_KINDS.plateSuture,
  );
  const rifts = reorgs.filter((e) => e.kind === EVENT_KINDS.plateRift).length;
  const per100Myr = (reorgs.length / (simulatedYears / 1e6)) * 100;
  // Interval between consecutive reorganizations touching the same plate:
  // a rift involves {plate, newPlate}, a suture {absorbed, into}.
  const lastSeen = new Map<number, number>();
  let intervalSum = 0;
  let intervalCount = 0;
  for (const e of reorgs) {
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
  const meanInterval =
    intervalCount > 0 ? `${(intervalSum / intervalCount / 1e6).toFixed(0)} Myr` : 'n/a';
  console.log(
    `tempo: ${rifts} rifts + ${reorgs.length - rifts} sutures in ${(simulatedYears / 1e6).toFixed(0)} Myr` +
      ` = ${per100Myr.toFixed(2)} reorganizations / 100 Myr` +
      `; mean interval per plate involved: ${meanInterval}`,
  );
}

/**
 * Paired branched A/B (#84, generalized for #88-#91): both arms share the
 * seed and every pre-branch byte (the flag-on arm's onset makes the
 * mechanism inert until the branch, and no gated system consumes RNG), so
 * post-branch deltas are the mechanism's direct effect — the measurement
 * the whole-history on/off comparison in ISSUE_84_PROTOTYPE_FINDINGS.md
 * could not make.
 */
if (abMechanism !== undefined && abBranchYears !== undefined) {
  if (MECHANISM_FLAGS.some((flag) => values[flag]) || dumpFields.length > 0) {
    console.error('sim-cli: --ab runs its own two arms; drop the single-arm mechanism flags/--dump');
    process.exit(2);
  }
  if (abBranchYears < 0 || abBranchYears >= untilYears) {
    console.error(`sim-cli: --ab branch must be in [0, --until): ${abBranchYears}`);
    process.exit(2);
  }
  const mechanismParams = MECHANISMS[abMechanism]!;
  const runArm = (on: boolean): { series: KeyframeMetrics[]; preBranchElev: string[] } => {
    const armParams = createPlanetParams({
      seed,
      ...(gridN !== undefined ? { gridN } : {}),
      ...(keyframeIntervalYears !== undefined ? { keyframeIntervalYears } : {}),
      ...(stepYears !== undefined ? { stepYears } : {}),
      ...(waterScale !== undefined ? { waterInventoryScale: waterScale } : {}),
      ...(initialLandFraction !== undefined ? { initialLandFraction } : {}),
      ...mechanismParams(on, abBranchYears),
    });
    const series: KeyframeMetrics[] = [];
    const preBranchElev: string[] = [];
    run(armParams, untilYears, (keyframe) => {
      checkFinite(keyframe);
      series.push(computeKeyframeMetrics(keyframe, armParams.gridN));
      // The keyframe AT the branch year is still pre-onset work — include it.
      if (keyframe.timeYears <= abBranchYears) preBranchElev.push(checksumHex(keyframe.fields.elevation));
    });
    return { series, preBranchElev };
  };
  console.log(`ab: arm A (${abMechanism} off), seed ${seed}, until ${(untilYears / 1e6).toFixed(0)} Myr ...`);
  const armOff = runArm(false);
  console.log(`ab: arm B (${abMechanism} on from ${(abBranchYears / 1e6).toFixed(0)} Myr) ...`);
  const armOn = runArm(true);
  // Instrument tripwire: pre-branch keyframes must be bit-identical, or the
  // "paired" deltas below are ordinary trajectory divergence in disguise.
  for (let i = 0; i < armOff.preBranchElev.length; i++) {
    if (armOff.preBranchElev[i] !== armOn.preBranchElev[i]) {
      console.error(`sim-cli: ab arms diverged BEFORE the branch (keyframe ${i}) — instrument broken`);
      process.exit(1);
    }
  }
  console.log(`ab: pre-branch identical (${armOff.preBranchElev.length} keyframes checked)`);
  console.log(summarizePairedMetrics(armOff.series, armOn.series, abBranchYears));
  process.exit(0);
}

let keyframeIndex = 0;
let finalEvents: SimEvent[] = [];
const metricsSeries: KeyframeMetrics[] = [];
const censusSeries: PlateCensusRow[] = [];
run(params, untilYears, (keyframe) => {
  checkFinite(keyframe);
  if (values.report) report(keyframe);
  if (values['crust-stats']) reportCrustStats(keyframe);
  if (values.metrics) metricsSeries.push(computeKeyframeMetrics(keyframe, params.gridN));
  if (values['plate-census']) {
    const prevTotal = censusSeries.at(-1)?.marginConsolidationFlipsTotal;
    const row = computePlateCensusRow(keyframe);
    censusSeries.push(row);
    console.log(formatPlateCensusRow(row, prevTotal));
  }
  // Every keyframe passes the tripwire above; --dump-every only thins the
  // PNG series. The final keyframe is always dumped so flipbooks end at the
  // end state.
  const isFinal = keyframe.timeYears >= untilYears;
  if (dumpFields.length > 0 && (keyframeIndex % dumpEvery === 0 || isFinal)) dump(keyframe);
  keyframeIndex++;
  finalEvents = keyframe.events;
});
if (values.report) reportTempo(finalEvents, untilYears);
if (values.metrics) {
  const reorgs = finalEvents.filter(
    (e) => e.kind === EVENT_KINDS.plateRift || e.kind === EVENT_KINDS.plateSuture,
  );
  console.log(summarizeMetrics(metricsSeries, reorgs.at(-1)?.timeYears));
}
if (values['plate-census']) {
  console.log(summarizePlateCensus(censusSeries));
}
