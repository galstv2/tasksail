/**
 * Closeout readiness rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_closeout.py
 */

import {
  ALLOWED_DIFFICULTY_LEVELS,
  FINAL_SUMMARY_RELATIVE_PATH,
  ISSUES_MD_RELATIVE_PATH,
  RETROSPECTIVE_INPUT_RELATIVE_PATH,
} from '../models.js';
import { issuesHaveBlockingFindings, normalizeText } from '../matching.js';
import type { PolicyValidator } from '../validator.js';

const IMPLEMENTATION_SPEC_RELATIVE_PATH = 'implementation-spec.md';
const REQUIREMENT_ID_PATTERN = /\b(?:CR|COMP|VAL)-\d{3}\b/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const FENCE_OPEN_RE = /^(```|~~~)/;

function normalizeDifficultyLevel(value: string): string {
  const match = /^(easy|medium|hard)\b/i.exec(value.trim());
  if (!match) return value.trim();
  const lowered = match[1]!.toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

function normalizeReviewOutcome(lines: readonly string[]): string {
  const normalized = normalizeText(lines).trim().toLowerCase();
  return /^(pass|advisory|blocking)\b/.exec(normalized)?.[1] ?? normalized;
}

export async function evaluateCloseoutRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('closeout.final-summary-required');
  validator.recordRule('closeout.retrospective-required');
  validator.recordRule('closeout.retrospective-action-items-required');
  validator.recordRule('closeout.retrospective-role-contributions-required');
  validator.recordRule('closeout.retrospective-concise');
  validator.recordRule('closeout.difficulty-level-required');
  validator.recordRule('closeout.qa-review-approved');
  validator.recordRule('closeout.owner-agent-valid');
  validator.recordRule('closeout.requirement-verification-section-present');
  validator.recordRule('closeout.requirement-verification-ids-covered');
  validator.recordRule('closeout.requirement-verification-completed');
  validator.recordRule('closeout.requirement-verification-no-blocked-status');

  if (validator.mode !== 'pre-closeout' && validator.mode !== 'pre-archive') {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  await checkQaReviewApproved(validator);
  await checkRequirementVerification(validator);

  const retrospective = await validator.getArtifact(RETROSPECTIVE_INPUT_RELATIVE_PATH);
  const retrospectiveGaps = validator.retrospectiveCompletionGaps();

  if (!retrospective.exists) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message:
        'Closeout legality requires retrospective-input.md to exist and capture the concise retrospective meeting.',
      remediation:
        'Restore retrospective-input.md from the canonical template, capture the retrospective summary, and record each named role contribution before closeout or archival.',
    });
  } else if (retrospectiveGaps.required_sections.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective content is incomplete in retrospective-input.md; missing or blank: ${retrospectiveGaps.required_sections.join(', ')}.`,
      remediation: `Complete the missing sections (${retrospectiveGaps.required_sections.join(', ')}) before closeout or archival.`,
    });
  }

  if (retrospectiveGaps.action_items.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-action-items-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective action items are incomplete in retrospective-input.md; ${retrospectiveGaps.action_items.join('; ')}.`,
      remediation:
        'Add 1 to 5 concrete action-item bullets under Action Items before closeout or archival.',
    });
  }

  if (retrospectiveGaps.missing_contributions.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-role-contributions-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective is missing contribution sections in retrospective-input.md; missing or blank: ${retrospectiveGaps.missing_contributions.join(', ')}.`,
      remediation:
        "Record at least one concise bullet in each named role's Contribution section before closeout or archival.",
    });
  }

  if (retrospectiveGaps.oversized_contributions.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-concise',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective contributions exceed 5 bullets per role; these sections are oversized: ${retrospectiveGaps.oversized_contributions.join(', ')}.`,
      remediation:
        'Trim each role contribution to no more than 5 concise bullets before closeout or archival.',
    });
  }

  if (validator.finalSummaryIsComplete()) {
    const finalSummary = await validator.getArtifact(FINAL_SUMMARY_RELATIVE_PATH);
    const closeoutOwner = validator.readAgentIdSection(finalSummary, 'Closeout Owner Agent ID');
    if (closeoutOwner !== 'qa') {
      validator.addViolation({
        rule_id: 'closeout.owner-agent-valid',
        artifact: FINAL_SUMMARY_RELATIVE_PATH,
        message: `Final-summary closeout must be owned by 'qa' under a top-level ## Closeout Owner Agent ID, found '${closeoutOwner || 'blank'}'.`,
        remediation:
          'Restore top-level ## Closeout Owner Agent ID in final-summary.md and set it to qa — do not move it into Task Metadata or a custom summary.',
      });
    }
    const difficultyLines = finalSummary.sections['Difficulty Assessment'] ?? [];
    let difficultyLevel = '';
    for (const line of difficultyLines) {
      const match = /^(?:[-*]\s*)?Difficulty Level\s*[:\-\u2013\u2014]\s*(.*)$/i.exec(line.trim());
      if (match) {
        difficultyLevel = normalizeDifficultyLevel(match[1] ?? '');
        break;
      }
    }

    if (!difficultyLevel) {
      validator.addViolation({
        rule_id: 'closeout.difficulty-level-required',
        artifact: FINAL_SUMMARY_RELATIVE_PATH,
        severity: 'warning',
        message:
          'Difficulty Level is missing from the Difficulty Assessment section of final-summary.md.',
        remediation:
          "Set '- Difficulty Level: Easy', 'Medium', or 'Hard' in the Difficulty Assessment section before closeout.",
      });
    } else if (!ALLOWED_DIFFICULTY_LEVELS.has(difficultyLevel)) {
      validator.addViolation({
        rule_id: 'closeout.difficulty-level-required',
        artifact: FINAL_SUMMARY_RELATIVE_PATH,
        severity: 'warning',
        message: `Difficulty Level must be Easy, Medium, or Hard; found '${difficultyLevel}'.`,
        remediation: "Set '- Difficulty Level:' to exactly 'Easy', 'Medium', or 'Hard'.",
      });
    }
    return;
  }

  validator.addViolation({
    rule_id: 'closeout.final-summary-required',
    artifact: FINAL_SUMMARY_RELATIVE_PATH,
    message:
      'Cannot treat the task as ready for closeout because final-summary.md does not contain completed closeout content yet.',
    remediation:
      'Complete final-summary.md with closeout content before creating a follow-up from the active parent task or filing the task archive.',
  });
}

