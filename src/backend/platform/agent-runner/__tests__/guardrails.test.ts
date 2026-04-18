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
  computeRuntimeFactsSourceSignature: vi.fn(async ({ repoRoot, taskRuntime }: { repoRoot: string; taskRuntime: string }) => `runtime:${repoRoot}:${taskRuntime}`),
  writeRuntimeWorkflowFacts,
}));

vi.mock('../../workflow-policy/index.js', () => ({
  evaluateWorkflowPolicy,
}));

const { runRuntimePolicyCheck, guardrailReceiptPath } = await import('../guardrails.js');

describe('guardrails runtime policy cache', () => {
  let repoRoot: string;
  let handoffsDir: string;
  let implStepsDir: string;

  function makeTaskRuntime(root: string, taskId?: string): string {
    return taskId
      ? path.join(root, '.platform-state', 'runtime', 'tasks', taskId)
      : path.join(root, '.platform-state', 'runtime');
  }

  function setupResolvePaths(root: string, taskId?: string): void {
    const taskRuntime = makeTaskRuntime(root, taskId);
    resolvePaths.mockImplementation((opts: { repoRoot?: string; taskId?: string } = {}) => {
      const r = opts.repoRoot ?? root;
      const t = opts.taskId;
      const rt = t
        ? path.join(r, '.platform-state', 'runtime', 'tasks', t)
        : path.join(r, '.platform-state', 'runtime');
      return {
        repoRoot: r,
        handoffs: path.join(r, 'AgentWorkSpace', 'handoffs'),
        implementationSteps: path.join(r, 'AgentWorkSpace', 'ImplementationSteps'),
        taskRuntime: rt,
      };
    });
    // Suppress unused variable warnings.
    void taskRuntime;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'guardrails-cache-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    implStepsDir = path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
    writeFileSync(path.join(repoRoot, '.github', 'agents', 'registry.json'), '{}\n', 'utf-8');
    setupResolvePaths(repoRoot);
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
    const first = await runRuntimePolicyCheck(repoRoot, 'alice');
    const second = await runRuntimePolicyCheck(repoRoot, 'alice');

    expect(first).toEqual(second);
    expect(writeRuntimeWorkflowFacts).toHaveBeenCalledTimes(2);
    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(1);
  });

  it('reruns policy when a tracked runtime file changes', async () => {
    await runRuntimePolicyCheck(repoRoot, 'alice');
    const singletonRuntime = makeTaskRuntime(repoRoot);
    mkdirSync(path.join(singletonRuntime, 'role-sessions'), { recursive: true });
    writeFileSync(
      path.join(singletonRuntime, 'role-sessions', 'software-engineer.json'),
      '{"session_id": "abc123"}\n',
      'utf-8',
    );

    await runRuntimePolicyCheck(repoRoot, 'alice');

    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(2);
  });

  it('ignores legacy testing metadata when computing the policy cache key', async () => {
    await runRuntimePolicyCheck(repoRoot, 'alice');
    const singletonRuntime = makeTaskRuntime(repoRoot);
    mkdirSync(path.join(singletonRuntime, 'guardrails'), { recursive: true });
    mkdirSync(path.join(singletonRuntime, 'conventions'), { recursive: true });
    writeFileSync(
      path.join(singletonRuntime, 'guardrails', 'testing-skip.json'),
      '{"active": true}\n',
      'utf-8',
    );
    writeFileSync(
      path.join(singletonRuntime, 'conventions', 'testing-infrastructure.json'),
      '{"status": "none"}\n',
      'utf-8',
    );

    await runRuntimePolicyCheck(repoRoot, 'alice');

    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(1);
  });
});

describe('guardrails per-task receipt isolation', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'guardrails-task-'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'handoffs'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps'), { recursive: true });
    resolvePaths.mockImplementation((opts: { repoRoot?: string; taskId?: string } = {}) => {
      const r = opts.repoRoot ?? repoRoot;
      const t = opts.taskId;
      const rt = t
        ? path.join(r, '.platform-state', 'runtime', 'tasks', t)
        : path.join(r, '.platform-state', 'runtime');
      return {
        repoRoot: r,
        handoffs: path.join(r, 'AgentWorkSpace', 'handoffs'),
        implementationSteps: path.join(r, 'AgentWorkSpace', 'ImplementationSteps'),
        taskRuntime: rt,
      };
    });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('writes receipts under different task runtime dirs for different taskIds', () => {
    const pathA = guardrailReceiptPath(repoRoot, 'alice', 'task-aaa');
    const pathB = guardrailReceiptPath(repoRoot, 'alice', 'task-bbb');

    expect(pathA).toContain(path.join('.platform-state', 'runtime', 'tasks', 'task-aaa', 'guardrails'));
    expect(pathB).toContain(path.join('.platform-state', 'runtime', 'tasks', 'task-bbb', 'guardrails'));
    expect(pathA).not.toBe(pathB);
  });

  it('writes the singleton receipt path when taskId is omitted', () => {
    const pathSingleton = guardrailReceiptPath(repoRoot, 'alice');
    expect(pathSingleton).toContain(path.join('.platform-state', 'runtime', 'guardrails'));
    expect(pathSingleton).not.toContain('tasks');
  });

  it('cache lookup with different taskId returns different entries (runs policy twice)', async () => {
    const mkRegistry = () => {
      mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
      writeFileSync(path.join(repoRoot, '.github', 'agents', 'registry.json'), '{}\n', 'utf-8');
    };
    mkRegistry();
    writeRuntimeWorkflowFacts.mockResolvedValue({});
    evaluateWorkflowPolicy.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 });

    await runRuntimePolicyCheck(repoRoot, 'alice', 'runtime', 'task-aaa');
    await runRuntimePolicyCheck(repoRoot, 'alice', 'runtime', 'task-bbb');

    // Different taskIds → different cache keys → evaluateWorkflowPolicy called once per task
    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(2);
  });

  it('cache hit when same taskId and inputs unchanged', async () => {
    mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
    writeFileSync(path.join(repoRoot, '.github', 'agents', 'registry.json'), '{}\n', 'utf-8');
    writeRuntimeWorkflowFacts.mockResolvedValue({});
    evaluateWorkflowPolicy.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 });

    await runRuntimePolicyCheck(repoRoot, 'alice', 'runtime', 'task-aaa');
    await runRuntimePolicyCheck(repoRoot, 'alice', 'runtime', 'task-aaa');

    // Same taskId and same inputs → cache hit → only one real call
    expect(evaluateWorkflowPolicy).toHaveBeenCalledTimes(1);
  });
});
