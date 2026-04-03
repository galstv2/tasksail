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

export async function evaluateCloseoutRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('closeout.final-summary-required');
  validator.recordRule('closeout.retrospective-required');
  validator.recordRule('closeout.retrospective-action-items-required');
  validator.recordRule('closeout.retrospective-role-contributions-required');
  validator.recordRule('closeout.retrospective-concise');
  validator.recordRule('closeout.difficulty-level-required');
  validator.recordRule('closeout.qa-review-approved');

  if (validator.mode !== 'pre-closeout' && validator.mode !== 'pre-archive') {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  await checkQaReviewApproved(validator);

  const retrospective = await validator.getArtifact(RETROSPECTIVE_INPUT_RELATIVE_PATH);
  const retrospectiveGaps = validator.retrospectiveCompletionGaps();

  if (!retrospective.exists) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message:
        'Closeout legality requires AgentWorkSpace/handoffs/retrospective-input.md to exist and capture the concise retrospective meeting.',
      remediation:
        'Restore AgentWorkSpace/handoffs/retrospective-input.md from the canonical template, capture the retrospective summary, and record each named role contribution before closeout or archival.',
    });
  } else if (retrospectiveGaps.required_sections.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective content is incomplete in AgentWorkSpace/handoffs/retrospective-input.md; missing or blank: ${retrospectiveGaps.required_sections.join(', ')}.`,
      remediation: `Complete the missing sections (${retrospectiveGaps.required_sections.join(', ')}) before closeout or archival.`,
    });
  }

  if (retrospectiveGaps.action_items.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-action-items-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective action items are incomplete in AgentWorkSpace/handoffs/retrospective-input.md; ${retrospectiveGaps.action_items.join('; ')}.`,
      remediation:
        'Add 1 to 5 concrete action-item bullets under Action Items before closeout or archival.',
    });
  }

  if (retrospectiveGaps.missing_contributions.length > 0) {
    validator.addViolation({
      rule_id: 'closeout.retrospective-role-contributions-required',
      artifact: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      severity: 'warning',
      message: `Retrospective is missing contribution sections in AgentWorkSpace/handoffs/retrospective-input.md; missing or blank: ${retrospectiveGaps.missing_contributions.join(', ')}.`,
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
    const difficultyLines = finalSummary.sections['Difficulty Assessment'] ?? [];
    let difficultyLevel = '';
    for (const line of difficultyLines) {
      const match = /^-\s+Difficulty Level:\s*(.*)$/.exec(line.trim());
      if (match) {
        difficultyLevel = (match[1] ?? '').trim();
        break;
      }
    }

    if (!difficultyLevel) {
      validator.addViolation({
        rule_id: 'closeout.difficulty-level-required',
        artifact: FINAL_SUMMARY_RELATIVE_PATH,
        severity: 'warning',
        message:
          'Difficulty Level is missing from the Difficulty Assessment section of AgentWorkSpace/handoffs/final-summary.md.',
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
      'Cannot treat the task as ready for closeout because AgentWorkSpace/handoffs/final-summary.md does not contain completed closeout content yet.',
    remediation:
      'Complete AgentWorkSpace/handoffs/final-summary.md with closeout content before creating a follow-up from the active parent task or filing the task archive.',
  });
}

async function checkQaReviewApproved(validator: PolicyValidator): Promise<void> {
  const issuesArtifact = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);
  if (!issuesArtifact.exists) {
    validator.addViolation({
      rule_id: 'closeout.qa-review-approved',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message:
        'Cannot proceed to closeout: AgentWorkSpace/handoffs/issues.md does not exist. QA must review and create this artifact before closeout.',
      remediation:
        'Run QA (Ron) to create AgentWorkSpace/handoffs/issues.md with Review Outcome set to pass or advisory.',
    });
    return;
  }

  const reviewOutcome = normalizeText(
    issuesArtifact.sections['Review Outcome'] ?? [],
  )
    .trim()
    .toLowerCase();

  if (reviewOutcome === 'pass' || reviewOutcome === 'advisory') {
    return;
  }

  if (reviewOutcome === 'blocking' || issuesHaveBlockingFindings(issuesArtifact.sections)) {
    validator.addViolation({
      rule_id: 'closeout.qa-review-approved',
      artifact: ISSUES_MD_RELATIVE_PATH,
      message: `Cannot proceed to closeout: AgentWorkSpace/handoffs/issues.md Review Outcome is '${reviewOutcome || 'missing'}'. All blocking findings must be resolved through the remediation loop before closeout.`,
      remediation:
        'Complete the Ron → Dalton → Ron remediation loop until Review Outcome in issues.md is set to pass or advisory.',
    });
  }
}
