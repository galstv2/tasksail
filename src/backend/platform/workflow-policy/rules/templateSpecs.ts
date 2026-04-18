import {
  SLICE_REQUIRED_SECTION_SPECS,
  SPEC_RECOMMENDED_SECTION_SPECS,
  SPEC_REQUIRED_SECTION_SPECS,
  type SemanticSectionSpec,
} from '../models.js';

/**
 * Template specification constants for handoff artifact validation.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/template_specs.py
 *
 * Note: contribution_section_names() from Python's lib/registry.py is replaced
 * here with a static list matching the current registry. The values match what
 * the Python registry.py produces from .github/agents/registry.json.
 */

export interface HandoffSpec {
  title: string;
  sections: readonly string[];
  extra_metadata_labels?: readonly string[];
  semanticSections?: readonly SemanticSectionSpec[];
}

export interface JsonHandoffSpec {
  required_top_level_keys: readonly string[];
}

export const HANDOFF_METADATA_LABELS = [
  'Task ID',
  'Task Title',
  'Initialized At (UTC)',
  'Active Branch',
  'Intake Source',
] as const;

export const LINEAGE_METADATA_LABELS = [
  'Task Kind',
  'Parent Task ID',
  'Root Task ID',
  'Parent QMD Record ID',
  'Parent QMD Scope',
  'Follow-Up Reason',
] as const;

export const ALLOWED_TASK_KINDS = new Set(['', 'standard', 'child-task']);

export const LINEAGE_HANDOFFS = new Set([
  'professional-task.md',
  'implementation-spec.md',
  'retrospective-input.md',
  'final-summary.md',
]);

/**
 * Returns the retrospective contribution section headings in workflow order.
 * These are derived from the registry at runtime.
 */
export function buildContributionSectionNames(
  agents: Array<{ name: string; role: string; workflowOrder: number }>,
): string[] {
  const sorted = [...agents].sort((a, b) => a.workflowOrder - b.workflowOrder);
  return sorted.map((a) => `${a.name}'s Contribution (${a.role})`);
}

export const HANDOFF_TEMPLATE_SPECS: Record<string, HandoffSpec> = {
  'professional-task.md': {
    title: 'Professional Task',
    sections: [
      'Task Metadata',
      'Task Lineage',
      'Raw Request',
      'Parent Task Carry-Forward Context',
      'Problem Statement',
      'Business Goal',
      'Scope',
      'Non-Goals',
      'Constraints',
      'Acceptance Criteria',
      'Risks',
      'Open Questions',
    ],
  },
  'implementation-spec.md': {
    title: 'Implementation Spec',
    sections: [
      'Task Metadata',
      'Problem and Outcome',
      'Current State and Boundaries',
      'Implementation Plan',
      'Risk and Impact',
      'Validation and Evidence',
      'Change Surface',
    ],
    semanticSections: [
      ...SPEC_REQUIRED_SECTION_SPECS,
      ...SPEC_RECOMMENDED_SECTION_SPECS,
    ],
  },
  'parallel-ok.md': {
    title: 'Parallel OK',
    sections: [
      'Task Metadata',
      'Decision',
      'Independent Slices',
      'Constraints',
      'Coordination Notes',
    ],
  },
  'issues.md': {
    title: 'QA Issues',
    sections: [
      'Task Metadata',
      'Review Outcome',
      'Finding',
      'Severity',
      'Finding Type',
      'Expectation Violated',
      'Required Fix',
      'Remediation Owner Agent ID',
      'Revalidation Agent ID',
      'Return-To Agent ID',
      'Retest Instructions',
    ],
  },
  'final-summary.md': {
    title: 'Final Summary',
    sections: [
      'Task Metadata',
      'Task Lineage',
      'Inherited Parent Context',
      'Child-Task Outcome Delta',
      'Closeout Owner Agent ID',
      'Completed Work',
      'Key Design Decisions',
      'Known Limitations',
      'Test Result Summary',
      'Rollout or Operational Notes',
      'Follow-Up Backlog',
      'Difficulty Assessment',
    ],
  },
  'retrospective-input.md': {
    title: 'Retrospective Input',
    extra_metadata_labels: ['Retrospective Required'],
    sections: [
      'Task Metadata',
      'Task Lineage',
      'Retrospective Summary',
      'Meeting Context',
      'What Went Well',
      'What Could Have Gone Better',
      'Action Items',
      // Contribution sections are appended dynamically at validation time
      // using buildContributionSectionNames() from the agent registry.
      "Lily's Contribution (Planning Specialist)",
      "Alice's Contribution (Product Manager)",
      "Dalton's Contribution (Software Engineer)",
      "Ron's Contribution (QA and Closeout)",
      'Reusable Team Learnings',
      'Anti-Patterns To Avoid',
    ],
  },
};

export const JSON_HANDOFF_TEMPLATE_SPECS: Record<string, JsonHandoffSpec> = {};

export const SLICE_TEMPLATE_SPEC: HandoffSpec = {
  title: 'Slice Template',
  sections: [
    'Objective',
    'Dependencies and Order',
    'Execution Scope',
    'Files and Interfaces',
    'Acceptance and Validation',
    'Guards and Coordination',
  ],
  semanticSections: SLICE_REQUIRED_SECTION_SPECS,
};

export const SLICE_TEMPLATE_RELATIVE_PATH =
  'AgentWorkSpace/ImplementationSteps/slice-template.md';

export const TEMPLATE_SOURCE_DIR = 'AgentWorkSpace/templates';

function buildTemplatePaths(
  specs: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const handoffPath of Object.keys(specs)) {
    const fileName = handoffPath.split('/').at(-1) ?? handoffPath;
    result[handoffPath] = `${TEMPLATE_SOURCE_DIR}/${fileName}`;
  }
  return result;
}

export const TEMPLATE_SOURCE_PATHS: Record<string, string> = {
  ...buildTemplatePaths(HANDOFF_TEMPLATE_SPECS),
  ...buildTemplatePaths(JSON_HANDOFF_TEMPLATE_SPECS),
  [SLICE_TEMPLATE_RELATIVE_PATH]: `${TEMPLATE_SOURCE_DIR}/slice-template.md`,
};
