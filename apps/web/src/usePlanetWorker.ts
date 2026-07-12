import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeKeyframe, type FieldName, type KeyframeGlobals, type MechanismToggles } from 'sim-kernel';
import { historyCache, historyCacheKey } from './history/historyCache';
import type { RunHistoryRequest, WorkerRequest, WorkerResponse } from './worker/messages';

/** Where the currently-loaded history came from, for the HUD and e2e proof. */
export type HistorySource = 'cache' | 'worker' | null;

/** Decoded fields of one keyframe (stored fields only). */
type DecodedFields = Partial<Record<FieldName, Float32Array>>;

/**
 * The renderer's view of a scrub position: the two bracketing keyframes plus a
 * fraction between them (#25). The GPU blends A→B by `fraction`; when the
 * playhead sits on an exact keyframe (or the history has a single frame),
 * aIndex === bIndex and fraction is 0. `timeYears`/`landFraction` are linearly
 * interpolated for the HUD.
 */
export interface RenderBlend {
  aIndex: number;
  bIndex: number;
  aFields: DecodedFields;
  bFields: DecodedFields;
  fraction: number;
  timeYears: number;
  landFraction: number;
  gridN: number;
}

/** One retained history slot: metadata + the still-encoded payload (decoded on demand). */
export interface HistoryEntry {
  index: number;
  timeYears: number;
  landFraction: number;
  /** Scalar reservoir globals for the time-series panel (see `KeyframeGlobals`). */
  globals: KeyframeGlobals;
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
  /** On/off state for every togglable mechanism (#84, #88-#91) — the
   *  sidebar's toggle record. A new record identity re-arms `generate`, so
   *  pass a stable object (state), not a fresh literal per render. */
  mechanisms: MechanismToggles;
}

/**
 * Runs the sim kernel in a Web Worker and streams a full history (#23), then
 * exposes it as a continuously-scrubbable blend (#25). Keyframes accumulate in a
 * ref; `blend` is the bracketing pair + fraction the renderer morphs between.
 * `select(position | null)` pins a fractional keyframe position or follows the
 * live streaming edge. Keyframes are decoded lazily and cached, so scrubbing
 * within a bracket costs nothing and crossing a boundary decodes at most one new
 * keyframe (never per animation frame).
 */
export function usePlanetWorker({
  gridN,
  untilYears,
  keyframeIntervalYears,
  mechanisms,
}: PlanetWorkerConfig) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const historyRef = useRef<HistoryEntry[]>([]);
  // Decoded-field cache keyed by keyframe index. Kept tiny: only indices in the
  // current bracket survive, so at most ~2 decoded field-sets are retained.
  const decodeCacheRef = useRef<Map<number, DecodedFields>>(new Map());
  // The cache key for the in-flight run, set synchronously in generate() so
  // write-through and finalize file keyframes under the right history.
  const writeKeyRef = useRef<string | null>(null);
  // null = follow the live edge; a number pins the view to that fractional
  // keyframe position while streaming continues. A ref so the worker callback
  // reads it fresh.
  const pinnedPositionRef = useRef<number | null>(null);

  const [blend, setBlend] = useState<RenderBlend | null>(null);
  const [pinnedPosition, setPinnedPosition] = useState<number | null>(null);
  const [keyframeCount, setKeyframeCount] = useState(0);
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [done, setDone] = useState(false);
  const [source, setSource] = useState<HistorySource>(null);

  // Build the blend view for a position (null = live edge = the last keyframe).
  // Reads historyRef/decodeCache directly so it is safe to call from the worker
  // callback and from select(). Decodes only the two bracketing keyframes and
  // evicts any others, so the cache never grows with scrub distance.
  const buildBlend = useCallback(
    (position: number | null): RenderBlend | null => {
      const history = historyRef.current;
      const n = history.length;
      if (n === 0) return null;

      const clamped = Math.max(0, Math.min(position ?? n - 1, n - 1));
      const ai = Math.floor(clamped);
      const bi = Math.min(ai + 1, n - 1);
      const fraction = bi === ai ? 0 : clamped - ai;

      const cache = decodeCacheRef.current;
      for (const key of cache.keys()) {
        if (key !== ai && key !== bi) cache.delete(key);
      }
      const decode = (index: number): DecodedFields => {
        let fields = cache.get(index);
        if (!fields) {
          fields = decodeKeyframe(history[index]!.payload).fields;
          cache.set(index, fields);
        }
        return fields;
      };

      const a = history[ai]!;
      const b = history[bi]!;
      return {
        aIndex: ai,
        bIndex: bi,
        aFields: decode(ai),
        bFields: decode(bi),
        fraction,
        timeYears: a.timeYears + (b.timeYears - a.timeYears) * fraction,
        landFraction: a.landFraction + (b.landFraction - a.landFraction) * fraction,
        gridN,
      };
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
            globals: msg.globals,
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
          if (pinnedPositionRef.current === null) setBlend(buildBlend(null));
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
  }, [buildBlend]);

  const generate = useCallback(
    (seed: number) => {
      const worker = workerRef.current;
      if (!worker) return;
      const runId = ++requestIdRef.current;
      historyRef.current = [];
      decodeCacheRef.current.clear();
      pinnedPositionRef.current = null;
      setPinnedPosition(null);
      setKeyframeCount(0);
      setBlend(null);
      setProgress(null);
      setDone(false);
      setSource(null);
      const key = historyCacheKey({ seed, gridN, untilYears, keyframeIntervalYears, mechanisms });
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
              globals: kf.globals,
              payload: kf.payload,
            });
          }
          setKeyframeCount(historyRef.current.length);
          setBlend(buildBlend(null));
          const last = historyRef.current[historyRef.current.length - 1]!;
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
          mechanisms,
        };
        const message: WorkerRequest = request;
        worker.postMessage(message);
      })();
    },
    [gridN, untilYears, keyframeIntervalYears, mechanisms, buildBlend],
  );

  /** Pin the view to a fractional keyframe position, or null to follow live. */
  const select = useCallback(
    (position: number | null) => {
      pinnedPositionRef.current = position;
      setPinnedPosition(position);
      setBlend(buildBlend(position));
    },
    [buildBlend],
  );

  return {
    blend,
    progress,
    done,
    keyframeCount,
    pinnedPosition,
    source,
    generate,
    select,
    history: historyRef,
  };
}
