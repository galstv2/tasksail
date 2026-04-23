/**
 * Required task artifact rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_task.py
 */

import { renderHandoffArtifactLabel } from '../../queue/paths.js';
import { toHandoffKey } from '../validator.js';
import type { PolicyValidator } from '../validator.js';

const TASK_RELATIVE_PATH = toHandoffKey('professional-task.md');

export async function evaluateRequiredTaskArtifacts(
  validator: PolicyValidator,
): Promise<void> {
  validator.recordRule('artifact.active-task-metadata');

  if (!validator.hasActiveTask()) {
    return;
  }

  const professional = await validator.getArtifact(TASK_RELATIVE_PATH);
  const taskId = (professional.metadata['Task ID'] ?? '').trim();
  const taskTitle = (professional.metadata['Task Title'] ?? '').trim();

  const artifactLabel = validator.taskId
    ? renderHandoffArtifactLabel(validator.taskId, 'professional-task.md')
    : 'professional-task.md';

  if (!taskId || !taskTitle) {
    validator.addViolation({
      rule_id: 'artifact.active-task-metadata',
      artifact: professional.relativePath,
      message:
        `Active task validation requires \`${artifactLabel}\` to carry both Task ID and Task Title.`,
      remediation:
        `Populate Task Metadata in ${artifactLabel} before relying on workflow-policy checks for an active task.`,
    });
  }
}
