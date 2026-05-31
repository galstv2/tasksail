import path from 'node:path';
import type { ProviderRuntimeManifestEnvVar } from '../cli-provider/index.js';
import { SPEC_REQUIRED_SECTION_SPECS } from '../workflow-policy/models.js';
import type { SliceArtifactFormat } from '../platform-config/types.js';

export type AgentRuntimePathManifestValueKind = 'path' | 'json' | 'file' | 'scalar';

export interface AgentRuntimePathManifestEntry {
  name: string;
  value: string;
  kind: AgentRuntimePathManifestValueKind;
  description: string;
}

export interface AgentRuntimePathManifest {
  agentId: string;
  launchPhase?: string;
  agentCwd: string;
  entries: AgentRuntimePathManifestEntry[];
  includeRoleArtifactChecklist?: boolean;
}

// Many of these names also appear in launchEnv.ts::TASKSAIL_LAUNCH_CONTROLLED_ENV_KEYS.
// When adding a new TASKSAIL_*, ACTIVE_CONTEXT_PACK_*, RUN_ROLE_AGENT_AUTONOMY_*,
// EXTERNAL_MCP_*, CONTEXT_PACK_*, or REPO_CONTEXT_MCP_* env key, audit both lists —
// they cannot share a source because manifest descriptors carry kind/description metadata
// and intentionally exclude secret-bearing keys like RUN_ROLE_AGENT_ACTIVE_MODEL.
const PLATFORM_RUNTIME_MANIFEST_ENV_VARS: readonly ProviderRuntimeManifestEnvVar[] = [
  { name: 'ACTIVE_CONTEXT_PACK_DIR', kind: 'path', description: 'Active context pack directory visible to this launch.' },
  { name: 'ACTIVE_CONTEXT_PACK_HOST_DIR', kind: 'path', description: 'Host path for the active context pack when container paths are used.' },
  { name: 'TASKSAIL_TASK_ID', kind: 'scalar', description: 'Current TaskSail task identifier for this launch.' },
  { name: 'TASKSAIL_TASK_BRANCHES', kind: 'json', description: 'Inline JSON branch metadata for branch-owned task repo bindings.' },
  { name: 'TASKSAIL_TASK_BRANCHES_FILE', kind: 'file', description: 'File containing branch-owned task repo metadata when the inline value is too large.' },
  { name: 'TASKSAIL_TASK_WORKTREES', kind: 'json', description: 'Inline JSON worktree metadata for all task-visible worktrees.' },
  { name: 'TASKSAIL_TASK_WORKTREES_FILE', kind: 'file', description: 'File containing all task-visible worktree metadata when the inline value is too large.' },
  { name: 'TASKSAIL_SLICE_ARTIFACT_FORMAT', kind: 'scalar', description: 'Frozen slice artifact format for this task. Use the active-format artifact checklist for authoring rules.' },
  { name: 'TASKSAIL_REALIGNMENT_STAGING_PATH', kind: 'path', description: 'Standalone realignment staging file path.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON', kind: 'json', description: 'Structured launch autonomy profile and boundary metadata.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON', kind: 'json', description: 'JSON array of allowed directories for this launch.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR', kind: 'path', description: 'Working directory advertised by the autonomy boundary.' },
  { name: 'RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS', kind: 'scalar', description: 'Autonomy boundary status for this launch.' },
  { name: 'CONTEXT_PACK_CONVENTIONS_STATUS', kind: 'scalar', description: 'Context-pack conventions availability status.' },
  { name: 'CONTEXT_PACK_CONVENTIONS_CONTEXT_FILE', kind: 'file', description: 'File containing context-pack conventions when available.' },
  { name: 'CONTEXT_PACK_CORRECTIONS_STATUS', kind: 'scalar', description: 'Context-pack corrections availability status.' },
  { name: 'CONTEXT_PACK_CORRECTIONS_CONTEXT_FILE', kind: 'file', description: 'File containing context-pack corrections when available.' },
  { name: 'EXTERNAL_MCP_CONTEXT_STATUS', kind: 'scalar', description: 'External MCP context availability status.' },
  { name: 'EXTERNAL_MCP_CONTEXT_FILE', kind: 'file', description: 'File containing launch-scoped external MCP context.' },
  { name: 'REPO_CONTEXT_MCP_URL', kind: 'scalar', description: 'Repo context MCP endpoint URL for this launch.' },
  { name: 'REPO_CONTEXT_MCP_PORT', kind: 'scalar', description: 'Repo context MCP port for this launch.' },
];

