import type { NamedAgentTeam } from './types.js';

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const AGENT_ID_ALIASES: Record<string, string> = {
  lily: 'planning-agent',
  alice: 'product-manager',
  dalton: 'software-engineer',
  ron: 'qa',
};

const ISSUES_NON_FINDING_SECTIONS = new Set(['Task Metadata', 'Review Outcome']);

export function stripHtmlComments(lines: readonly string[]): string[] {
  return lines.join('\n').replace(HTML_COMMENT_RE, '').split('\n');
}

export function normalizeText(lines: readonly string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

export function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeAgentId(value: string): string {
  const normalized = value.replace(HTML_COMMENT_RE, '').trim().toLowerCase();
  return AGENT_ID_ALIASES[normalized] ?? normalized;
}

export function readAgentIdFromSection(
  sections: Record<string, string[]>,
  sectionName: string,
): string {
  return normalizeAgentId(normalizeText(sections[sectionName] ?? []));
}

export function decisionOwnerMatchesAgent(
  value: string,
  agentKey: string,
  namedAgentTeam: NamedAgentTeam,
): boolean {
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    return false;
  }

  const tokens = new Set(normalized.split(/\s+/));
  const agent = namedAgentTeam[agentKey];
  if (!agent) {
    return false;
  }

  const roleTokens = new Set(normalizeIdentifier(agent.role).split(/\s+/).filter(Boolean));
  const nameTokens = new Set(normalizeIdentifier(agent.name).split(/\s+/).filter(Boolean));

  const roleMatches = [...roleTokens].every((token) => tokens.has(token));
  const nameMatches = [...nameTokens].every((token) => tokens.has(token));

  if (roleMatches || nameMatches) {
    return true;
  }

  return agentKey === 'product-manager' && tokens.has('pm');
}

export function agentIdExists(value: string, namedAgentTeam: NamedAgentTeam): boolean {
  return normalizeAgentId(value) in namedAgentTeam;
}

export function issuesSectionsHaveFindings(sections: Record<string, string[]>): boolean {
  return Object.entries(sections).some(([sectionName, lines]) => {
    if (ISSUES_NON_FINDING_SECTIONS.has(sectionName)) {
      return false;
    }
    return normalizeText(stripHtmlComments(lines)).length > 0;
  });
}

export function issuesHaveBlockingFindings(sections: Record<string, string[]>): boolean {
  const severityText = normalizeText(stripHtmlComments(sections.Severity ?? [])).toLowerCase();
  return severityText.includes('blocking');
}

export function markdownSectionsHaveContent(
  sections: Record<string, string[]>,
  options: { excludedSections?: ReadonlySet<string> } = {},
): boolean {
  const excludedSections = options.excludedSections ?? new Set<string>();
  return Object.entries(sections).some(([sectionName, lines]) => (
    !excludedSections.has(sectionName)
    && normalizeText(stripHtmlComments(lines)).length > 0
  ));
}

// ---------------------------------------------------------------------------
// Text pattern helpers (mirrored from Python lib/text.py)
// ---------------------------------------------------------------------------

export const CODE_FENCE_PATTERN = /^```/m;
export const COMMAND_LINE_PATTERN =
  /^\s*[-$>]?\s*(?:python3?|make|npm|npx|bash|sh|pytest|pip|cd|\.\/)\s*/m;
export const TABLE_ROW_PATTERN = /^\s*\|.*\|/m;

/**
 * Extract items from `- `, `* `, or `1.` list markers (HTML comments stripped).
 */
export function extractBulletItems(lines: readonly string[]): string[] {
  const items: string[] = [];
  for (const rawLine of lines) {
    const stripped = rawLine.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!stripped) {
      continue;
    }
    if (stripped.startsWith('- ') || stripped.startsWith('* ')) {
      const item = stripped.slice(2).trim();
      if (item) {
        items.push(item);
      }
      continue;
    }
    const match = /^\d+\.\s+(.*\S)\s*$/.exec(stripped);
    if (match?.[1]) {
      items.push(match[1].trim());
    }
  }
  return items;
}

