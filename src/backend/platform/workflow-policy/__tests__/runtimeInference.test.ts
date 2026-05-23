import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const checkAgentArtifactCompletion = vi.fn();
const detectParallelOk = vi.fn();

vi.mock('../../agent-runner/artifactCompletion.js', () => ({
  checkAgentArtifactCompletion,
  detectParallelOk,
}));

const {
  computeRuntimeCompletionFacts,
  evaluateRuntimeInference,
  inferNextAgentFromCompletion,
} = await import('../runtimeInference.js');

const TEST_TASK_ID = 'task-test-001';

describe('workflow-policy runtimeInference', () => {
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'runtime-inference-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TEST_TASK_ID, 'role-sessions'), { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TEST_TASK_ID, 'guardrails'), { recursive: true });
    detectParallelOk.mockResolvedValue(false);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('computes completion facts through artifactCompletion for every pipeline agent', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);

    const completion = await computeRuntimeCompletionFacts({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(completion).toEqual({
      'product-manager': { completed: true },
      'software-engineer': { completed: false },
      qa: { completed: true },
    });
    expect(checkAgentArtifactCompletion).toHaveBeenCalledTimes(2);
  });

  it('marks software-engineer complete when a runtime role-session receipt shows completed', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TEST_TASK_ID, 'role-sessions', 'software-engineer.json'),
      JSON.stringify({
        terminal: { status: 'completed', exit_code: 0 },
      }),
      'utf-8',
    );

    const completion = await computeRuntimeCompletionFacts({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(completion['software-engineer']).toEqual({ completed: true });
  });

  it('falls back to the SWE guardrail receipt when no role-session receipt exists', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TEST_TASK_ID, 'guardrails', 'software-engineer.json'),
      JSON.stringify({ status: 'passed' }),
      'utf-8',
    );

    const completion = await computeRuntimeCompletionFacts({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(completion['software-engineer']).toEqual({ completed: true });
  });

  it('ignores legacy guardrail_status-only receipts when inferring SWE completion', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'tasks', TEST_TASK_ID, 'guardrails', 'software-engineer.json'),
      JSON.stringify({ guardrail_status: 'internal-bypass' }),
      'utf-8',
    );

    const completion = await computeRuntimeCompletionFacts({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(completion['software-engineer']).toEqual({ completed: false });
  });

  it('preserves issues -> final-summary -> completion precedence', async () => {
    checkAgentArtifactCompletion.mockResolvedValue(true);
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      '# QA Issues\n\n## Severity\n\nblocking\n\n## Remediation Owner Agent ID\n\ndalton\n',
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Summary\n\n## Closeout Owner Agent ID\n\nron\n',
      'utf-8',
    );

    const inference = await evaluateRuntimeInference({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(inference.nextAgent).toEqual({
      agentId: 'software-engineer',
      source: 'qa issues remediation owner',
    });
  });

  it('uses closeout ownership before completion fallback and normalizes aliases', async () => {
    checkAgentArtifactCompletion.mockImplementation(async ({ agentId }: { agentId: string }) => (
      agentId === 'product-manager'
    ));
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Summary\n\n## Closeout Owner Agent ID\n\n<!-- keep -->Ron\n',
      'utf-8',
    );

    const inference = await evaluateRuntimeInference({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(inference.nextAgent).toEqual({
      agentId: 'qa',
      source: 'final-summary closeout owner',
    });
  });

  it('does not resolve comment-only closeout ownership', async () => {
    checkAgentArtifactCompletion.mockImplementation(async ({ agentId }: { agentId: string }) => (
      agentId === 'product-manager'
    ));
    writeFileSync(
      path.join(handoffsDir, 'final-summary.md'),
      '# Summary\n\n## Closeout Owner Agent ID\n\n<!-- keep -->\n',
      'utf-8',
    );

    const inference = await evaluateRuntimeInference({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(inference.nextAgent).toEqual({
      agentId: 'software-engineer',
      source: 'typescript runtime completion',
    });
  });

  it('falls back to completion-derived next agent and carries parallel approval', async () => {
    checkAgentArtifactCompletion.mockImplementation(async ({ agentId }: { agentId: string }) => (
      agentId === 'product-manager'
    ));
    detectParallelOk.mockResolvedValue(true);

    const inference = await evaluateRuntimeInference({ repoRoot, taskId: TEST_TASK_ID, handoffsDir, implStepsDir });

    expect(inference.nextAgent).toEqual({
      agentId: 'software-engineer',
      source: 'typescript runtime completion',
    });
    expect(inference.parallel.active_approval).toBe(true);
  });

  it('selects the first incomplete completion stage', () => {
    expect(inferNextAgentFromCompletion({
      'product-manager': { completed: false },
      'software-engineer': { completed: false },
      qa: { completed: false },
    })).toEqual({
      agentId: 'product-manager',
      source: 'typescript runtime completion',
    });

    expect(inferNextAgentFromCompletion({
      'product-manager': { completed: true },
      'software-engineer': { completed: false },
      qa: { completed: false },
    })).toEqual({
      agentId: 'software-engineer',
      source: 'typescript runtime completion',
    });

    expect(inferNextAgentFromCompletion({
      'product-manager': { completed: true },
      'software-engineer': { completed: true },
      qa: { completed: true },
    })).toEqual({
      agentId: 'qa',
      source: 'typescript runtime completion',
    });
  });
});
