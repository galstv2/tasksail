/**
 * Slice quality validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_slice.py
 */

import path from 'node:path';
import { readTextFile } from '../../core/index.js';
import {
  findSectionSpec,
  SPEC_RECOMMENDED_SECTION_SPECS,
  SPEC_REQUIRED_SECTION_SPECS,
  SLICE_REQUIRED_SECTION_SPECS,
  SLICE_FILE_SECTIONS,
  SLICE_RECOMMENDED_SECTIONS,
  type SemanticSectionSpec,
} from '../models.js';
import {
  CODE_FENCE_PATTERN,
  COMMAND_LINE_PATTERN,
  normalizeIdentifier,
  normalizeText,
} from '../matching.js';
import { listSliceFiles, parseSemanticSections, resolveSemanticSection } from '../artifacts.js';
import { toHandoffKey } from '../validator.js';
import { loadMarkdownContract } from '../contracts/markdownContract.js';
import type { WorkspaceArtifact } from '../types.js';
import type { PolicyValidator } from '../validator.js';

const REQUIREMENT_ID_PATTERN = /\b(?:CR|COMP|VAL)-\d{3}\b/g;
const SPEC_RELATIVE_PATH = toHandoffKey('implementation-spec.md');
const INTAKE_REQUIREMENTS_SECTION = 'Intake Requirements';
const TASK_METADATA_SECTION = 'Task Metadata';
const TRACEABILITY_RULE_IDS = [
  'slice.requirement-id-covered',
  'slice.validation-id-covered',
  'slice.requirement-id-known',
] as const;
const TRACEABILITY_MODES = new Set(['pre-slice', 'lint', 'ci']);
const MARKDOWN_CONTRACT = loadMarkdownContract();
const VALIDATION_SPEC_SECTIONS = [
  findSectionSpec(SPEC_REQUIRED_SECTION_SPECS, 'validation-strategy'),
  findSectionSpec(SPEC_RECOMMENDED_SECTION_SPECS, 'test-coverage'),
] as const;
const VALIDATION_SLICE_SECTIONS = [
  findSectionSpec(SLICE_REQUIRED_SECTION_SPECS, 'unit-tests'),
  findSectionSpec(SLICE_REQUIRED_SECTION_SPECS, 'acceptance-criteria'),
  findSectionSpec(SLICE_REQUIRED_SECTION_SPECS, 'validation-commands'),
] as const;

export async function evaluateSliceQualityRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('slice.required-section-present');
  validator.recordRule('slice.recommended-section-present');
  validator.recordRule('slice.file-scope-declared');
  validator.recordRule('slice.acceptance-criteria-measurable');
  validator.recordRule('slice.validation-commands-executable');
  for (const ruleId of TRACEABILITY_RULE_IDS) {
    validator.recordRule(ruleId);
  }

  if (
    validator.mode !== 'pre-slice' &&
    validator.mode !== 'lint' &&
    validator.mode !== 'ci'
  ) {
    return;
  }

  const stepsDir = validator.implementationStepsDir;
  const sliceFiles = await listSliceFiles(stepsDir);
  if (TRACEABILITY_MODES.has(validator.mode)) {
    await evaluateRequirementTraceabilityRules(validator, sliceFiles);
  }
  if (sliceFiles.length === 0) {
    return;
  }

  for (const slicePath of sliceFiles) {
    const relative = path.relative(validator.rootDir, slicePath);
    const text = (await readTextFile(slicePath)) ?? '';
    const sections = parseSemanticSections(text);
    validateSingleSlice(validator, relative, sections);
  }
}

