import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import {
  DEFAULT_GRID_N,
  MECHANISMS,
  defaultMechanismToggles,
  planHistory,
  type MechanismKey,
  type MechanismToggles,
} from 'sim-kernel';
import { DEBUG_FIELDS } from 'planet-renderer';
import { PlanetScene } from './PlanetScene';
import { usePlanetWorker, type HistoryEntry } from './usePlanetWorker';

const DEFAULT_SEED = 42;

// The full deep-time span: planet formation through 4.5 Gyr, one keyframe per
// 10 Myr. `planHistory` (#27) coarsens the interval only if this would blow the
// retained-memory budget; at N=128 the request fits, so it streams as asked.
const DEFAULT_UNTIL_YEARS = 4.5e9;
const DEFAULT_KEYFRAME_INTERVAL_YEARS = 10e6;

/** Optional URL knobs: `?seed=N` deep-links a planet, `?until=Y` shortens the
 *  history span (years) — handy for a quick look and for a fast cache e2e —
 *  and `?iso=1` starts with the crustal-block isostasy prototype (#84) toggled
 *  on (kept for old links; the mechanism sidebar is the live control now). */
function readUrlParams(): { seed: number; untilYears: number; blockIsostasy: boolean } {
  const fallback = { seed: DEFAULT_SEED, untilYears: DEFAULT_UNTIL_YEARS, blockIsostasy: false };
  if (typeof window === 'undefined') return fallback;
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed'));
  const until = Number(params.get('until'));
  return {
    seed: Number.isFinite(seed) && params.has('seed') ? Math.trunc(seed) : DEFAULT_SEED,
    untilYears: Number.isFinite(until) && until > 0 ? until : DEFAULT_UNTIL_YEARS,
    blockIsostasy: params.get('iso') === '1',
  };
}

