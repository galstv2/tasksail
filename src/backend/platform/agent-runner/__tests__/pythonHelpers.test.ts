import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/index.js', () => ({
  runPython: vi.fn(),
  resolvePaths: vi.fn(),
  safeJsonParse: vi.fn(),
}));

import { resolvePaths, runPython } from '../../core/index.js';
import { captureCodeDiff } from '../pythonHelpers.js';

const mockedResolvePaths = vi.mocked(resolvePaths);
const mockedRunPython = vi.mocked(runPython);

describe('captureCodeDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolvePaths.mockReturnValue({
      repoRoot: '/repo',
    } as never);
    mockedRunPython.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  });

  it('passes context pack dir as a named flag', async () => {
    await captureCodeDiff({
      contextPackDir: '/packs/pack-a',
      outputPath: '/repo/AgentWorkSpace/handoffs/code-changes.diff',
      repoRoot: '/repo',
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'capture-code-diff',
        '/repo/AgentWorkSpace/handoffs/code-changes.diff',
        '--repo-root',
        '/repo',
        '--context-pack-dir',
        '/packs/pack-a',
      ],
      {
        cwd: '/repo',
        abortSignal: undefined,
      },
    );
  });

  it('omits the context pack flag when none is provided', async () => {
    await captureCodeDiff({
      outputPath: '/repo/AgentWorkSpace/handoffs/code-changes.diff',
      repoRoot: '/repo',
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'capture-code-diff',
        '/repo/AgentWorkSpace/handoffs/code-changes.diff',
        '--repo-root',
        '/repo',
      ],
      {
        cwd: '/repo',
        abortSignal: undefined,
      },
    );
  });
});
