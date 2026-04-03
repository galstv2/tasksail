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
import { extractBulletItems, normalizeText } from '../matching.js';
import type { WorkspaceArtifact } from '../types.js';

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

    const actionItems = extractBulletItems(
      retrospective.sections[RETROSPECTIVE_ACTION_ITEMS_SECTION] ?? [],
    );
    if (!actionItems.length) {
      gaps.action_items.push('Action Items must contain at least one bullet');
    } else if (actionItems.length > RETROSPECTIVE_ACTION_ITEMS_MAX_BULLETS) {
      gaps.action_items.push('Action Items must not exceed 5 bullets');
    }

    for (const [, sectionName] of contributionSections) {
      const contributionItems = extractBulletItems(
        retrospective.sections[sectionName] ?? [],
      );
      if (!contributionItems.length) {
        gaps.missing_contributions.push(sectionName);
        continue;
      }
      if (contributionItems.length > RETROSPECTIVE_CONTRIBUTION_MAX_BULLETS) {
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
