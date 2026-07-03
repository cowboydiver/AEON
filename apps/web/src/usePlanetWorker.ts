import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeKeyframe, type FieldName } from 'sim-kernel';
import type { RunHistoryRequest, WorkerRequest, WorkerResponse } from './worker/messages';

/** A decoded keyframe ready for the renderer (stored fields only). */
export interface RenderKeyframe {
  timeYears: number;
  landFraction: number;
  gridN: number;
  fields: Partial<Record<FieldName, Float32Array>>;
}

/** One retained history slot: metadata + the still-encoded payload (kept for
 *  the timeline scrubber, #26, which will decode on demand). */
export interface HistoryEntry {
  index: number;
  timeYears: number;
  landFraction: number;
  payload: ArrayBuffer;
}

export interface StreamProgress {
  currentYears: number;
  untilYears: number;
  keyframesEmitted: number;
}

export interface PlanetWorkerConfig {
  gridN: number;
  untilYears: number;
  keyframeIntervalYears: number;
}

/**
 * Runs the sim kernel in a Web Worker and streams a full history (#23).
 * `generate(seed)` supersedes any in-flight run. Keyframes accumulate in a ref
 * (the scrubber reads them later); `current` is the latest decoded keyframe so
 * the planet visibly evolves while it streams. Stale responses are dropped.
 */
export function usePlanetWorker({ gridN, untilYears, keyframeIntervalYears }: PlanetWorkerConfig) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const historyRef = useRef<HistoryEntry[]>([]);
  // null = follow the live edge; a number pins the view to that keyframe while
  // streaming continues behind it. A ref so the worker callback reads it fresh.
  const pinnedIndexRef = useRef<number | null>(null);

  const [current, setCurrent] = useState<RenderKeyframe | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [keyframeCount, setKeyframeCount] = useState(0);
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [done, setDone] = useState(false);

  const renderEntry = useCallback(
    (entry: HistoryEntry) => {
      const decoded = decodeKeyframe(entry.payload);
      setCurrent({
        timeYears: entry.timeYears,
        landFraction: entry.landFraction,
        gridN,
        fields: decoded.fields,
      });
    },
    [gridN],
  );

  useEffect(() => {
    const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.requestId !== requestIdRef.current) return; // superseded response
      switch (msg.type) {
        case 'historyKeyframe': {
          const entry: HistoryEntry = {
            index: msg.index,
            timeYears: msg.timeYears,
            landFraction: msg.landFraction,
            payload: msg.payload,
          };
          historyRef.current.push(entry);
          setKeyframeCount(historyRef.current.length);
          // Only advance the view if the user hasn't pinned a scrub position.
          if (pinnedIndexRef.current === null) renderEntry(entry);
          break;
        }
        case 'historyProgress':
          setProgress({
            currentYears: msg.currentYears,
            untilYears: msg.untilYears,
            keyframesEmitted: msg.keyframesEmitted,
          });
          break;
        case 'historyDone':
          setDone(true);
          break;
      }
    };
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [renderEntry]);

  const generate = useCallback(
    (seed: number) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestIdRef.current++;
      historyRef.current = [];
      pinnedIndexRef.current = null;
      setPinnedIndex(null);
      setKeyframeCount(0);
      setCurrent(null);
      setProgress(null);
      setDone(false);
      const request: RunHistoryRequest = {
        type: 'runHistory',
        requestId: requestIdRef.current,
        seed,
        gridN,
        untilYears,
        keyframeIntervalYears,
      };
      const message: WorkerRequest = request;
      worker.postMessage(message);
    },
    [gridN, untilYears, keyframeIntervalYears],
  );

  /** Pin the view to a keyframe index, or pass null to resume following live. */
  const select = useCallback(
    (index: number | null) => {
      const history = historyRef.current;
      if (index === null) {
        pinnedIndexRef.current = null;
        setPinnedIndex(null);
        const last = history.at(-1);
        if (last) renderEntry(last);
        return;
      }
      const clamped = Math.max(0, Math.min(index, history.length - 1));
      const entry = history[clamped];
      if (!entry) return;
      pinnedIndexRef.current = clamped;
      setPinnedIndex(clamped);
      renderEntry(entry);
    },
    [renderEntry],
  );

  return { current, progress, done, keyframeCount, pinnedIndex, generate, select, history: historyRef };
}