function stripCommentsAndFences(text: string): string {
  const withoutComments = text.replace(HTML_COMMENT_RE, '');
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of withoutComments.split(/\r?\n/)) {
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

function sortedRequirementIds(text: string): string[] {
  return [...new Set(stripCommentsAndFences(text).match(REQUIREMENT_ID_PATTERN) ?? [])].sort();
}

function parseStatusForId(lines: readonly string[], id: string): string | null {
  const pattern = new RegExp(`\\b${id}\\s*[:\\-\\u2013\\u2014]\\s*(.*)$`);
  const match = stripCommentsAndFences(lines.join('\n'))
    .split(/\r?\n/)
    .map((candidate) => pattern.exec(candidate))
    .find((candidate) => candidate !== null);
  if (!match) {
    return null;
  }
  const lowered = (match[1] ?? '').trim().toLowerCase().replace(/[\u2013\u2014]/g, '-');
  if (lowered.startsWith('not met')) {
    return 'not met';
  }
  return /^(verified|advisory|pending|blocked|unmet|failed)\b/.exec(lowered)?.[1] ?? null;
}

async function checkRequirementVerification(validator: PolicyValidator): Promise<void> {
  const spec = await validator.getArtifact(IMPLEMENTATION_SPEC_RELATIVE_PATH);
  if (!spec.exists || !spec.hasSubstantiveContent) {
    return;
  }
  const intakeRequirements = spec.sections['Intake Requirements'];
  if (!intakeRequirements) {
    return;
  }
  const generatedIds = sortedRequirementIds(intakeRequirements.join('\n'));
  if (generatedIds.length === 0) {
    return;
  }

  const issuesArtifact = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);
  if (!issuesArtifact.exists) {
    return;
  }
  const reviewOutcome = normalizeReviewOutcome(issuesArtifact.sections['Review Outcome'] ?? []);
  if (reviewOutcome === 'blocking' || issuesHaveBlockingFindings(issuesArtifact.sections)) {
    return;
  }
  if (reviewOutcome !== 'pass' && reviewOutcome !== 'advisory') {
    return;
  }

  const finalSummary = await validator.getArtifact(FINAL_SUMMARY_RELATIVE_PATH);
  const verificationLines = finalSummary.sections['Requirement Verification'];
  if (!finalSummary.exists || !verificationLines || !stripCommentsAndFences(verificationLines.join('\n')).trim()) {
    validator.addViolation({
      rule_id: 'closeout.requirement-verification-section-present',
      artifact: FINAL_SUMMARY_RELATIVE_PATH,
      message:
        'Non-blocking QA closeout requires final-summary.md to contain a non-empty Requirement Verification section for generated requirements.',
      remediation:
        'Restore ## Requirement Verification in final-summary.md and mark each generated CR-*, COMP-*, and VAL-* as verified or advisory with evidence.',
    });
    return;
  }

  const verificationText = verificationLines.join('\n');
  const coveredIds = sortedRequirementIds(verificationText);
  const missingIds = generatedIds.filter((id) => !coveredIds.includes(id));
  if (missingIds.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.requirement-verification-ids-covered',
      artifact: FINAL_SUMMARY_RELATIVE_PATH,
      message: `Requirement Verification is missing generated requirement IDs: ${missingIds.join(', ')}.`,
      remediation:
        'Add every generated CR-*, COMP-*, and VAL-* ID from implementation-spec.md ## Intake Requirements to final-summary.md ## Requirement Verification.',
    });
  }

  const incompleteIds: string[] = [];
  const blockedIds: string[] = [];
  for (const id of generatedIds) {
    const status = parseStatusForId(verificationLines, id);
    if (status === 'blocked' || status === 'unmet' || status === 'failed' || status === 'not met') {
      blockedIds.push(id);
    }
    if (status !== 'verified' && status !== 'advisory') {
      incompleteIds.push(id);
    }
  }
  if (incompleteIds.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.requirement-verification-completed',
      artifact: FINAL_SUMMARY_RELATIVE_PATH,
      message: `Requirement Verification must mark generated IDs as verified or advisory; incomplete IDs: ${incompleteIds.sort().join(', ')}.`,
      remediation:
        'Replace pending or invalid status tokens with verified or advisory and add evidence for each generated requirement ID.',
    });
  }
  if (blockedIds.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.requirement-verification-no-blocked-status',
      artifact: FINAL_SUMMARY_RELATIVE_PATH,
      message: `Requirement Verification uses blocked/unmet status for generated IDs in a non-blocking closeout: ${blockedIds.sort().join(', ')}.`,
      remediation:
        'If a generated requirement is unmet, set issues.md Review Outcome to blocking and stop after issues.md; otherwise use verified or advisory.',
    });
  }
}