export function App() {
  const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const url = useMemo(readUrlParams, []);
  const [seedInput, setSeedInput] = useState(String(url.seed));
  // The seed of the currently requested history; a mechanism toggle re-runs
  // this seed (not whatever half-typed number sits in the input box).
  const [activeSeed, setActiveSeed] = useState(url.seed);
  const [ready, setReady] = useState(false);
  // Debug view: colour-code the individual tectonic plates instead of terrain.
  const [plateDebug, setPlateDebug] = useState(false);
  // Scalar debug field: 0 = off, 1..N false-colour a continuous field (viridis).
  const [debugField, setDebugField] = useState(0);
  // Tint the ocean by marine productivity in the beauty render (#38). Off by
  // default so the beauty surface stays byte-identical to the pre-#38 render.
  const [oceanLife, setOceanLife] = useState(false);
  // Show the reservoir time-series panel (co2/temperature/oxygen/sea level).
  const [showGraphs, setShowGraphs] = useState(false);
  // Mechanism toggle states (#84, #88-#91): seeded from the kernel defaults
  // so the sidebar always shows what is actually simulating; `?iso=1` links
  // start with the #84 prototype on.
  const [mechanisms, setMechanisms] = useState<MechanismToggles>(() => ({
    ...defaultMechanismToggles(),
    ...(url.blockIsostasy ? { blockIsostasy: true } : {}),
  }));
  // Clamp the request to the memory budget before streaming: a tight budget
  // coarsens the keyframe interval rather than dropping the tail of history.
  const plan = useMemo(
    () => planHistory(DEFAULT_GRID_N, url.untilYears, DEFAULT_KEYFRAME_INTERVAL_YEARS),
    [url.untilYears],
  );
  const { blend, progress, done, keyframeCount, pinnedPosition, source, generate, select, history } =
    usePlanetWorker({
      gridN: DEFAULT_GRID_N,
      untilYears: plan.untilYears,
      keyframeIntervalYears: plan.keyframeIntervalYears,
      mechanisms,
    });

  // Re-runs whenever the active seed changes OR `generate` is re-armed by a
  // mechanism toggle (its identity folds in `mechanisms`), so the view always
  // shows the sidebar's mechanism set.
  useEffect(() => {
    if (webgpuAvailable) generate(activeSeed);
  }, [webgpuAvailable, generate, activeSeed]);

  const regenerate = useCallback(() => {
    const seed = Number(seedInput);
    if (!Number.isFinite(seed)) return;
    setReady(false);
    const next = Math.trunc(seed);
    // Same seed: the effect won't re-fire on state identity, so run directly
    // (a completed history simply re-hydrates from the cache).
    if (next === activeSeed) generate(next);
    else setActiveSeed(next);
  }, [seedInput, generate, activeSeed]);

  const toggleMechanism = useCallback((key: MechanismKey, on: boolean) => {
    setReady(false);
    setMechanisms((prev) => ({ ...prev, [key]: on }));
  }, []);

  const streaming = progress !== null && !done;

  if (!webgpuAvailable) {
    return (
      <div style={{ padding: '2rem', maxWidth: 640 }}>
        <h1>WebGPU unavailable</h1>
        <p>
          This app requires WebGPU (Phase 0 has no WebGL fallback). Use a recent Chromium-based
          browser, or enable WebGPU in your browser settings, then reload.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      data-planet-ready={ready ? '1' : '0'}
      data-history-source={source ?? ''}
    >
      <Canvas
        camera={{ position: [0, 0.8, 2.6], fov: 50, near: 0.01, far: 200 }}
        gl={async (props) => {
          const renderer = new WebGPURenderer({
            ...(props as ConstructorParameters<typeof WebGPURenderer>[0]),
            antialias: true,
          });
          await renderer.init();
          return renderer;
        }}
      >
        <color attach="background" args={['#000000']} />
        <PlanetScene
          gridN={DEFAULT_GRID_N}
          blend={blend}
          plateDebug={plateDebug}
          debugField={debugField}
          oceanLife={oceanLife}
          onFirstFrame={() => setReady(true)}
        />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'rgba(10, 14, 24, 0.75)',
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: 14,
        }}
      >
        <label htmlFor="seed">Seed</label>
        <input
          id="seed"
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && regenerate()}
          inputMode="numeric"
          style={{ width: 90, background: '#0b1020', color: 'inherit', border: '1px solid #33405e', borderRadius: 4, padding: '4px 6px' }}
        />
        <button onClick={regenerate} disabled={streaming} style={{ padding: '4px 10px' }}>
          {streaming ? 'Generating…' : 'Regenerate'}
        </button>
        <label
          title="Show plate boundaries, coloured by crust type: oceanic vs continental (debug view)"
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
        >
          <input
            type="checkbox"
            data-plate-debug
            checked={plateDebug}
            onChange={(e) => setPlateDebug(e.target.checked)}
          />
          Plates
        </label>
        <label
          title="False-colour a single continuous field over the globe (debug view). Overrides the beauty/plate surface."
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          Field
          <select
            data-debug-field
            value={debugField}
            onChange={(e) => setDebugField(Number(e.target.value))}
            style={{ background: '#0b1020', color: 'inherit', border: '1px solid #33405e', borderRadius: 4, padding: '3px 4px' }}
          >
            <option value={0}>Off</option>
            {DEBUG_FIELDS.map((f, i) => (
              <option key={f.key} value={i + 1}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label
          title="Tint the ocean green by marine productivity (#38). Off leaves the beauty view unchanged."
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
        >
          <input
            type="checkbox"
            data-ocean-life
            checked={oceanLife}
            onChange={(e) => setOceanLife(e.target.checked)}
          />
          Ocean life
        </label>
        <label
          title="Show the reservoir time-series panel: CO₂, temperature, O₂, sea level over deep time"
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
        >
          <input
            type="checkbox"
            data-graphs-toggle
            checked={showGraphs}
            onChange={(e) => setShowGraphs(e.target.checked)}
          />
          Graphs
        </label>
        {blend ? (
          <span style={{ opacity: 0.7 }}>
            {(blend.timeYears / 1e9).toFixed(2)} Gyr · land {(blend.landFraction * 100).toFixed(1)}%
          </span>
        ) : null}
        {progress ? (
          <span style={{ opacity: 0.55 }} data-history-progress={done ? 'done' : 'streaming'}>
            {done
              ? `${progress.keyframesEmitted} keyframes`
              : `${((progress.currentYears / progress.untilYears) * 100).toFixed(0)}%`}
          </span>
        ) : null}
        {source === 'cache' ? (
          <span
            title="Hydrated from the IndexedDB history cache — no re-simulation"
            style={{ opacity: 0.6, color: '#6fae6f' }}
          >
            cached
          </span>
        ) : null}
        {plan.clamped ? (
          <span
            data-history-clamped
            title={`Memory budget coarsened the keyframe interval to ${(plan.keyframeIntervalYears / 1e6).toFixed(0)} Myr`}
            style={{ opacity: 0.6, color: '#e0b050' }}
          >
            ⚠ {(plan.keyframeIntervalYears / 1e6).toFixed(0)} Myr steps
          </span>
        ) : null}
      </div>

      {debugField > 0 ? <DebugFieldLegend index={debugField} /> : null}

      {showGraphs ? (
        <TimeSeriesPanel
          history={history.current}
          count={keyframeCount}
          currentYears={blend?.timeYears ?? 0}
          untilYears={plan.untilYears}
        />
      ) : null}

      <MechanismSidebar toggles={mechanisms} onToggle={toggleMechanism} streaming={streaming} />

      <Timeline
        keyframeCount={keyframeCount}
        pinnedPosition={pinnedPosition}
        currentYears={blend?.timeYears ?? 0}
        onScrub={select}
      />
    </div>
  );
}

interface MechanismSidebarProps {
  toggles: MechanismToggles;
  onToggle: (key: MechanismKey, on: boolean) => void;
  streaming: boolean;
}

/** Sidebar listing every togglable kernel mechanism with its live on/off
 *  state — the single place to see which mechanisms shaped the planet on
 *  screen. Toggling re-simulates immediately (an in-flight stream is
 *  superseded by the new run; completed histories re-hydrate from the
 *  cache). States that differ from the kernel default are marked, so a
 *  non-standard world is always visibly non-standard. */
function MechanismSidebar({ toggles, onToggle, streaming }: MechanismSidebarProps) {
  const defaults = useMemo(defaultMechanismToggles, []);
  return (
    <div
      data-mechanism-sidebar
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 240,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(10, 14, 24, 0.75)',
        padding: '10px 12px',
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, opacity: 0.85 }}>Mechanisms</div>
      {MECHANISMS.map((m) => {
        const nonDefault = toggles[m.key] !== defaults[m.key];
        return (
          <label
            key={m.key}
            title={m.summary}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              data-mechanism={m.key}
              checked={toggles[m.key]}
              onChange={(e) => onToggle(m.key, e.target.checked)}
            />
            <span style={{ color: nonDefault ? '#e0b050' : 'inherit' }}>
              {m.label}
              {nonDefault ? ' *' : ''}
            </span>
            <span style={{ opacity: 0.5, marginLeft: 'auto' }}>#{m.issue}</span>
          </label>
        );
      })}
      <div style={{ opacity: 0.55, fontSize: 11 }}>
        {streaming
          ? 'Toggling restarts the running simulation.'
          : 'Toggling re-simulates the planet. * = non-default.'}
      </div>
    </div>
  );
}

