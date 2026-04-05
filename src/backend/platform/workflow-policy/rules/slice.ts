/**
 * Slice quality validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_slice.py
 */

import path from 'node:path';
import { readTextFile } from '../../core/index.js';
import {
  findSectionSpec,
  SLICE_REQUIRED_SECTION_SPECS,
  SLICE_FILE_SECTIONS,
  SLICE_RECOMMENDED_SECTIONS,
} from '../models.js';
import {
  CODE_FENCE_PATTERN,
  COMMAND_LINE_PATTERN,
  extractBulletItems,
  normalizeText,
} from '../matching.js';
import { listSliceFiles, parseSections, resolveSemanticSection } from '../artifacts.js';
import type { PolicyValidator } from '../validator.js';

export async function evaluateSliceQualityRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('slice.required-section-present');
  validator.recordRule('slice.recommended-section-present');
  validator.recordRule('slice.file-scope-declared');
  validator.recordRule('slice.acceptance-criteria-measurable');
  validator.recordRule('slice.validation-commands-executable');

  if (
    validator.mode !== 'pre-slice' &&
    validator.mode !== 'lint' &&
    validator.mode !== 'ci'
  ) {
    return;
  }

  const stepsDir = path.join(validator.rootDir, 'AgentWorkSpace', 'ImplementationSteps');
  const sliceFiles = await listSliceFiles(stepsDir);
  if (sliceFiles.length === 0) {
    return;
  }

  for (const slicePath of sliceFiles) {
    const relative = path.relative(validator.rootDir, slicePath);
    const text = (await readTextFile(slicePath)) ?? '';
    const sections = parseSections(text);
    validateSingleSlice(validator, relative, sections);
  }
}

function validateSingleSlice(
  validator: PolicyValidator,
  relative: string,
  sections: Record<string, string[]>,
): void {
  for (const sectionSpec of SLICE_REQUIRED_SECTION_SPECS) {
    const content = normalizeText(resolveSemanticSection(sections, sectionSpec).content);
    if (!content) {
      validator.addViolation({
        rule_id: 'slice.required-section-present',
        artifact: relative,
        message: `Required section '${sectionSpec.preferredHeading}' is missing or empty.`,
        remediation: `Add a non-empty section for '${sectionSpec.preferredHeading}' to ${relative}.`,
      });
    }
  }

  for (const sectionName of SLICE_RECOMMENDED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'slice.recommended-section-present',
        artifact: relative,
        severity: 'warning',
        message: `Recommended section '${sectionName}' is missing or empty.`,
        remediation: `Consider adding a '## ${sectionName}' section to ${relative}.`,
      });
    }
  }

  const hasFileScope = SLICE_FILE_SECTIONS.some((s) =>
    normalizeText(
      resolveSemanticSection(
        sections,
        SLICE_REQUIRED_SECTION_SPECS.find((sectionSpec) => sectionSpec.preferredHeading === s)!,
      ).content,
    ),
  );
  if (!hasFileScope) {
    validator.addViolation({
      rule_id: 'slice.file-scope-declared',
      artifact: relative,
      message: "'Files' section has no content.",
      remediation: `Declare at least one file in the file scope section in ${relative}.`,
    });
  }

  const criteriaItems = extractBulletItems(
    resolveSemanticSection(sections, findSectionSpec(SLICE_REQUIRED_SECTION_SPECS, 'acceptance-criteria')).content,
  );
  if (!criteriaItems.length) {
    validator.addViolation({
      rule_id: 'slice.acceptance-criteria-measurable',
      artifact: relative,
      message: 'Acceptance Criteria must contain at least one bullet item.',
      remediation: `Add measurable bullet items to acceptance criteria in ${relative}.`,
    });
  }

  const validationText = resolveSemanticSection(
    sections,
    findSectionSpec(SLICE_REQUIRED_SECTION_SPECS, 'validation-commands'),
  ).content.join('\n');
  const hasCodeFence = CODE_FENCE_PATTERN.test(validationText);
  const hasCommandLine = COMMAND_LINE_PATTERN.test(validationText);
  if (!hasCodeFence && !hasCommandLine) {
    validator.addViolation({
      rule_id: 'slice.validation-commands-executable',
      artifact: relative,
      message:
        'Validation Commands must contain a code fence or executable command line.',
      remediation: `Add code-fenced shell commands to validation commands in ${relative}.`,
    });
  }
}