export function buildAgentRuntimePathManifest(args: {
  agentId: string;
  launchPhase?: string;
  agentCwd: string;
  env: Record<string, string>;
  providerEnvVars: readonly ProviderRuntimeManifestEnvVar[];
  includeRoleArtifactChecklist?: boolean;
}): AgentRuntimePathManifest {
  const descriptors = [...PLATFORM_RUNTIME_MANIFEST_ENV_VARS, ...args.providerEnvVars];
  return {
    agentId: args.agentId,
    ...(args.launchPhase !== undefined ? { launchPhase: args.launchPhase } : {}),
    agentCwd: args.agentCwd,
    ...(args.includeRoleArtifactChecklist === true ? { includeRoleArtifactChecklist: true } : {}),
    entries: descriptors.flatMap((descriptor) => {
      const value = args.env[descriptor.name];
      if (value === undefined) {
        return [];
      }
      return [{
        name: descriptor.name,
        value,
        kind: descriptor.kind,
        description: descriptor.description,
      }];
    }),
  };
}

interface BaseArtifactChecklistInput {
  taskId?: string;
  handoffsDir: string;
  implementationStepsDir: string;
  platformRepoRoot: string;
  sliceArtifactFormat: SliceArtifactFormat;
}

type ProductManagerArtifactChecklistInput = BaseArtifactChecklistInput;

function buildProductManagerArtifactChecklist(input: ProductManagerArtifactChecklistInput): string[] {
  const isXml = input.sliceArtifactFormat === 'xml';
  const templateFilename = isXml ? 'slice-template.xml' : 'slice-template.md';
  const sliceFilenamePattern = isXml ? 'slice-N.xml' : 'slice-N.md';
  const sliceGlob = isXml ? 'slice-*.xml' : 'slice-*.md';
  const implementationSpecPath = path.join(input.handoffsDir, 'implementation-spec.md');
  const intakePath = path.join(input.handoffsDir, 'intake.md');
  const parallelOkPath = path.join(input.handoffsDir, 'parallel-ok.md');
  const sliceTemplatePath = path.join(input.platformRepoRoot, 'AgentWorkSpace', 'templates', templateFilename);
  const authoringRules: string[] = isXml
    ? [
        `Active slice format: xml. Slice files are ${sliceFilenamePattern} under ${input.implementationStepsDir}.`,
        `implementation-spec.md and parallel-ok.md are required handoff documents at the paths above.`,
        `Authoring rules for active XML slices:`,
        `- Copy ${templateFilename} from ${sliceTemplatePath} for each slice; do not edit the template.`,
        `- Save each slice as ${sliceFilenamePattern} under ${input.implementationStepsDir}.`,
        `- Preserve the executionSlice XML structure exactly. Set the executionSlice id attribute to slice-N and the metadata/sliceId element text to slice-N.`,
        `- Populate every required element (those with required="true") with substantive task-specific content. Default to plain element text; prose needs no CDATA.`,
        `- For refactors, extractions, routes, endpoints, handlers, or controllers, populate executionScope/currentSymbols with every relevant existing source symbol found during source inspection, then classify each entry in executionScope/includedSymbols or executionScope/excludedSymbols. If source inspection finds no existing symbols, say that explicitly instead of inventing symbols.`,
        `- Wrap a field's content in a CDATA section when it contains code, commands, pseudocode, or literal < > & characters (for example generics like Promise<T>, file globs like <taskId>, or shell snippets). The validationCommands element is always CDATA.`,
        `- For an isolated < or & in otherwise-plain prose, escape it as &lt; / &amp; or wrap the field in CDATA.`,
        `- Do not invent new XML sections or rename existing elements. Populate only within the existing structure.`,
        `Reader-side guidance for active XML slices:`,
        `- Slice files are ${sliceGlob} under ${input.implementationStepsDir}.`,
        `- Acceptance criteria: acceptanceAndValidation/acceptanceCriteria element.`,
        `- Files to change: filesAndInterfaces/files element.`,
        `- Validation commands: acceptanceAndValidation/validationCommands element.`,
        `- Source inventory and inclusion boundaries: executionScope/currentSymbols, executionScope/includedSymbols, and executionScope/excludedSymbols elements.`,
        `- Scope and required changes: executionScope/scope and implementation/requiredChanges elements.`,
      ]
    : [
        `Active slice format: markdown. Slice files are ${sliceFilenamePattern} under ${input.implementationStepsDir}.`,
        `implementation-spec.md remains markdown. parallel-ok.md remains markdown.`,
        `Authoring rules (markdown mode):`,
        `- Copy ${templateFilename} from ${sliceTemplatePath} for each slice; do not edit the template.`,
        `- Save each slice as ${sliceFilenamePattern} under ${input.implementationStepsDir}.`,
        `- Preserve every seeded ## and ### heading exactly. Do not delete, rename, reorder, promote, or demote headings.`,
        `- Populate content only under the existing seeded headings. Write None under any seeded section that does not apply.`,
        `- For refactors, extractions, routes, endpoints, handlers, or controllers, populate Current Symbols with every relevant existing source symbol found during source inspection, then classify each entry in Included Symbols or Excluded Symbols. If source inspection finds no existing symbols, say that explicitly instead of inventing symbols.`,
        `- Write parallel-ok.md last, after implementation-spec.md and every planned slice are complete.`,
        `Reader-side guidance (markdown mode — for slice consumers: Ron, Dalton execution/remediation):`,
        `- Slice files are ${sliceGlob} under ${input.implementationStepsDir}.`,
        `- Content lives under seeded ## and ### headings: Purpose, Depends On, Scope, Current Symbols, Included Symbols, Excluded Symbols, Files, Acceptance Criteria, Unit Tests, Validation Commands, Guards.`,
      ];
  return [
    '## Product Manager Artifact Checklist',
    '',
    `Task ID: ${input.taskId ?? 'unknown'}`,
    `- implementation-spec.md: ${implementationSpecPath}`,
    `- intake.md: ${intakePath}`,
    `- ImplementationSteps directory: ${input.implementationStepsDir}`,
    `- ${templateFilename}: ${sliceTemplatePath}`,
    `- parallel-ok.md: ${parallelOkPath}`,
    '',
    'Artifact ownership:',
    `- Read only: intake.md (${intakePath}). Read it as source context; do not edit it.`,
    `- Read only template: ${templateFilename} (${sliceTemplatePath}). Copy its shape; do not edit the template.`,
    `- Write in place: implementation-spec.md (${implementationSpecPath}). Fill every required section with substantive task-specific content.`,
    `- Create and populate: ${sliceFilenamePattern} files under ${input.implementationStepsDir}. Copy each from ${templateFilename}, then populate it.`,
    `- Write last: parallel-ok.md (${parallelOkPath}). Set Decision to Simple or Complex only after implementation-spec.md and every planned slice are complete.`,
    '',
    'Required implementation-spec sections:',
    ...SPEC_REQUIRED_SECTION_SPECS.map((section) => `- ${section.preferredHeading}`),
    '',
    'Headings, blank lines, HTML comments, and placeholder text are not completion. Populate each required section with task-specific content.',
    `Write order: complete implementation-spec.md, create every ${sliceFilenamePattern} from ${templateFilename}, populate every slice, then write parallel-ok.md last.`,
    'Use Decision Simple for one coherent implementation path or when orchestration does not improve reliability.',
    `Use Decision Complex only when orchestration improves reliability. Complex requires bullets under Independent Slices that name existing ${sliceFilenamePattern} files.`,
    '',
    ...authoringRules,
  ];
}

