/**
 * Spec quality validation rules for implementation artifacts.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_spec.py
 */

import { readTextFile } from '../../core/index.js';
import {
  findSectionSpec,
  SPEC_CHILD_CARRY_FORWARD_SECTION,
  SPEC_RECOMMENDED_SECTION_SPECS,
  SPEC_REQUIRED_SECTION_SPECS,
} from '../models.js';
import {
  CODE_FENCE_PATTERN,
  COMMAND_LINE_PATTERN,
  TABLE_ROW_PATTERN,
  normalizeIdentifier,
  normalizeText,
  stripHtmlComments,
} from '../matching.js';
import { parseSemanticSections, resolveSemanticSection } from '../artifacts.js';
import { toHandoffKey } from '../validator.js';
import type { PolicyValidator } from '../validator.js';

const SPEC_RELATIVE_PATH = toHandoffKey('implementation-spec.md');
const INTAKE_RELATIVE_PATH = toHandoffKey('intake.md');
const INTAKE_REQUIREMENTS_SECTION = 'Intake Requirements';
const GENERATED_INTAKE_SPINE_MODES = new Set(['lint', 'pre-slice', 'runtime', 'ci']);
const INTAKE_REQUIREMENT_SUBSECTIONS = [
  {
    heading: 'Critical Requirements',
    ruleId: 'spec.intake-requirements-critical-matches',
  },
  {
    heading: 'Compatibility Requirements',
    ruleId: 'spec.intake-requirements-compatibility-matches',
  },
  {
    heading: 'Required Validation',
    ruleId: 'spec.intake-requirements-validation-matches',
  },
] as const;

export const GENERATED_INTAKE_SPINE_RULE_IDS: ReadonlySet<string> = new Set([
  'spec.intake-requirements-section-present',
  ...INTAKE_REQUIREMENT_SUBSECTIONS.map(({ ruleId }) => ruleId),
]);

function stripOuterBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') {
    start += 1;
  }
  while (end > start && lines[end - 1]!.trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}

function normalizeGeneratedRequirementBody(lines: readonly string[] | undefined): string {
  const stripped = stripOuterBlankLines(stripHtmlComments(lines ?? []));
  if (!normalizeText(stripped)) {
    return 'None';
  }
  return stripped.join('\n');
}

function findTopLevelSection(
  sections: Record<string, string[]>,
  heading: string,
): string[] | null {
  const normalizedHeading = normalizeIdentifier(heading);
  for (const [sectionName, lines] of Object.entries(sections)) {
    if (normalizeIdentifier(sectionName) === normalizedHeading) {
      return lines;
    }
  }
  return null;
}

function extractNestedMarkdownSection(
  lines: readonly string[],
  heading: string,
): string[] | null {
  const normalizedHeading = normalizeIdentifier(heading);
  let activeLevel = 0;
  let activeLines: string[] | null = null;
  let inFence = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
    }

    const match = inFence ? null : /^(#{3,6})\s+(.*\S)\s*$/.exec(trimmed);
    if (match?.[1] && match[2]) {
      const level = match[1].length;
      if (activeLines && level <= activeLevel) {
        return activeLines;
      }
      if (!activeLines && normalizeIdentifier(match[2]) === normalizedHeading) {
        activeLevel = level;
        activeLines = [];
        continue;
      }
    }

    if (activeLines) {
      activeLines.push(rawLine);
    }
  }

  return activeLines;
}

function extractedIntakeRequirementHeadingOrder(lines: readonly string[]): string[] {
  const expectedHeadings = new Set(
    INTAKE_REQUIREMENT_SUBSECTIONS.map(({ heading }) => normalizeIdentifier(heading)),
  );
  const ordered: string[] = [];
  let inFence = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
    }
    const match = inFence ? null : /^(#{3,6})\s+(.*\S)\s*$/.exec(trimmed);
    if (!match?.[2]) {
      continue;
    }
    const normalized = normalizeIdentifier(match[2]);
    if (expectedHeadings.has(normalized)) {
      ordered.push(normalized);
    }
  }

  return ordered;
}

