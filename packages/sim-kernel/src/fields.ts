/**
 * The single source of truth for per-cell field names. Every field is a
 * Float32Array of length cellCount(gridN) in flat cube-sphere index order.
 * Iteration order over FIELDS is the (deterministic) insertion order below —
 * JS guarantees string-key insertion order, and this object never changes at
 * runtime.
 */

export const FIELDS = {
  elevation: { unit: 'm', description: 'Surface height relative to the 0 m datum (sea level)' },
  crustAge: { unit: 'yr', description: 'Age of crust at the cell (all zero in Phase 0)' },
  temperature: { unit: 'K', description: 'Mean surface air temperature' },
  precipitation: { unit: 'kg/m^2/yr', description: 'Annual precipitation (all zero in Phase 0)' },
  iceFraction: { unit: '1', description: 'Fraction of cell covered by ice, 0-1 (zero in Phase 0)' },
  biome: { unit: 'index', description: 'Biome class index (all zero in Phase 0)' },
  plateId: {
    unit: 'index',
    description: 'Owning plate: index into PlanetState.plates (small integers stored in float32, exact up to 2^24)',
  },
  crustType: {
    unit: 'flag',
    description: 'Crust type: 0 = oceanic (subductable, follows age-depth), 1 = continental (buoyant, never subducts)',
  },
  boundaryStress: {
    unit: 'm/yr',
    description:
      'Signed normal closing speed at plate-boundary cells: + convergent, - divergent, ~0 transform. Exactly 0 in plate interiors; recomputed every step',
  },
  // Appended last deliberately: the codec's wire fieldId is FIELD_NAMES.indexOf,
  // so inserting earlier would renumber stored fields and break codec goldens.
  sutureYears: {
    unit: 'yr',
    description:
      'Sim time at which a continent-continent suture last welded this cell (0 = never). Crust property: advects with plate motion; fresh ocean and fresh arc crust carry 0',
  },
} as const;

export type FieldName = keyof typeof FIELDS;

export const FIELD_NAMES = Object.keys(FIELDS) as readonly FieldName[];

export type Fields = Record<FieldName, Float32Array>;
