/**
 * Parallel-ok content validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_parallel_ok_content.py
 */

import path from 'node:path';
import { extractBulletItems, normalizeText } from '../matching.js';
import { listSliceFiles, parallelOkHasActiveApproval } from '../artifacts.js';
import type { WorkspaceArtifact } from '../types.js';
import { toHandoffKey } from '../validator.js';
import type { PolicyValidator } from '../validator.js';

const ARTIFACT = toHandoffKey('parallel-ok.md');
const SLICE_ID_PATTERN = /\b(?:slice[-_a-zA-Z0-9]*|[a-zA-Z0-9][\w.-]*\.md)\b/g;

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
  const items = independentSliceItems(artifact.sections['Independent Slices'] ?? []);
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
  const items = independentSliceItems(artifact.sections['Independent Slices'] ?? []);
  if (!items.length) {
    return;
  }

  const stepsDir = validator.implementationStepsDir;
  const sliceFiles = await listSliceFiles(stepsDir);
  const existingIds = new Set(
    sliceFiles.map((p) => path.basename(p, '.md')),
  );
  const stepsDirRelative = path.relative(validator.rootDir, stepsDir);

  for (const item of items) {
    const sliceId = item.trim().replace(/\.md$/i, '');
    if (sliceId && !existingIds.has(sliceId)) {
      validator.addViolation({
        rule_id: 'parallel-ok.slices-exist',
        artifact: ARTIFACT,
        severity: 'warning',
        message: `Independent Slices references '${sliceId}' but no matching file exists in ${stepsDirRelative}/.`,
        remediation: `Create ${stepsDirRelative}/${sliceId}.md or remove it from the Independent Slices list.`,
      });
    }
  }
}

function independentSliceItems(lines: readonly string[]): string[] {
  const bulletItems = extractBulletItems(lines)
    .map((item) => item.trim().split(/\s/)[0]?.replace(/^`|`$/g, '').replace(/\.md$/i, '') ?? '')
    .filter(Boolean);
  if (bulletItems.length > 0) {
    return [...new Set(bulletItems)];
  }
  const content = normalizeText(lines);
  const matches = content.match(SLICE_ID_PATTERN) ?? [];
  return [...new Set(matches.map((match) => match.replace(/\.md$/i, '')))];
}
