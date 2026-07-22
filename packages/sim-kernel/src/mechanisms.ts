/**
 * Registry of the togglable mechanism prototypes (#84, #88-#91): the single
 * source of truth for UIs that expose mechanism switches (the web sidebar,
 * harness help text, docs). Each entry is a boolean `PlanetParams` gate with
 * a paired `<key>OnsetYears` param carrying the branched-A/B contract.
 *
 * Defaults are NOT duplicated here — `defaultMechanismToggles()` reads them
 * from `createPlanetParams`, so a future promotion/demotion can never leave
 * a UI showing stale default states.
 */
import { createPlanetParams, type PlanetParams } from './state';

/** The boolean `PlanetParams` keys that gate a togglable mechanism. */
export type MechanismKey =
  | 'blockIsostasy'
  | 'crustFates'
  | 'compactArcs'
  | 'marinePlanation'
  | 'emergentArcTaper'
  | 'seaLevelDatums'
  | 'freeboard'
  | 'bathymetryDatum'
  | 'forceKinematics'
  | 'emergentSuture'
  | 'tensionRift'
  | 'crustalColumns';

export interface MechanismInfo {
  key: MechanismKey;
  /** Short human label for toggles and legends. */
  label: string;
  /** The GitHub issue that specified the mechanism, when one exists
   *  (seaLevelDatums was specified by docs/SEA_LEVEL_DATUM_FINDINGS.md). */
  issue?: number;
  /** One-sentence description, suitable for a tooltip. */
  summary: string;
}

export const MECHANISMS: readonly MechanismInfo[] = [
  {
    key: 'crustFates',
    label: 'Crust fates + docking',
    issue: 88,
    summary:
      'Small continental fragments weld onto nearby continents across short straits (terrane docking); isolated ones drown and their crust record retires.',
  },
  {
    key: 'compactArcs',
    label: 'Compact arc maturation',
    issue: 89,
    summary:
      'New continental crust matures only against ≥2 continental neighbors, growing compact blobs instead of island chains. INCOMPATIBLE with the promoted V2 defaults (#127 item 9): arc maturation is the busy V2 world’s dominant crust source, and this flag alone starves it to ~9% of the sphere (findings §3) — designed against main’s quieter engine, kept default-off.',
  },
  {
    key: 'marinePlanation',
    label: 'Marine planation',
    issue: 90,
    summary:
      'Wave attack planes small islands down to the continental-shelf level, conservatively moving the mass into ocean sediment.',
  },
  {
    key: 'emergentArcTaper',
    label: 'Emergent-arc taper',
    issue: 91,
    summary:
      'Arc growth above sea level is heavily tapered, so only long-lived subduction margins build emergent island-arc chains. INCOMPATIBLE with the promoted V2 defaults (#127 item 9): it chokes the V2 world’s dominant crust source, collapsing continental crust to ~4–6% of the sphere (findings §3) — kept default-off.',
  },
  {
    key: 'blockIsostasy',
    label: 'Block isostasy',
    issue: 84,
    summary:
      'Per-component elevation ceilings founder small continental blocks (the #84 prototype, superseded by crust fates + docking).',
  },
  {
    key: 'seaLevelDatums',
    label: 'Sea-level-anchored datums',
    summary:
      'Platform and arc datums (founder level, sediment shelf ceiling, arc maturation gate and island ceiling) key off the dynamic sea level instead of the fixed 0 m datum, so drowned platforms and shallow shelves survive the deep-time sea-level fall.',
  },
  {
    key: 'freeboard',
    label: 'Freeboard regulation',
    summary:
      'Continental crust floats: mean continental elevation relaxes toward a target freeboard above the dynamic sea level, passive margins subside toward shelf depth, and the land-relief datums (orogeny ceiling, orogenic-root reference) ride the sea level — restoring flooded shelves and epicontinental seas.',
  },
  {
    key: 'bathymetryDatum',
    label: 'Sea-level-keyed bathymetry',
    issue: 102,
    summary:
      'The oceanic age-depth reference (ridge crest, trench pinning, gap fill, shelf room) keys off the dynamic sea level instead of the fixed 0 m datum, so mid-ocean ridge crests stay submerged instead of crossing the late-time oceans as emergent island chains. Designed to run on top of seaLevelDatums + freeboard.',
  },
  {
    key: 'forceKinematics',
    label: 'Force-balance kinematics',
    issue: 111,
    summary:
      'A per-step rigid-plate torque balance (slab pull, ridge push, collision damping, closed by basal drag) makes each plate’s angular velocity derived state that responds to what the plate touches, instead of a fixed random draw made once at creation.',
  },
  {
    key: 'emergentSuture',
    label: 'Stall-triggered suture',
    issue: 112,
    summary:
      'Continent–continent pairs suture when force-balance collision damping stalls their closing speed (detected), with a loud timeout backstop, instead of on a fixed contact countdown (scheduled); the merged plate keeps the drag-tensor-weighted blend of the two angular velocities.',
  },
  {
    key: 'tensionRift',
    label: 'Tension-driven rifting',
    issue: 113,
    summary:
      'Rift timing follows a physical hazard ∝ (boundary tension)² × a supercontinent thermal-blanket factor: a plate rifts because its opposed subducting perimeter is pulling it apart, replacing the flat Bernoulli hazard × the hand-tuned size ramp. Requires force-balance kinematics for a non-zero tension.',
  },
  {
    key: 'crustalColumns',
    label: 'Crustal columns',
    summary:
      'Crustal thickness becomes the primary vertical state: continental elevation is derived by Airy isostasy over a fixed datum (docs/CRUSTAL_COLUMN_PROPOSAL.md), so freeboard, cratonic platforms and foundering become consequences of a mass budget instead of servo targets. Stage C6: the migration is mechanism-complete — every continental write site is a thickness transaction (the last shim, the passive margin, retired for finite-β rift thinning); C7 calibration + the water sweep gate promotion.',
  },
] satisfies readonly MechanismInfo[];

