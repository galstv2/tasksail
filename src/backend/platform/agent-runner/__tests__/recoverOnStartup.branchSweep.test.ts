import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../pipeline/receipt.js', () => ({
  readLatestPipelineReceipt: vi.fn().mockResolvedValue(null),
  writePipelineReceipt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../queue/errorItems.js', () => ({
  moveFailedItemToErrorItems: vi.fn().mockResolvedValue({
    movedItem: 'x.md',
    errorItemPath: 'error',
    nextActiveItem: null,
  }),
}));

vi.mock('../../queue/resumeCloseout.js', () => ({
  resumeCloseoutFromSentinel: vi.fn().mockResolvedValue({ status: 'no-sentinel', drove: [] }),
}));

import { recoverOnStartup } from '../pipelineSupervisor.js';

describe('recoverOnStartup branch sweep marker re-check', () => {
  let repoRoot: string;

  beforeEach(async () => {
    execFileMock.mockReset();
    repoRoot = await mkdtemp(path.join(tmpdir(), 'tasksail-recover-branch-'));
    await mkdir(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('does not delete a branch whose marker appears after the initial carveout snapshot', async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[], _options: unknown, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (args[0] === 'worktree') return callback(null, { stdout: '', stderr: '' });
      if (args[0] === 'for-each-ref') {
        void writeFile(
          path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items', 'race-task'),
          'race-task.md',
        ).then(() => callback(null, { stdout: 'task/race-task\n', stderr: '' }));
        return;
      }
      if (args[0] === 'branch') return callback(null, { stdout: '', stderr: '' });
      return callback(null, { stdout: '', stderr: '' });
    });

    await recoverOnStartup(repoRoot);

    expect(execFileMock).not.toHaveBeenCalledWith(
      'git',
      ['branch', '-D', '--', 'task/race-task'],
      { cwd: repoRoot },
    );
  });

  it('deletes an orphan branch whose marker remains absent', async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[], _options: unknown, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (args[0] === 'worktree') return callback(null, { stdout: '', stderr: '' });
      if (args[0] === 'for-each-ref') return callback(null, { stdout: 'task/orphan-task\n', stderr: '' });
      if (args[0] === 'branch') return callback(null, { stdout: '', stderr: '' });
      return callback(null, { stdout: '', stderr: '' });
    });

    await recoverOnStartup(repoRoot);

    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['branch', '-D', '--', 'task/orphan-task'],
      { cwd: repoRoot },
      expect.any(Function),
    );
  });
});
