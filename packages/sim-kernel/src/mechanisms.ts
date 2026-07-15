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
  | 'tensionRift';

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
      'New continental crust matures only against ≥2 continental neighbors, growing compact blobs instead of island chains.',
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
      'Arc growth above sea level is heavily tapered, so only long-lived subduction margins build emergent island-arc chains.',
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
] satisfies readonly MechanismInfo[];

/** On/off states for every mechanism, e.g. a UI's toggle state. */
export type MechanismToggles = Record<MechanismKey, boolean>;

/** The kernel-default toggle states, read live from `createPlanetParams`.
 *  (The seed is irrelevant — mechanism defaults are seed-independent.) */
export function defaultMechanismToggles(): MechanismToggles {
  const defaults: PlanetParams = createPlanetParams({ seed: 0 });
  return Object.fromEntries(MECHANISMS.map((m) => [m.key, defaults[m.key]])) as MechanismToggles;
}