async function evaluateGeneratedIntakeRequirementSpine(validator: PolicyValidator): Promise<void> {
  const intake = await validator.getArtifact(INTAKE_RELATIVE_PATH);
  if (!intake.exists || !normalizeText(stripHtmlComments(Object.values(intake.sections).flat()))) {
    return;
  }

  const spec = await validator.getArtifact(SPEC_RELATIVE_PATH);
  if (!spec.exists || !spec.hasSubstantiveContent) {
    return;
  }

  const intakeRequirementLines = findTopLevelSection(spec.sections, INTAKE_REQUIREMENTS_SECTION);
  if (!intakeRequirementLines || !normalizeText(stripHtmlComments(intakeRequirementLines))) {
    validator.addViolation({
      rule_id: 'spec.intake-requirements-section-present',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Generated ## Intake Requirements section is missing or empty in implementation-spec.md.',
      remediation:
        `Restore the generated ## Intake Requirements section in ${SPEC_RELATIVE_PATH} from ${INTAKE_RELATIVE_PATH}.`,
    });
    return;
  }
  const expectedHeadingOrder = INTAKE_REQUIREMENT_SUBSECTIONS.map(({ heading }) => normalizeIdentifier(heading));
  const actualHeadingOrder = extractedIntakeRequirementHeadingOrder(intakeRequirementLines);
  if (actualHeadingOrder.join('\n') !== expectedHeadingOrder.join('\n')) {
    validator.addViolation({
      rule_id: 'spec.intake-requirements-section-present',
      artifact: SPEC_RELATIVE_PATH,
      message:
        'Generated ## Intake Requirements section headings are missing or reordered in implementation-spec.md.',
      remediation:
        `Restore the generated ## Intake Requirements section in ${SPEC_RELATIVE_PATH} from ${INTAKE_RELATIVE_PATH}.`,
    });
    return;
  }

  for (const { heading, ruleId } of INTAKE_REQUIREMENT_SUBSECTIONS) {
    const expected = normalizeGeneratedRequirementBody(findTopLevelSection(intake.sections, heading) ?? undefined);
    const actualLines = extractNestedMarkdownSection(intakeRequirementLines, heading);
    const actual = actualLines === null ? null : normalizeGeneratedRequirementBody(actualLines);
    if (actual !== expected) {
      validator.addViolation({
        rule_id: ruleId,
        artifact: SPEC_RELATIVE_PATH,
        message: `Generated ## Intake Requirements / ### ${heading} content is missing or differs from intake.md.`,
        remediation:
          `Restore the generated ### ${heading} body in ${SPEC_RELATIVE_PATH} from ${INTAKE_RELATIVE_PATH}; do not reinterpret, summarize, reorder, or weaken it.`,
      });
    }
  }
}

export async function evaluateSpecQualityRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('spec.required-section-present');
  validator.recordRule('spec.recommended-section-present');
  validator.recordRule('spec.goals-measurable');
  validator.recordRule('spec.non-goals-present');
  validator.recordRule('spec.validation-strategy-executable');
  validator.recordRule('spec.dependency-analysis-structured');
  validator.recordRule('spec.child-carry-forward-required');
  validator.recordRule('spec.intake-requirements-section-present');
  validator.recordRule('spec.intake-requirements-critical-matches');
  validator.recordRule('spec.intake-requirements-compatibility-matches');
  validator.recordRule('spec.intake-requirements-validation-matches');

  if (validator.hasActiveTask() && GENERATED_INTAKE_SPINE_MODES.has(validator.mode)) {
    await evaluateGeneratedIntakeRequirementSpine(validator);
  }

  if (validator.mode !== 'lint' && validator.mode !== 'ci') {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  const specPath = `${validator.handoffsDir}/${SPEC_RELATIVE_PATH}`;
  const text = await readTextFile(specPath);
  if (!text?.trim()) {
    return;
  }

  const sections = parseSemanticSections(text);

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

  const goalsContent = normalizeText(
    resolveSemanticSection(sections, findSectionSpec(SPEC_REQUIRED_SECTION_SPECS, 'goals')).content,
  );
  if (!goalsContent) {
    validator.addViolation({
      rule_id: 'spec.goals-measurable',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Goals must contain substantive content.',
      remediation: `Add substantive goals content to ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const nonGoalsContent = normalizeText(
    resolveSemanticSection(sections, findSectionSpec(SPEC_REQUIRED_SECTION_SPECS, 'non-goals')).content,
  );
  if (!nonGoalsContent) {
    validator.addViolation({
      rule_id: 'spec.non-goals-present',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Non-Goals must contain substantive content.',
      remediation: `Add substantive non-goals content to ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const validationText = resolveSemanticSection(
    sections,
    findSectionSpec(SPEC_REQUIRED_SECTION_SPECS, 'validation-strategy'),
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
    findSectionSpec(SPEC_REQUIRED_SECTION_SPECS, 'dependency-analysis'),
  ).content.join('\n');
  if (!CODE_FENCE_PATTERN.test(depText) && !TABLE_ROW_PATTERN.test(depText)) {
    validator.addViolation({
      rule_id: 'spec.dependency-analysis-structured',
      artifact: SPEC_RELATIVE_PATH,
      message: 'Dependency Analysis must contain a code fence or table.',
      remediation: `Add a code fence or markdown table to dependency analysis in ${SPEC_RELATIVE_PATH}.`,
    });
  }

  const professional = await validator.getArtifact('professional-task.md');
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
