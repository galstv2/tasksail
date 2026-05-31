/**
 * Parallel-ok content validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_parallel_ok_content.py
 */

import path from 'node:path';
import { extractBulletItems, normalizeText } from '../matching.js';
import { parallelOkHasActiveApproval } from '../artifacts.js';
import {
  describeSliceArtifactFormat,
  listSliceArtifactFiles,
  normalizeParallelSliceReference,
  sliceIdFromFilename,
} from '../sliceArtifacts.js';
import type { WorkspaceArtifact } from '../types.js';
import { toHandoffKey } from '../validator.js';
import type { PolicyValidator } from '../validator.js';

const ARTIFACT = toHandoffKey('parallel-ok.md');
// Accept bare slice-N, slice-N.md, or slice-N.xml references
const SLICE_ID_PATTERN = /\b(?:slice[-_a-zA-Z0-9]*|[a-zA-Z0-9][\w.-]*\.(?:md|xml))\b/g;

function shouldFire(validator: PolicyValidator): boolean {
  return (
    validator.mode === 'pre-slice' ||
    validator.mode === 'lint' ||
    validator.mode === 'ci'
  );
}

export async function evaluateParallelOkContentRules(
  validator: PolicyValidator,
): Promise<void> {
  validator.recordRule('parallel-ok.independent-slices-has-items');
  validator.recordRule('parallel-ok.constraints-populated');
  validator.recordRule('parallel-ok.slices-exist');

  if (!shouldFire(validator)) {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  const artifact = await validator.getArtifact(ARTIFACT);
  if (!artifact.exists || !artifact.hasSubstantiveContent) {
    return;
  }

  if (!(await parallelOkHasActiveApproval(validator.rootDir, artifact, validator.taskId))) {
    return;
  }

  checkIndependentSlices(validator, artifact);
  checkConstraints(validator, artifact);
  await checkSlicesExist(validator, artifact);
}

function checkIndependentSlices(
  validator: PolicyValidator,
  artifact: WorkspaceArtifact,
): void {
  const items = independentSliceItems(artifact.sections['Independent Slices'] ?? [], validator.sliceArtifactFormat);
  if (!items.length) {
    validator.addViolation({
      rule_id: 'parallel-ok.independent-slices-has-items',
      artifact: ARTIFACT,
      message:
        'Independent Slices section must list orchestrated slice IDs when Complex execution is approved.',
      remediation: `Add slice IDs Dalton can orchestrate to the Independent Slices section in ${ARTIFACT}.`,
    });
  }
}

function checkConstraints(
  validator: PolicyValidator,
  artifact: WorkspaceArtifact,
): void {
  const content = normalizeText(artifact.sections['Constraints'] ?? []);
  if (!content) {
    validator.addViolation({
      rule_id: 'parallel-ok.constraints-populated',
      artifact: ARTIFACT,
      severity: 'warning',
      message: 'Constraints section is empty when Complex orchestrator execution is approved.',
      remediation: `Add sequencing, shared-file, resource, validation, or coordination constraints (or 'None') to the Constraints section in ${ARTIFACT}.`,
    });
  }
}

async function checkSlicesExist(
  validator: PolicyValidator,
  artifact: WorkspaceArtifact,
): Promise<void> {
  const items = independentSliceItems(artifact.sections['Independent Slices'] ?? [], validator.sliceArtifactFormat);
  if (!items.length) {
    return;
  }

  const stepsDir = validator.implementationStepsDir;
  const format = validator.sliceArtifactFormat;
  const sliceFiles = await listSliceArtifactFiles(stepsDir, format);
  const existingIds = new Set(
    sliceFiles.map((p) => sliceIdFromFilename(p, format)),
  );
  const stepsDirRelative = path.relative(validator.rootDir, stepsDir);

  for (const item of items) {
    const sliceId = normalizeParallelSliceReference(item, format);
    if (sliceId && !existingIds.has(sliceId)) {
      validator.addViolation({
        rule_id: 'parallel-ok.slices-exist',
        artifact: ARTIFACT,
        severity: 'warning',
        message: `Independent Slices references '${sliceId}' but no matching file exists in ${stepsDirRelative}/.`,
        remediation: `Create ${stepsDirRelative}/${sliceId}${describeSliceArtifactFormat(format).extension} or remove it from the Independent Slices list.`,
      });
    }
  }
}

function independentSliceItems(lines: readonly string[], format: 'markdown' | 'xml' = 'markdown'): string[] {
  // When raw bullets exist, use them (format-aware) even if all are rejected —
  // falling back to the free-text regex would re-extract a wrong-format ref as a
  // bare id (the regex strips .md/.xml greedily), silently re-accepting it.
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
  const content = normalizeText(lines);
  const matches = content.match(SLICE_ID_PATTERN) ?? [];
  return [...new Set(matches.map((match) => normalizeParallelSliceReference(match, format)).filter(Boolean))];
}
