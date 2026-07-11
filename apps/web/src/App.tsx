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
import { PlanetScene } from './PlanetScene';
import { usePlanetWorker } from './usePlanetWorker';

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
  const { blend, progress, done, keyframeCount, pinnedPosition, source, generate, select } =
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
