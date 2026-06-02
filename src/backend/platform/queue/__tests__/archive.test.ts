import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PythonRunError } from '../../core/types.js';

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn(),
}));

vi.mock('../../core/pythonRunner.js', () => ({
  detectPythonBin: () => 'python3',
  runPython: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
  resolvePaths: vi.fn(),
  resolvePath: vi.fn(),
  ensurePathWithinDropbox: vi.fn(),
}));

import { runPython } from '../../core/pythonRunner.js';
import { assertPolicyPasses } from '../policyValidation.js';
import { fileTaskArchive } from '../archive.js';

const mockRunPython = vi.mocked(runPython);
const mockAssertPolicyPasses = vi.mocked(assertPolicyPasses);

describe('fileTaskArchive', () => {
  const originalTaskId = process.env.TASKSAIL_TASK_ID;
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPolicyPasses.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
    if (originalTaskId === undefined) {
      delete process.env.TASKSAIL_TASK_ID;
    } else {
      process.env.TASKSAIL_TASK_ID = originalTaskId;
    }
  });

  it('normalizes prose retrospective contributions before pre-archive validation', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'archive-retro-normalize-'));
    tempRoots.push(repoRoot);
    const taskId = 'task-abc';
    const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'handoffs');
    const retrospectivePath = path.join(handoffsDir, 'retrospective-input.md');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(retrospectivePath, [
      '# Retrospective Input',
      '',
      "## Ron's Contribution (QA and Closeout)",
      'Ron validated the task.',
      '',
    ].join('\n'), 'utf-8');
    mockRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });
    mockAssertPolicyPasses.mockImplementationOnce(async () => {
      expect(readFileSync(retrospectivePath, 'utf-8')).toContain(
        "## Ron's Contribution (QA and Closeout)\n\n- Ron validated the task.",
      );
    });

    await fileTaskArchive({
      contextPackDir: '/packs/pack-a',
      taskId,
      repoRoot,
    });

    expect(mockAssertPolicyPasses).toHaveBeenCalledTimes(1);
    expect(mockRunPython).toHaveBeenCalledTimes(1);
  });

  it('runs pre-archive validation before invoking the Python archive script', async () => {
    const archiveOutput = { status: 'filed', record_path: '/some/path.json' };
    mockRunPython.mockResolvedValue({
      stdout: JSON.stringify(archiveOutput),
      stderr: '',
      exitCode: 0,
    });

    const result = await fileTaskArchive({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-abc',
      repoRoot: '/fake/repo',
    });

    expect(result.passed).toBe(true);
    expect(result.data).toEqual(archiveOutput);
    expect(mockAssertPolicyPasses).toHaveBeenCalledWith({
      mode: 'pre-archive',
      repoRoot: '/fake/repo',
      taskId: 'task-abc',
      errorMessage: 'Archive filing blocked by workflow policy validation.',
    });
    expect(mockAssertPolicyPasses.mock.invocationCallOrder[0])
      .toBeLessThan(mockRunPython.mock.invocationCallOrder[0]!);

    const [scriptPath, args] = mockRunPython.mock.calls[0]!;
    expect(scriptPath).toContain('file-task-archive.py');
    expect(args).toContain('--context-pack-dir');
    expect(args).toContain('/packs/pack-a');
    expect(args).toContain('--repo-root');
    expect(args).toContain('/fake/repo');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(mockRunPython.mock.calls[0]![2]).toEqual({
      cwd: '/fake/repo',
      timeout: 60_000,
      env: {
        TASKSAIL_CLI_HOME_DIR_NAME: 'copilot-home',
        TASKSAIL_AGENT_REGISTRY_PATH: '/fake/repo/.github/agents/registry.json',
        TASKSAIL_TASK_ID: 'task-abc',
      },
    });
  });

  it('passes archive task id explicitly instead of relying on stale parent env', async () => {
    process.env.TASKSAIL_TASK_ID = 'stale-parent-task';
    mockRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });

    await fileTaskArchive({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-abc',
      repoRoot: '/fake/repo',
    });

    expect(mockRunPython).toHaveBeenCalledWith(
      expect.stringContaining('file-task-archive.py'),
      expect.any(Array),
      expect.objectContaining({
        cwd: '/fake/repo',
        timeout: 60_000,
        env: {
          TASKSAIL_CLI_HOME_DIR_NAME: 'copilot-home',
          TASKSAIL_AGENT_REGISTRY_PATH: '/fake/repo/.github/agents/registry.json',
          TASKSAIL_TASK_ID: 'task-abc',
        },
      }),
    );
  });

  it('passes the active provider registry path into the archive helper', async () => {
    mockRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });

    await fileTaskArchive({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-abc',
      repoRoot: '/fake/repo',
    });

    expect(mockRunPython).toHaveBeenCalledWith(
      expect.stringContaining('file-task-archive.py'),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          TASKSAIL_CLI_HOME_DIR_NAME: 'copilot-home',
          TASKSAIL_AGENT_REGISTRY_PATH: '/fake/repo/.github/agents/registry.json',
          TASKSAIL_TASK_ID: 'task-abc',
        }),
      }),
    );
  });

  it('includes optional --qmd-scope and --resume', async () => {
    mockRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });

    await fileTaskArchive({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-abc',
      repoRoot: '/fake/repo',
      qmdScope: 'custom/scope',
      resume: true,
    });

    const args = mockRunPython.mock.calls[0]![1] as string[];
    expect(args).toContain('--qmd-scope');
    expect(args).toContain('custom/scope');
    expect(args).toContain('--resume');
  });

  it('does not invoke the Python archive script when pre-archive validation fails', async () => {
    mockAssertPolicyPasses.mockRejectedValue(
      new Error('Archive filing blocked by workflow policy validation.\npolicy failed'),
    );

    await expect(
      fileTaskArchive({
        contextPackDir: '/packs/pack-a',
        taskId: 'task-abc',
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('Archive filing blocked by workflow policy validation.');

    expect(mockRunPython).not.toHaveBeenCalled();
  });

  it('returns passed=false on PythonRunError', async () => {
    mockRunPython.mockRejectedValue(
      new PythonRunError('exit 1', { stdout: '', stderr: 'archive failed', exitCode: 1 }),
    );

    const result = await fileTaskArchive({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-abc',
      repoRoot: '/fake/repo',
    });

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('archive failed');
  });
});
