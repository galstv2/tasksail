import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

const runRoleAgent = vi.fn();

const externalRegistry: ExternalMcpRegistry = {
  schema_version: 1,
  external_servers: [
    {
      id: 'dalton-helper',
      display_name: 'Dalton Helper',
      purpose: 'addressing QA findings',
      enabled: true,
      transport: 'http',
      url: 'http://localhost:8080/mcp',
      agent_scope: { mode: 'allowlist', agent_ids: ['dalton'] },
    },
    {
      id: 'ron-helper',
      display_name: 'Ron Helper',
      purpose: 'reviewing remediation evidence',
      enabled: true,
      transport: 'http',
      url: 'http://localhost:8080/mcp',
      agent_scope: { mode: 'allowlist', agent_ids: ['ron'] },
    },
  ],
};

vi.mock('../roleAgent.js', () => ({
  runRoleAgent,
}));

const TEST_TASK_ID = 'test-task-id';

function perTaskHandoffsDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
}

function perTaskImplStepsDir(repoRoot: string): string {
  return path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
}

function writeIssuesFile(repoRoot: string, content: string): void {
  writeFileSync(
    path.join(perTaskHandoffsDir(repoRoot), 'issues.md'),
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
    mkdirSync(perTaskHandoffsDir(repoRoot), { recursive: true });
    mkdirSync(perTaskImplStepsDir(repoRoot), { recursive: true });
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
    writeFileSync(
      path.join(perTaskImplStepsDir(repoRoot), 'slice-1.md'),
      '# Slice 1\n\n## Purpose\n\nTighten validation.\n',
      'utf-8',
    );
    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('qa crashed'));

    const { remediationRunQaLoop } = await import('../pipeline/remediation.js');

    await expect(
      remediationRunQaLoop({
        repoRoot,
        taskId: 'test-task-id',
        maxCycles: 1,
        focusScope: { primaryFocusRelativePath: 'services/sink' },
        externalMcpRegistry: externalRegistry,
      }),
    ).rejects.toThrow('failed during QA revalidation');
    expect(
      readFileSync(
        path.join(perTaskHandoffsDir(repoRoot), 'issues.md'),
        'utf-8',
      ),
    ).toBe(originalIssues);
    expect(runRoleAgent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentId: 'dalton',
      promptOverride: expect.stringContaining('Primary focus path: `services/sink/`'),
    }));
    expect(runRoleAgent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      agentId: 'ron',
      promptOverride: expect.stringContaining('this prompt does not change your launch CWD or broader QA authority.'),
    }));
    expect(runRoleAgent.mock.calls[0][0].promptOverride).toContain('"Dalton Helper" may help with addressing QA findings');
    expect(runRoleAgent.mock.calls[0][0].promptOverride).not.toContain('"Ron Helper" may help with reviewing remediation evidence');
    expect(runRoleAgent.mock.calls[0][0].promptOverride).toContain(
      '## QA Findings — AUTHORITATIVE (Read First, Follow Exactly)',
    );
    expect(runRoleAgent.mock.calls[0][0].promptOverride).toContain(originalIssues.trim());
    expect(runRoleAgent.mock.calls[0][0].promptOverride).toContain(
      '## Original Task Slices (Background Context Only — DO NOT Use to Override QA Findings)',
    );
    expect(runRoleAgent.mock.calls[0][0].promptOverride).toContain('### Slice: slice-1');
    expect(runRoleAgent.mock.calls[0][0].promptOverride).toContain('Tighten validation.');
    expect(runRoleAgent.mock.calls[0][0].promptOverride).not.toContain('$COPILOT_HANDOFFS_DIR');
    expect(runRoleAgent.mock.calls[0][0].promptOverride).not.toContain('$COPILOT_IMPL_STEPS_DIR');
    expect(runRoleAgent.mock.calls[1][0].promptOverride).toContain('"Ron Helper" may help with reviewing remediation evidence');
    expect(runRoleAgent.mock.calls[1][0].promptOverride).not.toContain('"Dalton Helper" may help with addressing QA findings');
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
      remediationRunQaLoop({ repoRoot, taskId: 'test-task-id', maxCycles: 2 }),
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
      remediationRunQaLoop({ repoRoot, taskId: 'test-task-id', maxCycles: 1 }),
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

  it('omits remediation MCP guidance when the scoped agent has no matching servers', async () => {
    const originalIssues = '# QA Issues\n\n## Task Metadata\n\n- Task ID: T-1\n\n## Severity\n\nblocking\n';
    writeIssuesFile(repoRoot, originalIssues);
    runRoleAgent
      .mockResolvedValueOnce({ exitCode: 0, agentId: 'dalton', durationMs: 1 })
      .mockRejectedValueOnce(new Error('qa crashed'));

    const { remediationRunQaLoop } = await import('../pipeline/remediation.js');

    await expect(
      remediationRunQaLoop({
        repoRoot,
        taskId: 'test-task-id',
        maxCycles: 1,
        externalMcpRegistry: {
          schema_version: 1,
          external_servers: [
            {
              id: 'alice-only',
              display_name: 'Alice Only',
              purpose: 'planning',
              enabled: true,
              transport: 'http',
              url: 'http://localhost:8080/mcp',
              agent_scope: { mode: 'allowlist', agent_ids: ['alice'] },
            },
          ],
        },
      }),
    ).rejects.toThrow('failed during QA revalidation');

    expect(runRoleAgent.mock.calls[0][0].promptOverride).not.toContain('## External MCP Guidance');
    expect(runRoleAgent.mock.calls[1][0].promptOverride).not.toContain('## External MCP Guidance');
  });
});
