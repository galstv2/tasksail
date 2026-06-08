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

vi.mock('../openSourceReadiness.js', () => ({
  checkOpenSourceReadiness: vi.fn().mockResolvedValue({
    valid: true,
    errors: [],
    warnings: [],
    summary: {
      repoRoot: '/workspace/tasksail',
      trackedFiles: 0,
      checkedTextFiles: 0,
      assetFiles: [],
      packageFilesChecked: 0,
      pnpmImporters: [],
    },
  }),
}));

vi.mock('../../workflow-policy/contracts/markdownContract.js', () => ({
  validateMarkdownContract: vi.fn(),
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
    expect(result.results.map(r => r.name)).toContain('open-source-readiness');
    expect(runPython).toHaveBeenCalledTimes(2);
    expect(runPython).toHaveBeenCalledWith(
      '-c',
      [expect.stringContaining('validate_markdown_contract')],
      { cwd: repoRoot, timeout: 30_000 },
    );
    expect(runPython).toHaveBeenCalledWith(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'run-targeted-tests.py'),
      [
        '--manifest',
        path.join(repoRoot, 'tests', 'test_manifest.json'),
        '--lane',
        'smoke',
      ],
      {
        cwd: repoRoot,
        env: {
          TASKSAIL_AGENT_REGISTRY_PATH: path.join(repoRoot, '.github', 'agents', 'registry.json'),
        },
        timeout: 300_000,
      },
    );
    const broadPytestCall = vi.mocked(runPython).mock.calls.some(([scriptPath, args]) => {
      return scriptPath === '-m'
        && Array.isArray(args)
        && args[0] === 'pytest'
        && args.includes('tests/');
    });
    expect(broadPytestCall).toBe(false);
  });

  it('isolates desktop test and build logs from the repo production log directory', async () => {
    const repoRoot = path.resolve('/workspace/tasksail');

    await runLocalChecks({
      repoRoot,
      profile: 'contracts',
      changedPath: 'src/frontend/desktop/src/renderer/App.tsx',
    });

    const desktopCalls = execFileMock.mock.calls.filter(([command, args]) => {
      return command === 'npm' && Array.isArray(args);
    });
    expect(desktopCalls).toHaveLength(3);
    expect(desktopCalls.map(([, args]) => args)).toEqual([
      ['run', 'test:css-colors'],
      ['test'],
      ['run', 'build'],
    ]);
    for (const [, , options] of desktopCalls) {
      expect(options).toMatchObject({
        cwd: path.join(repoRoot, 'src', 'frontend', 'desktop'),
        env: expect.objectContaining({
          LOG_DIR: expect.stringContaining('tasksail-local-checks-logs-'),
        }),
      });
      expect((options as { env: NodeJS.ProcessEnv }).env.LOG_DIR).not.toContain(
        path.join(repoRoot, '.platform-state', 'logs'),
      );
    }
  });
});