/** On/off states for every mechanism, e.g. a UI's toggle state. */
export type MechanismToggles = Record<MechanismKey, boolean>;

/**
 * Mechanism → its required prerequisite mechanism (#127 item 6). `tensionRift`
 * and `emergentSuture` both read state only `forceKinematics` produces, so
 * enabling either without it is a silently degenerate world — the kernel rejects
 * the combo (`validateKinematicDependencies` in state.ts). This map is the UI-
 * facing form of that dependency: a sidebar can gray out a dependent whose
 * prerequisite is off, and `resolveMechanismDependencies` cascades it.
 */
export const MECHANISM_PREREQUISITE: Partial<Record<MechanismKey, MechanismKey>> = {
  tensionRift: 'forceKinematics',
  emergentSuture: 'forceKinematics',
};

/**
 * Normalize a UI toggle set so it never expresses a degenerate partial-flag
 * config (#127 item 6): any mechanism whose prerequisite (per
 * `MECHANISM_PREREQUISITE`) is off is forced off too. Pure; returns the same
 * reference when nothing changes so callers can cheaply detect a no-op. A UI
 * should route toggle edits through this before handing them to
 * `createPlanetParams` (which throws on the un-normalized degenerate combo).
 */
export function resolveMechanismDependencies(toggles: MechanismToggles): MechanismToggles {
  let resolved: MechanismToggles | undefined;
  for (const [dependent, prerequisite] of Object.entries(MECHANISM_PREREQUISITE) as [
    MechanismKey,
    MechanismKey,
  ][]) {
    if (toggles[dependent] && !toggles[prerequisite]) {
      resolved ??= { ...toggles };
      resolved[dependent] = false;
    }
  }
  return resolved ?? toggles;
}

/** The kernel-default toggle states, read live from `createPlanetParams`.
 *  (The seed is irrelevant — mechanism defaults are seed-independent.) */
export function defaultMechanismToggles(): MechanismToggles {
  const defaults: PlanetParams = createPlanetParams({ seed: 0 });
  return Object.fromEntries(MECHANISMS.map((m) => [m.key, defaults[m.key]])) as MechanismToggles;
}