interface TimelineProps {
  keyframeCount: number;
  pinnedPosition: number | null;
  currentYears: number;
  onScrub: (position: number | null) => void;
}

/** Deep-time scrubber over the streamed history. Dragging pins a fractional
 *  position between keyframes (the GPU blends across it, #25); the Live button
 *  resumes following the streaming edge. */
function Timeline({ keyframeCount, pinnedPosition, currentYears, onScrub }: TimelineProps) {
  if (keyframeCount === 0) return null;
  const maxIndex = keyframeCount - 1;
  const value = pinnedPosition ?? maxIndex;
  const live = pinnedPosition === null;
  return (
    <div
      data-timeline
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        right: 16,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        background: 'rgba(10, 14, 24, 0.75)',
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <button
        onClick={() => onScrub(live ? Math.max(0, maxIndex) : null)}
        title={live ? 'Following the newest keyframe' : 'Resume following live'}
        style={{ padding: '4px 10px', minWidth: 56 }}
      >
        {live ? 'Live' : 'Go Live'}
      </button>
      <input
        type="range"
        min={0}
        max={maxIndex}
        step="any"
        value={value}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Timeline"
        style={{ flex: 1 }}
      />
      <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85, minWidth: 96, textAlign: 'right' }}>
        {(currentYears / 1e9).toFixed(2)} Gyr
      </span>
    </div>
  );
}

// Viridis anchors, matching the material's scalar debug ramp — the legend and the
// globe must read as the same colour scale.
const VIRIDIS_CSS = 'linear-gradient(90deg, #440154, #3b528b, #21908d, #5dc863, #fde725)';

/** Legend for the active scalar debug field: the viridis ramp and its display
 *  range (the same normalization the material applies), so the false colours on
 *  the globe are quantitatively readable. */
