import path from 'node:path';
import { readTextFile, writeTextFileAtomic } from '../core/index.js';
import { remediationHasBlockingFindings } from './pipeline/remediation.js';
import {
  renderHandoffArtifactLabel,
  renderImplementationStepsLabel,
} from '../queue/paths.js';
import {
  listSliceFiles as listWorkflowPolicySliceFiles,
  parseArtifactMetadata,
  parseSemanticSections,
  resolveSemanticSection,
} from '../workflow-policy/artifacts.js';
import {
  describeSliceArtifactFormat,
  listSliceArtifactFiles,
  listWrongFormatSliceFiles,
  MARKDOWN_SCOPE_INVENTORY_SECTION_SPECS,
  missingRequiredAttributeFields,
  missingRequiredSliceFields,
  normalizeParallelSliceReference,
  parseSliceArtifactContent,
  repairXmlSliceStructure,
  REPAIR_NO_STRUCTURAL_ISSUES_REASON,
  sliceIdFromFilename,
} from '../workflow-policy/sliceArtifacts.js';
import type { SliceArtifactFormat } from '../platform-config/types.js';
import { readTaskJsonSafe } from '../queue/taskJson.js';
import { extractBulletItems, normalizeAgentId, normalizeText } from '../workflow-policy/matching.js';
import { GENERATED_INTAKE_SPINE_RULE_IDS } from '../workflow-policy/rules/spec.js';
import {
  ALLOWED_DIFFICULTY_LEVELS,
  CONTENT_SECTION_EXCLUSIONS,
  ISSUES_MD_REQUIRED_FINDING_SECTIONS,
  ISSUES_MD_ROUTING_AGENT_SECTIONS,
  SPEC_REQUIRED_SECTION_SPECS,
  SLICE_REQUIRED_SECTION_SPECS,
} from '../workflow-policy/models.js';
import {
  parseRequirementVerificationStatus,
  sortedRequirementIds,
} from '../workflow-policy/requirementVerification.js';

const FINAL_SUMMARY_REQUIRED_CONTENT_SECTIONS = [
  'Completed Work',
  'Key Design Decisions',
  'Known Limitations',
];
const FINAL_SUMMARY_REQUIRED_STATUS_VALUES = new Set(['passed', 'failed', 'partially-passed', 'not-run']);
const FINAL_SUMMARY_QA_STATUS_VALUES = new Set(['passed', 'issues-found']);
const ALLOWED_PARALLEL_DECISIONS = new Set(['simple', 'complex']);
const SLICE_REQUIREMENT_TRACEABILITY_RULE_IDS = new Set([
  'slice.requirement-id-covered',
  'slice.validation-id-covered',
  'slice.requirement-id-known',
]);

