import { createPlanetParams, encodeHistory } from 'sim-kernel';
import type {
  HistoryDoneMessage,
  HistoryKeyframeMessage,
  HistoryProgressMessage,
  RunHistoryRequest,
  WorkerRequest,
} from './messages';

/**
 * Simulation worker (#23): streams a full quantized history for a seed. It
 * pulls the kernel's `encodeHistory` generator one keyframe at a time, posts
 * each with its buffer transferred, then yields to the event loop so a
 * superseding `runHistory` or a `cancel` can be seen between keyframes. Only the
 * newest request is active; older ones stop at their next keyframe boundary.
 */
let activeRequestId = 0;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'runHistory') {
    activeRequestId = msg.requestId;
    void streamHistory(msg);
  } else if (msg.type === 'cancel') {
    if (msg.requestId === activeRequestId) activeRequestId = 0;
  }
};

/** A macrotask yield that lets queued messages (cancel/supersede) run. A
 *  microtask (Promise.resolve) would not — onmessage is a macrotask. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

async function streamHistory(req: RunHistoryRequest): Promise<void> {
  const id = req.requestId;
  const params = createPlanetParams({
    seed: req.seed,
    gridN: req.gridN,
    keyframeIntervalYears: req.keyframeIntervalYears,
    blockIsostasy: req.blockIsostasy,
  });

  let emitted = 0;
  for (const kf of encodeHistory(params, req.untilYears)) {
    if (activeRequestId !== id) return; // superseded or cancelled before this one
    const keyframe: HistoryKeyframeMessage = {
      type: 'historyKeyframe',
      requestId: id,
      index: kf.index,
      timeYears: kf.timeYears,
      landFraction: kf.landFraction,
      payload: kf.payload,
    };
    self.postMessage(keyframe, [kf.payload]);
    emitted++;

    const progress: HistoryProgressMessage = {
      type: 'historyProgress',
      requestId: id,
      currentYears: kf.timeYears,
      untilYears: req.untilYears,
      keyframesEmitted: emitted,
    };
    self.postMessage(progress);

    await macrotask();
    if (activeRequestId !== id) return;
  }

  const done: HistoryDoneMessage = {
    type: 'historyDone',
    requestId: id,
    keyframeCount: emitted,
    totalYears: req.untilYears,
  };
  self.postMessage(done);
}
