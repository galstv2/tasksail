import { formatContextPackBindingSection } from '../../../backend/platform/queue/markdown.js';
import type { PlannerEditableDraftModel } from '../src/shared/desktopContract';
import type { PlannerStagingSidecar } from './main.staging';
import { stripMarkdownComments } from './main.textUtils';

export type PlannerEditableDraft = PlannerEditableDraftModel;

export const REQUIRED_INTAKE_SECTIONS = [
  'Request Summary',
  'Desired Outcome',
  'Acceptance Signals',
] as const;

export const CHILD_TASK_REQUIRED_LINEAGE_FIELDS = [
  'Parent Task ID',
  'Root Task ID',
  'Follow-Up Reason',
] as const;

export function parseMarkdownSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  function flush(): void {
    if (currentHeading === null) {
      return;
    }
    sections.set(currentHeading, stripMarkdownComments(buffer.join('\n')));
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
      buffer = [];
      continue;
    }

    if (currentHeading !== null) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

export function extractLineageField(content: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^- ${escapedLabel}:[ \\t]*([^\\r\\n]*)$`, 'm'));
  return (match?.[1] ?? '').trim();
}

function extractSectionField(sectionContent: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripMarkdownComments(sectionContent).match(new RegExp(`^- ${escapedLabel}:[ \\t]*([^\\r\\n]*)$`, 'm'));
  return (match?.[1] ?? '').trim();
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return (match?.[1] ?? '').trim();
}

function normalizeSectionBody(value: string): string {
  return stripMarkdownComments(value)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function buildExpectedContextPackBindingBody(metadata: PlannerStagingSidecar): string {
  return parseMarkdownSections(formatContextPackBindingSection(metadata.contextPackBinding)).get('Context Pack Binding') ?? '';
}

function buildExpectedSourceBody(metadata: PlannerStagingSidecar): string {
  return parseMarkdownSections([
    '## Source',
    '',
    '- Created By: Planning Agent',
    `- Created At (UTC): ${metadata.createdAt}`,
  ].join('\n')).get('Source') ?? '';
}

function validateProtectedSection(
  sections: Map<string, string>,
  sectionName: string,
  expectedBody: string,
  missingMessage: string,
  mismatchMessage: string,
): string | null {
  const actualBody = sections.get(sectionName);
  if (actualBody === undefined) {
    return missingMessage;
  }
  if (normalizeSectionBody(actualBody) !== normalizeSectionBody(expectedBody)) {
    return mismatchMessage;
  }
  return null;
}

export function hasBulletedContent(value: string): boolean {
  return value
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^([-*]|\d+\.)\s+\S+/.test(line));
}

export function validatePlanningIntakeDraft(
  content: string,
  taskKind?: 'standard' | 'child-task',
  preParsedSections?: Map<string, string>,
): string | null {
  const sections = preParsedSections ?? parseMarkdownSections(content);
  const missingSections = REQUIRED_INTAKE_SECTIONS.filter(
    (section) => stripMarkdownComments(sections.get(section) ?? '').length === 0,
  );
  if (missingSections.length > 0) {
    return `Staged draft is missing required section content: ${missingSections.join(', ')}. Ask Lily to complete the planning intake before finalizing.`;
  }

  const requestSummary = stripMarkdownComments(sections.get('Request Summary') ?? '');
  if (requestSummary.length < 20) {
    return 'Staged draft Request Summary is too short. Ask Lily to provide a fuller planning intake before finalizing.';
  }

  const acceptanceSignals = stripMarkdownComments(sections.get('Acceptance Signals') ?? '');
  if (!hasBulletedContent(acceptanceSignals)) {
    return 'Staged draft Acceptance Signals must contain at least one bullet or numbered item before finalizing.';
  }

  if (taskKind === 'child-task') {
    const carryForwardSummary = stripMarkdownComments(sections.get('Parent Task Carry-Forward Summary') ?? '');
    if (carryForwardSummary.length === 0) {
      return 'Child-task staged draft is missing Parent Task Carry-Forward Summary content. Ask Lily to complete the intake before finalizing.';
    }
  }

  return null;
}

export function validatePlannerProtectedMetadata(
  content: string,
  metadata: PlannerStagingSidecar,
  expectedTaskKind?: 'standard' | 'child-task',
  preParsedSections?: Map<string, string>,
): string | null {
  const draftTitle = extractTitle(content);
  if (!draftTitle) {
    return 'Staged draft is missing the platform-owned task title. Ask Lily to restore the staged shell before finalizing.';
  }
  if (draftTitle !== metadata.title) {
    return 'Staged draft title does not match the platform-owned planner title. Ask Lily to preserve the generated title before finalizing.';
  }

  if (expectedTaskKind && metadata.lineage.taskKind !== expectedTaskKind) {
    return `Platform expected ${expectedTaskKind} but staged planner metadata declares ${metadata.lineage.taskKind}. Restart the planner session before finalizing.`;
  }

  const sections = preParsedSections ?? parseMarkdownSections(content);
  const taskLineageSection = sections.get('Task Lineage');
  if (taskLineageSection === undefined) {
    return 'Staged draft is missing the platform-owned Task Lineage section. Ask Lily to restore the staged shell before finalizing.';
  }

  const authoritativeTaskKind = metadata.lineage.taskKind;
  const taskKind = extractSectionField(taskLineageSection, 'Task Kind').toLowerCase();
  if (taskKind !== authoritativeTaskKind) {
    return taskKind
      ? `Platform expected ${authoritativeTaskKind} but staged draft declares ${taskKind}. Ask Lily to correct the Task Kind field before finalizing.`
      : 'Staged draft Task Lineage is missing the platform-owned Task Kind field. Ask Lily to restore the staged shell before finalizing.';
  }

  const lineageFieldChecks: Array<[string, string]> = [
    ['Parent Task ID', metadata.lineage.parentTaskId],
    ['Root Task ID', metadata.lineage.rootTaskId],
    ['Parent QMD Record ID', metadata.lineage.parentQmdRecordId],
    ['Parent QMD Scope', metadata.lineage.parentQmdScope],
    ['Follow-Up Reason', metadata.lineage.followUpReason],
  ];
  const mismatchedLineageFields = lineageFieldChecks
    .filter(([label, expectedValue]) => extractSectionField(taskLineageSection, label) !== expectedValue)
    .map(([label]) => label);
  if (mismatchedLineageFields.length > 0) {
    return `Staged draft Task Lineage no longer matches the platform-owned planner metadata for: ${mismatchedLineageFields.join(', ')}. Ask Lily to restore the staged shell before finalizing.`;
  }

  const contextPackError = validateProtectedSection(
    sections,
    'Context Pack Binding',
    buildExpectedContextPackBindingBody(metadata),
    'Staged draft is missing the platform-owned Context Pack Binding section. Ask Lily to restore the staged shell before finalizing.',
    'Staged draft Context Pack Binding no longer matches the platform-owned planner metadata. Ask Lily to restore the staged shell before finalizing.',
  );
  if (contextPackError) {
    return contextPackError;
  }

  return validateProtectedSection(
    sections,
    'Source',
    buildExpectedSourceBody(metadata),
    'Staged draft is missing the platform-owned Source section. Ask Lily to restore the staged shell before finalizing.',
    'Staged draft Source metadata no longer matches the platform-owned planner metadata. Ask Lily to restore the staged shell before finalizing.',
  );
}

export function parsePlannerEditableDraft(
  content: string,
  preParsedSections?: Map<string, string>,
): PlannerEditableDraft {
  const sections = preParsedSections ?? parseMarkdownSections(content);
  const suggestedRouting = sections.get('Suggested Routing') ?? '';
  const suggestedPathValue = extractSectionField(suggestedRouting, 'Recommended Execution').toLowerCase();
  // Accept both vocabularies: Lily's staged template uses "sequential"/"parallel",
  // the Bypass Lily download template uses "Simple"/"Complex". Normalize to the
  // internal SuggestedPath type so downstream consumers stay unchanged.
  const SUGGESTED_PATH_MAP: Record<string, 'sequential' | 'parallel'> = {
    sequential: 'sequential',
    parallel: 'parallel',
    simple: 'sequential',
    complex: 'parallel',
  };
  const suggestedPath = SUGGESTED_PATH_MAP[suggestedPathValue];
  if (!suggestedPath) {
    throw new Error(
      'Staged draft Suggested Routing must declare Recommended Execution as Simple or Complex before finalizing.',
    );
  }

  return {
    summary: stripMarkdownComments(sections.get('Request Summary') ?? '').trim(),
    desiredOutcome: stripMarkdownComments(sections.get('Desired Outcome') ?? '').trim(),
    constraints: stripMarkdownComments(sections.get('Constraints') ?? '').trim(),
    acceptanceSignals: stripMarkdownComments(sections.get('Acceptance Signals') ?? '').trim(),
    carryForwardSummary: stripMarkdownComments(sections.get('Parent Task Carry-Forward Summary') ?? '').trim(),
    suggestedPath,
    planningNotes: (
      extractSectionField(suggestedRouting, 'Planner Notes')
      || extractSectionField(suggestedRouting, 'Decision Rationale')
    ).trim(),
  };
}