const MULTILINE_HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const TEMPLATE_BOILERPLATE_RE = /^(?:[-*]\s*|```\w*|#\s.*)$/;
const PLACEHOLDER_ONLY_RE = /^(?:[-*]\s*)?(?:tbd|todo|tba|placeholder)\.?$/i;
const ARTIFACT_COMPLETION_REASON_CAP = 20;
const PARALLEL_OK_SLICE_ID_RE = /\b(?:slice[-_a-zA-Z0-9]*|[a-zA-Z0-9][\w.-]*\.(?:md|xml))\b/g;
const PRODUCT_MANAGER_SLICE_MISSING_SECTION_PREFIX = 'ImplementationSteps slice ';
const PRODUCT_MANAGER_SLICE_MISSING_SECTION_MARKER = ' missing required semantic section: ';
const PRODUCT_MANAGER_COMPLEX_INDEPENDENT_SLICES_MISSING_REASON =
  'parallel-ok.md Complex decision requires Independent Slices to list existing slice-N.md files';
const PRODUCT_MANAGER_COMPLEX_INDEPENDENT_SLICES_MISSING_REASON_XML =
  'parallel-ok.md Complex decision requires Independent Slices to list existing slice-N.xml files';
const PRODUCT_MANAGER_COMPLEX_MISSING_SLICE_PREFIX =
  'parallel-ok.md Complex Independent Slices references missing slice file: ';
// Prefixes intentionally start with "ImplementationSteps XML"/"ImplementationSteps wrong-format"
// (not "ImplementationSteps slice ") so they never collide with
// PRODUCT_MANAGER_SLICE_MISSING_SECTION_PREFIX in remediation-bullet prefix matching.
const PRODUCT_MANAGER_SLICE_XML_STRUCTURE_REJECTED_PREFIX =
  'ImplementationSteps XML structure rejected for ';
const PRODUCT_MANAGER_SLICE_XML_REQUIRED_ATTR_PREFIX =
  'ImplementationSteps XML required attribute missing for ';
const PRODUCT_MANAGER_WRONG_FORMAT_SLICES_PREFIX =
  'ImplementationSteps wrong-format slice files: ';

// QA artifact-completion reason strings. Centralized so the emitter
// (qaFinalSummaryCompletionReasons), the bullet mapper (qaRemediationBulletForReason),
// and the shape-instruction trigger list (buildAgentArtifactRemediationPrompt)
// stay in sync — a typo in any one silently disconnects a reason from its bullet.
const QA_REASON_FINAL_SUMMARY_MISSING = 'final-summary.md missing or empty';
const QA_REASON_CLOSEOUT_OWNER = 'final-summary.md Closeout Owner Agent ID must be qa';
const QA_REASON_TEST_RESULT_SUMMARY = 'final-summary.md Test Result Summary section is missing or empty';
const QA_REASON_TEST_STATUS = 'final-summary.md Test Status must be passed, failed, partially-passed, or not-run';
const QA_REASON_QA_STATUS = 'final-summary.md QA Status must be passed or issues-found';
const QA_REASON_TASK_BRANCHES = 'final-summary.md Task branches section is missing or empty';
const QA_REASON_DIFFICULTY_LEVEL = 'final-summary.md Difficulty Level must be Easy, Medium, or Hard';
const QA_REASON_REQ_VERIFICATION_MISSING = 'final-summary.md Requirement Verification missing or empty for generated requirements';
const QA_REASON_MISSING_SECTION_CONTENT_PREFIX = 'final-summary.md missing required section content: ';
const QA_REASON_REQ_VERIFICATION_INCOMPLETE_PREFIX = 'final-summary.md Requirement Verification incomplete: ';

export interface AgentArtifactCompletionDetails {
  complete: boolean;
  reasons: string[];
}

export interface AgentArtifactCompletionOptions {
  agentId: string;
  handoffsDir: string;
  implStepsDir: string;
  repoRoot: string;
  taskId?: string;
  abortSignal?: AbortSignal;
}

// Recovery prompts must use concrete absolute paths; provider env-var
// expansion is not guaranteed in the remediation channel.
function toRecoveryPromptPath(repoRoot: string, relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

/** Resolve the frozen slice artifact format for a task. Defaults to markdown. */
function resolveSliceFormat(taskId: string | undefined, repoRoot: string): SliceArtifactFormat {
  if (!taskId) return 'markdown';
  return readTaskJsonSafe(taskId, repoRoot)?.sliceArtifactFormat ?? 'markdown';
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
    [renderHandoffArtifactLabel(taskId, 'implementation-spec.md')]: 'Fill in implementation-spec.md: Goals and Non-Goals need substantive content, Source Inventory and Slice Partition must anchor slice derivation, Validation Strategy needs a code-fenced command block, and Files or Areas Likely to Change must list file paths.',
    [renderHandoffArtifactLabel(taskId, 'final-summary.md')]: 'Fill in final-summary.md: leave platform-populated Closeout Owner Agent ID unchanged, set Difficulty Level to Easy/Medium/Hard, and populate Completed Work, Key Design Decisions, and Known Limitations.',
    [renderHandoffArtifactLabel(taskId, 'retrospective-input.md')]: 'Fill in retrospective-input.md: always populate Retrospective Summary, Meeting Context, and Lily/Alice/Dalton/Ron contribution sections for the current task. If Retrospective Required is false, leave cycle-level sections empty. If true, populate cycle-level sections only when this launch is the retrospective phase.',
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
    const match = /^(?:[-*]\s*)?Difficulty Level\s*[:\-\u2013\u2014]\s*(.*)$/i.exec(line.trim());
    if (match) {
      return normalizeDifficultyLevel(match[1] ?? '');
    }
  }
  return '';
}

function normalizeDifficultyLevel(value: string): string {
  const match = /^(easy|medium|hard)\b/i.exec(value.trim());
  if (!match) return value.trim();
  const lowered = match[1]!.toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
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
  const sections = parseSemanticSections(text);
  return {
    exists: rawText !== undefined,
    sections,
    ...parseArtifactMetadata(sections),
    hasSubstantiveContent: Object.entries(sections).some(([sectionName, lines]) => (
      !CONTENT_SECTION_EXCLUSIONS.has(sectionName)
      && normalizeText(lines).length > 0
    )),
  };
}

function readHandoffArtifact(handoffsDir: string, basename: string): Promise<WorkspaceArtifact> {
  return loadWorkspaceArtifactAtPath(path.join(handoffsDir, basename));
}

export async function listSliceFiles(stepsDir: string): Promise<string[]> {
  return listWorkflowPolicySliceFiles(stepsDir);
}

function isProductManagerSliceFile(filePath: string, format: SliceArtifactFormat): boolean {
  return describeSliceArtifactFormat(format).filenamePattern.test(path.basename(filePath));
}

function productManagerSliceFiles(sliceFiles: readonly string[], format: SliceArtifactFormat): string[] {
  return sliceFiles.filter((f) => isProductManagerSliceFile(f, format));
}

function invalidProductManagerSliceBasenames(sliceFiles: readonly string[], format: SliceArtifactFormat): string[] {
  return sliceFiles
    .filter((filePath) => !isProductManagerSliceFile(filePath, format))
    .map((filePath) => path.basename(filePath));
}

function parallelOkHasActiveApproval(artifact: WorkspaceArtifact): boolean {
  const decisionText = parallelOkDecisionValue(artifact);
  if (!decisionText) {
    return false;
  }
  return decisionText.includes('complex') && !decisionText.includes('simple');
}

function parallelOkDecisionValue(artifact: WorkspaceArtifact): string {
  return normalizeText(artifact.sections.Decision ?? []).toLowerCase();
}

function parallelOkDecisionKind(artifact: WorkspaceArtifact): 'simple' | 'complex' | null {
  const decision = parallelOkDecisionValue(artifact);
  return ALLOWED_PARALLEL_DECISIONS.has(decision) ? decision as 'simple' | 'complex' : null;
}

function stripBoilerplate(lines: string[]): string[] {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return !TEMPLATE_BOILERPLATE_RE.test(trimmed) && !PLACEHOLDER_ONLY_RE.test(trimmed);
  });
}

function describeSemanticSectionSpec(
  sectionKey: string,
  sectionSpecs = SLICE_REQUIRED_SECTION_SPECS,
): string {
  const sectionSpec = sectionSpecs.find((candidate) => candidate.key === sectionKey);
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

async function sliceMissingRequiredSections(slicePath: string, format: SliceArtifactFormat): Promise<string[]> {
  const text = (await readTextFile(slicePath)) ?? '';
  if (format === 'xml') {
    const content = parseSliceArtifactContent({ filePath: slicePath, text, format: 'xml' });
    return missingRequiredSliceFields(content);
  }
  const sections = parseSemanticSections(text);
  return [...SLICE_REQUIRED_SECTION_SPECS, ...MARKDOWN_SCOPE_INVENTORY_SECTION_SPECS].filter((sectionSpec) => (
    normalizeText(stripBoilerplate(resolveSemanticSection(sections, sectionSpec).content)).length === 0
  )).map((sectionSpec) => sectionSpec.key);
}

// Auto-heal unambiguous XML slice structural issues (missing XML declaration, id
// attribute, or closing tag) in place before completion validation. Returns the
// rejection reason when the slice is structurally non-repairable (no executionSlice
// root, duplicate required fields, or a markdown body), or null when the slice was
// healed or is already well-formed. Markdown is never touched.
async function repairXmlSliceStructureInPlace(
  slicePath: string,
  format: SliceArtifactFormat,
): Promise<string | null> {
  if (format !== 'xml') return null;
  const text = (await readTextFile(slicePath)) ?? '';
  if (!text) return null;
  const result = repairXmlSliceStructure({
    filePath: slicePath,
    text,
    expectedSliceId: sliceIdFromFilename(slicePath, format),
  });
  if (result.repaired && result.text !== text) {
    await writeTextFileAtomic(slicePath, result.text);
    return null;
  }
  // Surface only genuine non-repairable structural failures; an already-well-formed
  // slice reports the benign REPAIR_NO_STRUCTURAL_ISSUES_REASON, which is not a failure.
  if (!result.repaired && result.reason && result.reason !== REPAIR_NO_STRUCTURAL_ISSUES_REASON) {
    return result.reason;
  }
  return null;
}

function implementationSpecMissingRequiredSections(spec: WorkspaceArtifact): string[] {
  return SPEC_REQUIRED_SECTION_SPECS.filter((sectionSpec) => (
    normalizeText(stripBoilerplate(resolveSemanticSection(spec.sections, sectionSpec).content)).length === 0
  )).map((sectionSpec) => sectionSpec.key);
}

function parallelOkIndependentSliceIds(artifact: WorkspaceArtifact, format: SliceArtifactFormat): string[] {
  const lines = stripBoilerplate(artifact.sections['Independent Slices'] ?? []);
  const normalizeRef = (s: string): string => s.replace(/\.(md|xml)$/i, '');
  // When raw bullets exist, normalize them format-aware (XML mode rejects a
  // slice-N.md reference to ''); do not fall back to the free-text regex, which
  // would strip the extension and silently re-accept the wrong-format reference.
  const rawBullets = extractBulletItems(lines);
  if (rawBullets.length > 0) {
    return [...new Set(
      rawBullets
        .map((item) => normalizeParallelSliceReference(
          item.trim().split(/\s/)[0]?.replace(/^`|`$/g, '') ?? '',
          format,
        ))
        .filter(Boolean),
    )];
  }
  const ids = (normalizeText(lines).match(PARALLEL_OK_SLICE_ID_RE) ?? []).map(normalizeRef);
  return [...new Set(ids)];
}

function issuesSectionsHaveFindings(sections: Record<string, string[]>): boolean {
  return Object.entries(sections).some(([sectionName, lines]) => {
    if (ISSUES_NON_FINDING_SECTIONS.has(sectionName)) {
      return false;
    }
    return normalizeText(lines).length > 0;
  });
}

function issuesHaveBlockingFindings(sections: Record<string, string[]>): boolean {
  const severityText = normalizeText(sections.Severity ?? []).toLowerCase();
  return severityText.includes('blocking');
}

function generatedRequirementIdsFromSpec(spec: WorkspaceArtifact): string[] {
  const intakeRequirements = spec.sections['Intake Requirements'];
  if (!intakeRequirements) {
    return [];
  }
  return sortedRequirementIds(intakeRequirements.join('\n'));
}

async function generatedRequirementIds(handoffsDir: string): Promise<string[]> {
  const spec = await readHandoffArtifact(handoffsDir, 'implementation-spec.md');
  if (!spec.exists || !spec.hasSubstantiveContent) {
    return [];
  }
  return generatedRequirementIdsFromSpec(spec);
}

function issuesReviewOutcome(sections: Record<string, string[]>): string {
  const normalized = normalizeText(sections['Review Outcome'] ?? []).trim().toLowerCase();
  return /^(pass|advisory|blocking)\b/.exec(normalized)?.[1] ?? normalized;
}

function qaIssuesStructuredReason(issues: WorkspaceArtifact): string | null {
  if (!issues.exists || !issuesSectionsHaveFindings(issues.sections)) {
    return null;
  }
  for (const sectionName of ['Finding', ...ISSUES_MD_REQUIRED_FINDING_SECTIONS]) {
    if (!normalizeText(issues.sections[sectionName] ?? [])) {
      return 'issues.md findings are missing required structured sections';
    }
  }
  if (issuesHaveBlockingFindings(issues.sections)) {
    for (const sectionName of ISSUES_MD_ROUTING_AGENT_SECTIONS) {
      if (!normalizeText(issues.sections[sectionName] ?? [])) {
        return 'issues.md findings are missing required structured sections';
      }
    }
  }
  return null;
}

function requirementVerificationReasons(finalSummary: WorkspaceArtifact, ids: readonly string[]): string[] {
  if (ids.length === 0) {
    return [];
  }
  const lines = finalSummary.sections['Requirement Verification'];
  if (!lines || !normalizeText(lines)) {
    return [QA_REASON_REQ_VERIFICATION_MISSING];
  }
  return ids.flatMap((id) => {
    const status = parseRequirementVerificationStatus(lines, id);
    if (status === 'verified' || status === 'advisory') {
      return [];
    }
    return [`${QA_REASON_REQ_VERIFICATION_INCOMPLETE_PREFIX}${id} ${status ?? 'missing'}`];
  });
}

function sectionValue(artifact: WorkspaceArtifact, sectionName: string): string {
  return normalizeText(artifact.sections[sectionName] ?? []).trim();
}

function normalizedSectionValue(artifact: WorkspaceArtifact, sectionName: string): string {
  return sectionValue(artifact, sectionName).toLowerCase();
}

function qaFinalSummaryCompletionReasons(args: {
  finalSummary: WorkspaceArtifact;
  generatedRequirementIds: readonly string[];
}): string[] {
  const { finalSummary, generatedRequirementIds } = args;
  const reasons: string[] = [];
  if (!finalSummary.exists || !hasRealContent(finalSummary)) {
    reasons.push(QA_REASON_FINAL_SUMMARY_MISSING);
  }

  const owner = normalizeAgentId(sectionValue(finalSummary, 'Closeout Owner Agent ID'));
  if (owner !== 'qa') {
    reasons.push(QA_REASON_CLOSEOUT_OWNER);
  }
  for (const sectionName of FINAL_SUMMARY_REQUIRED_CONTENT_SECTIONS) {
    if (!sectionValue(finalSummary, sectionName)) {
      reasons.push(`${QA_REASON_MISSING_SECTION_CONTENT_PREFIX}${sectionName}`);
    }
  }
  if (!sectionValue(finalSummary, 'Test Result Summary')) {
    reasons.push(QA_REASON_TEST_RESULT_SUMMARY);
  }
  reasons.push(...requirementVerificationReasons(finalSummary, generatedRequirementIds));
  const testStatus = normalizedSectionValue(finalSummary, 'Test Status');
  if (!FINAL_SUMMARY_REQUIRED_STATUS_VALUES.has(testStatus)) {
    reasons.push(QA_REASON_TEST_STATUS);
  }
  const qaStatus = normalizedSectionValue(finalSummary, 'QA Status');
  if (!FINAL_SUMMARY_QA_STATUS_VALUES.has(qaStatus)) {
    reasons.push(QA_REASON_QA_STATUS);
  }
  if (!sectionValue(finalSummary, 'Task branches')) {
    reasons.push(QA_REASON_TASK_BRANCHES);
  }
  const difficultyLevel = finalSummaryDifficultyLevel(finalSummary);
  if (!ALLOWED_DIFFICULTY_LEVELS.has(difficultyLevel)) {
    reasons.push(QA_REASON_DIFFICULTY_LEVEL);
  }
  return reasons;
}

async function productManagerArtifactCompletionDetails(
  options: AgentArtifactCompletionOptions,
  slices: readonly string[],
  format: SliceArtifactFormat,
): Promise<AgentArtifactCompletionDetails> {
  const reasons: string[] = [];
  const spec = await readHandoffArtifact(options.handoffsDir, 'implementation-spec.md');
  if (!spec.exists || !spec.hasSubstantiveContent) {
    reasons.push('implementation-spec.md missing or empty');
  } else {
    for (const sectionKey of implementationSpecMissingRequiredSections(spec)) {
      reasons.push(`implementation-spec.md missing required semantic section: ${describeSemanticSectionSpec(sectionKey, SPEC_REQUIRED_SECTION_SPECS)}`);
    }
  }
  const parallelOk = await readHandoffArtifact(options.handoffsDir, 'parallel-ok.md');
  const parallelOkDecision = parallelOk.exists ? parallelOkDecisionKind(parallelOk) : null;
  if (!parallelOk.exists || !parallelOkDecision) {
    reasons.push('parallel-ok.md missing or Decision is not Simple or Complex');
  }
  const invalidSlices = invalidProductManagerSliceBasenames(slices, format);
  if (invalidSlices.length > 0) {
    reasons.push(`ImplementationSteps invalid slice filenames: ${invalidSlices.join(', ')}`);
  }
  // Wrong-format active slice files (slice-N.md in XML mode, slice-N.xml in markdown
  // mode) are invalid even when a valid-format slice also exists; reject them at the
  // completion gate rather than deferring to archive filing.
  const wrongFormatSlices = await listWrongFormatSliceFiles(options.implStepsDir, format);
  if (wrongFormatSlices.length > 0) {
    reasons.push(`${PRODUCT_MANAGER_WRONG_FORMAT_SLICES_PREFIX}${wrongFormatSlices.map((f) => path.basename(f)).join(', ')}`);
  }
  const canonicalSlices = productManagerSliceFiles(slices, format);
  if (canonicalSlices.length === 0) {
    reasons.push('ImplementationSteps missing slice files');
  } else {
    for (const slicePath of canonicalSlices) {
      const sliceBasename = path.basename(slicePath);
      const xmlStructureRejection = await repairXmlSliceStructureInPlace(slicePath, format);
      if (xmlStructureRejection !== null) {
        reasons.push(`${PRODUCT_MANAGER_SLICE_XML_STRUCTURE_REJECTED_PREFIX}${sliceBasename}: ${xmlStructureRejection}`);
        continue;
      }
      for (const sectionKey of await sliceMissingRequiredSections(slicePath, format)) {
        reasons.push(`${PRODUCT_MANAGER_SLICE_MISSING_SECTION_PREFIX}${sliceBasename}${PRODUCT_MANAGER_SLICE_MISSING_SECTION_MARKER}${describeSemanticSectionSpec(sectionKey, [...SLICE_REQUIRED_SECTION_SPECS, ...MARKDOWN_SCOPE_INVENTORY_SECTION_SPECS])}`);
      }
      if (format === 'xml') {
        const sliceText = (await readTextFile(slicePath)) ?? '';
        for (const fieldPath of missingRequiredAttributeFields(sliceText)) {
          reasons.push(`${PRODUCT_MANAGER_SLICE_XML_REQUIRED_ATTR_PREFIX}${sliceBasename}: ${fieldPath}`);
        }
      }
    }
    if (parallelOkDecision === 'complex') {
      const existingSliceIds = new Set(canonicalSlices.map((slicePath) => sliceIdFromFilename(slicePath, format)));
      const listedSliceIds = parallelOkIndependentSliceIds(parallelOk, format);
      const ext = describeSliceArtifactFormat(format).extension;
      const independentSlicesMissingReason = format === 'xml'
        ? PRODUCT_MANAGER_COMPLEX_INDEPENDENT_SLICES_MISSING_REASON_XML
        : PRODUCT_MANAGER_COMPLEX_INDEPENDENT_SLICES_MISSING_REASON;
      if (listedSliceIds.length === 0) {
        reasons.push(independentSlicesMissingReason);
      }
      for (const sliceId of listedSliceIds) {
        if (!existingSliceIds.has(sliceId)) {
          reasons.push(`${PRODUCT_MANAGER_COMPLEX_MISSING_SLICE_PREFIX}${sliceId}${ext}`);
        }
      }
    }
  }
  return { complete: reasons.length === 0, reasons };
}

async function qaArtifactCompletionDetails(options: AgentArtifactCompletionOptions): Promise<AgentArtifactCompletionDetails> {
  const reasons: string[] = [];
  const issues = await readHandoffArtifact(options.handoffsDir, 'issues.md');
  if (!issues.exists || !hasRealContent(issues)) {
    reasons.push('issues.md missing or empty');
  } else {
    const structuredReason = qaIssuesStructuredReason(issues);
    if (structuredReason) {
      reasons.push(structuredReason);
    }
    const reviewOutcome = issuesReviewOutcome(issues.sections);
    if (reviewOutcome !== 'pass' && reviewOutcome !== 'advisory' && reviewOutcome !== 'blocking') {
      reasons.push('issues.md Review Outcome must be pass, advisory, or blocking');
    }
    if (await remediationHasBlockingFindings(options.handoffsDir)) {
      return { complete: reasons.length === 0, reasons };
    }
  }

  const requirementIds = await generatedRequirementIds(options.handoffsDir);
  const finalSummary = await readHandoffArtifact(options.handoffsDir, 'final-summary.md');
  reasons.push(...qaFinalSummaryCompletionReasons({ finalSummary, generatedRequirementIds: requirementIds }));
  const retro = await readHandoffArtifact(options.handoffsDir, 'retrospective-input.md');
  if (!retro.exists || !hasRealContent(retro)) {
    reasons.push('retrospective-input.md missing or empty');
  }
  return { complete: reasons.length === 0, reasons };
}

export function boundedArtifactCompletionReasons(reasons: readonly string[]): string[] {
  if (reasons.length <= ARTIFACT_COMPLETION_REASON_CAP) return [...reasons];
  const kept = reasons.slice(0, ARTIFACT_COMPLETION_REASON_CAP - 1);
  kept.push(`additional artifact completion reasons omitted: ${reasons.length - kept.length}`);
  return kept;
}

export function formatIncompleteArtifactReasons(reasons: readonly string[]): string {
  const bounded = boundedArtifactCompletionReasons(reasons);
  return bounded.length === 0
    ? ''
    : ['Incomplete artifact reasons:', ...bounded.map((reason) => `- ${reason}`)].join('\n');
}

export async function detectParallelOk(handoffsDir: string): Promise<boolean> {
  const artifact = await loadWorkspaceArtifactAtPath(path.join(handoffsDir, 'parallel-ok.md'));
  return artifact.exists && parallelOkHasActiveApproval(artifact);
}

export async function checkAgentArtifactCompletionDetails(
  options: AgentArtifactCompletionOptions,
): Promise<AgentArtifactCompletionDetails> {
  const agentId = normalizeAgentId(options.agentId);
  const rootDir = options.repoRoot;

  if (agentId === 'planning-agent') {
    const stagingDir = options.taskId
      ? path.join(rootDir, 'AgentWorkSpace', 'tasks', options.taskId, 'dropbox-staging')
      : path.join(rootDir, 'AgentWorkSpace', 'dropbox', '.staging');
    const intakeFiles = (await listSliceFiles(stagingDir)).filter((filePath) => filePath.endsWith('.md'));
    if (intakeFiles.length === 0) {
      return { complete: false, reasons: [] };
    }
    for (const filePath of intakeFiles) {
      if (hasRealContent(await loadWorkspaceArtifactAtPath(filePath))) {
        return { complete: true, reasons: [] };
      }
    }
    return { complete: false, reasons: [] };
  }

  if (agentId === 'product-manager') {
    const format = resolveSliceFormat(options.taskId, options.repoRoot);
    // For markdown: use listSliceFiles (all .md non-template) so invalid names are detected.
    // For XML: use listSliceArtifactFiles (pattern-matched); XML invalid-name detection is a
    //          wrong-format check rather than a naming check.
    const slices = format === 'xml'
      ? await listSliceArtifactFiles(options.implStepsDir, format)
      : await listSliceFiles(options.implStepsDir);
    return productManagerArtifactCompletionDetails(options, slices, format);
  }

  const required = AGENT_REQUIRED_ARTIFACTS_FOR(options.taskId ?? '')[agentId];
  if (!required) {
    return { complete: true, reasons: [] };
  }

  // For QA, check if issues.md has a blocking outcome first. When blocking,
  // only issues.md is required — final-summary.md and retrospective-input.md
  // must NOT be written (the remediation loop handles next steps).
  if (agentId === 'qa') {
    return qaArtifactCompletionDetails(options);
  }

  const loaded = new Map<string, WorkspaceArtifact>();
  for (const relativePath of required) {
    const basename = path.basename(relativePath);
    const artifact = await readHandoffArtifact(options.handoffsDir, basename);
    loaded.set(relativePath, artifact);
    if (!artifact.exists || !hasRealContent(artifact)) {
      return { complete: false, reasons: [] };
    }
  }

  return { complete: true, reasons: [] };
}

export async function checkAgentArtifactCompletion(options: AgentArtifactCompletionOptions): Promise<boolean> {
  return (await checkAgentArtifactCompletionDetails(options)).complete;
}

function productManagerRemediationBulletForReason(
  reason: string,
  options: AgentArtifactCompletionOptions,
  format: SliceArtifactFormat = 'markdown',
): string {
  const taskId = options.taskId ?? '';
  const sliceDesc = describeSliceArtifactFormat(format);
  const sliceTemplatePath = toRecoveryPromptPath(
    options.repoRoot,
    path.join('AgentWorkSpace', 'templates', sliceDesc.templateFilename),
  );
  if (reason === 'implementation-spec.md missing or empty') {
    return `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))}: complete the implementation spec with substantive planning content before deciding whether execution should be Simple or Complex.`;
  }
  const specSectionPrefix = 'implementation-spec.md missing required semantic section: ';
  if (reason.startsWith(specSectionPrefix)) {
    const missingSection = reason.slice(specSectionPrefix.length);
    return `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))}: fill the required implementation-spec semantic section still missing content: ${missingSection}. Preserve the seeded template heading structure and do not edit the generated ## Intake Requirements section.`;
  }
  if (reason === 'parallel-ok.md missing or Decision is not Simple or Complex') {
    return `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'parallel-ok.md'))}: set the Decision section to exactly 'Simple' or 'Complex'. Default to 'Simple' unless fleet Dalton execution is truly required.`;
  }
  const sliceN = sliceDesc.displayGlob.replace('*', '<number>');
  if (reason === 'ImplementationSteps missing slice files') {
    if (format === 'xml') {
      return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: create the required ${sliceN} file or files by copying ${sliceTemplatePath} exactly, preserving the executionSlice XML structure, setting the executionSlice id attribute and the metadata/sliceId element text to slice-N, and populating required elements without inventing replacement sections.`;
    }
    return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: create the required ${sliceN} file or files by copying ${sliceTemplatePath} exactly, preserving every seeded ## and ### heading, then populate content only under the existing headings.`;
  }
  const invalidSlicePrefix = 'ImplementationSteps invalid slice filenames: ';
  if (reason.startsWith(invalidSlicePrefix)) {
    const invalidNames = reason.slice(invalidSlicePrefix.length);
    if (format === 'xml') {
      return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: replace invalid slice file name(s) (${invalidNames}) with sequential ${sliceN} file names. Move any useful content into valid slice files copied from ${sliceTemplatePath}, preserve the executionSlice XML structure, and do not keep invalid slice files as active slices.`;
    }
    return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: replace invalid slice file name(s) (${invalidNames}) with sequential ${sliceN} file names. Move any useful content into valid slice files copied from ${sliceTemplatePath}, preserve every seeded ## and ### heading, and do not keep invalid slice files as active slices.`;
  }
  if (reason.startsWith(PRODUCT_MANAGER_WRONG_FORMAT_SLICES_PREFIX)) {
    const wrongNames = reason.slice(PRODUCT_MANAGER_WRONG_FORMAT_SLICES_PREFIX.length);
    const wrongExt = format === 'xml' ? '.md' : '.xml';
    return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: remove wrong-format slice file(s) (${wrongNames}); ${sliceDesc.extension} is the active slice format for this task. Move any needed content into ${sliceDesc.displayGlob.replace('*', 'N')} files copied from ${sliceTemplatePath}, then delete the ${wrongExt} files.`;
  }
  if (reason.startsWith(PRODUCT_MANAGER_SLICE_XML_STRUCTURE_REJECTED_PREFIX)) {
    const detail = reason.slice(PRODUCT_MANAGER_SLICE_XML_STRUCTURE_REJECTED_PREFIX.length);
    return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: rebuild the malformed XML slice against ${sliceTemplatePath} (${detail}). Preserve the executionSlice XML structure: keep the XML declaration, a single executionSlice root with its id attribute, exactly one occurrence of each required element, and no markdown headings.`;
  }
  if (reason.startsWith(PRODUCT_MANAGER_SLICE_XML_REQUIRED_ATTR_PREFIX)) {
    const detail = reason.slice(PRODUCT_MANAGER_SLICE_XML_REQUIRED_ATTR_PREFIX.length);
    return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: restore the required="true" attribute on the XML element noted (${detail}) by copying ${sliceTemplatePath} as the shape authority; do not strip the template's required="true" markers.`;
  }
  if (reason.startsWith(PRODUCT_MANAGER_SLICE_MISSING_SECTION_PREFIX)) {
    const rest = reason.slice(PRODUCT_MANAGER_SLICE_MISSING_SECTION_PREFIX.length);
    const markerIndex = rest.indexOf(PRODUCT_MANAGER_SLICE_MISSING_SECTION_MARKER);
    const sliceBasename = markerIndex === -1 ? '' : rest.slice(0, markerIndex);
    const missingSection = markerIndex === -1 ? rest : rest.slice(markerIndex + PRODUCT_MANAGER_SLICE_MISSING_SECTION_MARKER.length);
    const slicePath = toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, sliceBasename));
    if (format === 'xml') {
      return `- ${slicePath}: populate the required XML element still missing content: ${missingSection}. Copy ${sliceTemplatePath} as the shape authority; preserve the executionSlice XML structure and do not invent replacement elements.`;
    }
    const headingInstruction = missingSection.includes('Guards and Coordination')
      ? ' Restore the seeded template heading structure: use top-level ## Guards and Coordination with nested ### Guards, then populate that existing section.'
      : ' Restore the seeded slice template heading structure before filling this section; do not add a custom heading under a different container.';
    return `- ${slicePath}: rebuild this malformed slice against ${sliceTemplatePath}; preserve every seeded ## and ### heading, move useful existing content under the matching seeded headings, remove custom replacement headings such as ## Steps, ## Validation, or ## Notes, then fill the required slice semantic section still missing content: ${missingSection}.${headingInstruction}`;
  }
  if (reason === PRODUCT_MANAGER_COMPLEX_INDEPENDENT_SLICES_MISSING_REASON
      || reason === PRODUCT_MANAGER_COMPLEX_INDEPENDENT_SLICES_MISSING_REASON_XML) {
    return `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'parallel-ok.md'))}: Decision is Complex, so add bullets under Independent Slices naming existing ${sliceDesc.displayGlob} files from ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}.`;
  }
  if (reason.startsWith(PRODUCT_MANAGER_COMPLEX_MISSING_SLICE_PREFIX)) {
    const missingSlice = reason.slice(PRODUCT_MANAGER_COMPLEX_MISSING_SLICE_PREFIX.length);
    return `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'parallel-ok.md'))}: Independent Slices names ${missingSlice}, but that file does not exist. Add the missing slice file under ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))} or remove the stale reference.`;
  }
  return `- ${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: resolve artifact completion issue: ${reason}.`;
}

