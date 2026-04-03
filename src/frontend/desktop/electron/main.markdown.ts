import { stripMarkdownComments } from './main.textUtils';

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

export function hasBulletedContent(value: string): boolean {
  return value
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^([-*]|\d+\.)\s+\S+/.test(line));
}

export function validatePlanningIntakeDraft(
  content: string,
  expectedTaskKind?: 'standard' | 'child-task',
): string | null {
  const sections = parseMarkdownSections(content);
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

  const fileTaskKind = extractLineageField(content, 'Task Kind').toLowerCase();

  if (expectedTaskKind) {
    if (fileTaskKind && fileTaskKind !== expectedTaskKind) {
      return `Platform expected ${expectedTaskKind} but staged draft declares ${fileTaskKind}. Ask Lily to correct the Task Kind field before finalizing.`;
    }
  }

  const effectiveTaskKind = expectedTaskKind ?? fileTaskKind;

  if (effectiveTaskKind === 'child-task') {
    const missingLineageFields = CHILD_TASK_REQUIRED_LINEAGE_FIELDS.filter(
      (field) => extractLineageField(content, field).length === 0,
    );
    if (missingLineageFields.length > 0) {
      return `Child-task staged draft is missing required lineage fields: ${missingLineageFields.join(', ')}. Ask Lily to complete the task lineage before finalizing.`;
    }

    const carryForwardSummary = stripMarkdownComments(sections.get('Parent Task Carry-Forward Summary') ?? '');
    if (carryForwardSummary.length === 0) {
      return 'Child-task staged draft is missing Parent Task Carry-Forward Summary content. Ask Lily to complete the intake before finalizing.';
    }
  }

  return null;
}
