import type { PlannerEditableDraftModel } from '../src/shared/desktopContract';
import type { PlannerStagingSidecar } from './planner/staging';
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

export function hasBulletedContent(value: string): boolean {
  return value
    .split('\n')
    .map((line) => line.trim())
    .some((line) => /^([-*]|\d+\.)\s+\S+/.test(line));
}

const REQUIREMENT_PREFIX_PATTERN = /^(CR|COMP|VAL)-\d{3}:\s*/;

function stripRequirementPrefix(value: string): string {
  return value.replace(REQUIREMENT_PREFIX_PATTERN, '').trim();
}

function collectRequirementItems(value: string): string[] {
  const content = stripMarkdownComments(value).trim();
  if (!content || content === 'None') {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const items: string[] = [];
  let currentBullet: string[] = [];
  let currentProse: string[] = [];

  function pushItem(linesToPush: string[]): void {
    const item = stripRequirementPrefix(linesToPush.join(' ').replace(/\s+/g, ' ').trim());
    if (item) {
      items.push(item);
    }
  }

  function flushBullet(): void {
    if (currentBullet.length === 0) {
      return;
    }
    pushItem(currentBullet);
    currentBullet = [];
  }

  function flushProse(): void {
    if (currentProse.length === 0) {
      return;
    }
    pushItem(currentProse);
    currentProse = [];
  }

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/);
    if (bulletMatch) {
      flushProse();
      flushBullet();
      currentBullet.push(bulletMatch[1] ?? '');
      continue;
    }

    const trimmedLine = line.trim();
    if (!trimmedLine) {
      flushBullet();
      flushProse();
      continue;
    }

    if (currentBullet.length > 0) {
      currentBullet.push(trimmedLine);
    } else {
      currentProse.push(trimmedLine);
    }
  }
  flushBullet();
  flushProse();

  return items;
}

export function canonicalizeRequirementSection(
  value: string | undefined,
  prefix: 'CR' | 'COMP' | 'VAL',
): string {
  const items = collectRequirementItems(value ?? '');
  if (items.length === 0) {
    return 'None';
  }
  return items
    .map((item, index) => `- ${prefix}-${String(index + 1).padStart(3, '0')}: ${item}`)
    .join('\n');
}

export function canonicalizeEditableDraftRequirements<T extends Partial<PlannerEditableDraft>>(
  draft: T,
): T & Pick<PlannerEditableDraft, 'criticalRequirements' | 'compatibilityRequirements' | 'requiredValidation'> {
  return {
    ...draft,
    criticalRequirements: canonicalizeRequirementSection(draft.criticalRequirements, 'CR'),
    compatibilityRequirements: canonicalizeRequirementSection(draft.compatibilityRequirements, 'COMP'),
    requiredValidation: canonicalizeRequirementSection(draft.requiredValidation, 'VAL'),
  };
}

export function validatePlanningIntakeDraft(
  content: string,
  taskKind?: 'standard' | 'child-task',
  preParsedSections?: Map<string, string>,
  options?: { allowEmptyCarryForward?: boolean },
): string | null {
  const sections = preParsedSections ?? parseMarkdownSections(content);
  const missingSections = REQUIRED_INTAKE_SECTIONS.filter(
    (section) => stripMarkdownComments(sections.get(section) ?? '').length === 0,
  );
  if (missingSections.length > 0) {
    return `Staged draft is missing required section content: ${missingSections.join(', ')}. Ask the planner to complete the planning intake before finalizing.`;
  }

  const requestSummary = stripMarkdownComments(sections.get('Request Summary') ?? '');
  if (requestSummary.length < 20) {
    return 'Staged draft Request Summary is too short. Ask the planner to provide a fuller planning intake before finalizing.';
  }

  const acceptanceSignals = stripMarkdownComments(sections.get('Acceptance Signals') ?? '');
  if (!hasBulletedContent(acceptanceSignals)) {
    return 'Staged draft Acceptance Signals must contain at least one bullet or numbered item before finalizing.';
  }

  if (taskKind === 'child-task' && !options?.allowEmptyCarryForward) {
    const carryForwardSummary = stripMarkdownComments(sections.get('Parent Task Carry-Forward Summary') ?? '');
    if (carryForwardSummary.length === 0) {
      return 'Child-task staged draft is missing Parent Task Carry-Forward Summary content. Ask the planner to complete the intake before finalizing.';
    }
  }

  return null;
}

