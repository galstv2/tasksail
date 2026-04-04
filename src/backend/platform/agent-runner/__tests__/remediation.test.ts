import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runRoleAgent = vi.fn();

vi.mock('../roleAgent.js', () => ({
  runRoleAgent,
}));

function writeIssuesFile(repoRoot: string, content: string): void {
  writeFileSync(
    path.join(repoRoot, 'AgentWorkSpace', 'handoffs', 'issues.md'),
    content,
    'utf-8',
  );
}

describe('remediationRunQaLoop', () => {
  let repoRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    repoRoot = mkdtempSync(path.join(tmpdir(), 'remediation-test-'));
    mkdirSync(path.join(repoRoot, '.git'));
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'handoffs'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'ImplementationSteps'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'templates'), { recursive: true });
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'templates', 'issues.md'),
      '# QA Issues\n\n## Task Metadata\n\n- Task ID: T-1\n\n## Severity\n\n',
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('fails closed and restores prior findings when QA revalidation crashes', async () => {
    const originalIssues = '# QA Issues\n\n## Task Metadata\n\n- Task ID: T-1\n\n## Severity\n\nblocking\n';
    writeIssuesFile(repoRoot, originalIssues);
    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('qa crashed'));

    const { remediationRunQaLoop } = await import('../pipeline/remediation.js');

    await expect(
      remediationRunQaLoop({
        repoRoot,
        maxCycles: 1,
        primaryFocusRelativePath: 'services/sink',
      }),
    ).rejects.toThrow('failed during QA revalidation');
    expect(
      readFileSync(
        path.join(repoRoot, 'AgentWorkSpace', 'handoffs', 'issues.md'),
        'utf-8',
      ),
    ).toBe(originalIssues);
    expect(runRoleAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentId: 'dalton',
      promptOverride: expect.stringContaining('Primary focus path: `services/sink`'),
    }));
    expect(runRoleAgent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      agentId: 'ron',
      promptOverride: expect.stringContaining('This prompt does not change your launch CWD or broader QA authority.'),
    }));
  });

  it('fails closed when blocking findings remain after max cycles', async () => {
    const blockingIssues = '# QA Issues\n\n## Task Metadata\n\n- Task ID: T-1\n\n## Review Outcome\n\nblocking\n\n## Findings\n\n- Still blocked\n';
    writeIssuesFile(repoRoot, blockingIssues);
    runRoleAgent.mockImplementation(async ({ agentId }: { agentId: string }) => {
      if (agentId === 'ron') {
        writeIssuesFile(repoRoot, blockingIssues);
      }
      return { exitCode: 0, agentId, durationMs: 1 };
    });

    const { remediationRunQaLoop } = await import('../pipeline/remediation.js');

    await expect(
      remediationRunQaLoop({ repoRoot, maxCycles: 2 }),
    ).rejects.toThrow('blocking findings remain');
  });

  it('preserves remediation prompt behavior when no monolith focus path is provided', async () => {
    const originalIssues = '# QA Issues\n\n## Task Metadata\n\n- Task ID: T-1\n\n## Severity\n\nblocking\n';
    writeIssuesFile(repoRoot, originalIssues);
    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('qa crashed'));

    const { remediationRunQaLoop } = await import('../pipeline/remediation.js');

    await expect(
      remediationRunQaLoop({ repoRoot, maxCycles: 1 }),
    ).rejects.toThrow('failed during QA revalidation');
    expect(runRoleAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentId: 'dalton',
      promptOverride: expect.not.stringContaining('## Monolith Focus Scope'),
    }));
    expect(runRoleAgent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      agentId: 'ron',
      promptOverride: expect.not.stringContaining('## Monolith Focus Scope'),
    }));
  });
});
