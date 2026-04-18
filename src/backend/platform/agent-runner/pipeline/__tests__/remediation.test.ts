/**
 * §1.5 per-task path isolation test for remediationRunQaLoop.
 *
 * Asserts that when taskId: 't1' is provided, the loop reads/writes
 * AgentWorkSpace/tasks/t1/handoffs/issues.md, NEVER the singleton
 * AgentWorkSpace/handoffs/issues.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runRoleAgent = vi.fn();

vi.mock('../../roleAgent.js', () => ({
  runRoleAgent,
}));

describe('remediationRunQaLoop — §1.5 per-task path isolation', () => {
  let repoRoot: string;
  const TASK_ID = 't1';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'remediation-pipeline-test-'));

    // Minimal .git marker so findRepoRoot resolves correctly
    mkdirSync(path.join(repoRoot, '.git'));

    // Per-task handoffs directory (§1.5 target path)
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', TASK_ID, 'handoffs'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'tasks', TASK_ID, 'ImplementationSteps'), { recursive: true });

    // Singleton handoffs directory — must NOT be written by the loop under §1.5
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'handoffs'), { recursive: true });

    // Templates dir for clearQaFindings helper
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'templates', 'issues.md'),
      '# QA Issues\n\n## Task Metadata\n\n- Task ID: T-1\n\n## Severity\n\n',
      'utf-8',
    );

    // A blocking issues.md at the per-task path — triggers remediation
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TASK_ID, 'handoffs', 'issues.md'),
      '# QA Issues\n\n## Severity\n\nblocking\n\n## Findings\n\n- Must fix X\n',
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('reads issues.md from the per-task path, not the singleton handoffs path', async () => {
    // Dalton succeeds; Ron crashes so the loop throws — letting us inspect state
    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('ron crashed'));

    const { remediationRunQaLoop } = await import('../remediation.js');

    await expect(
      remediationRunQaLoop({
        repoRoot,
        taskId: TASK_ID,
        maxCycles: 1,
      }),
    ).rejects.toThrow('failed during QA revalidation');

    // The per-task issues.md must exist (was read and potentially restored)
    const perTaskIssuesPath = path.join(
      repoRoot, 'AgentWorkSpace', 'tasks', TASK_ID, 'handoffs', 'issues.md',
    );
    expect(existsSync(perTaskIssuesPath)).toBe(true);

    // The singleton handoffs/issues.md must NOT have been written by the loop
    const singletonIssuesPath = path.join(repoRoot, 'AgentWorkSpace', 'handoffs', 'issues.md');
    expect(existsSync(singletonIssuesPath)).toBe(false);
  });

  it('passes taskId through to runRoleAgent for dalton and ron', async () => {
    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('ron crashed'));

    const { remediationRunQaLoop } = await import('../remediation.js');

    await expect(
      remediationRunQaLoop({
        repoRoot,
        taskId: TASK_ID,
        maxCycles: 1,
      }),
    ).rejects.toThrow('failed during QA revalidation');

    expect(runRoleAgent).toHaveBeenCalledTimes(2);
    expect(runRoleAgent.mock.calls[0][0]).toMatchObject({ agentId: 'dalton', taskId: TASK_ID });
    expect(runRoleAgent.mock.calls[1][0]).toMatchObject({ agentId: 'ron', taskId: TASK_ID });
  });

  it('restores prior findings to the per-task path on QA crash', async () => {
    const originalFindings = readFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TASK_ID, 'handoffs', 'issues.md'),
      'utf-8',
    );

    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('ron crashed'));

    const { remediationRunQaLoop } = await import('../remediation.js');

    await expect(
      remediationRunQaLoop({
        repoRoot,
        taskId: TASK_ID,
        maxCycles: 1,
      }),
    ).rejects.toThrow('failed during QA revalidation');

    // Findings are restored to the per-task path after the crash
    const restoredContent = readFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TASK_ID, 'handoffs', 'issues.md'),
      'utf-8',
    );
    expect(restoredContent).toBe(originalFindings);
  });
});
