/**
 * QA execution validation rules for Ron's review output quality.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_qa_execution.py
 */

import {
  ALLOWED_FINDING_TYPES,
  ALLOWED_ISSUE_SEVERITIES,
  ISSUES_MD_RELATIVE_PATH,
  ISSUES_MD_REQUIRED_FINDING_SECTIONS,
  ISSUES_MD_ROUTING_AGENT_SECTIONS,
  REMEDIATION_BLOCKING_LOCATION_PATTERN,
} from '../models.js';
import {
  agentIdExists,
  issuesSectionsHaveFindings,
  normalizeText,
} from '../matching.js';
import { listSliceArtifactFiles } from '../sliceArtifacts.js';
import { renderHandoffArtifactLabel } from '../../queue/paths.js';
import type { WorkspaceArtifact } from '../types.js';
import type { PolicyValidator } from '../validator.js';

const FINDING_SECTION_RULE_IDS: Record<string, string> = {
  Severity: 'qa.finding-has-severity',
  'Finding Type': 'qa.finding-has-finding-type',
  'Required Fix': 'qa.finding-has-required-fix',
};

const SELF_REVIEW_MARKERS = [
  'agentworkspace/handoffs/issues.md',
  'agentworkspace/handoffs/',
  'qa handoff is incomplete',
  'issues.md did not populate',
  'issues.md is incomplete',
  'issues.md did not include',
];

function shouldFire(validator: PolicyValidator): boolean {
  if (validator.mode === 'lint' || validator.mode === 'ci') {
    return true;
  }

  if (validator.mode === 'runtime') {
    if (validator.requestedAgentId === 'qa') {
      return false;
    }
    if (validator.finalSummaryIsComplete()) {
      return true;
    }
  }

  return false;
}

function readSectionValue(artifact: WorkspaceArtifact, sectionName: string): string {
  return normalizeText(artifact.sections[sectionName] ?? []).trim().toLowerCase();
}

export async function evaluateQaExecutionRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('qa.issues-md-exists');
  validator.recordRule('qa.issues-md-has-review-decision');
  validator.recordRule('qa.finding-has-severity');
  validator.recordRule('qa.finding-has-finding-type');
  validator.recordRule('qa.finding-has-required-fix');
  validator.recordRule('qa.remediation-blocking-requires-location');
  validator.recordRule('qa.severity-value-valid');
  validator.recordRule('qa.finding-type-value-valid');
  validator.recordRule('qa.routing-agent-ids-valid');
  validator.recordRule('qa.retest-instructions-required');
  validator.recordRule('qa.finding-not-self-review');

  if (!shouldFire(validator)) {
    return;
  }

  const stepsDir = validator.implementationStepsDir;
  const sliceFiles = await listSliceArtifactFiles(stepsDir, validator.sliceArtifactFormat);
  if (sliceFiles.length === 0) {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  const issuesLabel = validator.taskId
    ? renderHandoffArtifactLabel(validator.taskId, 'issues.md')
    : 'issues.md';

  const issuesArtifact = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);

  checkIssuesMdExists(validator, issuesArtifact, issuesLabel);

  if (issuesArtifact.exists) {
    const hasFindings = issuesSectionsHaveFindings(issuesArtifact.sections);
    checkReviewDecision(validator, issuesArtifact, hasFindings, issuesLabel);
    checkFindingQuality(validator, issuesArtifact, hasFindings, issuesLabel);

    if (hasFindings) {
      const severity = readSectionValue(issuesArtifact, 'Severity');
      checkFindingNotSelfReview(validator, issuesArtifact);
      checkRemediationBlockingLocation(validator, issuesArtifact, severity, issuesLabel);
      checkSeverityValue(validator, severity, issuesLabel);
      checkFindingTypeValue(validator, issuesArtifact, issuesLabel);
      checkRoutingAgentIds(validator, issuesArtifact, severity, issuesLabel);
      checkRetestInstructions(validator, issuesArtifact, severity, issuesLabel);
    }
  }
}

function checkIssuesMdExists(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  issuesLabel: string,
): void {
  if (!issuesArtifact.exists) {
    validator.addViolation({
      rule_id: 'qa.issues-md-exists',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message: 'issues.md must exist after QA review, even for a clean pass.',
      remediation:
        `Create ${issuesLabel} from the canonical template. The artifact must exist even when no issues are found.`,
    });
  }
}

function checkReviewDecision(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  hasFindings: boolean,
  issuesLabel: string,
): void {
  if (!hasFindings) {
    return;
  }

  const findingContent = normalizeText(issuesArtifact.sections['Finding'] ?? []);
  if (!findingContent) {
    validator.addViolation({
      rule_id: 'qa.issues-md-has-review-decision',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message:
        'issues.md has substantive content but the "Finding" section is empty or missing. Findings must be structured.',
      remediation:
        `Populate the "Finding" section in ${issuesLabel} with a description of each QA finding.`,
    });
  }
}