interface QaArtifactChecklistInput extends BaseArtifactChecklistInput {
  taskBranchesInline?: string;
  taskBranchesFile?: string;
}

function buildQaArtifactChecklist(input: QaArtifactChecklistInput): string[] {
  const sliceGlob = input.sliceArtifactFormat === 'xml' ? 'slice-*.xml' : 'slice-*.md';
  const taskBranchesEvidence = input.taskBranchesFile
    ? `TASKSAIL_TASK_BRANCHES_FILE: ${input.taskBranchesFile}`
    : input.taskBranchesInline !== undefined
      ? 'TASKSAIL_TASK_BRANCHES: parse the inline JSON value from the Runtime Path Manifest.'
      : 'Task branches evidence: unavailable for this launch.';
  return [
    '## QA Artifact Checklist',
    '',
    `Task ID: ${input.taskId ?? 'unknown'}`,
    `- issues.md: ${path.join(input.handoffsDir, 'issues.md')}`,
    `- final-summary.md: ${path.join(input.handoffsDir, 'final-summary.md')}`,
    `- retrospective-input.md: ${path.join(input.handoffsDir, 'retrospective-input.md')}`,
    `- implementation-spec.md: ${path.join(input.handoffsDir, 'implementation-spec.md')}`,
    `- code-changes.diff: ${path.join(input.handoffsDir, 'code-changes.diff')}`,
    `- ImplementationSteps directory: ${input.implementationStepsDir}`,
    `- Platform repo root: ${input.platformRepoRoot}`,
    `- ${taskBranchesEvidence}`,
    '',
    'Artifact ownership:',
    `- Read only: implementation-spec.md (${path.join(input.handoffsDir, 'implementation-spec.md')}), code-changes.diff (${path.join(input.handoffsDir, 'code-changes.diff')}), and ImplementationSteps/${sliceGlob} under ${input.implementationStepsDir}.`,
    `- Write for every review outcome: issues.md (${path.join(input.handoffsDir, 'issues.md')}).`,
    `- Write only for pass or advisory: retrospective-input.md (${path.join(input.handoffsDir, 'retrospective-input.md')}), then final-summary.md (${path.join(input.handoffsDir, 'final-summary.md')}) last.`,
    '- Do not edit Alice artifacts or source code during QA.',
    '',
    'First-pass QA write order: read code-changes.diff and slices, decide Review Outcome, write issues.md with concrete verified findings when blocking, otherwise complete retrospective-input.md, then final-summary.md last.',
    'For pass or advisory, final-summary.md must keep Closeout Owner Agent ID as qa, mark generated requirement IDs verified or advisory with evidence, set Test Status to passed, failed, partially-passed, or not-run, set QA Status to passed or issues-found, populate Task branches from provided branch evidence, and populate Completed Work, Key Design Decisions, Known Limitations, Test Result Summary, and Difficulty Assessment.',
    'For blocking, issues.md must include a concrete verified Finding, Severity, Finding Type, Required Fix, Remediation Owner Agent ID, Revalidation Agent ID, Return-To Agent ID, and Retest Instructions. Do not write closeout content for a blocking outcome.',
  ];
}

