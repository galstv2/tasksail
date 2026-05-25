import { createLogger, extractMarkdownSection, stripHtmlComments } from '../core/index.js';
import type { PrimaryFocusTarget } from '../context-pack/deepFocusNormalization.js';
import { parseSections } from '../workflow-policy/artifacts.js';
import { loadMarkdownContract } from '../workflow-policy/contracts/markdownContract.js';
import { SECTION_NAMES } from '../workflow-policy/contracts/sectionNames.js';
import {
  parseRepositoryTypesJson,
  stableStringifyRepositoryTypes,
  type ContextPackRepositoryTypes,
} from './repositoryTypes.js';

const log = createLogger('platform/queue/markdown');

/**
 * Extract the H1 heading text from markdown content.
 * Returns the heading text without the leading "# ".
 */
export function extractTaskTitle(content: string): string {
  const contract = loadMarkdownContract();
  const match = contract.compiled.title.exec(content);
  return match?.[contract.groups.title]?.trim() ?? '';
}

export function buildProfessionalTaskSectionsFromIntake(content: string): Record<string, string> {
  const sections = parseSections(content);
  const requestSummary = effectiveSection(
    sections,
    'Request Summary',
    fallbackRequestSummary(content),
  );
  const desiredOutcome = effectiveSection(
    sections,
    'Desired Outcome',
    'Complete the requested task.',
  );
  const constraints = effectiveSection(sections, 'Constraints', 'None');
  const acceptanceSignals = effectiveSection(
    sections,
    'Acceptance Signals',
    '- Requested task is completed without weakening existing behavior.',
  );
  const criticalRequirements = optionalSection(sections, 'Critical Requirements');
  const compatibilityRequirements = optionalSection(sections, 'Compatibility Requirements');
  const requiredValidation = optionalSection(sections, 'Required Validation');
  const taskLineage = sectionBody(sections, SECTION_NAMES.TASK_LINEAGE);
  const taskKind = extractLabeledValue(taskLineage, 'Task Kind', SECTION_NAMES.TASK_LINEAGE);
  const parentCarryForward = taskKind === 'child-task'
    ? optionalSection(sections, 'Parent Task Carry-Forward Summary') ?? ''
    : '';

  return {
    'Raw Request': requestSummary,
    'Problem Statement': requestSummary,
    'Business Goal': desiredOutcome,
    'Scope': criticalRequirements ?? acceptanceSignals,
    'Non-Goals': extractNonGoals(constraints),
    'Constraints': appendLabeledSection(
      constraints,
      'Compatibility requirements from intake:',
      compatibilityRequirements,
    ),
    'Acceptance Criteria': appendLabeledSection(
      acceptanceSignals,
      'Required validation from intake:',
      requiredValidation,
    ),
    'Risks': '- None stated in intake.',
    'Open Questions': '- None.',
    'Parent Task Carry-Forward Context': parentCarryForward,
  };
}

export function buildImplementationSpecSectionsFromIntake(content: string): Record<string, string> {
  return {
    'Intake Requirements': renderIntakeRequirementsFromIntake(content),
  };
}

function renderIntakeRequirementsFromIntake(content: string): string {
  const sections = parseSections(content);
  return [
    '<!-- Platform-generated from handoffs/intake.md during task activation. Do not edit or delete. -->',
    '',
    '### Critical Requirements',
    '',
    sectionBodyOrNone(sections, 'Critical Requirements'),
    '',
    '### Compatibility Requirements',
    '',
    sectionBodyOrNone(sections, 'Compatibility Requirements'),
    '',
    '### Required Validation',
    '',
    sectionBodyOrNone(sections, 'Required Validation'),
  ].join('\n');
}

function sectionBodyOrNone(
  sections: Record<string, string[]>,
  sectionName: string,
): string {
  const body = sectionBody(sections, sectionName);
  return body.trim() ? body : 'None';
}

function sectionBody(
  sections: Record<string, string[]>,
  sectionName: string,
): string {
  return cleanSectionBody(sections[sectionName] ?? []);
}

