// @vitest-environment node

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
const error = vi.fn();
const showOpenDialog = vi.fn();

vi.mock('../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn, error })),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog },
}));

function createPayload(root: string) {
  const contextPackDir = join(root, 'context-pack');
  const discoveryRoot = join(root, 'repo');
  return {
    contextPackDir,
    discoveryRoot,
    mode: 'monolith' as const,
    seedOnCreate: false,
    bootstrapAnswers: {
      contextPackId: 'test-pack',
      estateName: 'Test Pack',
      primaryFocusAreaIds: ['core'],
      repositories: [
        {
          repoRoot: discoveryRoot,
          repoName: 'Repo',
          repoId: 'repo',
          systemLayer: 'shared' as const,
        },
      ],
      focusableAreas: [
        {
          focusId: 'core',
          focusName: 'Core',
          relativePath: '.',
          path: discoveryRoot,
          focusType: 'service',
        },
      ],
    },
  };
}

describe('context-pack action diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs malformed bootstrap JSON during context-pack creation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-pack-create-diagnostics-'));
    try {
      const payload = createPayload(root);
      // Existing-source monolith create requires the root to be Git-backed for
      // the create-time guard to pass and reach bootstrap.
      await mkdir(join(payload.discoveryRoot, '.git'), { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrapRunner = vi.fn().mockResolvedValue({ stdout: '{not-json', stderr: '' });
      const planRunner = vi.fn();
      const seedRunner = vi.fn();
      const preflightRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ ok: true, errors: [], warnings: [] }),
        stderr: '',
      });

      const result = await executeContextPackCreateAction(
        payload,
        bootstrapRunner,
        planRunner,
        seedRunner,
        preflightRunner,
      );

      expect(result).toEqual(expect.objectContaining({
        ok: false,
        action: 'contextPack.create',
      }));
      expect(warn).toHaveBeenCalledWith(
        'context-pack.create.bootstrap-output.parse.failed',
        expect.objectContaining({
          commandPath: expect.stringContaining('bootstrap-context-pack.py'),
          reason: expect.stringContaining('JSON'),
        }),
      );
      expect(error).toHaveBeenCalledWith(
        'context-pack.create.failed',
        expect.any(Error),
        expect.objectContaining({
          contextPackDir: payload.contextPackDir,
          contextPackParentDir: root,
          discoveryRoot: payload.discoveryRoot,
          contextPackId: 'test-pack',
          repositoryCount: 1,
        }),
      );
      expect(planRunner).not.toHaveBeenCalled();
      expect(seedRunner).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('logs preflight rejection diagnostics during context-pack creation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-pack-create-preflight-diagnostics-'));
    try {
      const payload = createPayload(root);
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrapRunner = vi.fn();
      const planRunner = vi.fn();
      const seedRunner = vi.fn();
      const preflightRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          ok: false,
          errors: [
            {
              code: 'context-pack-parent-not-writable',
              field: 'contextPackDir',
              message: `Parent of contextPackDir is missing or not writable: ${root}`,
              details: { path: payload.contextPackDir, parent: root },
            },
          ],
          warnings: [],
        }),
        stderr: '',
      });

      const result = await executeContextPackCreateAction(
        payload,
        bootstrapRunner,
        planRunner,
        seedRunner,
        preflightRunner,
      );

      expect(result).toEqual(expect.objectContaining({
        ok: false,
        action: 'contextPack.create',
        errorCode: 'preflight-failed',
      }));
      expect(warn).toHaveBeenCalledWith(
        'context-pack.create.preflight.failed',
        expect.objectContaining({
          contextPackDir: payload.contextPackDir,
          contextPackParentDir: root,
          discoveryRoot: payload.discoveryRoot,
          preflightScriptPath: expect.stringContaining('run-pack-preflight.py'),
          errorCount: 1,
          errors: [
            expect.objectContaining({
              code: 'context-pack-parent-not-writable',
              field: 'contextPackDir',
              details: { path: payload.contextPackDir, parent: root },
            }),
          ],
          contextPackDirDiagnostics: expect.objectContaining({
            path: payload.contextPackDir,
            exists: false,
          }),
          contextPackParentDiagnostics: expect.objectContaining({
            path: root,
            exists: true,
            isDirectory: true,
            writable: true,
          }),
          discoveryRootDiagnostics: expect.objectContaining({
            path: payload.discoveryRoot,
            exists: false,
          }),
        }),
      );
      expect(bootstrapRunner).not.toHaveBeenCalled();
      expect(planRunner).not.toHaveBeenCalled();
      expect(seedRunner).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('logs failed context-pack directory picker calls', async () => {
    showOpenDialog.mockRejectedValue(new Error('Dialog failed.'));
    const { pickContextPackDirectoryAction } = await import('./discovery');

    const result = await pickContextPackDirectoryAction({
      purpose: 'context-pack-destination',
      defaultPath: '/tmp/context-packs',
    });

    expect(result).toEqual({
      ok: false,
      action: 'contextPack.pickDirectory',
      error: 'Dialog failed.',
    });
    expect(warn).toHaveBeenCalledWith('context-pack.pick-directory.failed', {
      purpose: 'context-pack-destination',
      reason: 'Dialog failed.',
    });
  });

  it('logs failed context-pack discovery calls', async () => {
    const { executeContextPackDiscoveryAction } = await import('./discovery');
    const runner = vi.fn().mockRejectedValue({
      stderr: 'discovery stderr',
    });

    const result = await executeContextPackDiscoveryAction(
      { rootPath: '/tmp/repo', mode: 'monolith' },
      runner,
    );

    expect(result).toEqual({
      ok: false,
      action: 'contextPack.discoverPrefill',
      error: 'discovery stderr',
    });
    expect(warn).toHaveBeenCalledWith('context-pack.discovery.failed', {
      rootPath: '/tmp/repo',
      mode: 'monolith',
      reason: 'discovery stderr',
    });
  });

  it('logs failed markdown file picker calls', async () => {
    showOpenDialog.mockRejectedValue(new Error('Markdown dialog failed.'));
    const { pickMarkdownFileAction } = await import('./pickMarkdownFile');

    const result = await pickMarkdownFileAction();

    expect(result).toEqual({
      ok: false,
      action: 'planner.pickMarkdownFile',
      error: 'Markdown dialog failed.',
    });
    expect(warn).toHaveBeenCalledWith('planner.pick-markdown-file.failed', {
      reason: 'Markdown dialog failed.',
    });
  });
});
