/**
 * Planning-agent scope and lifecycle rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_planning.py
 */

import type { PolicyValidator } from '../validator.js';

export function evaluatePlanningAgentRules(validator: PolicyValidator): void {
  validator.recordRule('runtime.planning-agent-pre-task-only');

  if (validator.mode !== 'runtime') {
    return;
  }

  if (validator.requestedAgentId !== 'planning-agent') {
    return;
  }

  if (validator.hasActiveTask()) {
    validator.addViolation({
      rule_id: 'runtime.planning-agent-pre-task-only',
      artifact: 'handoffs/',
      severity: 'warning',
      message:
        'Planning agent requested while an active task exists. Intake will be queued behind the current task.',
      remediation:
        'This is expected when preparing follow-up work. The intake will be picked up after the active task completes.',
    });
  }
}
