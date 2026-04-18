import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPolicyPasses.mockResolvedValue(undefined);
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
