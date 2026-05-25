/**
 * Retrospective completion gap analysis.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/retrospective_helpers.py
 */

import {
  RETROSPECTIVE_ACTION_ITEMS_MAX_BULLETS,
  RETROSPECTIVE_ACTION_ITEMS_SECTION,
  RETROSPECTIVE_CONTRIBUTION_MAX_BULLETS,
  RETROSPECTIVE_REQUIRED_CONTENT_SECTIONS,
} from '../models.js';
import { extractBulletItems, normalizeText, stripHtmlComments } from '../matching.js';
import type { WorkspaceArtifact } from '../types.js';

const CONTRIBUTION_HEADING_RE = /^.+\'s Contribution \(.+\)$/;

function sectionItems(lines: readonly string[]): string[] {
  const bulletItems = extractBulletItems(lines);
  if (bulletItems.length > 0) {
    return bulletItems;
  }
  const prose = normalizeText(stripHtmlComments(lines)).replace(/\s*\n\s*/g, ' ').trim();
  return prose ? [prose] : [];
}

export function normalizeRetrospectiveListSectionsMarkdown(
  markdown: string,
  contributionSectionNames: readonly string[] = [],
): string {
  const contributionNames = new Set(contributionSectionNames);
  const lines = markdown.split(/\r?\n/);
  const hadTrailingNewline = markdown.endsWith('\n');
  const normalizedLines: string[] = [];

  for (let index = 0; index < lines.length;) {
    const headingMatch = /^##\s+(.*\S)\s*$/.exec(lines[index]?.trim() ?? '');
    const heading = headingMatch?.[1] ?? '';
    const isContributionSection = heading
      && (contributionNames.has(heading) || CONTRIBUTION_HEADING_RE.test(heading));
    const isListSection = heading === RETROSPECTIVE_ACTION_ITEMS_SECTION || isContributionSection;

    if (!isListSection) {
      normalizedLines.push(lines[index] ?? '');
      index += 1;
      continue;
    }

    let sectionEnd = index + 1;
    while (sectionEnd < lines.length && !/^##\s+.*\S\s*$/.test(lines[sectionEnd]?.trim() ?? '')) {
      sectionEnd += 1;
    }

    const items = sectionItems(lines.slice(index + 1, sectionEnd));
    if (items.length === 0) {
      normalizedLines.push(...lines.slice(index, sectionEnd));
    } else {
      normalizedLines.push(lines[index] ?? '', '', ...items.map((item) => `- ${item}`), '');
    }
    index = sectionEnd;
  }

  const normalized = normalizedLines.join('\n').replace(/[ \t]+\n/g, '\n').trimEnd();
  return hadTrailingNewline ? `${normalized}\n` : normalized;
}

export interface RetrospectiveGaps {
  required_sections: string[];
  action_items: string[];
  missing_contributions: string[];
  oversized_contributions: string[];
}

/**
 * Identify gaps in the retrospective artifact.
 *
 * @param retrospective - The loaded retrospective workspace artifact.
 * @param fullCeremony - Whether full retrospective ceremony is required.
 * @param contributionSections - List of `[agentId, sectionName]` pairs.
 */
export function retrospectiveCompletionGaps(options: {
  retrospective: WorkspaceArtifact;
  fullCeremony: boolean;
  contributionSections: ReadonlyArray<readonly [string, string]>;
}): RetrospectiveGaps {
  const { retrospective, fullCeremony, contributionSections } = options;

  const gaps: RetrospectiveGaps = {
    required_sections: [],
    action_items: [],
    missing_contributions: [],
    oversized_contributions: [],
  };

  if (!retrospective.exists) {
    gaps.required_sections.push('retrospective artifact is missing');
    return gaps;
  }

  if (fullCeremony) {
    for (const sectionName of RETROSPECTIVE_REQUIRED_CONTENT_SECTIONS) {
      if (!normalizeText(retrospective.sections[sectionName] ?? [])) {
        gaps.required_sections.push(sectionName);
      }
    }

    const actionItems = sectionItems(retrospective.sections[RETROSPECTIVE_ACTION_ITEMS_SECTION] ?? []);
    if (!actionItems.length) {
      gaps.action_items.push('Action Items must contain at least one item');
    } else if (actionItems.length > RETROSPECTIVE_ACTION_ITEMS_MAX_BULLETS) {
      gaps.action_items.push('Action Items must not exceed 5 items');
    }

    for (const [, sectionName] of contributionSections) {
      const items = sectionItems(retrospective.sections[sectionName] ?? []);
      if (!items.length) {
        gaps.missing_contributions.push(sectionName);
        continue;
      }
      if (items.length > RETROSPECTIVE_CONTRIBUTION_MAX_BULLETS) {
        gaps.oversized_contributions.push(sectionName);
      }
    }
  } else {
    if (!normalizeText(retrospective.sections['Retrospective Summary'] ?? [])) {
      gaps.required_sections.push('Retrospective Summary');
    }
  }

  return gaps;
}
