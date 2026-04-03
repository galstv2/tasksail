/**
 * Split a multiline string into trimmed, non-empty lines.
 * Used for converting textarea content to string-array payloads.
 */
export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
