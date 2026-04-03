/**
 * Workflow planning rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_workflow.py
 */

import type { PolicyValidator } from '../validator.js';

const IMPLEMENTATION_SPEC_RELATIVE_PATH = 'AgentWorkSpace/handoffs/implementation-spec.md';

export async function evaluateWorkflowPathRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('path.standard-requires-implementation-spec');

  if (validator.mode !== 'lint' && validator.mode !== 'ci') {
    return;
  }

  if (!validator.hasActiveTask()) {
    return;
  }

  const implementationSpec = await validator.getArtifact(IMPLEMENTATION_SPEC_RELATIVE_PATH);
  if (!implementationSpec.hasSubstantiveContent) {
    validator.addViolation({
      rule_id: 'path.standard-requires-implementation-spec',
      artifact: implementationSpec.relativePath,
      message:
        'AgentWorkSpace/handoffs/implementation-spec.md does not contain planning content yet.',
      remediation:
        'Create or complete AgentWorkSpace/handoffs/implementation-spec.md before treating the task as implementation-ready on the standard path.',
    });
  }
}
