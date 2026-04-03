import { policyResultToJSON } from './models.js';
import type { PolicyResult } from './types.js';

export function formatText(result: PolicyResult): string {
  const lines = [
    `Workflow policy status: ${result.status}`,
    `Mode: ${result.mode}`,
    `Phase: ${result.phase}`,
    `Rules evaluated: ${result.rule_count}`,
    `Failures: ${result.failure_count}`,
    `Warnings: ${result.warning_count}`,
  ];

  if (result.violations.length > 0) {
    lines.push('Violations:');
    for (const violation of result.violations) {
      lines.push(`- [${violation.severity}] ${violation.rule_id}`);
      lines.push(`  Artifact: ${violation.artifact}`);
      lines.push(`  Message: ${violation.message}`);
      lines.push(`  Remediation: ${violation.remediation}`);
    }
  } else {
    lines.push('Violations: none');
  }

  if (result.guardrail) {
    lines.push('Guardrail:');
    lines.push(`- Status: ${result.guardrail.status}`);
    lines.push(`- Requested agent ID: ${result.guardrail.requested_agent_id || 'none'}`);
    lines.push(`- Expected agent ID: ${result.guardrail.expected_agent_id || 'unknown'}`);
    lines.push(`- Required model: ${result.guardrail.required_model || 'none'}`);
    lines.push(`- Launch seam: ${result.guardrail.launch_seam}`);
  }

  if (result.next_steps.length > 0) {
    lines.push('Next steps:');
    for (const step of result.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join('\n');
}

export function formatJson(result: PolicyResult): string {
  return JSON.stringify(policyResultToJSON(result), null, 2);
}

