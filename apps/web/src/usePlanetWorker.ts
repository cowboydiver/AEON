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
  const [current, setCurrent] = useState<RenderKeyframe | null>(null);
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.requestId !== requestIdRef.current) return; // superseded response
      switch (msg.type) {
        case 'historyKeyframe': {
          historyRef.current.push({
            index: msg.index,
            timeYears: msg.timeYears,
            landFraction: msg.landFraction,
            payload: msg.payload,
          });
          const decoded = decodeKeyframe(msg.payload);
          setCurrent({
            timeYears: msg.timeYears,
            landFraction: msg.landFraction,
            gridN,
            fields: decoded.fields,
          });
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
  }, [gridN]);

  const generate = useCallback(
    (seed: number) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestIdRef.current++;
      historyRef.current = [];
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

  return { current, progress, done, generate, history: historyRef };
}