function stripCommentsAndFences(lines: readonly string[]): string {
  const output: string[] = [];
  let fenceClose: string | null = null;

  const withoutComments = lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  for (const line of withoutComments) {
    const trimmed = line.trim();
    if (fenceClose) {
      if (trimmed === fenceClose) {
        fenceClose = null;
      }
      continue;
    }

    const fenceMatch = MARKDOWN_CONTRACT.compiled.fenceOpen.exec(line);
    const marker = fenceMatch?.[MARKDOWN_CONTRACT.groups.fenceMarker];
    if (marker) {
      fenceClose = marker;
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

function extractRequirementIds(lines: readonly string[] | string): Set<string> {
  const text = typeof lines === 'string'
    ? stripCommentsAndFences(lines.split(/\r?\n/))
    : stripCommentsAndFences(lines);
  return new Set(text.match(REQUIREMENT_ID_PATTERN) ?? []);
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
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

function authoredSpecLines(spec: WorkspaceArtifact): string[] {
  const excluded = new Set([
    normalizeIdentifier(INTAKE_REQUIREMENTS_SECTION),
    normalizeIdentifier(TASK_METADATA_SECTION),
  ]);
  const lines: string[] = [];
  for (const [sectionName, sectionLines] of Object.entries(spec.sections)) {
    if (excluded.has(normalizeIdentifier(sectionName))) {
      continue;
    }
    lines.push(...sectionLines);
  }
  return lines;
}

function validationSurfaceLines(sections: Record<string, string[]>, specs: readonly SemanticSectionSpec[]): string[] {
  return specs.flatMap((sectionSpec) => resolveSemanticSection(sections, sectionSpec).content);
}

async function evaluateRequirementTraceabilityRules(
  validator: PolicyValidator,
  sliceFiles: readonly string[],
): Promise<void> {
  const spec = await validator.getArtifact(SPEC_RELATIVE_PATH);
  if (!spec.exists || !spec.hasSubstantiveContent) {
    return;
  }

  const intakeRequirementLines = findTopLevelSection(spec.sections, INTAKE_REQUIREMENTS_SECTION);
  if (!intakeRequirementLines) {
    return;
  }

  const generatedIds = extractRequirementIds(intakeRequirementLines);
  const authoredByArtifact = new Map<string, Set<string>>();
  const validationIds = new Set<string>();

  const authoredSpecIds = extractRequirementIds(authoredSpecLines(spec));
  authoredByArtifact.set(SPEC_RELATIVE_PATH, authoredSpecIds);
  for (const id of extractRequirementIds(validationSurfaceLines(spec.sections, VALIDATION_SPEC_SECTIONS))) {
    validationIds.add(id);
  }

  for (const slicePath of sliceFiles) {
    const relative = path.relative(validator.rootDir, slicePath);
    const text = (await readTextFile(slicePath)) ?? '';
    const sections = parseSemanticSections(text);
    authoredByArtifact.set(relative, extractRequirementIds(text));
    for (const id of extractRequirementIds(validationSurfaceLines(sections, VALIDATION_SLICE_SECTIONS))) {
      validationIds.add(id);
    }
  }

  const authoredIds = new Set<string>();
  for (const ids of authoredByArtifact.values()) {
    for (const id of ids) {
      authoredIds.add(id);
    }
  }

  for (const id of sortedIds(generatedIds)) {
    if (!authoredIds.has(id)) {
      validator.addViolation({
        rule_id: 'slice.requirement-id-covered',
        artifact: SPEC_RELATIVE_PATH,
        message: `Generated requirement ${id} is not referenced in Alice-authored plan or slice content.`,
        remediation:
          `Reference ${id} in ${SPEC_RELATIVE_PATH} ### Requirement Handling or the relevant slice-N.md content; do not copy every generated requirement into every slice.`,
      });
    }
  }

  for (const id of sortedIds(generatedIds).filter((candidate) => candidate.startsWith('VAL-'))) {
    if (!validationIds.has(id)) {
      validator.addViolation({
        rule_id: 'slice.validation-id-covered',
        artifact: SPEC_RELATIVE_PATH,
        message: `Generated validation requirement ${id} is not referenced in a validation surface.`,
        remediation:
          `Add ${id} to a validation surface with the command, test, or acceptance criterion that proves it.`,
      });
    }
  }

  const emittedUnknowns = new Set<string>();
  const byArtifact = [...authoredByArtifact.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [artifact, ids] of byArtifact) {
    for (const id of sortedIds(ids)) {
      if (generatedIds.has(id)) {
        continue;
      }
      const key = `${artifact}\0${id}`;
      if (emittedUnknowns.has(key)) {
        continue;
      }
      emittedUnknowns.add(key);
      validator.addViolation({
        rule_id: 'slice.requirement-id-known',
        artifact,
        message: `${artifact} references unknown requirement ID ${id}.`,
        remediation: `Remove ${id} from ${artifact} or correct it to an existing generated requirement ID.`,
      });
    }
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

  const criteriaContent = normalizeText(
    resolveSemanticSection(sections, findSectionSpec(SLICE_REQUIRED_SECTION_SPECS, 'acceptance-criteria')).content,
  );
  if (!criteriaContent) {
    validator.addViolation({
      rule_id: 'slice.acceptance-criteria-measurable',
      artifact: relative,
      message: 'Acceptance Criteria must contain substantive content.',
      remediation: `Add measurable acceptance criteria to ${relative}.`,
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