// trimBlankLines handles boundary blank lines; no outer .trim() so leading
// indentation on command lines and fence-internal text survives verbatim into
// both the professional-task append blocks and the implementation-spec render.
function cleanSectionBody(lines: readonly string[]): string {
  return trimBlankLines(stripHtmlComments(lines.join('\n'))).join('\n');
}

function trimBlankLines(value: string): string[] {
  const lines = value.split(/\r?\n/);
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}

function isNonNone(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== 'None';
}

function optionalSection(
  sections: Record<string, string[]>,
  sectionName: string,
): string | undefined {
  const body = sectionBody(sections, sectionName);
  return isNonNone(body) ? body : undefined;
}

function effectiveSection(
  sections: Record<string, string[]>,
  sectionName: string,
  fallback: string,
): string {
  const body = sectionBody(sections, sectionName);
  return body.trim() ? body : fallback;
}

function fallbackRequestSummary(content: string): string {
  const title = extractTaskTitle(content).trim();
  if (title) return title;

  const body = stripHtmlComments(content);
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed;
    }
  }
  return 'Unspecified request.';
}

function appendLabeledSection(
  base: string,
  label: string,
  appendix: string | undefined,
): string {
  if (!appendix) return base;
  if (!isNonNone(base)) {
    return `${label}\n${appendix}`;
  }
  return `${base}\n\n${label}\n${appendix}`;
}

function extractNonGoals(constraints: string): string {
  const nonGoals = constraints
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const match = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
      const item = match?.[1]?.trim() ?? '';
      return /^(?:NOT:|No |Do not |Must not )/.test(item);
    });

  return nonGoals.length > 0 ? nonGoals.join('\n') : '- None stated in intake.';
}

/**
 * Format a single metadata line: `- LABEL: VALUE` or `- LABEL:` if value is empty.
 */
export function templateMetadataLine(label: string, value?: string): string {
  if (value) {
    return `- ${label}: ${value}`;
  }
  return `- ${label}:`;
}

/**
 * Format a complete Task Metadata block from key-value pairs.
 */
export function printTaskMetadataBlock(
  metadata: Record<string, string>,
): string {
  return Object.entries(metadata)
    .map(([label, value]) => templateMetadataLine(label, value))
    .join('\n');
}

/**
 * Format a complete Task Lineage block from key-value pairs.
 */
export function printTaskLineageBlock(
  lineage: Record<string, string>,
): string {
  return Object.entries(lineage)
    .map(([label, value]) => templateMetadataLine(label, value))
    .join('\n');
}

/**
 * Extract a value from a labeled line within the Task Lineage section.
 * Looks for `- LABEL: VALUE` within `## Task Lineage`.
 */
export function extractLineageValue(
  content: string,
  label: string,
): string {
  const section = extractMarkdownSection(content, SECTION_NAMES.TASK_LINEAGE);
  return extractLabeledValue(section, label, SECTION_NAMES.TASK_LINEAGE);
}

/**
 * Extract a value from a labeled line within the Task Metadata section.
 * Looks for `- LABEL: VALUE` within `## Task Metadata`.
 */
export function extractTaskMetadataValue(
  content: string,
  label: string,
): string {
  const section = extractMarkdownSection(content, SECTION_NAMES.TASK_METADATA);
  return extractLabeledValue(section, label, SECTION_NAMES.TASK_METADATA);
}

/**
 * Context pack focus state captured at task submission time.
 * When present, the pipeline uses these values instead of the global env.
 */
export interface TaskContextPackBinding {
  contextPackDir: string;
  contextPackId: string;
  scopeMode: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
  repositoryTypes?: ContextPackRepositoryTypes;
  deepFocusEnabled?: boolean;
  primaryRepoId?: string;
  primaryFocusId?: string;
  deepFocusPrimaryRepoId?: string;
  deepFocusPrimaryFocusId?: string;
  selectedFocusPath?: string;
  selectedFocusTargetKind?: 'directory' | 'file';
  selectedFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: TaskContextPackTarget | null;
  selectedSupportTargets?: TaskContextPackTarget[];
}

