import { describe, it, expect, vi } from 'vitest';

const { execFileMock, fsState } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  fsState: { operationHeadExists: false },
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn((target: string) => (
    target === '/repo'
    || target.endsWith('.git')
    || (target.endsWith('MERGE_HEAD') && fsState.operationHeadExists)
    || target.endsWith('refs/heads/task/test')
  )),
}));

vi.mock('node:child_process', () => ({
  execFile: Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: (_command: string, args: string[], options: unknown) => (
      new Promise((resolve, reject) => {
        execFileMock(_command, args, options, (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            Object.assign(error, { stdout, stderr });
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        });
      })
    ),
  }),
}));

import { stageAutoMergeCloseout } from '../autoMerge.js';

describe('stageAutoMergeCloseout rollback failures', () => {
  it('fails closeout when a failed staged patch cannot be rolled back', async () => {
    fsState.operationHeadExists = false;
    execFileMock.mockImplementation((_command: string, args: string[], _options: unknown, callback: (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void) => {
      const gitArgs = args.slice(2);
      const command = gitArgs.join(' ');
      if (command === 'rev-parse --is-inside-work-tree') {
        callback(null, 'true\n', '');
        return;
      }
      if (command === 'rev-parse --abbrev-ref HEAD') {
        callback(null, 'main\n', '');
        return;
      }
      if (command === 'rev-parse --git-dir') {
        callback(null, '.git\n', '');
        return;
      }
      if (command === 'status --porcelain=v1 --untracked-files=normal') {
        callback(null, '', '');
        return;
      }
      if (command === 'show-ref --verify --quiet refs/heads/task/test') {
        callback(null, '', '');
        return;
      }
      if (command === 'diff --binary base..task/test') {
        callback(null, 'diff --git a/file.txt b/file.txt\n', '');
        return;
      }
      if (command.startsWith('apply --index --3way ')) {
        fsState.operationHeadExists = true;
        const error = new Error('apply failed') as Error & { stderr: string };
        error.stderr = 'CONFLICT';
        callback(error, '', 'CONFLICT');
        return;
      }
      if (command === 'reset --hard HEAD') {
        const error = new Error('reset failed') as Error & { stderr: string };
        error.stderr = 'reset failed';
        callback(error, '', 'reset failed');
        return;
      }
      if (command === 'clean -fd') {
        callback(null, '', '');
        return;
      }
      callback(new Error(`unexpected git command: ${command}`), '', '');
    });

    await expect(stageAutoMergeCloseout({
      enabled: true,
      bindings: [{
        originalRoot: '/repo',
        worktreeRoot: '/worktree',
        worktreeBranch: 'task/test',
        baseCommitSha: 'base',
      }],
    })).rejects.toThrow('Completion blocked: auto-merge staging rollback failed');
  });
});
