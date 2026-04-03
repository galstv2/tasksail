/**
 * Boundary and task-ID consistency rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_boundary.py
 */

import { HANDOFF_RELATIVE_PATHS } from '../models.js';
import type { PolicyValidator } from '../validator.js';

export async function evaluateBoundaryRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('boundary.task-id-consistency');
  validator.recordRule('boundary.orphaned-workspace-content');

  const taskIds = validator.taskIdsByArtifact();
  const uniqueTaskIds = [...new Set(Object.values(taskIds))].sort();
  if (uniqueTaskIds.length > 1) {
    const mismatchedFiles = Object.entries(taskIds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, id]) => `${p}=${id}`)
      .join(', ');
    validator.addViolation({
      rule_id: 'boundary.task-id-consistency',
      artifact: 'AgentWorkSpace/handoffs/',
      message: `Active handoff artifacts disagree on Task ID, so repo artifacts no longer describe one authoritative current task. Observed: ${mismatchedFiles}.`,
      remediation:
        'Reset or restamp the inconsistent handoff files so every populated active artifact uses the same Task ID.',
    });
  }

  if (validator.hasActiveTask()) {
    return;
  }

  const orphaned: string[] = [];
  for (const relativePath of HANDOFF_RELATIVE_PATHS) {
    const artifact = await validator.getArtifact(relativePath);
    if (artifact.hasSubstantiveContent) {
      orphaned.push(artifact.relativePath);
    }
  }

  if (orphaned.length > 0) {
    validator.addViolation({
      rule_id: 'boundary.orphaned-workspace-content',
      artifact: 'AgentWorkSpace/handoffs/',
      message: `Downstream handoff content is present even though no active task metadata was detected. Affected artifacts: ${orphaned.join(', ')}.`,
      remediation:
        'Either initialize the active task metadata or reset the orphaned handoff artifacts back to their canonical blank templates.',
    });
  }
}
