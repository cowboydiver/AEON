import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { DEFAULT_GRID_N, planHistory } from 'sim-kernel';
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
 *  and `?iso=1` enables the crustal-block isostasy prototype (#84) for
 *  side-by-side visual inspection against the default kernel. */
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
  const [ready, setReady] = useState(false);
  // Debug view: colour-code the individual tectonic plates instead of terrain.
  const [plateDebug, setPlateDebug] = useState(false);
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
      blockIsostasy: url.blockIsostasy,
    });

  useEffect(() => {
    if (webgpuAvailable) generate(url.seed);
  }, [webgpuAvailable, generate, url.seed]);

  const regenerate = useCallback(() => {
    const seed = Number(seedInput);
    if (!Number.isFinite(seed)) return;
    setReady(false);
    generate(Math.trunc(seed));
  }, [seedInput, generate]);

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
          title="Colour-code each tectonic plate (debug view)"
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
        {url.blockIsostasy ? (
          <span
            title="Crustal-block isostasy prototype enabled (#84) — remove ?iso=1 for the default kernel"
            style={{ opacity: 0.6, color: '#c08de0' }}
          >
            iso
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

      <Timeline
        keyframeCount={keyframeCount}
        pinnedPosition={pinnedPosition}
        currentYears={blend?.timeYears ?? 0}
        onScrub={select}
      />
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
