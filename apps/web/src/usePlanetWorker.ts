import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeKeyframe, type FieldName } from 'sim-kernel';
import { historyCache, historyCacheKey } from './history/historyCache';
import type { RunHistoryRequest, WorkerRequest, WorkerResponse } from './worker/messages';

/** Where the currently-loaded history came from, for the HUD and e2e proof. */
export type HistorySource = 'cache' | 'worker' | null;

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
  // The cache key for the in-flight run, set synchronously in generate() so
  // write-through and finalize file keyframes under the right history.
  const writeKeyRef = useRef<string | null>(null);
  // null = follow the live edge; a number pins the view to that keyframe while
  // streaming continues behind it. A ref so the worker callback reads it fresh.
  const pinnedIndexRef = useRef<number | null>(null);

  const [current, setCurrent] = useState<RenderKeyframe | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [keyframeCount, setKeyframeCount] = useState(0);
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [done, setDone] = useState(false);
  const [source, setSource] = useState<HistorySource>(null);

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
          // Write through to the cache so a reload salvages the run (#24). The
          // payload is structured-cloned by IndexedDB, so the in-memory copy
          // stays usable for rendering and scrubbing.
          const writeKey = writeKeyRef.current;
          if (writeKey) void historyCache.putKeyframe(writeKey, entry);
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
        case 'historyDone': {
          setDone(true);
          const writeKey = writeKeyRef.current;
          if (writeKey) void historyCache.finalize(writeKey, historyRef.current.length);
          break;
        }
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
      const runId = ++requestIdRef.current;
      historyRef.current = [];
      pinnedIndexRef.current = null;
      setPinnedIndex(null);
      setKeyframeCount(0);
      setCurrent(null);
      setProgress(null);
      setDone(false);
      setSource(null);
      const key = historyCacheKey({ seed, gridN, untilYears, keyframeIntervalYears });
      writeKeyRef.current = key;

      // Try the cache first; a completed history hydrates instantly with no
      // worker run. Any miss/partial/corrupt/version-bump falls through to a
      // fresh streaming run that writes through to the cache as it goes.
      void (async () => {
        const cached = await historyCache.loadComplete(key);
        if (requestIdRef.current !== runId) return; // superseded during the async read

        if (cached && cached.length > 0) {
          for (const kf of cached) {
            historyRef.current.push({
              index: kf.index,
              timeYears: kf.timeYears,
              landFraction: kf.landFraction,
              payload: kf.payload,
            });
          }
          setKeyframeCount(historyRef.current.length);
          const last = historyRef.current[historyRef.current.length - 1]!;
          renderEntry(last);
          setProgress({
            currentYears: last.timeYears,
            untilYears,
            keyframesEmitted: historyRef.current.length,
          });
          setDone(true);
          setSource('cache');
          return;
        }

        setSource('worker');
        await historyCache.startRun(key);
        if (requestIdRef.current !== runId) return; // superseded while opening the run
        const request: RunHistoryRequest = {
          type: 'runHistory',
          requestId: runId,
          seed,
          gridN,
          untilYears,
          keyframeIntervalYears,
        };
        const message: WorkerRequest = request;
        worker.postMessage(message);
      })();
    },
    [gridN, untilYears, keyframeIntervalYears, renderEntry],
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

  return { current, progress, done, keyframeCount, pinnedIndex, source, generate, select, history: historyRef };
}