// The H1 title, Context Pack Binding section, and Source section are all
// regenerated programmatically from sidecar metadata when createDropboxTask
// writes the canonical dropbox markdown. Validating the staged draft's
// rendered copy of those sections only gates finalize on the planner preserving
// platform-owned text byte-for-byte — which she frequently won't — without
// any benefit to the dropbox output. Lineage fields remain validated because
// they are sidecar-authoritative and we want a clear error if the staged
// shell drifts from that authority before downstream consumers read it.
export function validatePlannerProtectedMetadata(
  content: string,
  metadata: PlannerStagingSidecar,
  expectedTaskKind?: 'standard' | 'child-task',
  preParsedSections?: Map<string, string>,
): string | null {
  if (expectedTaskKind && metadata.lineage.taskKind !== expectedTaskKind) {
    return `Platform expected ${expectedTaskKind} but staged planner metadata declares ${metadata.lineage.taskKind}. Restart the planner session before finalizing.`;
  }

  const sections = preParsedSections ?? parseMarkdownSections(content);
  const taskLineageSection = sections.get('Task Lineage');
  if (taskLineageSection === undefined) {
    return 'Staged draft is missing the platform-owned Task Lineage section. Ask the planner to restore the staged shell before finalizing.';
  }

  const authoritativeTaskKind = metadata.lineage.taskKind;
  const taskKind = extractSectionField(taskLineageSection, 'Task Kind').toLowerCase();
  if (taskKind !== authoritativeTaskKind) {
    return taskKind
      ? `Platform expected ${authoritativeTaskKind} but staged draft declares ${taskKind}. Ask the planner to correct the Task Kind field before finalizing.`
      : 'Staged draft Task Lineage is missing the platform-owned Task Kind field. Ask the planner to restore the staged shell before finalizing.';
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
    return `Staged draft Task Lineage no longer matches the platform-owned planner metadata for: ${mismatchedLineageFields.join(', ')}. Ask the planner to restore the staged shell before finalizing.`;
  }

  return null;
}

// Canonical user-facing vocabulary is "Simple"/"Complex" — the staging shell
// (main.staging.ts), the planning-intake template, planner and PM
// instructions, and the workflow-policy validator (rules/intake.ts) all use
// those tokens. The "sequential"/"parallel" keys are kept as defensive
// tolerance: legacy dropbox files written by older code carried those raw
// queue-discriminator values, and re-loading them must still parse cleanly.
// Unrecognized values fall back to "sequential" rather than throwing —
// finalize should not fail over a routing-vocabulary mismatch.
const SUGGESTED_PATH_MAP: Record<string, 'sequential' | 'parallel'> = {
  simple: 'sequential',
  complex: 'parallel',
  sequential: 'sequential',
  parallel: 'parallel',
};

function resolveSuggestedPath(rawValue: string): 'sequential' | 'parallel' {
  const normalized = rawValue.toLowerCase().trim();
  if (SUGGESTED_PATH_MAP[normalized]) {
    return SUGGESTED_PATH_MAP[normalized];
  }
  // Try the leading word, in case the planner wrote something like
  // "Simple — one coherent ask" or "Complex (multi-slice)".
  const leadingWord = normalized.split(/[\s(–—\-]/)[0] ?? '';
  return SUGGESTED_PATH_MAP[leadingWord] ?? 'sequential';
}

export function parsePlannerEditableDraft(
  content: string,
  preParsedSections?: Map<string, string>,
): PlannerEditableDraft {
  const sections = preParsedSections ?? parseMarkdownSections(content);
  const suggestedRouting = sections.get('Suggested Routing') ?? '';
  const suggestedPath = resolveSuggestedPath(extractSectionField(suggestedRouting, 'Recommended Execution'));

  return {
    summary: stripMarkdownComments(sections.get('Request Summary') ?? '').trim(),
    desiredOutcome: stripMarkdownComments(sections.get('Desired Outcome') ?? '').trim(),
    constraints: stripMarkdownComments(sections.get('Constraints') ?? '').trim(),
    criticalRequirements: stripMarkdownComments(sections.get('Critical Requirements') ?? 'None').trim() || 'None',
    compatibilityRequirements: stripMarkdownComments(sections.get('Compatibility Requirements') ?? 'None').trim() || 'None',
    requiredValidation: stripMarkdownComments(sections.get('Required Validation') ?? 'None').trim() || 'None',
    acceptanceSignals: stripMarkdownComments(sections.get('Acceptance Signals') ?? '').trim(),
    carryForwardSummary: stripMarkdownComments(sections.get('Parent Task Carry-Forward Summary') ?? '').trim(),
    suggestedPath,
    planningNotes: (
      extractSectionField(suggestedRouting, 'Planner Notes')
      || extractSectionField(suggestedRouting, 'Decision Rationale')
    ).trim(),
  };
}
