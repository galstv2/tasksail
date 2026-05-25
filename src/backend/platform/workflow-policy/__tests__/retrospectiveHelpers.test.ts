import { describe, expect, it } from 'vitest';
import {
  normalizeRetrospectiveListSectionsMarkdown,
  retrospectiveCompletionGaps,
} from '../rules/retrospectiveHelpers.js';
import type { WorkspaceArtifact } from '../types.js';

function retrospectiveArtifact(sections: Record<string, string[]>): WorkspaceArtifact {
  return {
    relativePath: 'retrospective-input.md',
    exists: true,
    sections,
    metadata: {},
    taskLineage: {},
    hasSubstantiveContent: true,
  };
}

describe('retrospectiveHelpers', () => {
  const contributionSections = [
    ['planning-agent', "Lily's Contribution (Planning Specialist)"],
    ['product-manager', "Alice's Contribution (Product Manager)"],
    ['software-engineer', "Dalton's Contribution (Software Engineer)"],
    ['qa', "Ron's Contribution (QA and Closeout)"],
  ] as const;

  it('accepts prose role contributions without forcing bullet syntax', () => {
    const gaps = retrospectiveCompletionGaps({
      retrospective: retrospectiveArtifact({
        'Retrospective Summary': ['Summary content.'],
        'What Went Well': ['Good stuff.'],
        'What Could Have Gone Better': ['One thing could improve.'],
        'Action Items': ['- Keep a tighter closeout checklist.'],
        "Lily's Contribution (Planning Specialist)": ['Lily shaped the planning context and acceptance criteria.'],
        "Alice's Contribution (Product Manager)": ['Alice clarified product scope and expected outcomes.'],
        "Dalton's Contribution (Software Engineer)": ['Dalton implemented the CLI behavior and preserved compatibility.'],
        "Ron's Contribution (QA and Closeout)": ['Ron validated the task and completed closeout.'],
      }),
      fullCeremony: true,
      contributionSections,
    });

    expect(gaps.missing_contributions).toEqual([]);
  });

  it('accepts prose action items without forcing bullet syntax', () => {
    const gaps = retrospectiveCompletionGaps({
      retrospective: retrospectiveArtifact({
        'Retrospective Summary': ['Summary content.'],
        'What Went Well': ['Good stuff.'],
        'What Could Have Gone Better': ['One thing could improve.'],
        'Action Items': ['Keep closeout evidence grounded in completed artifacts.'],
        "Lily's Contribution (Planning Specialist)": ['Lily shaped the planning context.'],
        "Alice's Contribution (Product Manager)": ['Alice clarified product scope.'],
        "Dalton's Contribution (Software Engineer)": ['Dalton implemented the CLI behavior.'],
        "Ron's Contribution (QA and Closeout)": ['Ron validated closeout.'],
      }),
      fullCeremony: true,
      contributionSections,
    });

    expect(gaps.action_items).toEqual([]);
  });

  it('normalizes prose role contributions into canonical bullets', () => {
    const normalized = normalizeRetrospectiveListSectionsMarkdown([
      '# Retrospective Input',
      '',
      "## Ron's Contribution (QA and Closeout)",
      'Ron validated the task.',
      'Ron completed closeout.',
      '',
      '## Action Items',
      'Keep validation focused.',
      '',
      '## Reusable Team Learnings',
      '- Keep validation focused.',
      '',
    ].join('\n'));

    expect(normalized).toContain([
      "## Ron's Contribution (QA and Closeout)",
      '',
      '- Ron validated the task. Ron completed closeout.',
    ].join('\n'));
    expect(normalized).toContain([
      '## Action Items',
      '',
      '- Keep validation focused.',
    ].join('\n'));
  });
});