export interface TaskContextPackTarget {
  path: string;
  kind: 'directory' | 'file';
  repoLocalPath?: string;
  repoId?: string;
  focusId?: string;
}

export type ContextPackBindingResult =
  | { kind: 'absent' }
  | {
      kind: 'invalid';
      reason: 'missing-context-pack-dir' | 'malformed-targets' | 'malformed-deep-focus' | 'malformed-repository-types';
      section: string;
    }
  | { kind: 'binding'; binding: TaskContextPackBinding };

const BRANCH_CHAIN_SECTION_NAME = 'Branch Chain';

export interface TaskBranchChainRepo {
  repoRoot: string;
  repoLabel: string;
  chainSourceBranch: string;
  parentSourceBranch: string;
  parentBranchHead: string;
  targetBranch: string | null;
}

export interface TaskBranchChainBinding {
  schemaVersion: 1;
  mode: 'continuation';
  rootTaskId: string;
  parentTaskId: string;
  depth: number;
  repos: TaskBranchChainRepo[];
}

export type BranchChainInvalidReason =
  | 'missing-json-fence'
  | 'malformed-json'
  | 'invalid-schema';

export type BranchChainBindingResult =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: BranchChainInvalidReason; section: string }
  | { kind: 'binding'; binding: TaskBranchChainBinding };

export function formatBranchChainSection(binding: TaskBranchChainBinding): string {
  return [
    `## ${BRANCH_CHAIN_SECTION_NAME}`,
    '',
    '```json',
    JSON.stringify(normalizeBranchChainBinding(binding), null, 2),
    '```',
  ].join('\n');
}

export function extractBranchChainBinding(content: string): BranchChainBindingResult {
  const section = extractMarkdownSection(content, BRANCH_CHAIN_SECTION_NAME);
  if (!section.trim()) return { kind: 'absent' };

  const jsonBlock = extractFirstJsonFence(section);
  if (jsonBlock === null) {
    return { kind: 'invalid', reason: 'missing-json-fence', section };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return { kind: 'invalid', reason: 'malformed-json', section };
  }

  const binding = parseBranchChainBinding(parsed);
  if (!binding) {
    return { kind: 'invalid', reason: 'invalid-schema', section };
  }
  return { kind: 'binding', binding };
}

/**
 * Extract context pack binding from task markdown.
 * Returns null when the section is absent or Context Pack Dir is empty
 * (legacy tasks created before this feature).
 */