function checkFindingQuality(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  hasFindings: boolean,
  issuesLabel: string,
): void {
  if (!hasFindings) {
    return;
  }

  for (const sectionName of ISSUES_MD_REQUIRED_FINDING_SECTIONS) {
    const content = normalizeText(issuesArtifact.sections[sectionName] ?? []);
    if (!content) {
      const ruleId = FINDING_SECTION_RULE_IDS[sectionName] ?? 'qa.finding-quality';
      validator.addViolation({
        rule_id: ruleId,
        artifact: ISSUES_MD_RELATIVE_PATH,
        message: `issues.md has findings but the "${sectionName}" section is empty or missing.`,
        remediation: `Populate the "${sectionName}" section in ${issuesLabel} with details about the QA finding.`,
      });
    }
  }
}

function checkRemediationBlockingLocation(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  severity: string,
  issuesLabel: string,
): void {
  if (process.env.REMEDIATION_LOOP_TRIGGERED?.toLowerCase() !== 'true') {
    return;
  }

  if (severity !== 'blocking') {
    return;
  }

  const findingContent = normalizeText(issuesArtifact.sections['Finding'] ?? []);
  if (!findingContent) {
    return;
  }

  if (!REMEDIATION_BLOCKING_LOCATION_PATTERN.test(findingContent)) {
    validator.addViolation({
      rule_id: 'qa.remediation-blocking-requires-location',
      artifact: ISSUES_MD_RELATIVE_PATH,
      severity: 'warning',
      message:
        'Blocking finding on remediation return (iteration >= 2) must reference a specific code location (file path or function name). Vague blocking findings delay convergence.',
      remediation:
        `Add a specific file path or function name to the Finding section in ${issuesLabel} so the SDET can address the issue precisely.`,
    });
  }
}

function checkSeverityValue(validator: PolicyValidator, severity: string, issuesLabel: string): void {
  if (!severity) {
    return;
  }
  if (!ALLOWED_ISSUE_SEVERITIES.has(severity)) {
    validator.addViolation({
      rule_id: 'qa.severity-value-valid',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message: `Severity value '${severity}' is not recognized. Expected one of: ${[...ALLOWED_ISSUE_SEVERITIES].sort().join(', ')}.`,
      remediation:
        `Set the Severity section in ${issuesLabel} to 'blocking' or 'advisory'.`,
    });
  }
}

function checkFindingTypeValue(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  issuesLabel: string,
): void {
  const findingType = readSectionValue(issuesArtifact, 'Finding Type');
  if (!findingType) {
    return;
  }
  if (!ALLOWED_FINDING_TYPES.has(findingType)) {
    validator.addViolation({
      rule_id: 'qa.finding-type-value-valid',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message: `Finding Type value '${findingType}' is not recognized. Expected one of: ${[...ALLOWED_FINDING_TYPES].sort().join(', ')}.`,
      remediation: `Set the Finding Type section in ${issuesLabel} to one of: ${[...ALLOWED_FINDING_TYPES].sort().join(', ')}.`,
    });
  }
}

function checkRoutingAgentIds(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  severity: string,
  issuesLabel: string,
): void {
  if (severity !== 'blocking') {
    return;
  }

  for (const sectionName of ISSUES_MD_ROUTING_AGENT_SECTIONS) {
    const agentId = validator.readAgentIdSection(issuesArtifact, sectionName);
    if (!agentId) {
      continue;
    }
    if (!agentIdExists(agentId, validator.namedAgentTeam, validator.runtimeToProviderAgentId)) {
      validator.addViolation({
        rule_id: 'qa.routing-agent-ids-valid',
        artifact: ISSUES_MD_RELATIVE_PATH,
        message: `${sectionName} value '${agentId}' is not a recognized agent in the registry.`,
        remediation: `Set ${sectionName} in ${issuesLabel} to a valid agent ID from registry.json.`,
      });
    }
  }
}

function checkRetestInstructions(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
  severity: string,
  issuesLabel: string,
): void {
  if (severity !== 'blocking') {
    return;
  }

  const retest = normalizeText(issuesArtifact.sections['Retest Instructions'] ?? []);
  if (!retest) {
    validator.addViolation({
      rule_id: 'qa.retest-instructions-required',
      artifact: ISSUES_MD_RELATIVE_PATH,
      severity: 'warning',
      message: 'Retest Instructions is empty for a blocking finding. The SDET needs verification steps.',
      remediation:
        `Add commands or steps to the Retest Instructions section in ${issuesLabel}.`,
    });
  }
}

function checkFindingNotSelfReview(
  validator: PolicyValidator,
  issuesArtifact: WorkspaceArtifact,
): void {
  const finding = normalizeText(issuesArtifact.sections['Finding'] ?? []).toLowerCase();
  const requiredFix = normalizeText(issuesArtifact.sections['Required Fix'] ?? []).toLowerCase();
  const combined = `${finding} ${requiredFix}`;

  for (const marker of SELF_REVIEW_MARKERS) {
    if (combined.includes(marker)) {
      validator.addViolation({
        rule_id: 'qa.finding-not-self-review',
        artifact: ISSUES_MD_RELATIVE_PATH,
        message:
          'QA finding references AgentWorkSpace handoff artifacts instead of task code. QA must review the code diff and slice files — not its own output or workflow artifacts.',
        remediation:
          'Rewrite issues.md to review only code in code-changes.diff and files listed in the slice. If no code changes exist, set Review Outcome to pass.',
      });
      return;
    }
  }
}
