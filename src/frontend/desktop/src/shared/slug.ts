/**
 * Shared slug utility - single source of truth for pack ID generation.
 * Imported by both the renderer (useContextPackDraft.ts) and the main process
 * (main.contextPackShared.ts) so IDs produced in the UI and on disk are
 * byte-identical.
 */

/**
 * Convert a display name into a URL-safe, lowercase, hyphenated slug.
 * Falls back to "context-pack" when the input normalises to an empty string.
 *
 * Examples:
 *   "My Pack 2026!" -> "my-pack-2026"
 *   "  hello  "    -> "hello"
 *   ""             -> "context-pack"
 */
export function slugifyValue(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'context-pack';
}