export function extractContextPackBinding(
  content: string,
): ContextPackBindingResult {
  const section = extractMarkdownSection(content, SECTION_NAMES.CONTEXT_PACK_BINDING);
  if (!section.trim()) return { kind: 'absent' };

  const dir = extractLabeledValue(section, 'Context Pack Dir', SECTION_NAMES.CONTEXT_PACK_BINDING);
  if (!dir) return { kind: 'invalid', reason: 'missing-context-pack-dir', section };

  const binding: TaskContextPackBinding = {
    contextPackDir: dir,
    contextPackId: extractLabeledValue(section, 'Context Pack ID', SECTION_NAMES.CONTEXT_PACK_BINDING),
    scopeMode: extractLabeledValue(section, 'Scope Mode', SECTION_NAMES.CONTEXT_PACK_BINDING),
    selectedRepoIds: commaSplit(extractLabeledValue(section, 'Selected Repo IDs', SECTION_NAMES.CONTEXT_PACK_BINDING)),
    selectedFocusIds: commaSplit(extractLabeledValue(section, 'Selected Focus IDs', SECTION_NAMES.CONTEXT_PACK_BINDING)),
  };
  const primaryRepoId = optionalLabeledValue(section, 'Primary Repo ID');
  if (primaryRepoId) {
    binding.primaryRepoId = primaryRepoId;
  }
  const primaryFocusId = optionalLabeledValue(section, 'Primary Focus ID');
  if (primaryFocusId) {
    binding.primaryFocusId = primaryFocusId;
  }
  const repositoryTypesValue = optionalLabeledValue(section, 'Selection Roles');
  const repositoryTypes = repositoryTypesValue ? parseRepositoryTypesJson(repositoryTypesValue) : undefined;
  if (repositoryTypesValue && !repositoryTypes) {
    return { kind: 'invalid', reason: 'malformed-repository-types', section };
  }

  if (extractLabeledValue(section, 'Deep Focus Enabled', SECTION_NAMES.CONTEXT_PACK_BINDING) !== 'true') {
    if (repositoryTypes) {
      binding.repositoryTypes = repositoryTypes;
    }
    return { kind: 'binding', binding };
  }

  const selectedFocusTargetsValue = extractLabeledValue(section, 'Selected Focus Targets', SECTION_NAMES.CONTEXT_PACK_BINDING);
  const selectedTestTargetValue = extractLabeledValue(section, 'Selected Test Target', SECTION_NAMES.CONTEXT_PACK_BINDING);
  const selectedSupportTargetsValue = extractLabeledValue(section, 'Selected Support Targets', SECTION_NAMES.CONTEXT_PACK_BINDING);
  const selectedFocusTargets = parsePrimaryFocusTargetList(selectedFocusTargetsValue);
  const deepFocusPrimaryRepoId = optionalLabeledValue(section, 'Deep Focus Primary Repo ID');
  const deepFocusPrimaryFocusId = optionalLabeledValue(section, 'Deep Focus Primary Focus ID');
  if (selectedFocusTargetsValue && selectedFocusTargets === undefined) {
    return { kind: 'invalid', reason: 'malformed-deep-focus', section };
  }
  const selectedTestTarget = parseContextPackTarget(selectedTestTargetValue);
  const selectedSupportTargets = parseContextPackTargetList(selectedSupportTargetsValue);
  if (
    (selectedTestTargetValue && selectedTestTarget === undefined)
    || (selectedSupportTargetsValue && selectedSupportTargets === undefined)
  ) {
    return { kind: 'invalid', reason: 'malformed-targets', section };
  }

  return {
    kind: 'binding',
    binding: {
      ...binding,
      deepFocusEnabled: true,
      ...(deepFocusPrimaryRepoId ? { deepFocusPrimaryRepoId } : {}),
      ...(deepFocusPrimaryFocusId ? { deepFocusPrimaryFocusId } : {}),
      selectedFocusPath: extractLabeledValue(section, 'Selected Focus Path', SECTION_NAMES.CONTEXT_PACK_BINDING),
      selectedFocusTargetKind: parseTargetKind(
        extractLabeledValue(section, 'Selected Focus Target Kind', SECTION_NAMES.CONTEXT_PACK_BINDING),
      ),
      selectedFocusTargets,
      selectedTestTarget: selectedTestTarget ?? null,
      selectedSupportTargets: selectedSupportTargets ?? [],
    },
  };
}

/**
 * Format a context pack binding as a markdown section.
 * Inverse of extractContextPackBinding — owns the canonical label format.
 */
