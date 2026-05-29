import path from 'node:path';
import type { ProviderRuntimeManifestEnvVar } from '../cli-provider/index.js';
import { SPEC_REQUIRED_SECTION_SPECS } from '../workflow-policy/models.js';

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
  { name: 'TASKSAIL_REALIGNMENT_STAGING_PATH', kind: 'path', description: 'Standalone realignment markdown staging file path.' },
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
}

type ProductManagerArtifactChecklistInput = BaseArtifactChecklistInput;

function buildProductManagerArtifactChecklist(input: ProductManagerArtifactChecklistInput): string[] {
  const implementationSpecPath = path.join(input.handoffsDir, 'implementation-spec.md');
  const intakePath = path.join(input.handoffsDir, 'intake.md');
  const parallelOkPath = path.join(input.handoffsDir, 'parallel-ok.md');
  const sliceTemplatePath = path.join(input.platformRepoRoot, 'AgentWorkSpace', 'templates', 'slice-template.md');
  return [
    '## Product Manager Artifact Checklist',
    '',
    `Task ID: ${input.taskId ?? 'unknown'}`,
    `- implementation-spec.md: ${implementationSpecPath}`,
    `- intake.md: ${intakePath}`,
    `- ImplementationSteps directory: ${input.implementationStepsDir}`,
    `- slice-template.md: ${sliceTemplatePath}`,
    `- parallel-ok.md: ${parallelOkPath}`,
    '',
    'Artifact ownership:',
    `- Read only: intake.md (${intakePath}). Read it as source context; do not edit it.`,
    `- Read only template: slice-template.md (${sliceTemplatePath}). Copy its shape; do not edit the template.`,
    `- Write in place: implementation-spec.md (${implementationSpecPath}). Fill every required section with substantive task-specific content.`,
    `- Create and populate: slice-N.md files under ${input.implementationStepsDir}. Copy each from slice-template.md, then populate it.`,
    `- Write last: parallel-ok.md (${parallelOkPath}). Set Decision to Simple or Complex only after implementation-spec.md and every planned slice are complete.`,
    '',
    'Required implementation-spec sections:',
    ...SPEC_REQUIRED_SECTION_SPECS.map((section) => `- ${section.preferredHeading}`),
    '',
    'Headings, blank lines, HTML comments, and placeholder text are not completion. Populate each required section with task-specific content.',
    'Write order: complete implementation-spec.md, create every slice-N.md from slice-template.md, populate every slice, then write parallel-ok.md last.',
    'Use Decision Simple for one coherent implementation path or when orchestration does not improve reliability.',
    'Use Decision Complex only when orchestration improves reliability. Complex requires bullets under Independent Slices that name existing slice-N.md files.',
  ];
}

interface QaArtifactChecklistInput extends BaseArtifactChecklistInput {
  taskBranchesInline?: string;
  taskBranchesFile?: string;
}

function buildQaArtifactChecklist(input: QaArtifactChecklistInput): string[] {
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
    `- Read only: implementation-spec.md (${path.join(input.handoffsDir, 'implementation-spec.md')}), code-changes.diff (${path.join(input.handoffsDir, 'code-changes.diff')}), and ImplementationSteps/slice-*.md under ${input.implementationStepsDir}.`,
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
  if (manifest.agentId === 'product-manager') {
    return buildProductManagerArtifactChecklist({
      taskId,
      handoffsDir,
      implementationStepsDir,
      platformRepoRoot,
    });
  }
  if (manifest.agentId === 'qa') {
    return buildQaArtifactChecklist({
      taskId,
      handoffsDir,
      implementationStepsDir,
      platformRepoRoot,
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