function DebugFieldLegend({ index }: { index: number }) {
  const field = DEBUG_FIELDS[index - 1];
  if (!field) return null;
  const unit = field.unit ? ` ${field.unit}` : '';
  return (
    <div
      data-debug-legend
      style={{
        position: 'absolute',
        top: 60,
        left: 12,
        width: 220,
        background: 'rgba(10, 14, 24, 0.75)',
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{field.label}</div>
      <div style={{ height: 12, borderRadius: 3, background: VIRIDIS_CSS }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.75, marginTop: 3 }}>
        <span>
          {field.min}
          {unit}
        </span>
        <span>
          {field.max}
          {unit}
        </span>
      </div>
    </div>
  );
}

interface SeriesSpec {
  label: string;
  unit: string;
  color: string;
  /** Pull the scalar from a keyframe's globals. */
  value: (e: HistoryEntry) => number;
  /** Sparkline on a log axis (for CO₂, which spans an order of magnitude). */
  log?: boolean;
  /** Format the current value for the readout. */
  format: (v: number) => string;
}

const TIME_SERIES: readonly SeriesSpec[] = [
  { label: 'CO₂', unit: 'ppm', color: '#e0894f', value: (e) => e.globals.co2, log: true, format: (v) => v.toFixed(0) },
  { label: 'Temp', unit: 'K', color: '#e05f7a', value: (e) => e.globals.meanTemperatureK, format: (v) => v.toFixed(1) },
  { label: 'O₂', unit: 'PAL', color: '#6fae6f', value: (e) => e.globals.oxygen, format: (v) => v.toFixed(3) },
  { label: 'Sea', unit: 'm', color: '#5aa9e0', value: (e) => e.globals.seaLevelM, format: (v) => v.toFixed(0) },
];

const SPARK_W = 200;
const SPARK_H = 26;

/** Build an SVG polyline (in `SPARK_W`×`SPARK_H` space) for one series over the
 *  history, normalized to its own min/max (log-scaled when asked). Flat when the
 *  series is constant. */
function sparkPoints(history: HistoryEntry[], spec: SeriesSpec, untilYears: number): string {
  if (history.length === 0) return '';
  const tx = (v: number) => (spec.log ? Math.log10(Math.max(v, 1e-9)) : v);
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of history) {
    const v = tx(spec.value(e));
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  return history
    .map((e) => {
      const x = untilYears > 0 ? (e.timeYears / untilYears) * SPARK_W : 0;
      const norm = span > 0 ? (tx(spec.value(e)) - lo) / span : 0.5;
      const y = SPARK_H - norm * (SPARK_H - 2) - 1; // 1px padding top/bottom
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

interface TimeSeriesPanelProps {
  history: HistoryEntry[];
  /** Keyframe count — a state value, so the panel re-renders as the (ref-held)
   *  history grows during streaming. */
  count: number;
  currentYears: number;
  untilYears: number;
}

/**
 * Small-multiples sparklines for the well-mixed reservoir globals — CO₂, mean
 * temperature, O₂, sea level — the scalars that drive the carbon/climate/
 * oxygenation systems but live in no per-cell field, so they are otherwise
 * invisible at render. Each row is normalized to its own range; a shared marker
 * tracks the scrubbed time, and the readout shows the value there.
 */
function TimeSeriesPanel({ history, count, currentYears, untilYears }: TimeSeriesPanelProps) {
  // `count` participates in render so the ref-held history redraws while streaming.
  void count;
  if (history.length === 0) return null;
  // Nearest keyframe to the playhead, for the per-series value readout.
  let nearest = history[0]!;
  for (const e of history) {
    if (Math.abs(e.timeYears - currentYears) < Math.abs(nearest.timeYears - currentYears)) nearest = e;
  }
  const markerX = untilYears > 0 ? (currentYears / untilYears) * SPARK_W : 0;
  return (
    <div
      data-timeseries
      style={{
        position: 'absolute',
        bottom: 76,
        left: 16,
        width: 268,
        background: 'rgba(10, 14, 24, 0.8)',
        padding: '10px 12px',
        borderRadius: 8,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontWeight: 600, opacity: 0.85 }}>Reservoirs</div>
      {TIME_SERIES.map((spec) => (
        <div key={spec.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 30, color: spec.color }}>{spec.label}</span>
          <svg width={SPARK_W} height={SPARK_H} style={{ display: 'block', flexShrink: 0 }}>
            <polyline
              points={sparkPoints(history, spec, untilYears)}
              fill="none"
              stroke={spec.color}
              strokeWidth={1.2}
            />
            <line x1={markerX} y1={0} x2={markerX} y2={SPARK_H} stroke="#ffffff" strokeWidth={0.6} opacity={0.5} />
          </svg>
          <span style={{ width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
            {spec.format(spec.value(nearest))}
          </span>
        </div>
      ))}
      <div style={{ opacity: 0.5, fontSize: 10 }}>Each row scaled to its own range · white line = playhead</div>
    </div>
  );
}
