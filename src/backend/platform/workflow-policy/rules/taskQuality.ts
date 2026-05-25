/**
 * Task and workflow-path quality validation rules for PM artifacts.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_task_quality.py
 */

import path from 'node:path';
import { readTextFile } from '../../core/index.js';
import {
  CHILD_TASK_REQUIRED_LINEAGE_FIELDS,
  HANDOFF_RELATIVE_PATHS,
  LINEAGE_CONSISTENCY_FIELDS,
  TASK_RECOMMENDED_SECTIONS,
  TASK_REQUIRED_SECTIONS,
} from '../models.js';
import { normalizeText } from '../matching.js';
import { parseSemanticSections } from '../artifacts.js';
import { toHandoffKey } from '../validator.js';
import type { PolicyValidator } from '../validator.js';

const TASK_RELATIVE_PATH = toHandoffKey('professional-task.md');

export async function evaluateTaskQualityRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('task.required-section-present');
  validator.recordRule('task.recommended-section-present');
  validator.recordRule('task.acceptance-criteria-measurable');
  validator.recordRule('task.non-goals-present');
  validator.recordRule('task.child-lineage-required');
  validator.recordRule('task.child-carry-forward-required');
  validator.recordRule('task.lineage-consistency');

  if (
    validator.mode !== 'runtime' &&
    validator.mode !== 'pre-slice' &&
    validator.mode !== 'lint' &&
    validator.mode !== 'ci'
  ) {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  // Runtime mode: only lineage/child checks are relevant.
  if (validator.mode === 'runtime') {
    return;
  }

  const taskPath = path.join(validator.handoffsDir, TASK_RELATIVE_PATH);
  const text = await readTextFile(taskPath);
  if (!text?.trim()) {
    return;
  }

  const sections = parseSemanticSections(text);

  for (const sectionName of TASK_REQUIRED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'task.required-section-present',
        artifact: TASK_RELATIVE_PATH,
        message: `Required section '${sectionName}' is missing or empty.`,
        remediation: `Add a non-empty '## ${sectionName}' section to ${TASK_RELATIVE_PATH}.`,
      });
    }
  }

  for (const sectionName of TASK_RECOMMENDED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'task.recommended-section-present',
        artifact: TASK_RELATIVE_PATH,
        severity: 'warning',
        message: `Recommended section '${sectionName}' is missing or empty.`,
        remediation: `Consider adding a '## ${sectionName}' section to ${TASK_RELATIVE_PATH}.`,
      });
    }
  }

  const acContent = normalizeText(sections['Acceptance Criteria'] ?? []);
  if (!acContent) {
    validator.addViolation({
      rule_id: 'task.acceptance-criteria-measurable',
      artifact: TASK_RELATIVE_PATH,
      message: 'Acceptance Criteria must contain substantive content.',
      remediation: `Add substantive acceptance criteria to '## Acceptance Criteria' in ${TASK_RELATIVE_PATH}.`,
    });
  }

  const ngContent = normalizeText(sections['Non-Goals'] ?? []);
  if (!ngContent) {
    validator.addViolation({
      rule_id: 'task.non-goals-present',
      artifact: TASK_RELATIVE_PATH,
      message: 'Non-Goals must contain substantive content.',
      remediation: `Add substantive non-goals to '## Non-Goals' in ${TASK_RELATIVE_PATH}.`,
    });
  }

  await checkChildTaskRules(validator);
  await checkLineageConsistency(validator);
}

async function checkChildTaskRules(validator: PolicyValidator): Promise<void> {
  const professional = await validator.getArtifact(TASK_RELATIVE_PATH);
  if (!professional.exists || !professional.hasSubstantiveContent) {
    return;
  }

  const taskKind = (professional.taskLineage['Task Kind'] ?? '').trim();
  if (taskKind !== 'child-task') {
    return;
  }

  const missing = CHILD_TASK_REQUIRED_LINEAGE_FIELDS.filter(
    (f) => !(professional.taskLineage[f] ?? '').trim(),
  );
  if (missing.length > 0) {
    validator.addViolation({
      rule_id: 'task.child-lineage-required',
      artifact: TASK_RELATIVE_PATH,
      message: `Task Kind is 'child-task' but required lineage fields are missing: ${missing.join(', ')}.`,
      remediation: `Populate all child-task lineage fields (${CHILD_TASK_REQUIRED_LINEAGE_FIELDS.join(', ')}) in ${TASK_RELATIVE_PATH}.`,
    });
  }

  const carryForward = normalizeText(
    professional.sections['Parent Task Carry-Forward Context'] ?? [],
  );
  if (!carryForward) {
    validator.addViolation({
      rule_id: 'task.child-carry-forward-required',
      artifact: TASK_RELATIVE_PATH,
      message: "Task Kind is 'child-task' but Parent Task Carry-Forward Context is blank.",
      remediation: `Add substantive parent-task context to the '## Parent Task Carry-Forward Context' section in ${TASK_RELATIVE_PATH}.`,
    });
  }
}

async function checkLineageConsistency(validator: PolicyValidator): Promise<void> {
  const referenceValues: Record<string, string> = {};
  let referenceArtifact = '';

  for (const relativePath of HANDOFF_RELATIVE_PATHS) {
    const artifact = await validator.getArtifact(relativePath);
    if (!artifact.exists || !artifact.hasSubstantiveContent) {
      continue;
    }

    for (const fieldName of LINEAGE_CONSISTENCY_FIELDS) {
      const value = (artifact.taskLineage[fieldName] ?? '').trim();
      if (!value) {
        continue;
      }

      if (!(fieldName in referenceValues)) {
        referenceValues[fieldName] = value;
        referenceArtifact = relativePath;
        continue;
      }

      if (value !== referenceValues[fieldName]) {
        validator.addViolation({
          rule_id: 'task.lineage-consistency',
          artifact: relativePath,
          message: `Lineage field '${fieldName}' is '${value}' in ${relativePath} but '${referenceValues[fieldName]}' in ${referenceArtifact}.`,
          remediation: `Ensure '${fieldName}' is consistent across all handoff artifacts.`,
        });
      }
    }
  }
}
