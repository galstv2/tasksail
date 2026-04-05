import path from 'node:path';
import { readTextFile } from '../core/index.js';
import {
  listSliceFiles as listWorkflowPolicySliceFiles,
  parseArtifactMetadata,
  parseSections,
  resolveSemanticSection,
} from '../workflow-policy/artifacts.js';
import { normalizeAgentId, normalizeText, stripHtmlComments } from '../workflow-policy/matching.js';
import {
  ALLOWED_DIFFICULTY_LEVELS,
  CONTENT_SECTION_EXCLUSIONS,
  ISSUES_MD_REQUIRED_FINDING_SECTIONS,
  ISSUES_MD_ROUTING_AGENT_SECTIONS,
  SLICE_REQUIRED_SECTION_SPECS,
} from '../workflow-policy/models.js';

const FINAL_SUMMARY_REQUIRED_CONTENT_SECTIONS = [
  'Completed Work',
  'Key Design Decisions',
  'Known Limitations',
];
const ALLOWED_PARALLEL_DECISIONS = new Set(['simple', 'complex']);

const MULTILINE_HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const TEMPLATE_BOILERPLATE_RE = /^(?:[-*]\s*|```\w*|#\s.*)$/;
const PLACEHOLDER_ONLY_RE = /^(?:[-*]\s*)?(?:tbd|todo|tba|placeholder)\.?$/i;

/**
 * Convert an internal relative artifact path to an env-var-based reference
 * suitable for prompt text. This ensures copilot agents resolve paths
 * correctly regardless of CWD (critical for repo-executor agents whose CWD
 * is an external focused repo, not the platform repo).
 */
function toPromptPath(relativePath: string): string {
  return relativePath
    .replace(/^AgentWorkSpace\/handoffs\//, '$COPILOT_HANDOFFS_DIR/')
    .replace(/^AgentWorkSpace\/ImplementationSteps\//, '$COPILOT_IMPL_STEPS_DIR/');
}
const ISSUES_NON_FINDING_SECTIONS = new Set(['Task Metadata', 'Review Outcome']);

const AGENT_REQUIRED_ARTIFACTS: Record<string, string[]> = {
  qa: [
    'AgentWorkSpace/handoffs/issues.md',
    'AgentWorkSpace/handoffs/final-summary.md',
    'AgentWorkSpace/handoffs/retrospective-input.md',
  ],
};

const ARTIFACT_REMEDIATION_INSTRUCTIONS: Record<string, string> = {
  'AgentWorkSpace/handoffs/issues.md': 'Set Review Outcome in issues.md. If the code diff has no issues, set Review Outcome to pass and leave all finding sections empty. Do NOT review or create findings about AgentWorkSpace files — only review code in the diff.',
  'AgentWorkSpace/handoffs/implementation-spec.md': 'Fill in implementation-spec.md: Goals must have numbered/bulleted items, Validation Strategy must have a code-fenced command block, and Files or Areas Likely to Change must list file paths.',
  'AgentWorkSpace/handoffs/professional-task.md': 'Fill in professional-task.md: Acceptance Criteria must have bulleted items, Non-Goals must have bulleted items, and Problem Statement, Business Goal, and Scope must have content.',
  'AgentWorkSpace/handoffs/final-summary.md': 'Fill in final-summary.md: set Closeout Owner Agent ID to \'qa\', set Difficulty Level to Easy/Medium/Hard, and populate Completed Work, Key Design Decisions, and Known Limitations.',
  'AgentWorkSpace/handoffs/retrospective-input.md': 'Fill in retrospective-input.md: check the Retrospective Required field in Task Metadata. If \'true\', populate all sections including per-role contributions and Action Items. If \'false\', populate ONLY the Retrospective Summary with a brief note.',
};

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

async function loadWorkspaceArtifact(rootDir: string, relativePath: string): Promise<WorkspaceArtifact> {
  const absolutePath = path.join(rootDir, relativePath);
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

async function qaIssuesStructured(rootDir: string): Promise<boolean> {
  const issues = await loadWorkspaceArtifact(rootDir, 'AgentWorkSpace/handoffs/issues.md');
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

async function implementationSpecReady(rootDir: string): Promise<boolean> {
  const spec = await loadWorkspaceArtifact(rootDir, 'AgentWorkSpace/handoffs/implementation-spec.md');
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
  repoRoot?: string;
  abortSignal?: AbortSignal;
}): Promise<boolean> {
  const agentId = normalizeAgentId(options.agentId);
  const rootDir = path.resolve(options.handoffsDir, '..', '..');

  if (agentId === 'planning-agent') {
    const stagingDir = path.join(rootDir, 'AgentWorkSpace', 'dropbox', '.staging');
    const intakeFiles = (await listSliceFiles(stagingDir)).filter((filePath) => filePath.endsWith('.md'));
    if (intakeFiles.length === 0) {
      return false;
    }
    for (const filePath of intakeFiles) {
      const relativePath = path.relative(rootDir, filePath);
      if (hasRealContent(await loadWorkspaceArtifact(rootDir, relativePath))) {
        return true;
      }
    }
    return false;
  }

  if (agentId === 'product-manager') {
    if (!await implementationSpecReady(rootDir)) {
      return false;
    }
    const parallelOk = await loadWorkspaceArtifact(rootDir, 'AgentWorkSpace/handoffs/parallel-ok.md');
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

  const required = AGENT_REQUIRED_ARTIFACTS[agentId];
  if (!required) {
    return true;
  }

  const loaded = new Map<string, WorkspaceArtifact>();
  for (const relativePath of required) {
    const artifact = await loadWorkspaceArtifact(rootDir, relativePath);
    loaded.set(relativePath, artifact);
    if (!artifact.exists || !hasRealContent(artifact)) {
      return false;
    }
  }

  if (agentId === 'qa') {
    if (!await qaIssuesStructured(rootDir)) {
      return false;
    }
    const finalSummary = loaded.get('AgentWorkSpace/handoffs/final-summary.md')!;
    const owner = normalizeAgentId(normalizeText(stripHtmlComments(finalSummary.sections['Closeout Owner Agent ID'] ?? [])));
    if (owner !== 'qa') {
      return false;
    }
    for (const sectionName of FINAL_SUMMARY_REQUIRED_CONTENT_SECTIONS) {
      if (!normalizeText(finalSummary.sections[sectionName] ?? [])) {
        return false;
      }
    }
    const difficultyLevel = finalSummaryDifficultyLevel(finalSummary);
    if (!ALLOWED_DIFFICULTY_LEVELS.has(difficultyLevel)) {
      return false;
    }
  }

  return true;
}

export async function buildAgentArtifactRemediationPrompt(options: {
  agentId: string;
  handoffsDir: string;
  implStepsDir: string;
  repoRoot?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const agentId = normalizeAgentId(options.agentId);
  const rootDir = path.resolve(options.handoffsDir, '..', '..');

  if (agentId === 'product-manager') {
    const missingParts: string[] = [];
    if (!await implementationSpecReady(rootDir)) {
      missingParts.push(`- ${toPromptPath('AgentWorkSpace/handoffs/implementation-spec.md')}: complete the implementation spec with substantive planning content before deciding whether execution should be Simple or Complex.`);
    }
    const parallelOk = await loadWorkspaceArtifact(rootDir, 'AgentWorkSpace/handoffs/parallel-ok.md');
    if (!parallelOk.exists || !parallelOkDecisionRecorded(parallelOk)) {
      missingParts.push(`- ${toPromptPath('AgentWorkSpace/handoffs/parallel-ok.md')}: set the Decision section to exactly 'Simple' or 'Complex'. Default to 'Simple' unless fleet Dalton execution is truly required.`);
    }
    const slices = await listSliceFiles(options.implStepsDir);
    if (slices.length === 0) {
      missingParts.push(`- ${toPromptPath('AgentWorkSpace/ImplementationSteps/')}: create at least one substantive sliceN.md handoff file.`);
    } else {
      const finalSlice = slices.at(-1)!;
      const missingSections = await sliceMissingRequiredSections(finalSlice);
      if (missingSections.length > 0) {
        const semanticSections = missingSections.map((sectionKey) => describeSemanticSectionSpec(sectionKey));
        missingParts.push(`- ${toPromptPath(path.relative(rootDir, finalSlice))}: fill the required semantic sections still missing content: ${semanticSections.join(', ')}.`);
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

  const required = AGENT_REQUIRED_ARTIFACTS[agentId];
  if (!required) {
    return '';
  }

  const missingParts: string[] = [];
  for (const relativePath of required) {
    const artifact = await loadWorkspaceArtifact(rootDir, relativePath);
    if (!artifact.exists || !hasRealContent(artifact)) {
      missingParts.push(`- ${toPromptPath(relativePath)}: ${ARTIFACT_REMEDIATION_INSTRUCTIONS[relativePath] ?? `Fill in ${toPromptPath(relativePath)} with substantive content.`}`);
    }
  }
  if (agentId === 'qa' && !await qaIssuesStructured(rootDir)) {
    missingParts.push(`- ${toPromptPath('AgentWorkSpace/handoffs/issues.md')}: Your issues.md has findings but is missing required structured sections. Each finding must have: Finding, Severity, Finding Type, Required Fix, Remediation Owner Agent ID (software-engineer), Revalidation Agent ID (qa), Return-To Agent ID (qa). Fill in all sections.`);
  }
  if (agentId === 'qa') {
    const finalSummary = await loadWorkspaceArtifact(rootDir, 'AgentWorkSpace/handoffs/final-summary.md');
    if (finalSummary.exists) {
      const owner = normalizeAgentId(normalizeText(stripHtmlComments(finalSummary.sections['Closeout Owner Agent ID'] ?? [])));
      if (owner !== 'qa') {
        missingParts.push(`- ${toPromptPath('AgentWorkSpace/handoffs/final-summary.md')}: set Closeout Owner Agent ID to exactly 'qa'.`);
      }
      const difficultyLevel = finalSummaryDifficultyLevel(finalSummary);
      if (!ALLOWED_DIFFICULTY_LEVELS.has(difficultyLevel)) {
        missingParts.push(`- ${toPromptPath('AgentWorkSpace/handoffs/final-summary.md')}: set '- Difficulty Level:' in the Difficulty Assessment section to exactly 'Easy', 'Medium', or 'Hard'.`);
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
