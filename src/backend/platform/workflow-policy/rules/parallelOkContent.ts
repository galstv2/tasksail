/**
 * Parallel-ok content validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_parallel_ok_content.py
 */

import path from 'node:path';
import { extractBulletItems, normalizeText } from '../matching.js';
import { listSliceFiles, parallelOkHasActiveApproval } from '../artifacts.js';
import type { WorkspaceArtifact } from '../types.js';
import type { PolicyValidator } from '../validator.js';

const ARTIFACT = 'AgentWorkSpace/handoffs/parallel-ok.md';

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

  if (!(await parallelOkHasActiveApproval(validator.rootDir, artifact))) {
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
  const items = extractBulletItems(artifact.sections['Independent Slices'] ?? []);
  if (!items.length) {
    validator.addViolation({
      rule_id: 'parallel-ok.independent-slices-has-items',
      artifact: ARTIFACT,
      message:
        'Independent Slices section must have bullet items when parallelization is approved.',
      remediation: `Add bullet items listing independent slice IDs to the Independent Slices section in ${ARTIFACT}.`,
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
      message: 'Constraints section is empty when parallelization is approved.',
      remediation: `Add resource limits or ordering dependencies (or 'None') to the Constraints section in ${ARTIFACT}.`,
    });
  }
}

async function checkSlicesExist(
  validator: PolicyValidator,
  artifact: WorkspaceArtifact,
): Promise<void> {
  const items = extractBulletItems(artifact.sections['Independent Slices'] ?? []);
  if (!items.length) {
    return;
  }

  const stepsDir = path.join(validator.rootDir, 'AgentWorkSpace', 'ImplementationSteps');
  const sliceFiles = await listSliceFiles(stepsDir);
  const existingIds = new Set(
    sliceFiles.map((p) => path.basename(p, '.md')),
  );

  for (const item of items) {
    const sliceId = item.trim().split(/\s/)[0]?.replace(/^`|`$/g, '') ?? '';
    if (sliceId && !existingIds.has(sliceId)) {
      validator.addViolation({
        rule_id: 'parallel-ok.slices-exist',
        artifact: ARTIFACT,
        severity: 'warning',
        message: `Independent Slices references '${sliceId}' but no matching file exists in AgentWorkSpace/ImplementationSteps/.`,
        remediation: `Create AgentWorkSpace/ImplementationSteps/${sliceId}.md or remove it from the Independent Slices list.`,
      });
    }
  }
}
