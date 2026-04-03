/**
 * Slice quality validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_slice.py
 */

import path from 'node:path';
import { readTextFile } from '../../core/index.js';
import {
  SLICE_FILE_SECTIONS,
  SLICE_RECOMMENDED_SECTIONS,
  SLICE_REQUIRED_SECTIONS,
} from '../models.js';
import {
  CODE_FENCE_PATTERN,
  COMMAND_LINE_PATTERN,
  extractBulletItems,
  normalizeText,
} from '../matching.js';
import { listSliceFiles, parseSections } from '../artifacts.js';
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
  for (const sectionName of SLICE_REQUIRED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'slice.required-section-present',
        artifact: relative,
        message: `Required section '${sectionName}' is missing or empty.`,
        remediation: `Add a non-empty '## ${sectionName}' section to ${relative}.`,
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
    normalizeText(sections[s] ?? []),
  );
  if (!hasFileScope) {
    validator.addViolation({
      rule_id: 'slice.file-scope-declared',
      artifact: relative,
      message: "'Files' section has no content.",
      remediation: `Declare at least one file in 'Files' in ${relative}.`,
    });
  }

  const criteriaItems = extractBulletItems(sections['Acceptance Criteria'] ?? []);
  if (!criteriaItems.length) {
    validator.addViolation({
      rule_id: 'slice.acceptance-criteria-measurable',
      artifact: relative,
      message: 'Acceptance Criteria must contain at least one bullet item.',
      remediation: `Add measurable bullet items to '## Acceptance Criteria' in ${relative}.`,
    });
  }

  const validationText = (sections['Validation Commands'] ?? []).join('\n');
  const hasCodeFence = CODE_FENCE_PATTERN.test(validationText);
  const hasCommandLine = COMMAND_LINE_PATTERN.test(validationText);
  if (!hasCodeFence && !hasCommandLine) {
    validator.addViolation({
      rule_id: 'slice.validation-commands-executable',
      artifact: relative,
      message:
        'Validation Commands must contain a code fence or executable command line.',
      remediation: `Add code-fenced shell commands to '## Validation Commands' in ${relative}.`,
    });
  }
}
