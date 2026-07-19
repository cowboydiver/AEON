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
  /** `emergentSuture` (#112) loud backstop: a cont–cont contact that persisted
   *  `SUTURE_TIMEOUT_YEARS` without ever stalling long enough was merged anyway.
   *  Distinct from `plateSuture` so the stall-never-fires failure mode is visible
   *  in the event log; each one is a documented stall-criterion miss. */
  sutureTimeout: 'sutureTimeout',
  /** A plate whose last cell was consumed by advection (fully subducted / overridden). */
  plateConsumed: 'plateConsumed',
  /** Plate-slot pressure heads-up (#127 item 7): the monotonically growing
   *  plate-slot table (ids handed out densely from 0, dead slots never
   *  reclaimed) first crossed `PLATE_SLOT_WARN_COUNT` — a visible warning well
   *  before the history codec's `plateId < 256` categorical ceiling, whose
   *  per-cell assertion is otherwise the only (loud, mid-run) backstop. Data
   *  `{slots, limit}`. Dormant on shipped worlds (measured deep-time peak 176). */
  plateSlotPressure: 'plateSlotPressure',
  /** Ocean life originates (sets `globals.abiogenesisYear`), #37. */
  abiogenesis: 'abiogenesis',
  /** `globals.oxygen` first crosses the oxidation threshold — the emergent Great Oxidation, #37. */
  greatOxidation: 'greatOxidation',
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
