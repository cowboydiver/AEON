import type { FieldName } from 'sim-kernel';

/** Main thread -> worker. */
export interface GenerateRequest {
  type: 'generate';
  requestId: number;
  seed: number;
  gridN: number;
}

/** Worker -> main thread. Field buffers are transferred, not copied twice. */
export interface KeyframeMessage {
  type: 'keyframe';
  requestId: number;
  timeYears: number;
  gridN: number;
  landFraction: number;
  fields: Record<FieldName, Float32Array>;
}
