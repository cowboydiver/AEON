/**
 * Worker protocol for Phase 2 progressive full-history streaming (#23).
 *
 * The main thread asks for a whole history; the worker steps the kernel and
 * streams one quantized keyframe at a time (payload ArrayBuffers are
 * transferred, not copied). A later `runHistory` supersedes an in-flight one by
 * `requestId`; `cancel` stops it. The worker checks the active id between
 * keyframes, so both are honored within one keyframe's step budget.
 */

/** Main thread -> worker: generate the full history for a seed. */
export interface RunHistoryRequest {
  type: 'runHistory';
  requestId: number;
  seed: number;
  gridN: number;
  untilYears: number;
  keyframeIntervalYears: number;
}

/** Main thread -> worker: stop the given in-flight request if still active. */
export interface CancelRequest {
  type: 'cancel';
  requestId: number;
}

export type WorkerRequest = RunHistoryRequest | CancelRequest;

/** Worker -> main: one encoded keyframe; `payload` is transferred. */
export interface HistoryKeyframeMessage {
  type: 'historyKeyframe';
  requestId: number;
  index: number;
  timeYears: number;
  landFraction: number;
  payload: ArrayBuffer;
}

/** Worker -> main: streaming progress for the request. */
export interface HistoryProgressMessage {
  type: 'historyProgress';
  requestId: number;
  currentYears: number;
  untilYears: number;
  keyframesEmitted: number;
}

/** Worker -> main: the history finished (not sent if superseded/cancelled). */
export interface HistoryDoneMessage {
  type: 'historyDone';
  requestId: number;
  keyframeCount: number;
  totalYears: number;
}

export type WorkerResponse =
  | HistoryKeyframeMessage
  | HistoryProgressMessage
  | HistoryDoneMessage;
