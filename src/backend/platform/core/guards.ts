/**
 * Type guard utilities shared across platform modules.
 */

/** Narrow an unknown value to a string-keyed record (non-null, non-array object). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True for filesystem errors that mean "the path is not there" — either the
 * entry is missing (ENOENT) or a parent component is not a directory (ENOTDIR).
 * Both are typically the same "treat as absent" case at the call site.
 */
export function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
