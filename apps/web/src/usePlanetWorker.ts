import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerateRequest, KeyframeMessage } from './worker/messages';

/**
 * Runs the sim kernel in a Web Worker. generate(seed) posts a request; the
 * latest keyframe (transferred buffers) lands in `keyframe`. Stale responses
 * from superseded requests are dropped.
 */
export function usePlanetWorker(gridN: number) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [keyframe, setKeyframe] = useState<KeyframeMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('./worker/simWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<KeyframeMessage>) => {
      if (event.data.type !== 'keyframe' || event.data.requestId !== requestIdRef.current) return;
      setKeyframe(event.data);
      setBusy(false);
    };
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, []);

  const generate = useCallback(
    (seed: number) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestIdRef.current++;
      setBusy(true);
      const request: GenerateRequest = {
        type: 'generate',
        requestId: requestIdRef.current,
        seed,
        gridN,
      };
      worker.postMessage(request);
    },
    [gridN],
  );

  return { keyframe, busy, generate };
}
