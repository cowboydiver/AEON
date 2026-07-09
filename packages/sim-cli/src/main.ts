import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import {
  EVENT_KINDS,
  FIELD_NAMES,
  createPlanetParams,
  hashFloat32Array,
  run,
  type FieldName,
  type Keyframe,
  type SimEvent,
} from 'sim-kernel';
import { computeKeyframeMetrics, summarizeMetrics, type KeyframeMetrics } from './metrics';
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
    report: { type: 'boolean', default: false },
    metrics: { type: 'boolean', default: false },
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
const dumpEvery = Math.max(1, Math.round(numArg(values['dump-every'], 'dump-every') ?? 1));

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
      ['time'.padStart(12), 'land%'.padStart(7), 'min elev'.padStart(10), 'mean elev'.padStart(10), 'max elev'.padStart(10), 'cont elev'.padStart(10), 'mean T'.padStart(8), 'CO2 ppm'.padStart(9), 'checksums (fnv1a32 per field)'].join('  '),
    );
    printedHeader = true;
  }
  const elevation = keyframe.fields.elevation;
  const crustType = keyframe.fields.crustType;
  const { min, max, mean } = fieldStats(elevation);
  // >= 0: cells exactly at the datum are land (matches globals.landFraction,
  // which counts noise >= the sea-level quantile — those cells get 0 m).
  let land = 0;
  for (const e of elevation) if (e >= 0) land++;
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
      checksums,
    ].join('  '),
  );
  reportEvents(keyframe);
}

function dump(keyframe: Keyframe): void {
  for (const name of dumpFields) {
    const png = renderFieldPng(name, keyframe.fields[name], params.gridN);
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

let keyframeIndex = 0;
let finalEvents: SimEvent[] = [];
const metricsSeries: KeyframeMetrics[] = [];
run(params, untilYears, (keyframe) => {
  checkFinite(keyframe);
  if (values.report) report(keyframe);
  if (values.metrics) metricsSeries.push(computeKeyframeMetrics(keyframe, params.gridN));
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