function roleArtifactChecklistLines(manifest: AgentRuntimePathManifest): string[] {
  if (!manifest.includeRoleArtifactChecklist || manifest.launchPhase !== undefined) {
    return [];
  }
  const entryValues = new Map(manifest.entries.map((entry) => [entry.name, entry.value]));
  const handoffsDir = entryValues.get('COPILOT_HANDOFFS_DIR');
  const implementationStepsDir = entryValues.get('COPILOT_IMPL_STEPS_DIR');
  const platformRepoRoot = entryValues.get('COPILOT_PLATFORM_REPO_ROOT');
  if (!handoffsDir || !implementationStepsDir || !platformRepoRoot) {
    return [];
  }
  const taskId = entryValues.get('TASKSAIL_TASK_ID');
  // Default to markdown when the env var is absent (legacy/non-task launches).
  const rawFormat = entryValues.get('TASKSAIL_SLICE_ARTIFACT_FORMAT');
  const sliceArtifactFormat: SliceArtifactFormat = rawFormat === 'xml' ? 'xml' : 'markdown';
  if (manifest.agentId === 'product-manager') {
    return buildProductManagerArtifactChecklist({
      taskId,
      handoffsDir,
      implementationStepsDir,
      platformRepoRoot,
      sliceArtifactFormat,
    });
  }
  if (manifest.agentId === 'qa') {
    return buildQaArtifactChecklist({
      taskId,
      handoffsDir,
      implementationStepsDir,
      platformRepoRoot,
      sliceArtifactFormat,
      taskBranchesInline: entryValues.get('TASKSAIL_TASK_BRANCHES'),
      taskBranchesFile: entryValues.get('TASKSAIL_TASK_BRANCHES_FILE'),
    });
  }
  return [];
}

export function renderAgentRuntimePathManifestForPrompt(
  manifest: AgentRuntimePathManifest,
): string {
  const lines = [
    '## Runtime Path Manifest',
    '',
    `Agent launch CWD: ${manifest.agentCwd}`,
    'Do not write $NAME or $NAME/... as a literal filesystem path; resolve the variable through this manifest first.',
    'If a value is JSON, parse it before using paths or branch metadata.',
    'If a _FILE value is present, read that file for the payload instead of guessing the inline value.',
    'Omitted variables are unavailable for this launch.',
    '',
  ];
  for (const entry of manifest.entries) {
    lines.push(`- ${entry.name} (${entry.kind}): ${entry.value} -- ${entry.description}`);
  }
  const checklist = roleArtifactChecklistLines(manifest);
  if (checklist.length > 0) {
    lines.push('', ...checklist);
  }
  return lines.join('\n');
}

export function prependRuntimePathManifestToPrompt(args: {
  prompt: string;
  manifest: AgentRuntimePathManifest;
}): string {
  return `${renderAgentRuntimePathManifestForPrompt(args.manifest)}\n\n${args.prompt.trim()}`;
}
