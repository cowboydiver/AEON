/**
 * Discrete simulation events, recorded alongside keyframes (HANDOVER §2).
 * Phase 2 renders them as timeline markers; Phase 4 grows them into the
 * narrated planetary history. First producers: Wilson cycles (#18).
 *
 * Purity rule: systems never mutate the event list — they return a new state
 * with `events: [...state.events, newEvent]`, and an appended event's
 * timeYears must be the state's current time. Events are appended in
 * simulation order, so the list is deterministic whenever the fields are.
 */

/** Event kinds: single source of truth, like FIELDS (no scattered strings). */
export const EVENT_KINDS = {
  plateRift: 'plateRift',
  plateSuture: 'plateSuture',
} as const;

export type SimEventKind = (typeof EVENT_KINDS)[keyof typeof EVENT_KINDS];

export interface SimEvent {
  timeYears: number;
  kind: SimEventKind;
  /** Numeric payload only (plate ids, sizes, …): trivially deterministic and serializable. */
  data?: Record<string, number>;
}

/** Deep-copy an event list (keyframes must not alias live state). */
export function copyEvents(events: readonly SimEvent[]): SimEvent[] {
  return events.map((e) => ({ ...e, ...(e.data ? { data: { ...e.data } } : {}) }));
}
