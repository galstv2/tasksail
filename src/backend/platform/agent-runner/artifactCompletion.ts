import path from 'node:path';
import { readTextFile } from '../core/index.js';
import { remediationHasBlockingFindings } from './pipeline/remediation.js';
import {
  renderHandoffArtifactLabel,
  renderImplementationStepsLabel,
} from '../queue/paths.js';
import {
  listSliceFiles as listWorkflowPolicySliceFiles,
  parseArtifactMetadata,
  parseSections,
  resolveSemanticSection,
} from '../workflow-policy/artifacts.js';
import { normalizeAgentId, normalizeText, stripHtmlComments } from '../workflow-policy/matching.js';
import { GENERATED_INTAKE_SPINE_RULE_IDS } from '../workflow-policy/rules/spec.js';
import {
  ALLOWED_DIFFICULTY_LEVELS,
  CONTENT_SECTION_EXCLUSIONS,
  ISSUES_MD_REQUIRED_FINDING_SECTIONS,
  ISSUES_MD_ROUTING_AGENT_SECTIONS,
  SLICE_REQUIRED_SECTION_SPECS,
} from '../workflow-policy/models.js';
import { getActiveProvider } from '../cli-provider/index.js';

const FINAL_SUMMARY_REQUIRED_CONTENT_SECTIONS = [
  'Completed Work',
  'Key Design Decisions',
  'Known Limitations',
];
const REQUIREMENT_ID_PATTERN = /\b(?:CR|COMP|VAL)-\d{3}\b/g;
const FENCE_OPEN_RE = /^(```|~~~)/;
const ALLOWED_PARALLEL_DECISIONS = new Set(['simple', 'complex']);
const SLICE_REQUIREMENT_TRACEABILITY_RULE_IDS = new Set([
  'slice.requirement-id-covered',
  'slice.validation-id-covered',
  'slice.requirement-id-known',
]);

const MULTILINE_HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const TEMPLATE_BOILERPLATE_RE = /^(?:[-*]\s*|```\w*|#\s.*)$/;
const PLACEHOLDER_ONLY_RE = /^(?:[-*]\s*)?(?:tbd|todo|tba|placeholder)\.?$/i;

/**
 * Convert an internal relative artifact path to an env-var-based reference
 * suitable for prompt text. This ensures agents resolve paths
 * correctly regardless of CWD (critical for repo-executor agents whose CWD
 * is an external focused repo, not the platform repo).
 */
function toPromptPath(repoRoot: string, relativePath: string): string {
  const envVars = getActiveProvider(repoRoot).promptPathEnvVars();
  return relativePath
    .replace(/^AgentWorkSpace\/tasks\/[^/]+\/handoffs\//, `$${envVars.handoffsDir}/`)
    .replace(/^AgentWorkSpace\/tasks\/[^/]+\/ImplementationSteps\//, `$${envVars.implStepsDir}/`);
}
const ISSUES_NON_FINDING_SECTIONS = new Set(['Task Metadata', 'Review Outcome']);

function AGENT_REQUIRED_ARTIFACTS_FOR(taskId: string): Record<string, string[]> {
  return {
    qa: [
      renderHandoffArtifactLabel(taskId, 'issues.md'),
      renderHandoffArtifactLabel(taskId, 'final-summary.md'),
      renderHandoffArtifactLabel(taskId, 'retrospective-input.md'),
    ],
  };
}

function remediationInstructionsFor(taskId: string): Record<string, string> {
  return {
    [renderHandoffArtifactLabel(taskId, 'issues.md')]: 'Set Review Outcome in issues.md. If the code diff has no issues, set Review Outcome to pass and leave all finding sections empty. Do NOT review or create findings about AgentWorkSpace files — only review code in the diff.',
    [renderHandoffArtifactLabel(taskId, 'implementation-spec.md')]: 'Fill in implementation-spec.md: Goals must have numbered/bulleted items, Validation Strategy must have a code-fenced command block, and Files or Areas Likely to Change must list file paths.',
    [renderHandoffArtifactLabel(taskId, 'professional-task.md')]: 'Fill in professional-task.md: Acceptance Criteria must have bulleted items, Non-Goals must have bulleted items, and Problem Statement, Business Goal, and Scope must have content.',
    [renderHandoffArtifactLabel(taskId, 'final-summary.md')]: 'Fill in final-summary.md: set Closeout Owner Agent ID to \'qa\', set Difficulty Level to Easy/Medium/Hard, and populate Completed Work, Key Design Decisions, and Known Limitations.',
    [renderHandoffArtifactLabel(taskId, 'retrospective-input.md')]: 'Fill in retrospective-input.md: check the Retrospective Required field in Task Metadata. If \'true\', populate all sections including per-role contributions and Action Items. If \'false\', populate ONLY the Retrospective Summary with a brief note.',
  };
}

interface WorkspaceArtifact {
  exists: boolean;
  sections: Record<string, string[]>;
  metadata: Record<string, string>;
  taskLineage: Record<string, string>;
  hasSubstantiveContent: boolean;
}

function finalSummaryDifficultyLevel(artifact: WorkspaceArtifact): string {
  for (const line of artifact.sections['Difficulty Assessment'] ?? []) {
    const match = /^-\s+Difficulty Level:\s*(.*)$/.exec(line.trim());
    if (match) {
      return (match[1] ?? '').trim();
    }
  }
  return '';
}

function hasRealContent(artifact: WorkspaceArtifact): boolean {
  return Object.entries(artifact.sections).some(([sectionName, lines]) => {
    if (CONTENT_SECTION_EXCLUSIONS.has(sectionName)) {
      return false;
    }
    return lines.join('\n').replace(MULTILINE_HTML_COMMENT_RE, '').trim().length > 0;
  });
}

async function loadWorkspaceArtifactAtPath(absolutePath: string): Promise<WorkspaceArtifact> {
  const rawText = await readTextFile(absolutePath);
  const text = rawText ?? '';
  const sections = parseSections(text);
  return {
    exists: rawText !== undefined,
    sections,
    ...parseArtifactMetadata(sections),
    hasSubstantiveContent: Object.entries(sections).some(([sectionName, lines]) => (
      !CONTENT_SECTION_EXCLUSIONS.has(sectionName)
      && normalizeText(stripHtmlComments(lines)).length > 0
    )),
  };
}

function readHandoffArtifact(handoffsDir: string, basename: string): Promise<WorkspaceArtifact> {
  return loadWorkspaceArtifactAtPath(path.join(handoffsDir, basename));
}

export async function listSliceFiles(stepsDir: string): Promise<string[]> {
  return listWorkflowPolicySliceFiles(stepsDir);
}

function parallelOkHasActiveApproval(artifact: WorkspaceArtifact): boolean {
  const decisionText = parallelOkDecisionValue(artifact);
  if (!decisionText) {
    return false;
  }
  return decisionText.includes('complex') && !decisionText.includes('simple');
}

function parallelOkDecisionValue(artifact: WorkspaceArtifact): string {
  return normalizeText(stripHtmlComments(artifact.sections.Decision ?? [])).toLowerCase();
}

function parallelOkDecisionRecorded(artifact: WorkspaceArtifact): boolean {
  return ALLOWED_PARALLEL_DECISIONS.has(parallelOkDecisionValue(artifact));
}

function stripBoilerplate(lines: string[]): string[] {
  return stripHtmlComments(lines).filter((line) => {
    const trimmed = line.trim();
    return !TEMPLATE_BOILERPLATE_RE.test(trimmed) && !PLACEHOLDER_ONLY_RE.test(trimmed);
  });
}

function describeSemanticSectionSpec(sectionKey: string): string {
  const sectionSpec = SLICE_REQUIRED_SECTION_SPECS.find((candidate) => candidate.key === sectionKey);
  if (!sectionSpec) {
    return sectionKey;
  }

  const acceptedHeadings = [
    sectionSpec.preferredHeading,
    ...(sectionSpec.aliases ?? []),
  ];
  const acceptedContainers = sectionSpec.containerHeadings ?? [];

  if (acceptedHeadings.length === 1 && acceptedContainers.length === 0) {
    return acceptedHeadings[0]!;
  }

  const details: string[] = [
    acceptedHeadings.join(' / '),
  ];
  if (acceptedContainers.length > 0) {
    details.push(`or nested under ${acceptedContainers.join(' / ')}`);
  }
  return details.join(' ');
}

async function sliceMissingRequiredSections(slicePath: string): Promise<string[]> {
  const text = (await readTextFile(slicePath)) ?? '';
  const sections = parseSections(text);
  return SLICE_REQUIRED_SECTION_SPECS.filter((sectionSpec) => (
    normalizeText(stripBoilerplate(resolveSemanticSection(sections, sectionSpec).content)).length === 0
  )).map((sectionSpec) => sectionSpec.key);
}

async function sliceIsRuntimeReady(slicePath: string): Promise<boolean> {
  return (await sliceMissingRequiredSections(slicePath)).length === 0;
}

function issuesSectionsHaveFindings(sections: Record<string, string[]>): boolean {
  return Object.entries(sections).some(([sectionName, lines]) => {
    if (ISSUES_NON_FINDING_SECTIONS.has(sectionName)) {
      return false;
    }
    return normalizeText(stripHtmlComments(lines)).length > 0;
  });
}

function issuesHaveBlockingFindings(sections: Record<string, string[]>): boolean {
  const severityText = normalizeText(stripHtmlComments(sections.Severity ?? [])).toLowerCase();
  return severityText.includes('blocking');
}

function stripFencedCode(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    const match = FENCE_OPEN_RE.exec(trimmed);
    if (match?.[1]) {
      fence = match[1];
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function generatedRequirementIdsFromSpec(spec: WorkspaceArtifact): string[] {
  const intakeRequirements = spec.sections['Intake Requirements'];
  if (!intakeRequirements) {
    return [];
  }
  return [...new Set(stripFencedCode(stripHtmlComments(intakeRequirements).join('\n')).match(REQUIREMENT_ID_PATTERN) ?? [])].sort();
}

async function generatedRequirementIds(handoffsDir: string): Promise<string[]> {
  const spec = await readHandoffArtifact(handoffsDir, 'implementation-spec.md');
  if (!spec.exists || !spec.hasSubstantiveContent) {
    return [];
  }
  return generatedRequirementIdsFromSpec(spec);
}

function parseRequirementStatus(lines: readonly string[], id: string): string | null {
  const pattern = new RegExp(`\\b${id}:\\s*(.*)$`);
  const match = stripFencedCode(stripHtmlComments(lines).join('\n'))
    .split(/\r?\n/)
    .map((candidate) => pattern.exec(candidate))
    .find((candidate) => candidate !== null);
  if (!match) {
    return null;
  }
  const afterId = (match[1] ?? '').trim();
  if (afterId.includes(' - ')) {
    return afterId.split(' - ')[0]!.trim().toLowerCase();
  }
  const lowered = afterId.toLowerCase();
  if (lowered.startsWith('not met')) {
    return 'not met';
  }
  return lowered.split(/\s+/)[0] ?? null;
}

function requirementVerificationComplete(finalSummary: WorkspaceArtifact, ids: readonly string[]): boolean {
  if (ids.length === 0) {
    return true;
  }
  const lines = finalSummary.sections['Requirement Verification'];
  if (!lines || !normalizeText(stripHtmlComments(lines))) {
    return false;
  }
  return ids.every((id) => {
    const status = parseRequirementStatus(lines, id);
    return status === 'verified' || status === 'advisory';
  });
}

function issuesReviewOutcome(sections: Record<string, string[]>): string {
  return normalizeText(stripHtmlComments(sections['Review Outcome'] ?? [])).trim().toLowerCase();
}

async function qaIssuesStructured(handoffsDir: string): Promise<boolean> {
  const issues = await readHandoffArtifact(handoffsDir, 'issues.md');
  if (!issues.exists) {
    return true;
  }
  if (!issuesSectionsHaveFindings(issues.sections)) {
    return true;
  }
  for (const sectionName of ['Finding', ...ISSUES_MD_REQUIRED_FINDING_SECTIONS]) {
    if (!normalizeText(stripHtmlComments(issues.sections[sectionName] ?? []))) {
      return false;
    }
  }
  if (issuesHaveBlockingFindings(issues.sections)) {
    for (const sectionName of ISSUES_MD_ROUTING_AGENT_SECTIONS) {
      if (!normalizeText(stripHtmlComments(issues.sections[sectionName] ?? []))) {
        return false;
      }
    }
  }
  return true;
}

async function implementationSpecReady(handoffsDir: string): Promise<boolean> {
  const spec = await readHandoffArtifact(handoffsDir, 'implementation-spec.md');
  return spec.exists && spec.hasSubstantiveContent;
}

export async function detectParallelOk(handoffsDir: string): Promise<boolean> {
  const content = await readTextFile(path.join(handoffsDir, 'parallel-ok.md'));
  if (content === undefined) {
    return false;
  }
  const sections = parseSections(content);
  return parallelOkHasActiveApproval({
    exists: true,
    sections,
    ...parseArtifactMetadata(sections),
    hasSubstantiveContent: Object.entries(sections).some(([sectionName, lines]) => (
      !CONTENT_SECTION_EXCLUSIONS.has(sectionName)
      && normalizeText(stripHtmlComments(lines)).length > 0
    )),
  });
}

export async function checkAgentArtifactCompletion(options: {
  agentId: string;
  handoffsDir: string;
  implStepsDir: string;
  repoRoot: string;
  taskId?: string;
  abortSignal?: AbortSignal;
}): Promise<boolean> {
  const agentId = normalizeAgentId(options.agentId);
  const rootDir = options.repoRoot;

  if (agentId === 'planning-agent') {
    const stagingDir = options.taskId
      ? path.join(rootDir, 'AgentWorkSpace', 'tasks', options.taskId, 'dropbox-staging')
      : path.join(rootDir, 'AgentWorkSpace', 'dropbox', '.staging');
    const intakeFiles = (await listSliceFiles(stagingDir)).filter((filePath) => filePath.endsWith('.md'));
    if (intakeFiles.length === 0) {
      return false;
    }
    for (const filePath of intakeFiles) {
      if (hasRealContent(await loadWorkspaceArtifactAtPath(filePath))) {
        return true;
      }
    }
    return false;
  }

  if (agentId === 'product-manager') {
    if (!await implementationSpecReady(options.handoffsDir)) {
      return false;
    }
    const parallelOk = await readHandoffArtifact(options.handoffsDir, 'parallel-ok.md');
    if (!parallelOk.exists || !parallelOkDecisionRecorded(parallelOk)) {
      return false;
    }
    const slices = await listSliceFiles(options.implStepsDir);
    if (slices.length === 0) {
      return false;
    }
    if (!await sliceIsRuntimeReady(slices.at(-1)!)) {
      return false;
    }
    return true;
  }

  const required = AGENT_REQUIRED_ARTIFACTS_FOR(options.taskId ?? '')[agentId];
  if (!required) {
    return true;
  }

  // For QA, check if issues.md has a blocking outcome first. When blocking,
  // only issues.md is required — final-summary.md and retrospective-input.md
  // must NOT be written (the remediation loop handles next steps).
  if (agentId === 'qa') {
    const issues = await readHandoffArtifact(options.handoffsDir, 'issues.md');
    if (!issues.exists || !hasRealContent(issues)) {
      return false;
    }
    if (!await qaIssuesStructured(options.handoffsDir)) {
      return false;
    }
    const reviewOutcome = issuesReviewOutcome(issues.sections);
    if (reviewOutcome !== 'pass' && reviewOutcome !== 'advisory' && reviewOutcome !== 'blocking') {
      return false;
    }
    if (await remediationHasBlockingFindings(options.handoffsDir)) {
      return true;
    }

    // Non-blocking outcome — all closeout artifacts are required.
    const requirementIds = await generatedRequirementIds(options.handoffsDir);
    const finalSummary = await readHandoffArtifact(options.handoffsDir, 'final-summary.md');
    if (!finalSummary.exists || !hasRealContent(finalSummary)) {
      return false;
    }
    const retro = await readHandoffArtifact(options.handoffsDir, 'retrospective-input.md');
    if (!retro.exists || !hasRealContent(retro)) {
      return false;
    }
    const owner = normalizeAgentId(normalizeText(stripHtmlComments(finalSummary.sections['Closeout Owner Agent ID'] ?? [])));
    if (owner !== 'qa') {
      return false;
    }
    for (const sectionName of FINAL_SUMMARY_REQUIRED_CONTENT_SECTIONS) {
      if (!normalizeText(finalSummary.sections[sectionName] ?? [])) {
        return false;
      }
    }
    if (!normalizeText(finalSummary.sections['Task branches'] ?? [])) {
      return false;
    }
    if (!requirementVerificationComplete(finalSummary, requirementIds)) {
      return false;
    }
    const difficultyLevel = finalSummaryDifficultyLevel(finalSummary);
    if (!ALLOWED_DIFFICULTY_LEVELS.has(difficultyLevel)) {
      return false;
    }
    return true;
  }

  const loaded = new Map<string, WorkspaceArtifact>();
  for (const relativePath of required) {
    const basename = path.basename(relativePath);
    const artifact = await readHandoffArtifact(options.handoffsDir, basename);
    loaded.set(relativePath, artifact);
    if (!artifact.exists || !hasRealContent(artifact)) {
      return false;
    }
  }

  return true;
}

export async function buildAgentArtifactRemediationPrompt(options: {
  agentId: string;
  handoffsDir: string;
  implStepsDir: string;
  repoRoot: string;
  taskId?: string;
  abortSignal?: AbortSignal;
  policyViolationRuleIds?: readonly string[];
}): Promise<string> {
  const agentId = normalizeAgentId(options.agentId);

  if (agentId === 'product-manager') {
    const taskId = options.taskId ?? '';
    const missingParts: string[] = [];
    if (!await implementationSpecReady(options.handoffsDir)) {
      missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))}: complete the implementation spec with substantive planning content before deciding whether execution should be Simple or Complex.`);
    }
    if (options.policyViolationRuleIds?.some((ruleId) => GENERATED_INTAKE_SPINE_RULE_IDS.has(ruleId))) {
      missingParts.push(
        `- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))}: ` +
        'restore the generated ## Intake Requirements section from intake.md. ' +
        'Do not reinterpret, summarize, reorder, or weaken the copied Critical Requirements, Compatibility Requirements, or Required Validation content. ' +
        'Leave authored planning sections otherwise unchanged unless needed to keep markdown structure valid. ' +
        `Use ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'intake.md'))} as the source.`,
      );
    }
    if (options.policyViolationRuleIds?.some((ruleId) => SLICE_REQUIREMENT_TRACEABILITY_RULE_IDS.has(ruleId))) {
      missingParts.push(
        `- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))} and ` +
        `${toPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: ` +
        'account for every generated CR-*, COMP-*, and VAL-* ID by exact ID from ## Intake Requirements. ' +
        'Put global or cross-cutting IDs in ### Requirement Handling, put slice-owned IDs in the relevant slice content including ### Requirement Coverage, ' +
        'put every VAL-* in a validation surface, and remove or correct any unknown requirement ID. ' +
        'Do not paste every ID into every slice.',
      );
    }
    const parallelOk = await readHandoffArtifact(options.handoffsDir, 'parallel-ok.md');
    if (!parallelOk.exists || !parallelOkDecisionRecorded(parallelOk)) {
      missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'parallel-ok.md'))}: set the Decision section to exactly 'Simple' or 'Complex'. Default to 'Simple' unless fleet Dalton execution is truly required.`);
    }
    const slices = await listSliceFiles(options.implStepsDir);
    if (slices.length === 0) {
      missingParts.push(`- ${toPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: create at least one substantive sliceN.md handoff file.`);
    } else {
      const finalSlice = slices.at(-1)!;
      const missingSections = await sliceMissingRequiredSections(finalSlice);
      if (missingSections.length > 0) {
        const semanticSections = missingSections.map((sectionKey) => describeSemanticSectionSpec(sectionKey));
        const sliceBasename = path.basename(finalSlice);
        missingParts.push(`- ${toPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, sliceBasename))}: fill the required semantic sections still missing content: ${semanticSections.join(', ')}.`);
      }
    }
    if (missingParts.length === 0) {
      return '';
    }
    return [
      'You exited without completing all required artifacts. The following artifacts are still incomplete:',
      ...missingParts,
      'Do not do any other work. Only fill in the missing artifacts above.',
    ].join('\n');
  }

  const taskId = options.taskId ?? '';
  const required = AGENT_REQUIRED_ARTIFACTS_FOR(taskId)[agentId];
  if (!required) {
    return '';
  }

  const remediationInstructions = remediationInstructionsFor(taskId);
  const missingParts: string[] = [];
  for (const relativePath of required) {
    const basename = path.basename(relativePath);
    const artifact = await readHandoffArtifact(options.handoffsDir, basename);
    if (!artifact.exists || !hasRealContent(artifact)) {
      missingParts.push(`- ${toPromptPath(options.repoRoot, relativePath)}: ${remediationInstructions[relativePath] ?? `Fill in ${toPromptPath(options.repoRoot, relativePath)} with substantive content.`}`);
    }
  }
  if (agentId === 'qa' && !await qaIssuesStructured(options.handoffsDir)) {
    missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'issues.md'))}: Your issues.md has findings but is missing required structured sections. Each finding must have: Finding, Severity, Finding Type, Required Fix, Remediation Owner Agent ID (software-engineer), Revalidation Agent ID (qa), Return-To Agent ID (qa). Fill in all sections.`);
  }
  if (agentId === 'qa') {
    const requirementIds = await generatedRequirementIds(options.handoffsDir);
    const shapeInstruction = `${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'))}: preserve every top-level ## heading from the seeded template; populate content only under the seeded section bodies. Do not move Closeout Owner Agent ID, Review Outcome, or Task branches into Task Metadata or a custom summary.`;
    let shapeInstructionPushed = false;
    const pushShapeInstruction = (): void => {
      if (shapeInstructionPushed) {
        return;
      }
      missingParts.push(`- ${shapeInstruction}`);
      shapeInstructionPushed = true;
    };
    const issues = await readHandoffArtifact(options.handoffsDir, 'issues.md');
    if (issues.exists && !['pass', 'advisory', 'blocking'].includes(issuesReviewOutcome(issues.sections))) {
      missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'issues.md'))}: preserve every top-level ## heading from the seeded template; populate content only under the seeded section bodies. Do not move Closeout Owner Agent ID, Review Outcome, or Task branches into Task Metadata or a custom summary.`);
    }
    const finalSummary = await readHandoffArtifact(options.handoffsDir, 'final-summary.md');
    if (finalSummary.exists) {
      const owner = normalizeAgentId(normalizeText(stripHtmlComments(finalSummary.sections['Closeout Owner Agent ID'] ?? [])));
      if (owner !== 'qa') {
        missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'))}: set Closeout Owner Agent ID to exactly 'qa'.`);
        pushShapeInstruction();
      }
      const difficultyLevel = finalSummaryDifficultyLevel(finalSummary);
      if (!ALLOWED_DIFFICULTY_LEVELS.has(difficultyLevel)) {
        missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'))}: set '- Difficulty Level:' in the Difficulty Assessment section to exactly 'Easy', 'Medium', or 'Hard'.`);
      }
      // §4.15 Branch-name surfacing: instruct Ron to copy branch names into
      // ## Task branches in final-summary.md. Ron MUST NOT introspect git —
      // the branch list is available in TASKSAIL_TASK_BRANCHES (inline JSON)
      // or TASKSAIL_TASK_BRANCHES_FILE (path to a JSON file when payload > 8KB).
      if (!finalSummary.sections['Task branches'] || finalSummary.sections['Task branches']!.join('').trim().length === 0) {
        missingParts.push(
          `- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'))}: add a '## Task branches' section. ` +
          `Copy the value of the TASKSAIL_TASK_BRANCHES environment variable (a JSON array of { originalRoot, branch } objects) ` +
          `into this section. If TASKSAIL_TASK_BRANCHES is absent or empty, read the file path from TASKSAIL_TASK_BRANCHES_FILE instead and copy its contents. ` +
          `Do NOT run any git commands to discover branch names — use only the env var or file.`,
        );
        pushShapeInstruction();
      }
      if (requirementIds.length > 0 && !requirementVerificationComplete(finalSummary, requirementIds)) {
        missingParts.push(`- ${toPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'))}: populate ## Requirement Verification. The platform pre-populated this section with pending generated CR-*, COMP-*, and VAL-* IDs; replace each pending with verified or advisory and add a short evidence note. Do not delete IDs.`);
      }
    }
  }
  if (missingParts.length === 0) {
    return '';
  }
  return [
    'You exited without completing all required artifacts. The following artifacts are still incomplete:',
    ...missingParts,
    'Do not do any other work. Only fill in the missing artifacts above.',
  ].join('\n');
}