async function checkQaReviewApproved(validator: PolicyValidator): Promise<void> {
  const issuesArtifact = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);
  if (!issuesArtifact.exists) {
    validator.addViolation({
      rule_id: 'closeout.qa-review-approved',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message:
        'Cannot proceed to closeout: issues.md does not exist. QA must review and create this artifact before closeout.',
      remediation:
        'Run QA (Ron) to create issues.md with Review Outcome set to pass or advisory.',
    });
    return;
  }

  const reviewOutcome = normalizeReviewOutcome(issuesArtifact.sections['Review Outcome'] ?? []);

  if (reviewOutcome === 'pass' || reviewOutcome === 'advisory') {
    return;
  }

  if (reviewOutcome === 'blocking' || issuesHaveBlockingFindings(issuesArtifact.sections)) {
    validator.addViolation({
      rule_id: 'closeout.qa-review-approved',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message: `Cannot proceed to closeout: issues.md Review Outcome is '${reviewOutcome || 'missing'}'. All blocking findings must be resolved through the remediation loop before closeout.`,
      remediation:
        'Complete the Ron → Dalton → Ron remediation loop until Review Outcome in issues.md is set to pass or advisory.',
    });
    return;
  }

  validator.addViolation({
    rule_id: 'closeout.qa-review-approved',
    artifact: ISSUES_MD_RELATIVE_PATH,
    message: `Cannot proceed to closeout: issues.md top-level ## Review Outcome is '${reviewOutcome || 'missing'}'. Closeout requires a top-level ## Review Outcome set to pass, advisory, or blocking.`,
    remediation:
      'Restore top-level ## Review Outcome in issues.md and set it to pass, advisory, or blocking — do not move it into Task Metadata or a custom summary.',
  });
}
