import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const resolvePaths = vi.fn();
const writeRuntimeWorkflowFacts = vi.fn();
const evaluateWorkflowPolicy = vi.fn();

vi.mock('../../core/index.js', () => ({
  ensureDir: vi.fn(),
  writeTextFile: vi.fn(),
  resolvePaths,
}));

vi.mock('../runtimeFacts.js', () => ({
  computeRuntimeFactsSourceSignature: vi.fn(async ({ repoRoot }: { repoRoot: string }) => `runtime:${repoRoot}`),
  writeRuntimeWorkflowFacts,
}));

vi.mock('../../workflow-policy/index.js', () => ({
  evaluateWorkflowPolicy,
}));

const { runRuntimePolicyCheck } = await import('../guardrails.js');

describe('guardrails runtime policy cache', () => {
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'guardrails-cache-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
    writeFileSync(path.join(repoRoot, '.github', 'agents', 'registry.json'), '{}\n', 'utf-8');
    resolvePaths.mockReturnValue({
      repoRoot,
      handoffs: handoffsDir,
      implementationSteps: implStepsDir,
    });
    writeRuntimeWorkflowFacts.mockResolvedValue({
      schema_version: 1,
      source: 'typescript',
      generated_at: new Date().toISOString(),
      completion: {},
      parallel: { active_approval: false },
      next_agent_id: 'product-manager',
      next_agent_source: 'typescript runtime completion',
    });
    evaluateWorkflowPolicy.mockResolvedValue({
      result: {
        status: 'ok',
        mode: 'runtime',
        phase: 'fail-closed',
        rule_count: 0,
        failure_count: 0,
        warning_count: 0,
        violations: [],
        next_steps: [],
        guardrail: null,
      },
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reuses the prior result when the tracked policy inputs are unchanged', async () => {
    const first = await runRuntimePolicyCheck(repoRoot, 'product-manager');
    const second = await runRuntimePolicyCheck(repoRoot, 'product-manager');

    expect(first).toEqual(second);
    expect(writeRuntimeWorkflowFacts).toHaveBeenCalledTimes(2);
    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(1);
  });

  it('reruns policy when a tracked runtime file changes', async () => {
    await runRuntimePolicyCheck(repoRoot, 'product-manager');
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'role-sessions'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'role-sessions', 'software-engineer.json'),
      '{"session_id": "abc123"}\n',
      'utf-8',
    );

    await runRuntimePolicyCheck(repoRoot, 'product-manager');

    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(2);
  });

  it('ignores legacy testing metadata when computing the policy cache key', async () => {
    await runRuntimePolicyCheck(repoRoot, 'product-manager');
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'guardrails'), { recursive: true });
    mkdirSync(path.join(repoRoot, '.platform-state', 'runtime', 'conventions'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'guardrails', 'testing-skip.json'),
      '{"active": true}\n',
      'utf-8',
    );
    writeFileSync(
      path.join(repoRoot, '.platform-state', 'runtime', 'conventions', 'testing-infrastructure.json'),
      '{"status": "none"}\n',
      'utf-8',
    );

    await runRuntimePolicyCheck(repoRoot, 'product-manager');

    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(1);
  });
});
