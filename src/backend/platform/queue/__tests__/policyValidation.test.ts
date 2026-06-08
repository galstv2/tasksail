import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowPolicyExecutionResult } from '../../workflow-policy/index.js';

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
  resolvePaths: vi.fn(),
  resolvePath: vi.fn(),
  ensurePathWithinDropbox: vi.fn(),
}));

vi.mock('../../workflow-policy/index.js', () => ({
  evaluateWorkflowPolicy: vi.fn(),
}));

import { evaluateWorkflowPolicy } from '../../workflow-policy/index.js';
import { assertPolicyPasses } from '../policyValidation.js';

const mockEvaluateWorkflowPolicy = vi.mocked(evaluateWorkflowPolicy);

describe('policyValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws the caller message with validator details when assertion fails', async () => {
    mockEvaluateWorkflowPolicy.mockResolvedValue({
      result: {
        status: 'blocked',
        mode: 'pre-archive',
        phase: 'fail-closed',
        rule_count: 0,
        failure_count: 1,
        warning_count: 0,
        violations: [],
        next_steps: [],
        guardrail: null,
      },
      stdout: 'stdout details',
      stderr: '',
      exitCode: 1,
    } satisfies WorkflowPolicyExecutionResult);

    await expect(
      assertPolicyPasses({ mode: 'pre-archive', repoRoot: '/fake/repo', taskId: 'task-abc', errorMessage: 'Archive blocked by policy validation.' }),
    ).rejects.toThrow(
      'Archive blocked by policy validation.\nstdout details',
    );
  });

  it('includes stderr details when the evaluator surfaces them', async () => {
    mockEvaluateWorkflowPolicy.mockResolvedValue({
      result: {
        status: 'blocked',
        mode: 'pre-archive',
        phase: 'fail-closed',
        rule_count: 0,
        failure_count: 1,
        warning_count: 0,
        violations: [],
        next_steps: [],
        guardrail: null,
      },
      stdout: 'stdout details',
      stderr: 'stderr details',
      exitCode: 1,
    } satisfies WorkflowPolicyExecutionResult);

    await expect(
      assertPolicyPasses({ mode: 'pre-archive', repoRoot: '/fake/repo', taskId: 'task-abc', errorMessage: 'Archive blocked by policy validation.' }),
    ).rejects.toThrow(
      'Archive blocked by policy validation.\nstdout details\nstderr details',
    );
  });
});
