/**
 * Remove leading and trailing whitespace from a string.
 */
export function trimWhitespace(value: string): string {
  return value.trim();
}

/**
 * Remove wrapping single or double quotes from a string.
 */
export function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Convert a string to a URL-safe slug.
 * Lowercases, replaces non-alphanumeric runs with hyphens,
 * and trims leading/trailing hyphens.
 */
export function slugify(value: string, defaultValue = 'task'): string {
  let result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/-+/g, '-');

  if (result === '') {
    result = defaultValue;
  }

  return result;
}

/**
 * Escape a string for safe embedding in JSON.
 */
export function jsonEscapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Extract YAML-style frontmatter from a markdown string.
 * Returns the frontmatter content (without delimiters) and the body after it.
 * Returns null frontmatter if none is present.
 */
export function extractFrontmatter(
  content: string,
): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }
  return { frontmatter: match[1], body: match[2] };
}

/**
 * Extract the body content of a markdown ## section by heading name.
 * Returns empty string if the section is not found.
 */
export function extractMarkdownSection(
  content: string,
  sectionName: string,
): string {
  const regex = new RegExp(
    `^## ${escapeRegExp(sectionName)}\\s*\\r?\\n([\\s\\S]*?)(?=^## |\\Z)`,
    'm',
  );
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ISO-8601 timestamp without fractional seconds (e.g. "2026-04-03T12:00:00Z").
 */
export function nowIsoCompact(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Extract a human-readable message from an unknown caught error.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