export function formatContextPackBindingSection(binding: {
  contextPackDir?: string;
  contextPackId?: string;
  scopeMode?: string;
  selectedRepoIds?: string[];
  selectedFocusIds?: string[];
  repositoryTypes?: ContextPackRepositoryTypes;
  deepFocusEnabled?: boolean;
  primaryRepoId?: string | null;
  primaryFocusId?: string | null;
  deepFocusPrimaryRepoId?: string | null;
  deepFocusPrimaryFocusId?: string | null;
  selectedFocusPath?: string | null;
  selectedFocusTargetKind?: 'directory' | 'file' | null;
  selectedFocusTargets?: PrimaryFocusTarget[];
  selectedTestTarget?: TaskContextPackTarget | null;
  selectedSupportTargets?: TaskContextPackTarget[];
}): string {
  const lines = [
    '## Context Pack Binding',
    '',
    `- Context Pack Dir: ${binding.contextPackDir ?? ''}`,
    `- Context Pack ID: ${binding.contextPackId ?? ''}`,
    `- Scope Mode: ${binding.scopeMode ?? ''}`,
  ];
  // Deep focus encodes the operator's selection in `Selected Focus Targets`
  // (the JSON array with role markers). `Primary Repo ID` is duplicated by the
  // anchor target's `repoId`, and `Selected Focus IDs` is structurally always
  // empty in deep-focus mode. Suppress both to keep the section signal-only.
  // Likewise, monolith packs have no repo selection concept — staging passes
  // an empty `selectedRepoIds` and we skip the line entirely so the monolith
  // section reads cleanly without a degenerate echo of `Context Pack ID`.
  const isDeepFocus = binding.deepFocusEnabled === true;
  if (binding.primaryRepoId && !isDeepFocus) {
    lines.push(`- Primary Repo ID: ${binding.primaryRepoId}`);
  }
  const repoIds = binding.selectedRepoIds ?? [];
  if (repoIds.length > 0) {
    lines.push(`- Selected Repo IDs: ${repoIds.join(', ')}`);
  }
  if (binding.primaryFocusId) {
    lines.push(`- Primary Focus ID: ${binding.primaryFocusId}`);
  }
  if (!isDeepFocus) {
    lines.push(`- Selected Focus IDs: ${(binding.selectedFocusIds ?? []).join(', ')}`);
    if (binding.repositoryTypes && Object.keys(binding.repositoryTypes).length > 0) {
      lines.push(`- Selection Roles: ${stableStringifyRepositoryTypes(binding.repositoryTypes)}`);
    }
  }

  if (binding.deepFocusEnabled === true) {
    lines.push('- Deep Focus Enabled: true');
    if (binding.deepFocusPrimaryRepoId) {
      lines.push(`- Deep Focus Primary Repo ID: ${binding.deepFocusPrimaryRepoId}`);
    }
    if (binding.deepFocusPrimaryFocusId) {
      lines.push(`- Deep Focus Primary Focus ID: ${binding.deepFocusPrimaryFocusId}`);
    }
    if (binding.selectedFocusPath != null) {
      lines.push(`- Selected Focus Path: ${binding.selectedFocusPath}`);
    }
    if (binding.selectedFocusTargetKind != null) {
      lines.push(`- Selected Focus Target Kind: ${binding.selectedFocusTargetKind}`);
    }
    lines.push(`- Selected Focus Targets: ${JSON.stringify(binding.selectedFocusTargets ?? [])}`);
    if (binding.selectedTestTarget) {
      lines.push(`- Selected Test Target: ${JSON.stringify(binding.selectedTestTarget)}`);
    }
    lines.push(
      `- Selected Support Targets: ${JSON.stringify(binding.selectedSupportTargets ?? [])}`,
    );
  }

  return lines.join('\n');
}

export type AgentVisibleContextPackTarget = {
  path: string;
  kind: 'directory' | 'file';
  repoId?: string;
  focusId?: string;
  role?: 'anchor' | 'primary';
  testTarget?: AgentVisibleContextPackTarget;
  supportTargets?: AgentVisibleContextPackTarget[];
};

export function formatAgentVisibleContextPackBindingSection(
  binding: Parameters<typeof formatContextPackBindingSection>[0],
): string {
  if (binding.deepFocusEnabled !== true) {
    return formatContextPackBindingSection(binding);
  }

  const targets = (binding.selectedFocusTargets ?? []).map(sanitizeAgentVisibleTarget);
  const selectedRepoIds = collectAgentVisibleRepoIds(binding, targets);
  const multiPrimary = targets.filter((target) => target.role === 'anchor' || target.role === 'primary').length > 1;
  return formatContextPackBindingSection({
    ...binding,
    selectedRepoIds,
    selectedFocusTargets: targets as PrimaryFocusTarget[],
    selectedTestTarget: binding.selectedTestTarget ? sanitizeAgentVisibleTarget(binding.selectedTestTarget) : null,
    selectedSupportTargets: (binding.selectedSupportTargets ?? []).map(sanitizeAgentVisibleTarget),
    deepFocusPrimaryRepoId: multiPrimary ? null : binding.deepFocusPrimaryRepoId,
    selectedFocusPath: multiPrimary ? null : binding.selectedFocusPath,
    selectedFocusTargetKind: multiPrimary ? null : binding.selectedFocusTargetKind,
  });
}

