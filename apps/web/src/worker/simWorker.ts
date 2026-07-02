import { createInitialState, createPlanetParams, snapshotKeyframe, FIELD_NAMES } from 'sim-kernel';
import type { GenerateRequest, KeyframeMessage } from './messages';

/**
 * Simulation worker: generates the initial planet state for a seed and posts
 * the t=0 keyframe with transferred buffers. Later phases run full histories
 * here; the message shape already carries timeYears for that.
 */
self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const { type, requestId, seed, gridN } = event.data;
  if (type !== 'generate') return;

  const params = createPlanetParams({ seed, gridN });
  const state = createInitialState(params);
  const keyframe = snapshotKeyframe(state);

  const message: KeyframeMessage = {
    type: 'keyframe',
    requestId,
    timeYears: keyframe.timeYears,
    gridN,
    landFraction: state.globals.landFraction,
    fields: keyframe.fields,
  };
  self.postMessage(
    message,
    FIELD_NAMES.map((name) => keyframe.fields[name].buffer),
  );
};
