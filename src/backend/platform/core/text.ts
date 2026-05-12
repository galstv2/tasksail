import { loadMarkdownContract } from '../workflow-policy/contracts/markdownContract.js';

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

export function stripHtmlComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Extract the body content of a markdown ## section by heading name.
 * Returns empty string if the section is not found.
 */
export function extractMarkdownSection(
  content: string,
  sectionName: string,
): string {
  const contract = loadMarkdownContract();
  const lines = content.split(/\r?\n/);
  const body: string[] = [];
  let inSection = false;
  let inFence: string | null = null;

  for (const rawLine of lines) {
    if (inFence && rawLine.trim() === inFence) {
      inFence = null;
    } else {
      const fenceMatch = contract.compiled.fenceOpen.exec(rawLine);
      if (fenceMatch?.[contract.groups.fenceMarker]) {
        inFence = fenceMatch[contract.groups.fenceMarker]!;
      }
    }

    if (!inFence) {
      const headingMatch = contract.compiled.heading.exec(rawLine);
      const heading = headingMatch?.[contract.groups.headingName]?.trim();
      if (heading !== undefined) {
        if (inSection) {
          break;
        }
        if (heading === sectionName) {
          inSection = true;
        }
        continue;
      }
    }

    if (inSection) {
      body.push(rawLine);
    }
  }

  return body.join('\n').trim();
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
