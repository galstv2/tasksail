import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const { execFileMock } = vi.hoisted(() => {
  const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
  const mock = vi.fn(
    (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => callback(null, '', ''),
  );

  Object.defineProperty(mock, promisifyCustom, {
    value: (command: string, args: string[], options: unknown) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        mock(command, args, options, (error, stdout = '', stderr = '') => {
          if (error) {
            reject(Object.assign(error, { stdout, stderr }));
            return;
          }
          resolve({ stdout, stderr });
        });
      }),
  });

  return { execFileMock: mock };
});

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import {
  preCommitHook,
  stagedFilesRequireDesktopCssColorGate,
} from '../preCommitHook.js';

describe('preCommitHook CSS color token discipline', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pre-commit-hook-'));
    execFileMock.mockClear();
  });

  afterEach(async () => {
    await fs.promises.rm(repoRoot, { recursive: true, force: true });
  });

  it('only requires the CSS color gate for staged production renderer CSS outside variables.css', () => {
    expect(stagedFilesRequireDesktopCssColorGate([
      'src/frontend/desktop/src/renderer/styles/shell.css',
    ])).toBe(true);

    expect(stagedFilesRequireDesktopCssColorGate([
      'src/frontend/desktop/src/renderer/styles/variables.css',
      'src/frontend/desktop/src/renderer/App.tsx',
      'docs/style.css',
    ])).toBe(false);
  });

  it('runs the focused desktop CSS color gate when a production renderer CSS file is staged', async () => {
    const stagedFile = 'src/frontend/desktop/src/renderer/styles/shell.css';
    await writeRepoFile(stagedFile, '.shell { color: var(--ts-text-primary); }\n');
    mockStagedFiles([stagedFile]);

    const result = await preCommitHook(repoRoot);

    expect(result.passed).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'npm',
      ['run', 'test:css-colors'],
      expect.objectContaining({
        cwd: path.join(repoRoot, 'src', 'frontend', 'desktop'),
        timeout: 120_000,
      }),
      expect.any(Function),
    );
  });

  it('reports CSS color gate failures through the existing pre-commit failure channel', async () => {
    const stagedFile = 'src/frontend/desktop/src/renderer/styles/shell.css';
    await writeRepoFile(stagedFile, '.shell { color: var(--ts-text-primary); }\n');
    mockStagedFiles([stagedFile], new Error('css color gate failed'));

    const result = await preCommitHook(repoRoot);

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain('desktop CSS color token discipline failed');
    expect(result.failures[0]).toContain('css color gate failed');
    expect(result.failures[0]).toContain('literal color found');
  });

  it('reports staged comment discipline failures without reading unstaged content', async () => {
    const stagedFile = 'src/backend/platform/queue/example.ts';
    await writeRepoFile(stagedFile, [
      '// ----------',
      'export const value = 1;',
    ].join('\n'));
    mockStagedFiles(
      [stagedFile],
      undefined,
      [
        'diff --git a/src/backend/platform/queue/example.ts b/src/backend/platform/queue/example.ts',
        'index 1111111..2222222 100644',
        '--- a/src/backend/platform/queue/example.ts',
        '+++ b/src/backend/platform/queue/example.ts',
        '@@ -0,0 +1,2 @@',
        '+// Phase 2: staged label.',
        '+export const value = 2;',
      ].join('\n'),
      new Map([[stagedFile, '// Phase 2: staged label.\nexport const value = 2;\n']]),
    );

    const result = await preCommitHook(repoRoot);

    expect(result.passed).toBe(false);
    expect(result.failures.join('\n')).toContain('comment discipline failed');
    expect(result.failures.join('\n')).toContain('comment.process-reference-label');
    expect(result.failures.join('\n')).toContain('Phase 2: staged label.');
  });

  async function writeRepoFile(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(repoRoot, relativePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content);
  }

  function mockStagedFiles(
    stagedFiles: string[],
    cssGateError?: Error,
    cachedDiff = '',
    stagedBlobs: Map<string, string> = new Map(),
  ): void {
    execFileMock.mockImplementation((
      command: string,
      args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      if (command === 'git' && args[0] === 'diff' && args.includes('--name-only')) {
        callback(null, `${stagedFiles.join('\n')}\n`, '');
        return;
      }

      if (command === 'git' && args[0] === 'diff' && args.includes('--unified=0')) {
        callback(null, cachedDiff, '');
        return;
      }

      if (command === 'git' && args[0] === 'show') {
        const stagedPath = args[1]?.replace(/^:/, '');
        callback(null, stagedBlobs.get(stagedPath ?? '') ?? '', '');
        return;
      }

      if (command === 'npm' && args.join(' ') === 'run test:css-colors') {
        callback(cssGateError ?? null, 'css gate stdout', cssGateError ? 'literal color found' : '');
        return;
      }

      callback(new Error(`unexpected command: ${command} ${args.join(' ')}`));
    });
  }
});
