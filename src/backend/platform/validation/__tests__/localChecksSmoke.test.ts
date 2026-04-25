import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error?: Error | null) => void,
    ) => {
      callback(new Error('ruff not installed'));
    },
  ),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>(
    '../../core/index.js',
  );
  return {
    ...actual,
    runPython: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  };
});

vi.mock('../structure.js', () => ({
  validateStructure: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

vi.mock('../fileSizes.js', () => ({
  checkFileSizes: vi.fn().mockResolvedValue({ violations: [], warnings: [] }),
}));

vi.mock('../externalMcpCheck.js', () => ({
  checkExternalMcpRegistry: vi.fn().mockResolvedValue({
    valid: true,
    errors: [],
    warnings: [],
  }),
}));

import { runPython } from '../../core/index.js';
import { runLocalChecks } from '../localChecks.js';

describe('runLocalChecks smoke profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the manifest smoke lane instead of broad pytest discovery', async () => {
    const repoRoot = path.resolve('/workspace/tasksail');

    const result = await runLocalChecks({ repoRoot, profile: 'smoke' });

    expect(result.passed).toBe(true);
    expect(runPython).toHaveBeenCalledTimes(1);
    expect(runPython).toHaveBeenCalledWith(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'run-targeted-tests.py'),
      [
        '--manifest',
        path.join(repoRoot, 'tests', 'test_manifest.json'),
        '--lane',
        'smoke',
      ],
      { cwd: repoRoot, timeout: 300_000 },
    );
    const broadPytestCall = vi.mocked(runPython).mock.calls.some(([scriptPath, args]) => {
      return scriptPath === '-m'
        && Array.isArray(args)
        && args[0] === 'pytest'
        && args.includes('tests/');
    });
    expect(broadPytestCall).toBe(false);
  });
});