function sanitizeAgentVisibleTarget<T extends TaskContextPackTarget & {
  role?: 'anchor' | 'primary';
  testTarget?: TaskContextPackTarget | null;
  supportTargets?: TaskContextPackTarget[];
}>(target: T): AgentVisibleContextPackTarget {
  return {
    path: target.path,
    kind: target.kind,
    ...(target.repoId ? { repoId: target.repoId } : {}),
    ...(target.focusId ? { focusId: target.focusId } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.testTarget ? { testTarget: sanitizeAgentVisibleTarget(target.testTarget) } : {}),
    ...(target.supportTargets?.length ? { supportTargets: target.supportTargets.map(sanitizeAgentVisibleTarget) } : {}),
  };
}

function collectAgentVisibleRepoIds(
  binding: Parameters<typeof formatContextPackBindingSection>[0],
  targets: readonly AgentVisibleContextPackTarget[],
): string[] {
  const repoIds: string[] = [];
  const seen = new Set<string>();
  const add = (repoId: string | undefined): void => {
    const id = repoId?.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    repoIds.push(id);
  };
  const walk = (target: AgentVisibleContextPackTarget): void => {
    add(target.repoId);
    if (target.testTarget) walk(target.testTarget);
    for (const support of target.supportTargets ?? []) walk(support);
  };
  for (const target of targets) walk(target);
  if (binding.selectedTestTarget?.repoId) add(binding.selectedTestTarget.repoId);
  for (const support of binding.selectedSupportTargets ?? []) add(support.repoId);
  for (const repoId of binding.selectedRepoIds ?? []) add(repoId);
  return repoIds;
}

function commaSplit(value: string): string[] {
  return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];
}

function normalizeBranchChainBinding(binding: TaskBranchChainBinding): TaskBranchChainBinding {
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId: binding.rootTaskId,
    parentTaskId: binding.parentTaskId,
    depth: binding.depth,
    repos: binding.repos.map((repo) => ({
      repoRoot: repo.repoRoot,
      repoLabel: repo.repoLabel,
      chainSourceBranch: repo.chainSourceBranch,
      parentSourceBranch: repo.parentSourceBranch,
      parentBranchHead: repo.parentBranchHead,
      targetBranch: repo.targetBranch,
    })),
  };
}

function extractFirstJsonFence(section: string): string | null {
  const lines = section.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const opener = lines[index]!.trim();
    if (!opener.startsWith('```')) {
      continue;
    }
    if (opener !== '```json' && opener !== '```') {
      return null;
    }
    const body: string[] = [];
    for (let closeIndex = index + 1; closeIndex < lines.length; closeIndex += 1) {
      if (lines[closeIndex]!.trim() === '```') {
        return body.join('\n');
      }
      body.push(lines[closeIndex]!);
    }
    return null;
  }
  return null;
}

export function parseBranchChainBinding(value: unknown): TaskBranchChainBinding | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1
    || candidate.mode !== 'continuation'
    || !isNonEmptyString(candidate.rootTaskId)
    || !isNonEmptyString(candidate.parentTaskId)
    || !Number.isInteger(candidate.depth)
    || (candidate.depth as number) < 0
    || !Array.isArray(candidate.repos)
    || candidate.repos.length === 0
  ) {
    return null;
  }

  const repos = candidate.repos.map(parseBranchChainRepo);
  if (repos.some((repo) => repo === null)) {
    return null;
  }

  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId: candidate.rootTaskId,
    parentTaskId: candidate.parentTaskId,
    depth: candidate.depth as number,
    repos: repos as TaskBranchChainRepo[],
  };
}

