/**
 * Type guard utilities shared across platform modules.
 */

/** Narrow an unknown value to a string-keyed record (non-null, non-array object). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
