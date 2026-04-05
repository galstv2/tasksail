/**
 * Spec quality validation rules for implementation-spec.md.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_spec.py
 */

import { readTextFile } from '../../core/index.js';
import {
  SPEC_CHILD_CARRY_FORWARD_SECTION,
  SPEC_RECOMMENDED_SECTION_SPECS,
  SPEC_REQUIRED_SECTION_SPECS,
} from '../models.js';
import {
  CODE_FENCE_PATTERN,
  COMMAND_LINE_PATTERN,
  TABLE_ROW_PATTERN,
  extractBulletItems,
  normalizeText,
} from '../matching.js';
import { parseSections, resolveSemanticSection } from '../artifacts.js';
import type { PolicyValidator } from '../validator.js';

const SPEC_RELATIVE_PATH = 'AgentWorkSpace/handoffs/implementation-spec.md';

export async function evaluateSpecQualityRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('spec.required-section-present');
  validator.recordRule('spec.recommended-section-present');
  validator.recordRule('spec.goals-measurable');
  validator.recordRule('spec.non-goals-present');
  validator.recordRule('spec.validation-strategy-executable');
  validator.recordRule('spec.dependency-analysis-structured');
  validator.recordRule('spec.child-carry-forward-required');

  if (validator.mode !== 'lint' && validator.mode !== 'ci') {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  const specPath = `${validator.rootDir}/${SPEC_RELATIVE_PATH}`;
  const text = await readTextFile(specPath);
  if (!text?.trim()) {
    return;
  }

  const sections = parseSections(text);

  for (const sectionSpec of SPEC_REQUIRED_SECTION_SPECS) {
    const content = normalizeText(resolveSemanticSection(sections, sectionSpec).content);
    if (!content) {
      validator.addViolation({
        rule_id: 'spec.required-section-present',
        artifact: SPEC_RELATIVE_PATH,
        message: `Required section '${sectionSpec.preferredHeading}' is missing or empty.`,
        remediation:
          `Add a non-empty section for '${sectionSpec.preferredHeading}' to ${SPEC_RELATIVE_PATH}.`,
      });
    }
  }

  for (const sectionSpec of SPEC_RECOMMENDED_SECTION_SPECS) {
    const content = normalizeText(resolveSemanticSection(sections, sectionSpec).content);
    if (!content) {
      validator.addViolation({
        rule_id: 'spec.recommended-section-present',
        artifact: SPEC_RELATIVE_PATH,
        severity: 'warning',
        message: `Recommended section '${sectionSpec.preferredHeading}' is missing or empty.`,
        remediation:
          `Consider adding a section for '${sectionSpec.preferredHeading}' to ${SPEC_RELATIVE_PATH}.`,
      });
    }
  }

  const goalsItems = extractBulletItems(
    resolveSemanticSection(sections, SPEC_REQUIRED_SECTION_SPECS[1]!).content,
  );
  if (!goalsItems.length) {
    validator.addViolation({
      rule_id: 'spec.goals-measurable',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Goals must contain at least one numbered or bullet item.',
      remediation: `Add numbered or bulleted goals content to ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const nonGoalsItems = extractBulletItems(
    resolveSemanticSection(sections, SPEC_REQUIRED_SECTION_SPECS[2]!).content,
  );
  if (!nonGoalsItems.length) {
    validator.addViolation({
      rule_id: 'spec.non-goals-present',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Non-Goals must contain at least one numbered or bullet item.',
      remediation: `Add numbered or bulleted non-goals content to ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const validationText = resolveSemanticSection(
    sections,
    SPEC_REQUIRED_SECTION_SPECS[9]!,
  ).content.join('\n');
  if (!CODE_FENCE_PATTERN.test(validationText) && !COMMAND_LINE_PATTERN.test(validationText)) {
    validator.addViolation({
      rule_id: 'spec.validation-strategy-executable',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Validation Strategy must contain a code fence or executable command line.',
      remediation: `Add code-fenced shell commands to validation guidance in ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const depText = resolveSemanticSection(
    sections,
    SPEC_REQUIRED_SECTION_SPECS[6]!,
  ).content.join('\n');
  if (!CODE_FENCE_PATTERN.test(depText) && !TABLE_ROW_PATTERN.test(depText)) {
    validator.addViolation({
      rule_id: 'spec.dependency-analysis-structured',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Dependency Analysis must contain a code fence or table.',
      remediation: `Add a code fence or markdown table to dependency analysis in ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const professional = await validator.getArtifact(
    'AgentWorkSpace/handoffs/professional-task.md',
  );
  if (professional.hasSubstantiveContent) {
    const taskKind = (professional.taskLineage['Task Kind'] ?? '').trim();
    if (taskKind === 'child-task') {
      const carryForward = normalizeText(
        resolveSemanticSection(sections, SPEC_CHILD_CARRY_FORWARD_SECTION).content,
      );
      if (!carryForward) {
        validator.addViolation({
          rule_id: 'spec.child-carry-forward-required',
          artifact: SPEC_RELATIVE_PATH,
          message:
            "Task Kind is 'child-task' but Parent Task Carry-Forward Context is blank in the implementation spec.",
          remediation: `Add substantive parent-task context to '## Parent Task Carry-Forward Context' in ${SPEC_RELATIVE_PATH}.`,
        });
      }
    }
  }
}