function parseBranchChainRepo(value: unknown): TaskBranchChainRepo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isNonEmptyString(candidate.repoRoot)
    || !isNonEmptyString(candidate.repoLabel)
    || !isNonEmptyString(candidate.chainSourceBranch)
    || !isNonEmptyString(candidate.parentSourceBranch)
    || !isNonEmptyString(candidate.parentBranchHead)
    || !(candidate.targetBranch === null || isNonEmptyString(candidate.targetBranch))
  ) {
    return null;
  }
  return {
    repoRoot: candidate.repoRoot,
    repoLabel: candidate.repoLabel,
    chainSourceBranch: candidate.chainSourceBranch,
    parentSourceBranch: candidate.parentSourceBranch,
    parentBranchHead: candidate.parentBranchHead,
    targetBranch: candidate.targetBranch,
  };
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function optionalLabeledValue(section: string, label: string): string | undefined {
  const value = extractLabeledValue(section, label, SECTION_NAMES.CONTEXT_PACK_BINDING).trim();
  return value || undefined;
}

function parseTargetKind(value: string): 'directory' | 'file' | undefined {
  return value === 'directory' || value === 'file' ? value : undefined;
}

function parseContextPackTarget(value: string): TaskContextPackTarget | null | undefined {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return isContextPackTarget(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseContextPackTargetList(value: string): TaskContextPackTarget[] | undefined {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.every(isContextPackTarget) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parsePrimaryFocusTargetList(value: string): PrimaryFocusTarget[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const targets = parsed.map(parsePrimaryFocusTarget).filter((target): target is PrimaryFocusTarget => target !== null);
    return targets.length === parsed.length ? targets : undefined;
  } catch {
    return undefined;
  }
}

function isContextPackTarget(value: unknown): value is TaskContextPackTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate.path === 'string'
    && (candidate.kind === 'directory' || candidate.kind === 'file');
}

function isPrimaryFocusTarget(value: unknown): value is PrimaryFocusTarget {
  if (!isContextPackTarget(value)) {
    return false;
  }
  const role = (value as unknown as Record<string, unknown>).role;
  return role === undefined || role === 'anchor' || role === 'primary';
}

function parsePrimaryFocusTarget(value: unknown): PrimaryFocusTarget | null {
  if (!isPrimaryFocusTarget(value)) {
    return null;
  }
  const candidate = value as unknown as Record<string, unknown>;
  const testTarget = candidate.testTarget === null
    ? undefined
    : parseContextPackTargetValue(candidate.testTarget);
  const supportTargets = Array.isArray(candidate.supportTargets)
    ? candidate.supportTargets.filter(isContextPackTarget)
    : [];
  return {
    path: value.path,
    kind: value.kind,
    ...(typeof candidate.repoLocalPath === 'string' && candidate.repoLocalPath
      ? { repoLocalPath: candidate.repoLocalPath }
      : {}),
    ...(typeof candidate.repoId === 'string' && candidate.repoId
      ? { repoId: candidate.repoId }
      : {}),
    ...(typeof candidate.focusId === 'string' && candidate.focusId
      ? { focusId: candidate.focusId }
      : {}),
    ...(value.role ? { role: value.role } : {}),
    ...(testTarget ? { testTarget } : {}),
    supportTargets,
  };
}

function parseContextPackTargetValue(value: unknown): TaskContextPackTarget | undefined {
  return isContextPackTarget(value) ? value : undefined;
}

/**
 * Extract a value from a `- LABEL: VALUE` line in a block of text.
 */
function extractLabeledValue(text: string, label: string, sectionName = 'unknown'): string {
  const contract = loadMarkdownContract();
  let value = '';
  let found = false;
  let duplicateWarned = false;
  for (const line of text.split(/\r?\n/)) {
    const match = contract.compiled.label.exec(line.trim());
    if (match?.[contract.groups.labelName]?.trim() !== label) {
      continue;
    }
    if (!found) {
      value = stripHtmlComments(match[contract.groups.labelValue] ?? '').trim();
      found = true;
      continue;
    }
    if (!duplicateWarned) {
      log.warn('markdown.label.duplicate', { label, sectionName });
      duplicateWarned = true;
    }
  }
  return value;
}
