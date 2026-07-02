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
} as const;

export type FieldName = keyof typeof FIELDS;

export const FIELD_NAMES = Object.keys(FIELDS) as readonly FieldName[];

export type Fields = Record<FieldName, Float32Array>;