function qaRemediationBulletForReason(reason: string, options: AgentArtifactCompletionOptions): string {
  const taskId = options.taskId ?? '';
  const issuesPath = toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'issues.md'));
  const finalSummaryPath = toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'));
  const retroPath = toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'retrospective-input.md'));
  if (reason === 'issues.md missing or empty') {
    return `- ${issuesPath}: ${remediationInstructionsFor(taskId)[renderHandoffArtifactLabel(taskId, 'issues.md')]}`;
  }
  if (reason === 'issues.md findings are missing required structured sections') {
    return `- ${issuesPath}: Your issues.md has findings but is missing required structured sections. Each finding must have: Finding, Severity, Finding Type, Required Fix, Remediation Owner Agent ID (software-engineer), Revalidation Agent ID (qa), Return-To Agent ID (qa). Fill in all sections.`;
  }
  if (reason === 'issues.md Review Outcome must be pass, advisory, or blocking') {
    return `- ${issuesPath}: preserve every top-level ## heading from the seeded template; set Review Outcome to exactly 'pass', 'advisory', or 'blocking' under the top-level Review Outcome section.`;
  }
  if (reason === QA_REASON_FINAL_SUMMARY_MISSING) {
    return `- ${finalSummaryPath}: complete final-summary.md for non-blocking QA closeout. Leave platform-owned ## Closeout Owner Agent ID unchanged. Fill these top-level sections in one pass: ## Completed Work, ## Key Design Decisions, ## Known Limitations, ## Test Result Summary, ## Requirement Verification, ## Test Status, ## QA Status, ## Task branches, and ## Difficulty Assessment.`;
  }
  if (reason === 'retrospective-input.md missing or empty') {
    return `- ${retroPath}: ${remediationInstructionsFor(taskId)[renderHandoffArtifactLabel(taskId, 'retrospective-input.md')]}`;
  }
  if (reason === QA_REASON_CLOSEOUT_OWNER) {
    return `- ${finalSummaryPath}: restore the seeded final-summary.md shape and leave the platform-owned ## Closeout Owner Agent ID section unchanged.`;
  }
  if (reason.startsWith(QA_REASON_MISSING_SECTION_CONTENT_PREFIX)) {
    return `- ${finalSummaryPath}: populate the ${reason.slice(QA_REASON_MISSING_SECTION_CONTENT_PREFIX.length)} section with substantive content.`;
  }
  if (reason === QA_REASON_TASK_BRANCHES) {
    return `- ${finalSummaryPath}: add a '## Task branches' section. Copy the value of the TASKSAIL_TASK_BRANCHES environment variable (a JSON array of { repoId, role, branch, worktreeRoot } objects) into this section. If TASKSAIL_TASK_BRANCHES is absent or empty, read the file path from TASKSAIL_TASK_BRANCHES_FILE instead and copy its contents. Do NOT run any git commands to discover branch names — use only the env var or file.`;
  }
  if (
    reason === QA_REASON_REQ_VERIFICATION_MISSING
    || reason.startsWith(QA_REASON_REQ_VERIFICATION_INCOMPLETE_PREFIX)
  ) {
    return `- ${finalSummaryPath}: populate ## Requirement Verification. The platform pre-populated this section with pending generated CR-*, COMP-*, and VAL-* IDs; replace each pending with verified or advisory and add a short evidence note. Do not delete IDs.`;
  }
  if (reason === QA_REASON_DIFFICULTY_LEVEL) {
    return `- ${finalSummaryPath}: set '- Difficulty Level:' in the Difficulty Assessment section to exactly 'Easy', 'Medium', or 'Hard'.`;
  }
  if (reason === QA_REASON_TEST_RESULT_SUMMARY) {
    return `- ${finalSummaryPath}: populate ## Test Result Summary with a concise outcome summary grounded in completed implementation and validation.`;
  }
  if (reason === QA_REASON_TEST_STATUS) {
    return `- ${finalSummaryPath}: set ## Test Status to exactly one of passed, failed, partially-passed, or not-run. Put any prose in ## Test Result Summary instead.`;
  }
  if (reason === QA_REASON_QA_STATUS) {
    return `- ${finalSummaryPath}: set ## QA Status to exactly passed or issues-found. Use issues-found when any advisory or blocking finding is recorded in issues.md.`;
  }
  return `- ${finalSummaryPath}: resolve artifact completion issue: ${reason}.`;
}

