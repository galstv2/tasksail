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

const TEST_TASK_ID = 'task-test-001';

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

  it('passes task id as a named flag', async () => {
    await captureCodeDiff({
      outputPath: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'capture-code-diff',
        '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
        '--repo-root',
        '/repo',
        '--task-id',
        TEST_TASK_ID,
      ],
      {
        cwd: '/repo',
        abortSignal: undefined,
      },
    );
  });

  it('uses the resolved repo root', async () => {
    await captureCodeDiff({
      outputPath: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
      repoRoot: '/repo',
      taskId: TEST_TASK_ID,
    });

    expect(mockedRunPython).toHaveBeenCalledWith(
      '/repo/src/backend/scripts/python/run-role-agent-helper.py',
      [
        'capture-code-diff',
        '/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff',
        '--repo-root',
        '/repo',
        '--task-id',
        TEST_TASK_ID,
      ],
      {
        cwd: '/repo',
        abortSignal: undefined,
      },
    );
  });
});
