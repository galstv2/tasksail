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
 */
export async function runPolicyValidation(options: {
  mode: PolicyValidationMode;
  repoRoot?: string;
  enforce?: boolean;
}): Promise<PolicyValidationResult> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const result = await evaluateWorkflowPolicy({
    repoRoot,
    mode: options.mode,
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
 * Run policy validation in the given mode and throw if it fails.
 * stdout and stderr from the validator are incorporated into the
 * thrown error message rather than written to process streams.
 */
export async function assertPolicyPasses(
  mode: PolicyValidationMode,
  repoRoot: string,
  errorMessage: string,
): Promise<void> {
  const validation = await runPolicyValidation({ mode, repoRoot });
  if (!validation.passed) {
    const details = [validation.stdout, validation.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    const suffix = details ? `\n${details}` : '';
    throw new Error(`${errorMessage}${suffix}`);
  }
}
