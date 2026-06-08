import { formatJson, formatText } from './formatting.js';
import type { PolicyOutputFormat, PolicyResult, PolicyValidationMode } from './types.js';
import { PolicyValidator } from './validator.js';

export interface EvaluateWorkflowPolicyOptions {
  repoRoot: string;
  mode: PolicyValidationMode;
  taskId?: string;
  contextPackDir?: string;
  enforce?: boolean;
  requestedAgentId?: string;
  format?: PolicyOutputFormat;
}

export interface WorkflowPolicyExecutionResult {
  result: PolicyResult;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Evaluate workflow policy directly in TypeScript while preserving the legacy
 * subprocess result shape expected by queue and runtime callers.
 */
export async function evaluateWorkflowPolicy(
  options: EvaluateWorkflowPolicyOptions,
): Promise<WorkflowPolicyExecutionResult> {
  if (options.mode === 'lint' && !options.taskId) {
    const result = repoLevelLintResult();
    const format = options.format ?? 'text';
    return {
      result,
      stdout: format === 'json' ? formatJson(result) : formatText(result),
      stderr: '',
      exitCode: 0,
    };
  }

  const validator = new PolicyValidator({
    rootDir: options.repoRoot,
    mode: options.mode,
    taskId: options.taskId,
    contextPackDir: options.contextPackDir,
    enforce: options.enforce,
    requestedAgentId: options.requestedAgentId,
  });
  const result = await validator.evaluate();
  const format = options.format ?? 'text';

  return {
    result,
    stdout: format === 'json' ? formatJson(result) : formatText(result),
    stderr: '',
    exitCode: validator.enforce && result.failure_count > 0 ? 1 : 0,
  };
}

function repoLevelLintResult(): PolicyResult {
  return {
    status: 'ok',
    mode: 'lint',
    phase: 'report-only',
    rule_count: 0,
    failure_count: 0,
    warning_count: 0,
    violations: [],
    next_steps: ['Repository-level workflow-policy lint completed without task-scoped validation.'],
    guardrail: null,
  };
}
