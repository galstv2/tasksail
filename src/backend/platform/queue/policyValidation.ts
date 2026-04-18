import { findRepoRoot } from '../core/index.js';
import { evaluateWorkflowPolicy } from '../workflow-policy/index.js';

export type PolicyValidationMode =
  | 'runtime'
  | 'lint'
  | 'pre-closeout'
  | 'queue-advance'
  | 'pre-slice'
  | 'pre-archive';

export interface PolicyValidationResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the workflow policy validator in the specified mode.
 * Returns the result without throwing on violations — the caller
 * decides how to handle failures.
 *
 * `taskId` is REQUIRED on this queue-side wrapper — queue policy checks are
 * always task-scoped. Only the core `evaluateWorkflowPolicy` keeps it optional
 * (to support `lint` mode invocations from the CLI where no task is active).
 */
export async function runPolicyValidation(options: {
  mode: PolicyValidationMode;
  taskId: string;
  repoRoot?: string;
  enforce?: boolean;
}): Promise<PolicyValidationResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const result = await evaluateWorkflowPolicy({
    repoRoot,
    mode: options.mode,
    taskId: options.taskId,
    enforce: options.enforce,
    format: 'text',
  });
  return {
    passed: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

/**
 * Options for assertPolicyPasses — queue-side policy assertions are always
 * task-scoped so `taskId` is REQUIRED here.
 */
export interface AssertPolicyPassesOptions {
  mode: PolicyValidationMode;
  repoRoot: string;
  taskId: string; // REQUIRED — queue-side policy checks are always task-scoped
  errorMessage: string;
}

/**
 * Run policy validation in the given mode and throw if it fails.
 * stdout and stderr from the validator are incorporated into the
 * thrown error message rather than written to process streams.
 */
export async function assertPolicyPasses(
  options: AssertPolicyPassesOptions,
): Promise<void> {
  const validation = await runPolicyValidation({
    mode: options.mode,
    taskId: options.taskId,
    repoRoot: options.repoRoot,
  });
  if (!validation.passed) {
    const details = [validation.stdout, validation.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    const suffix = details ? `\n${details}` : '';
    throw new Error(`${options.errorMessage}${suffix}`);
  }
}
