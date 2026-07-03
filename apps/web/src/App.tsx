import { useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { DEFAULT_GRID_N } from 'sim-kernel';
import { PlanetScene } from './PlanetScene';
import { usePlanetWorker } from './usePlanetWorker';

const DEFAULT_SEED = 42;

// History extent streamed on load. Kept modest until the memory budget + clamp
// (#27) lands; the full 4.5 Gyr scrub follows once that guardrail exists.
const DEFAULT_UNTIL_YEARS = 1e9;
const DEFAULT_KEYFRAME_INTERVAL_YEARS = 10e6;

export function App() {
  const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SEED));
  const [ready, setReady] = useState(false);
  const { current, progress, done, keyframeCount, pinnedIndex, generate, select } = usePlanetWorker({
    gridN: DEFAULT_GRID_N,
    untilYears: DEFAULT_UNTIL_YEARS,
    keyframeIntervalYears: DEFAULT_KEYFRAME_INTERVAL_YEARS,
  });

  useEffect(() => {
    if (webgpuAvailable) generate(DEFAULT_SEED);
  }, [webgpuAvailable, generate]);

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
    <div style={{ position: 'relative', width: '100%', height: '100%' }} data-planet-ready={ready ? '1' : '0'}>
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
        <PlanetScene gridN={DEFAULT_GRID_N} keyframe={current} onFirstFrame={() => setReady(true)} />
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
        {current ? (
          <span style={{ opacity: 0.7 }}>
            {(current.timeYears / 1e9).toFixed(2)} Gyr · land {(current.landFraction * 100).toFixed(1)}%
          </span>
        ) : null}
        {progress ? (
          <span style={{ opacity: 0.55 }} data-history-progress={done ? 'done' : 'streaming'}>
            {done
              ? `${progress.keyframesEmitted} keyframes`
              : `${((progress.currentYears / progress.untilYears) * 100).toFixed(0)}%`}
          </span>
        ) : null}
      </div>

      <Timeline
        keyframeCount={keyframeCount}
        pinnedIndex={pinnedIndex}
        currentYears={current?.timeYears ?? 0}
        onScrub={select}
      />
    </div>
  );
}

interface TimelineProps {
  keyframeCount: number;
  pinnedIndex: number | null;
  currentYears: number;
  onScrub: (index: number | null) => void;
}

/** Deep-time scrubber over the streamed history. Dragging pins a keyframe;
 *  the Live button resumes following the streaming edge. */
function Timeline({ keyframeCount, pinnedIndex, currentYears, onScrub }: TimelineProps) {
  if (keyframeCount === 0) return null;
  const maxIndex = keyframeCount - 1;
  const value = pinnedIndex ?? maxIndex;
  const live = pinnedIndex === null;
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