function dedupeBullets(bullets: readonly string[]): string[] {
  return [...new Set(bullets)];
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
    const format = resolveSliceFormat(options.taskId, options.repoRoot);
    const slices = format === 'xml'
      ? await listSliceArtifactFiles(options.implStepsDir, format)
      : await listSliceFiles(options.implStepsDir);
    const details = await productManagerArtifactCompletionDetails(options, slices, format);
    const missingParts = details.reasons.map((reason) => productManagerRemediationBulletForReason(reason, options, format));
    if (options.policyViolationRuleIds?.some((ruleId) => GENERATED_INTAKE_SPINE_RULE_IDS.has(ruleId))) {
      missingParts.push(
        `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))}: ` +
        'restore the generated ## Intake Requirements section from intake.md. ' +
        'Do not reinterpret, summarize, reorder, or weaken the copied Critical Requirements, Compatibility Requirements, or Required Validation content. ' +
        'Leave authored planning sections otherwise unchanged unless needed to keep markdown structure valid. ' +
        `Use ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'intake.md'))} as the source.`,
      );
    }
    if (options.policyViolationRuleIds?.some((ruleId) => SLICE_REQUIREMENT_TRACEABILITY_RULE_IDS.has(ruleId))) {
      if (format === 'xml') {
        missingParts.push(
          `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))} and ` +
          `${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: ` +
          'account for every generated CR-*, COMP-*, and VAL-* ID by exact ID from ## Intake Requirements. ' +
          'Put global or cross-cutting IDs in executionScope/requirementCoverage or the implementation-spec Requirement Handling section, put slice-owned IDs in the relevant slice content including executionScope/requirementCoverage, ' +
          'put every VAL-* in a validation surface (acceptanceAndValidation/validationCommands or acceptanceCriteria), and remove or correct any unknown requirement ID. ' +
          'Do not paste every ID into every slice.',
        );
      } else {
        missingParts.push(
          `- ${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'implementation-spec.md'))} and ` +
          `${toRecoveryPromptPath(options.repoRoot, renderImplementationStepsLabel(taskId, ''))}: ` +
          'account for every generated CR-*, COMP-*, and VAL-* ID by exact ID from ## Intake Requirements. ' +
          'Put global or cross-cutting IDs in ### Requirement Handling, put slice-owned IDs in the relevant slice content including ### Requirement Coverage, ' +
          'put every VAL-* in a validation surface, and remove or correct any unknown requirement ID. ' +
          'Do not paste every ID into every slice.',
        );
      }
    }
    if (missingParts.length === 0) {
      return '';
    }
    const sliceDesc = describeSliceArtifactFormat(format);
    const sliceShapeInstruction = format === 'xml'
      ? `If repairing slices, use AgentWorkSpace/templates/${sliceDesc.templateFilename} as the shape authority. Every ${sliceDesc.displayGlob.replace('*', 'N')} must preserve the executionSlice XML structure, set the executionSlice id attribute and the metadata/sliceId element text to slice-N, and populate required elements without inventing replacement sections.`
      : `If repairing slices, use AgentWorkSpace/templates/${sliceDesc.templateFilename} as the shape authority. Every ${sliceDesc.displayGlob.replace('*', 'N')} must preserve every seeded ## and ### heading and place content only under those headings.`;
    return [
      'You exited without completing all required artifacts. The following artifacts are still incomplete:',
      'Product-manager artifact repair protocol: read .github/copilot/instructions/product-manager.instructions.md, edit only the listed workflow artifacts, preserve seeded template headings exactly, and do not answer with a prose-only status update.',
      sliceShapeInstruction,
      'If inspecting source during repair, use task worktree roots from TASKSAIL_TASK_WORKTREES or TASKSAIL_TASK_WORKTREES_FILE. Do not inspect contextpacks/... paths as source code.',
      ...dedupeBullets(missingParts),
      'Do not do any other work. Only fill in the missing artifacts above.',
    ].join('\n');
  }

  const taskId = options.taskId ?? '';
  const required = AGENT_REQUIRED_ARTIFACTS_FOR(taskId)[agentId];
  if (!required) {
    return '';
  }

  let missingParts: string[] = [];
  if (agentId === 'qa') {
    const details = await checkAgentArtifactCompletionDetails(options);
    missingParts = details.reasons.map((reason) => qaRemediationBulletForReason(reason, options));
    const shapeInstruction = `${toRecoveryPromptPath(options.repoRoot, renderHandoffArtifactLabel(taskId, 'final-summary.md'))}: preserve every top-level ## heading from the seeded template; populate content only under the seeded section bodies. Do not move Review Outcome or Task branches into Task Metadata or a custom summary. Leave platform-owned Closeout Owner Agent ID unchanged.`;
    const pushShapeInstruction = (): void => {
      missingParts.push(`- ${shapeInstruction}`);
    };
    if (details.reasons.some((reason) => (
      reason === 'issues.md Review Outcome must be pass, advisory, or blocking'
      || reason === QA_REASON_FINAL_SUMMARY_MISSING
      || reason === QA_REASON_CLOSEOUT_OWNER
      || reason === QA_REASON_TEST_RESULT_SUMMARY
      || reason === QA_REASON_TEST_STATUS
      || reason === QA_REASON_QA_STATUS
      || reason === QA_REASON_TASK_BRANCHES
    ))) {
      pushShapeInstruction();
    }
  }
  if (missingParts.length === 0) {
    return '';
  }
  return [
    'You exited without completing all required artifacts. The following artifacts are still incomplete:',
    'Artifact repair protocol: do not answer with a prose-only verdict; edit only the listed artifact files, preserve their seeded top-level ## headings, satisfy every bullet below, then re-open the edited files before exit to verify the listed reasons are gone.',
    'Required QA write order during repair: issues.md first; if Review Outcome is blocking, stop after structured findings; if Review Outcome is pass or advisory, complete retrospective-input.md next and final-summary.md last.',
    ...dedupeBullets(missingParts),
    'The task is not complete until every listed section is populated or the QA Review Outcome is blocking with structured findings.',
    'Do not do any other work. Only fill in the missing artifacts above.',
  ].join('\n');
}
