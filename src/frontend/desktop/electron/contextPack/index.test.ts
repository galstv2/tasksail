// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../paths';

const loadURL = vi.fn(async () => undefined);
const loadFile = vi.fn(async () => undefined);
const show = vi.fn();
const once = vi.fn((event: string, callback: () => void) => {
  if (event === 'ready-to-show') {
    callback();
  }
});

const browserWindowInstance = {
  loadFile,
  loadURL,
  once,
  show,
};

const BrowserWindowMock = vi.fn(() => browserWindowInstance) as unknown as {
  (): typeof browserWindowInstance;
  getAllWindows: ReturnType<typeof vi.fn>;
};
BrowserWindowMock.getAllWindows = vi.fn(() => []);

const appMock = {
  on: vi.fn(),
  quit: vi.fn(),
  whenReady: vi.fn(() => new Promise<void>(() => {})),
};

const dialogMock = {
  showOpenDialog: vi.fn(),
};

const ipcMainMock = {
  handle: vi.fn(),
};

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: ipcMainMock,
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

describe('electron main bootstrap — context pack operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    appMock.whenReady.mockReturnValue(new Promise<void>(() => {}));
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('executes reseed through the repo-context seed seam only for approved catalog entries', async () => {
    const { buildContextPackReseedArgs, executeContextPackReseedAction } = await import('../main');

    expect(
      buildContextPackReseedArgs({
        contextPackDir: '/tmp/context-packs/orders-estate',
      }),
    ).toEqual([
      expect.stringContaining('src/backend/scripts/python/repo-context-app.py'),
      'seed',
      '--context-pack-dir',
      '/tmp/context-packs/orders-estate',
      '--format',
      'json',
    ]);

    await expect(
      executeContextPackReseedAction(
        { contextPackDir: '/tmp/context-packs/orders-estate' },
        vi.fn().mockResolvedValue({
          stdout: JSON.stringify({
            overall_status: 'seeded',
            report_path: '/tmp/report.json',
            seeded_repo_count: 2,
            blocked_repo_count: 1,
            conventions_summary: {
              status: 'available',
            },
          }),
          stderr: '',
        }),
        async () => new Set(['/tmp/context-packs/orders-estate']),
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.reseed',
        mode: 'reseeded',
        commandPath: 'src/backend/scripts/python/repo-context-app.py',
        result: expect.objectContaining({
          contextPackDir: '/tmp/context-packs/orders-estate',
          overallStatus: 'seeded',
          seededRepoCount: 2,
          blockedRepoCount: 1,
          conventionsSummaryStatus: 'available',
          conventionsPolicy: 'only-if-missing',
        }),
      }),
    });

    await expect(
      executeContextPackReseedAction(
        { contextPackDir: '/tmp/context-packs/orders-estate' },
        vi.fn(),
        async () => new Set(['/tmp/context-packs/billing-estate']),
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'contextPack.reseed',
      error:
        'Context-pack reseed is limited to approved catalog entries discovered through the desktop shell.',
    });
  });

  it('adds the repo-local default context-pack search root', async () => {
    const { getDefaultContextPackSearchRoots } = await import('../main');

    expect(
      getDefaultContextPackSearchRoots('/tmp/workspaces/tasksail'),
    ).toEqual([
      '/tmp/workspaces/tasksail/contextpacks',
    ]);
  });

  it('builds context-pack workspace args with the required action flag', async () => {
    const { buildContextPackWorkspaceArgs } = await import('../main');

    expect(
      buildContextPackWorkspaceArgs('clear'),
    ).toEqual(['--action', 'clear']);

    expect(
      buildContextPackWorkspaceArgs('apply', {
        contextPackDir: '/tmp/context-packs/orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        selectedFocusIds: ['orders-dashboard'],
      }),
    ).toEqual([
      '--action',
      'apply',
      '--context-pack-dir',
      '/tmp/context-packs/orders-estate',
      '--scope-mode',
      'focused',
      '--selected-repo-id',
      'orders-api',
      '--selected-focus-id',
      'orders-dashboard',
    ]);
  });

  it('serializes deep focus switch args through the workspace wrapper', async () => {
    const { buildContextPackWorkspaceArgs } = await import('../main');

    expect(
      buildContextPackWorkspaceArgs('apply', {
        contextPackDir: '/tmp/context-packs/orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'orders-api',
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src/orders',
        selectedFocusTargetKind: 'directory',
        selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
        selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }),
    ).toEqual([
      '--action',
      'apply',
      '--context-pack-dir',
      '/tmp/context-packs/orders-estate',
      '--scope-mode',
      'focused',
      '--selected-repo-id',
      'orders-api',
      '--deep-focus-enabled',
      '--deep-focus-primary-repo-id',
      'orders-api',
      '--selected-focus-path',
      'src/orders',
      '--selected-focus-target-kind',
      'directory',
      '--selected-test-target',
      '{"path":"tests/orders","kind":"directory"}',
      '--selected-support-target',
      '{"path":"docs/orders.md","kind":"file"}',
    ]);
  });

  it('serializes scoped primary fields for workspace sync with snake-case nested keys', async () => {
    const { buildContextPackWorkspaceArgs } = await import('../main');

    const args = buildContextPackWorkspaceArgs('apply', {
      contextPackDir: '/tmp/context-packs/orders-estate',
      scopeMode: 'focused',
      selectedRepoIds: ['orders-api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders', kind: 'directory' }],
      }],
    });

    const selectedFocusTargetIndex = args.indexOf('--selected-focus-target');
    expect(selectedFocusTargetIndex).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(args[selectedFocusTargetIndex + 1]!)).toEqual({
      path: 'src/orders',
      kind: 'directory',
      role: 'anchor',
      test_target: { path: 'tests/orders', kind: 'directory' },
      support_targets: [{ path: 'docs/orders', kind: 'directory' }],
    });
    expect(args).toContain('--selected-test-target');
    expect(args).toContain('{"path":"tests/orders","kind":"directory"}');
    expect(args).toContain('--selected-support-target');
    expect(args).toContain('{"path":"docs/orders","kind":"directory"}');
  });

  it('serializes repo-root deep focus without requiring selectedFocusTargetKind', async () => {
    const { buildContextPackWorkspaceArgs } = await import('../main');

    expect(
      buildContextPackWorkspaceArgs('apply', {
        contextPackDir: '/tmp/context-packs/orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        deepFocusEnabled: true,
      }),
    ).toEqual([
      '--action',
      'apply',
      '--context-pack-dir',
      '/tmp/context-packs/orders-estate',
      '--scope-mode',
      'focused',
      '--selected-repo-id',
      'orders-api',
      '--deep-focus-enabled',
      '--selected-focus-path',
      '',
    ]);
  });

  it('normalizes discovery repo category fields and preserves older responses without category', async () => {
    const { executeContextPackDiscoveryAction } = await import('../main');

    const result = await executeContextPackDiscoveryAction(
      { rootPath: '/tmp/estate-root', mode: 'distributed' },
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          discovery_mode: 'distributed',
          estate_type: 'distributed',
          warnings: [],
          candidate_repos: [
            {
              repo_id: 'orders-api',
              repo_name: 'Orders API',
              path: '/tmp/estate-root/orders-api',
              relative_path: 'orders-api',
              high_signal_paths: ['src'],
              repo_category: 'service',
              repo_category_confidence: 'high',
              suggested_system_layer: 'backend',
              repository_type: 'primary',
              classification_confidence: 'high',
            },
            {
              repo_id: 'orders-web',
              repo_name: 'Orders Web',
              path: '/tmp/estate-root/orders-web',
              relative_path: 'orders-web',
              high_signal_paths: ['web'],
              repository_type: 'support',
            },
          ],
          candidate_focus_areas: [],
          high_signal_paths: [],
        }),
        stderr: '',
      }),
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.discoverPrefill',
        candidateRepos: [
          expect.objectContaining({
            repoId: 'orders-api',
            repoCategory: 'service',
            repoCategoryConfidence: 'high',
            suggestedSystemLayer: 'backend',
            repositoryType: 'primary',
          }),
          expect.objectContaining({
            repoId: 'orders-web',
            repoCategory: undefined,
            repoCategoryConfidence: undefined,
            suggestedSystemLayer: undefined,
            repositoryType: 'support',
          }),
        ],
      }),
    });
  });

  it('derives discovery suggestions from Windows-native root paths', async () => {
    const { executeContextPackDiscoveryAction } = await import('../main');

    const result = await executeContextPackDiscoveryAction(
      { rootPath: 'C:\\workspace\\orders-estate', mode: 'distributed' },
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          discovery_mode: 'distributed',
          estate_type: 'distributed',
          warnings: [],
          candidate_repos: [],
          candidate_focus_areas: [],
          high_signal_paths: [],
        }),
        stderr: '',
      }),
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        suggestedContextPackId: 'orders-estate',
        suggestedDisplayName: 'Orders Estate',
      }),
    });
  });

  it('skips initial seeding during context-pack creation when seedOnCreate is false', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-pack-create-'));
    try {
      const contextPackDir = join(REPO_ROOT, 'contextpacks', `vitest-mono-pack-${process.pid}`);
      const discoveryRoot = join(tempRoot, 'brand-new-monolith');
      // Existing-source monolith create requires a top-level Git marker.
      await mkdir(join(discoveryRoot, '.git'), { recursive: true });
      const bootstrapRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          context_pack_id: 'mono-pack',
          display_name: 'Mono Pack',
          discovery_root: discoveryRoot,
          discovery_mode: 'monolith',
          estate_type: 'monolith',
          bootstrap_answers_path: join(contextPackDir, 'qmd/bootstrap/bootstrap-answers.json'),
          draft_path: join(contextPackDir, 'qmd/bootstrap/discovery-structure.json'),
          manifest_path: join(contextPackDir, 'qmd/repo-sources.json'),
          repository_count: 1,
          focus_target_count: 1,
          primary_working_repo_ids: [],
          primary_focus_area_ids: ['core-app'],
          warnings: [],
        }),
        stderr: '',
      });
      const planRunner = vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' });
      const seedRunner = vi.fn();
      const preflightRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ ok: true, errors: [], warnings: [] }),
        stderr: '',
      });

      const { executeContextPackCreateAction } = await import('../main');
      const result = await executeContextPackCreateAction(
        {
          contextPackDir,
          discoveryRoot,
          mode: 'monolith',
          seedOnCreate: false,
          bootstrapAnswers: {
            contextPackId: 'mono-pack',
            estateName: 'Mono Pack',
            primaryFocusAreaIds: ['core-app'],
            repositories: [
              {
                repoRoot: discoveryRoot,
                repoName: 'Brand New Monolith',
                repoId: 'brand-new-monolith',
                systemLayer: 'shared',
              },
            ],
            focusableAreas: [
              {
                focusId: 'core-app',
                focusName: 'Core App',
                relativePath: '.',
                path: discoveryRoot,
                focusType: 'service',
              },
            ],
          },
        },
        bootstrapRunner,
        planRunner,
        seedRunner,
        preflightRunner,
      );

      expect(result).toEqual({
        ok: true,
        response: expect.objectContaining({
          action: 'contextPack.create',
          result: expect.objectContaining({
            contextPackId: 'mono-pack',
            estateType: 'monolith',
            seedStatus: 'not-run',
            primaryFocusAreaIds: ['core-app'],
          }),
        }),
      });
      expect(bootstrapRunner).toHaveBeenCalledTimes(1);
      expect(planRunner).toHaveBeenCalledTimes(1);
      expect(seedRunner).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps existing create flow seeding enabled by default', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-pack-seed-'));
    try {
      const contextPackDir = join(REPO_ROOT, 'contextpacks', `vitest-orders-estate-${process.pid}`);
      const discoveryRoot = join(tempRoot, 'orders-estate-root');
      // Existing-source distributed create requires each repo to be Git-backed.
      await mkdir(join(discoveryRoot, 'orders-api', '.git'), { recursive: true });
      const bootstrapRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          context_pack_id: 'orders-estate',
          display_name: 'Orders Estate',
          discovery_root: discoveryRoot,
          discovery_mode: 'distributed',
          estate_type: 'distributed',
          bootstrap_answers_path: join(contextPackDir, 'qmd/bootstrap/bootstrap-answers.json'),
          draft_path: join(contextPackDir, 'qmd/bootstrap/discovery-structure.json'),
          manifest_path: join(contextPackDir, 'qmd/repo-sources.json'),
          repository_count: 1,
          focus_target_count: 1,
          primary_working_repo_ids: ['orders-api'],
          primary_focus_area_ids: [],
          warnings: [],
        }),
        stderr: '',
      });
      const planRunner = vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' });
      const seedRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ overall_status: 'success' }),
        stderr: '',
      });
      const preflightRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ ok: true, errors: [], warnings: [] }),
        stderr: '',
      });

      const { executeContextPackCreateAction } = await import('../main');
      const result = await executeContextPackCreateAction(
        {
          contextPackDir,
          discoveryRoot,
          mode: 'distributed',
          bootstrapAnswers: {
            contextPackId: 'orders-estate',
            estateName: 'Orders Estate',
            repositories: [
              {
                repoRoot: join(discoveryRoot, 'orders-api'),
                repoName: 'Orders API',
                repoId: 'orders-api',
                systemLayer: 'backend',
                repositoryType: 'primary',
                repoCategory: 'service',
                repoCategoryAuthored: false,
              },
            ],
          },
        },
        bootstrapRunner,
        planRunner,
        seedRunner,
        preflightRunner,
      );

      expect(result).toEqual({
        ok: true,
        response: expect.objectContaining({
          action: 'contextPack.create',
          result: expect.objectContaining({
            contextPackId: 'orders-estate',
            estateType: 'distributed',
            seedStatus: 'success',
            primaryWorkingRepoIds: ['orders-api'],
          }),
        }),
      });
      expect(seedRunner).toHaveBeenCalledTimes(1);
      const bootstrapStdin = JSON.parse(
        bootstrapRunner.mock.calls[0]?.[1]?.stdin as string,
      ) as { repositories: Array<Record<string, unknown>> };
      expect(bootstrapStdin.repositories[0]).toEqual(expect.objectContaining({
        repo_category: 'service',
        repo_category_authored: false,
      }));
      // The create bridge must not forward legacy focus fields; focus is owned by
      // the manifest via primary_working_repo_ids.
      expect(bootstrapStdin.repositories[0]).not.toHaveProperty('repository_type');
      expect(bootstrapStdin.repositories[0]).not.toHaveProperty('repo_focus');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects creation before any disk write when preflight returns ok=false', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-pack-preflight-'));
    try {
      const contextPackDir = join(REPO_ROOT, 'contextpacks', `vitest-rejected-pack-${process.pid}`);
      const discoveryRoot = join(tempRoot, 'rejected-pack-root');
      const bootstrapRunner = vi.fn();
      const planRunner = vi.fn();
      const seedRunner = vi.fn();
      const preflightRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          ok: false,
          errors: [
            {
              code: 'path-not-found',
              field: 'bootstrapAnswers.repositories[0].repoRoot',
              message: 'repoRoot does not exist or is not a directory: /no/such/path',
              details: { path: '/no/such/path' },
            },
            {
              code: 'scary-path',
              field: 'contextPackDir',
              message: 'Refusing to create a context pack at a system-critical location.',
              details: { path: contextPackDir, reason: 'shallow /tmp' },
            },
          ],
          warnings: [],
        }),
        stderr: '',
      });

      const { executeContextPackCreateAction } = await import('../main');
      const result = await executeContextPackCreateAction(
        {
          contextPackDir,
          discoveryRoot,
          mode: 'distributed',
          bootstrapAnswers: {
            contextPackId: 'rejected-pack',
            estateName: 'Rejected Pack',
            repositories: [
              {
                repoRoot: '/no/such/path',
                repoName: 'Phantom',
                repoId: 'phantom',
                systemLayer: 'backend',
              },
            ],
          },
        },
        bootstrapRunner,
        planRunner,
        seedRunner,
        preflightRunner,
      );

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errorCode).toBe('preflight-failed');
      expect(result.preflightErrors).toHaveLength(2);
      expect(result.details).toEqual([
        'repoRoot does not exist or is not a directory: /no/such/path',
        'Refusing to create a context pack at a system-critical location.',
      ]);
      expect(bootstrapRunner).not.toHaveBeenCalled();
      expect(planRunner).not.toHaveBeenCalled();
      expect(seedRunner).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('merges configured context-pack search roots with repo-local defaults', async () => {
    const { resolveContextPackSearchRoots } = await import('../main');

    expect(
      resolveContextPackSearchRoots(
        [
          '/tmp/custom-context-packs',
          '/tmp/workspaces/context-packs',
        ],
        '/tmp/workspaces/tasksail',
      ),
    ).toEqual([
      '/tmp/custom-context-packs',
      '/tmp/workspaces/context-packs',
      '/tmp/workspaces/tasksail/contextpacks',
    ]);
  });

  it('surfaces drift and restore metadata from workspace sync state in the catalog', async () => {
    const { deriveContextPackRuntimeState } = await import('../main');

    const state = deriveContextPackRuntimeState(
      '/tmp/context-packs/orders-estate',
      null,
      {
        activeContextPackDir: '/tmp/context-packs/orders-estate',
        activeContextPackId: 'orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: 'src/orders',
        selectedFocusTargetKind: 'directory',
        selectedTestTarget: {
          path: 'tests/orders',
          kind: 'directory',
        },
        selectedSupportTargets: [
          {
            path: 'docs/orders.md',
            kind: 'file',
          },
        ],
        managedFolders: [
          '/tmp/context-packs/orders-estate',
          '/tmp/estate-root/orders-api',
        ],
        status: 'success',
        lastSyncedAt: '2026-03-08T12:00:00Z',
        workspaceFolderCount: null,
        workspaceFileCount: null,
      },
    );

    expect(state).toEqual(
      expect.objectContaining({
        isActive: true,
        status: 'active',
        restoreAvailable: false,
        lastAppliedScopeMode: 'focused',
        lastAppliedSelectedRepoIds: ['orders-api'],
        lastAppliedDeepFocusEnabled: true,
        lastAppliedSelectedFocusPath: 'src/orders',
        lastAppliedSelectedFocusTargetKind: 'directory',
        lastAppliedSelectedTestTarget: {
          path: 'tests/orders',
          kind: 'directory',
        },
        lastAppliedSelectedSupportTargets: [
          {
            path: 'docs/orders.md',
            kind: 'file',
          },
        ],
        lastSyncedAt: '2026-03-08T12:00:00Z',
      }),
    );
  });

  it('parses successful workspace wrapper output into a renderer-safe response', async () => {
    const { executeContextPackWorkspaceAction } = await import('../main');

    await expect(
      executeContextPackWorkspaceAction(
        'contextPack.previewSwitch',
        'preview',
        {
          contextPackDir: '/tmp/context-packs/orders-estate',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api'],
          selectedFocusIds: [],
        },
        async () => ({
          stdout: JSON.stringify({
            ok: true,
            action: 'preview',
            stage: 'complete',
            status: 'success',
            activation: {
              performed: false,
              exit_code: null,
              output: '',
            },
            env_state_cleared: false,
            workspace: {
              context_pack_id: 'orders-estate',
              context_pack_dir: '/tmp/context-packs/orders-estate',
              workspace_file: '/repo/tasksail.code-workspace',
              state_file: '/repo/.platform-state/workspace-context-sync.json',
              scope_mode: 'expanded',
              selected_repo_ids: ['orders-api'],
              selected_focus_ids: ['services-billing'],
              selected_focus_targets: [
                {
                  path: 'src/orders',
                  kind: 'directory',
                  role: 'anchor',
                  repo_local_path: '/repos/orders-api',
                  repo_id: 'orders-api',
                },
                {
                  path: 'src/web',
                  kind: 'directory',
                  role: 'primary',
                  repoLocalPath: '/repos/orders-web',
                  repoId: 'orders-web',
                },
              ],
              warnings: ['missing docs path'],
              folders_to_add: ['/tmp/context-packs/orders-estate'],
              folders_to_remove: [],
              managed_folders: ['/tmp/context-packs/orders-estate'],
              target_folders: ['/tmp/context-packs/orders-estate'],
              derived_writable_roots: [{
                path: 'src/orders',
                kind: 'directory',
                reason: 'selected-primary',
                repo_local_path: '/repos/orders-api',
              }],
            },
          }),
          stderr: '',
        }),
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.previewSwitch',
        mode: 'preview',
        result: expect.objectContaining({
          ok: true,
          contextPackId: 'orders-estate',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api'],
          selectedFocusIds: ['services-billing'],
          selectedFocusTargets: [
            expect.objectContaining({
              path: 'src/orders',
              repoLocalPath: '/repos/orders-api',
              repoId: 'orders-api',
            }),
            expect.objectContaining({
              path: 'src/web',
              repoLocalPath: '/repos/orders-web',
              repoId: 'orders-web',
            }),
          ],
          derivedWritableRoots: [
            expect.objectContaining({
              path: 'src/orders',
              repoLocalPath: '/repos/orders-api',
            }),
          ],
          warnings: ['missing docs path'],
        }),
      }),
    });
  });

  it('surfaces structured wrapper failures for context-pack workspace actions', async () => {
    const { handleDesktopAction } = await import('../main');

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.applySwitch',
          payload: {
            contextPackDir: '/tmp/context-packs/orders-estate',
            scopeMode: 'focused',
            selectedRepoIds: ['orders-api'],
            selectedFocusIds: [],
          },
        },
        {
          applyContextPackSwitch: async () => ({
            ok: false,
            action: 'contextPack.applySwitch',
            error: 'Activation failed.',
            contextPackResult: {
              ok: false,
              wrapperAction: 'apply',
              stage: 'activation',
              status: 'error',
              activation: {
                performed: true,
                exitCode: 1,
                output: 'activation failed',
              },
              envStateCleared: false,
              error: 'Activation failed.',
              contextPackId: null,
              contextPackDir: '/tmp/context-packs/orders-estate',
              workspaceFile: null,
              stateFile: null,
              scopeMode: 'focused',
              selectedRepoIds: ['orders-api'],
              selectedFocusIds: [],
              warnings: [],
              foldersToAdd: [],
              foldersToRemove: [],
              managedFolders: [],
              targetFolders: [],
              lastSyncedAt: null,
              deepFocusEnabled: false,
              deepFocusPrimaryRepoId: null,
              deepFocusPrimaryFocusId: null,
              selectedFocusPath: null,
              selectedFocusTargetKind: null,
              selectedTestTarget: null,
              selectedSupportTargets: [],
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'contextPack.applySwitch',
      error: 'Activation failed.',
      contextPackResult: expect.objectContaining({
        wrapperAction: 'apply',
        stage: 'activation',
        status: 'error',
      }),
    });
  });

  it('contextPack.activate with valid packId calls activation and returns activated response', async () => {
    const { handleDesktopAction } = await import('../main');

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.activate',
          payload: {
            packId: 'test-pack',
            command: 'context-pack:activate',
            mode: 'status-only',
          },
        },
        {
          activateContextPack: async () => ({
            ok: true,
            response: {
              action: 'contextPack.activate',
              mode: 'activated',
              accepted: true,
              message: "Context pack 'test-pack' activated and ACTIVE_CONTEXT_PACK_DIR updated.",
              contextPackDir: '/tmp/context-packs/test-pack',
              contextPackId: 'test-pack',
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.activate',
        mode: 'activated',
        contextPackId: 'test-pack',
        contextPackDir: '/tmp/context-packs/test-pack',
      }),
    });
  });

  it('contextPack.activate with unknown packId returns error', async () => {
    const { handleDesktopAction } = await import('../main');

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.activate',
          payload: {
            packId: 'nonexistent-pack',
            command: 'context-pack:activate',
            mode: 'status-only',
          },
        },
        {
          activateContextPack: async () => ({
            ok: false,
            action: 'contextPack.activate',
            error: 'Unknown context pack: nonexistent-pack. Pack must appear in the catalog before activation.',
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'contextPack.activate',
      error: 'Unknown context pack: nonexistent-pack. Pack must appear in the catalog before activation.',
    });
  });

  it('normalizes discovered monolith focus area repository types', async () => {
    const { executeContextPackDiscoveryAction } = await import('../main');

    const result = await executeContextPackDiscoveryAction(
      { rootPath: '/tmp/estate-root', mode: 'monolith' },
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          discovery_mode: 'monolith',
          estate_type: 'monolith',
          warnings: [],
          candidate_repos: [],
          candidate_focus_areas: [
            {
              focus_id: 'core',
              focus_name: 'Core',
              focus_type: 'service',
              path: '/tmp/estate-root/src/core',
              relative_path: 'src/core',
              repository_type: 'primary',
            },
          ],
          high_signal_paths: [],
        }),
        stderr: '',
      }),
    );

    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.discoverPrefill',
        candidateFocusAreas: [
          expect.objectContaining({
            focusId: 'core',
            repositoryType: 'primary',
          }),
        ],
      }),
    });
  });

  it('delegates repository type update to update-pack-manifest.py and returns ok response', async () => {
    vi.resetModules();
    // Mock node:child_process so the Python subprocess is not actually invoked.
    vi.doMock('node:child_process', () => ({
      execFile: vi.fn((_bin: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: JSON.stringify({ status: 'ok', repo_id: 'core', field: 'repo_focus' }), stderr: '' });
      }),
      spawn: vi.fn(),
    }));

    try {
      const { executeSetRepoFocusAction } = await import('./index');
      const result = await executeSetRepoFocusAction({
        contextPackDir: '/tmp/monolith-estate',
        repoId: 'core',
        repositoryType: 'primary',
      });

      expect(result).toEqual({
        ok: true,
        response: expect.objectContaining({
          action: 'contextPack.setRepositoryType',
          mode: 'updated',
        }),
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('runPythonScriptCommand passes stdin to the child process via spawn', async () => {
    vi.resetModules();

    // Capture what was written to stdin
    let capturedStdin = '';
    const stdinWrite = vi.fn((data: string) => { capturedStdin += data; });
    const stdinEnd = vi.fn();
    const mockChild = {
      stdout: { on: vi.fn((event: string, cb: (d: Buffer) => void) => { if (event === 'data') cb(Buffer.from('{"status":"ok"}')); }) },
      stderr: { on: vi.fn() },
      stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() },
      on: vi.fn((event: string, cb: () => void) => { if (event === 'close') cb(); }),
    };
    vi.doMock('node:child_process', () => ({
      execFile: vi.fn(),
      spawn: vi.fn(() => mockChild),
    }));

    try {
      const { runPythonScriptCommand } = await import('./actions');
      const result = await runPythonScriptCommand(['echo'], { stdin: 'hello-stdin' });
      expect(result.stdout).toBe('{"status":"ok"}');
      expect(stdinWrite).toHaveBeenCalledWith('hello-stdin');
      expect(stdinEnd).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('runPythonScriptCommand rejects non-zero stdin child exits with stderr', async () => {
    vi.resetModules();

    const mockChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn((event: string, cb: (d: Buffer) => void) => { if (event === 'data') cb(Buffer.from('usage: bad mode')); }) },
      stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null, signal: NodeJS.Signals | null) => void) => {
        if (event === 'close') cb(2, null);
      }),
    };
    vi.doMock('node:child_process', () => ({
      execFile: vi.fn(),
      spawn: vi.fn(() => mockChild),
    }));

    try {
      const { runPythonScriptCommand } = await import('./actions');
      await expect(runPythonScriptCommand(['echo'], { stdin: '{}' })).rejects.toMatchObject({
        message: 'usage: bad mode',
        stderr: 'usage: bad mode',
        exitCode: 2,
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('runPythonScriptCommand without options uses execFile (legacy no-stdin path)', async () => {
    vi.resetModules();

    const execFileMock = vi.fn((_bin: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'legacy-output', stderr: '' });
    });
    vi.doMock('node:child_process', () => ({
      execFile: execFileMock,
      spawn: vi.fn(),
    }));

    try {
      const { runPythonScriptCommand } = await import('./actions');
      const result = await runPythonScriptCommand(['echo', 'hi']);
      expect(result.stdout).toBe('legacy-output');
      // spawn must NOT have been called — only execFile for the no-stdin path
      const { spawn } = await import('node:child_process');
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('mirrors saved Deep Focus selections into the active workspace sync state', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-deep-focus-sync-'));
    const contextPackDir = join(repoRoot, 'contextpacks', 'orders');

    try {
      vi.resetModules();
      vi.doMock('../paths', () => ({
        REPO_ROOT: repoRoot,
        DESKTOP_ROOT: join(repoRoot, 'src/frontend/desktop'),
      }));

      await mkdir(join(repoRoot, '.platform-state'), { recursive: true });
      await writeFile(
        join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
        JSON.stringify({
          version: 1,
          workspace_file: join(repoRoot, 'tasksail.code-workspace'),
          active_context_pack_dir: contextPackDir,
          active_context_pack_id: 'orders',
          scope_mode: 'focused',
          selected_repo_ids: ['backend'],
          selected_focus_ids: [],
          deep_focus_enabled: false,
          deep_focus_primary_repo_id: null,
          deep_focus_primary_focus_id: null,
          selected_focus_path: null,
          selected_focus_target_kind: null,
          selected_support_targets: [],
          managed_folders: [],
          last_synced_at: '2026-04-24T07:21:40Z',
          status: 'success',
        }, null, 2) + '\n',
        'utf-8',
      );

      const { saveDeepFocusSelections } = await import('./actions');
      const result = await saveDeepFocusSelections({
        contextPackDir,
        selections: {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'backend',
          deepFocusPrimaryFocusId: null,
          selectedFocusPath: 'services/Orders.Api/Routes.cs',
          selectedFocusTargetKind: 'file',
          selectedTestTarget: {
            path: 'services/Orders.Api.Tests',
            kind: 'directory',
          },
          selectedSupportTargets: [{
            path: 'libs/Orders.Models',
            kind: 'directory',
          }],
        },
      });

      expect(result.ok).toBe(true);
      const persistedSelections = JSON.parse(
        await readFile(join(repoRoot, '.platform-state', 'deep-focus-selections.json'), 'utf-8'),
      ) as Record<string, { derivedWritableRoots?: unknown }>;
      expect(persistedSelections[contextPackDir]).toEqual(expect.objectContaining({
        derivedWritableRoots: [
          {
            path: 'services/Orders.Api',
            kind: 'directory',
            reason: 'primary-focus-parent',
          },
          {
            path: 'services/Orders.Api.Tests',
            kind: 'directory',
            reason: 'test-target',
          },
        ],
      }));
      const state = JSON.parse(
        await readFile(join(repoRoot, '.platform-state', 'workspace-context-sync.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(state).toEqual(expect.objectContaining({
        deep_focus_enabled: true,
        deep_focus_primary_repo_id: 'backend',
        deep_focus_primary_focus_id: null,
        selected_focus_path: 'services/Orders.Api/Routes.cs',
        selected_focus_target_kind: 'file',
        selected_test_target: {
          path: 'services/Orders.Api.Tests',
          kind: 'directory',
        },
        selected_support_targets: [{
          path: 'libs/Orders.Models',
          kind: 'directory',
        }],
        derived_writable_roots: [
          {
            path: 'services/Orders.Api',
            kind: 'directory',
            reason: 'primary-focus-parent',
          },
          {
            path: 'services/Orders.Api.Tests',
            kind: 'directory',
            reason: 'test-target',
          },
        ],
        derived_readonly_context_roots: [{
          path: 'libs/Orders.Models',
          kind: 'directory',
          reason: 'support-target',
        }],
      }));
      expect(state.last_synced_at).toBe('2026-04-24T07:21:40Z');
    } finally {
      vi.doUnmock('../paths');
      vi.resetModules();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('round-trips multi-repo selectedFocusTargets identity through save and workspace-sync mirror', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-deep-focus-multi-repo-'));
    const contextPackDir = join(repoRoot, 'contextpacks', 'platform');

    try {
      vi.resetModules();
      vi.doMock('../paths', () => ({
        REPO_ROOT: repoRoot,
        DESKTOP_ROOT: join(repoRoot, 'src/frontend/desktop'),
      }));

      await mkdir(join(repoRoot, '.platform-state'), { recursive: true });
      await writeFile(
        join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
        JSON.stringify({
          version: 1,
          workspace_file: join(repoRoot, 'tasksail.code-workspace'),
          active_context_pack_dir: contextPackDir,
          active_context_pack_id: 'platform',
          scope_mode: 'focused',
          selected_repo_ids: ['platform', 'tools'],
          selected_focus_ids: [],
          deep_focus_enabled: false,
          deep_focus_primary_repo_id: null,
          deep_focus_primary_focus_id: null,
          selected_focus_path: null,
          selected_focus_target_kind: null,
          selected_support_targets: [],
          managed_folders: [],
          last_synced_at: '2026-05-01T08:00:00Z',
          status: 'success',
        }, null, 2) + '\n',
        'utf-8',
      );

      const { saveDeepFocusSelections } = await import('./actions');
      const result = await saveDeepFocusSelections({
        contextPackDir,
          selections: {
            deepFocusEnabled: true,
            deepFocusPrimaryRepoId: 'platform',
            deepFocusPrimaryFocusId: null,
            selectedFocusPath: 'src/Api',
            selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [
            {
              path: 'src/Api',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/platform',
              repoId: 'platform',
            },
            {
              path: 'src/Cli',
              kind: 'directory',
              role: 'primary',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
            },
          ],
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      });
      expect(result.ok).toBe(true);

      const persistedSelections = JSON.parse(
        await readFile(join(repoRoot, '.platform-state', 'deep-focus-selections.json'), 'utf-8'),
      ) as Record<string, {
        deepFocusPrimaryRepoId?: unknown;
        selectedFocusTargets?: Array<Record<string, unknown>>;
      }>;
      expect(persistedSelections[contextPackDir]?.deepFocusPrimaryRepoId).toBe('platform');
      expect(persistedSelections[contextPackDir]?.selectedFocusTargets).toEqual([
        expect.objectContaining({
          path: 'src/Api',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        }),
        expect.objectContaining({
          path: 'src/Cli',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
        }),
      ]);
      for (const target of persistedSelections[contextPackDir]?.selectedFocusTargets ?? []) {
        expect(target).not.toHaveProperty('repo_local_path');
        expect(target).not.toHaveProperty('repo_id');
      }

      const state = JSON.parse(
        await readFile(join(repoRoot, '.platform-state', 'workspace-context-sync.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(state.deep_focus_primary_repo_id).toBe('platform');
      expect(state.selected_focus_targets).toEqual([
        expect.objectContaining({
          path: 'src/Api',
          kind: 'directory',
          role: 'anchor',
          repo_local_path: '/repos/platform',
          repo_id: 'platform',
        }),
        expect.objectContaining({
          path: 'src/Cli',
          kind: 'directory',
          role: 'primary',
          repo_local_path: '/repos/tools',
          repo_id: 'tools',
        }),
      ]);
      for (const target of state.selected_focus_targets as Array<Record<string, unknown>>) {
        expect(target).not.toHaveProperty('repoLocalPath');
        expect(target).not.toHaveProperty('repoId');
      }
    } finally {
      vi.doUnmock('../paths');
      vi.resetModules();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('round-trips monolith selectedFocusTargets focus identity through save and workspace-sync mirror', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-deep-focus-monolith-'));
    const contextPackDir = join(repoRoot, 'contextpacks', 'monolith');

    try {
      vi.resetModules();
      vi.doMock('../paths', () => ({
        REPO_ROOT: repoRoot,
        DESKTOP_ROOT: join(repoRoot, 'src/frontend/desktop'),
      }));

      await mkdir(join(repoRoot, '.platform-state'), { recursive: true });
      await writeFile(
        join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
        JSON.stringify({
          version: 1,
          workspace_file: join(repoRoot, 'tasksail.code-workspace'),
          active_context_pack_dir: contextPackDir,
          active_context_pack_id: 'monolith',
          scope_mode: 'focused',
          selected_repo_ids: [],
          selected_focus_ids: ['core'],
          deep_focus_enabled: false,
          deep_focus_primary_repo_id: null,
          deep_focus_primary_focus_id: null,
          selected_focus_path: null,
          selected_focus_target_kind: null,
          selected_support_targets: [],
          managed_folders: [],
          last_synced_at: '2026-05-01T09:00:00Z',
          status: 'success',
        }, null, 2) + '\n',
        'utf-8',
      );

      const { saveDeepFocusSelections } = await import('./actions');
      const result = await saveDeepFocusSelections({
        contextPackDir,
        selections: {
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: null,
          deepFocusPrimaryFocusId: 'core',
          selectedFocusPath: 'apps/core',
          selectedFocusTargetKind: 'directory',
          selectedFocusTargets: [
            {
              path: 'apps/core',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/monolith',
              focusId: 'core',
            },
          ],
          selectedTestTarget: undefined,
          selectedSupportTargets: [],
        },
      });
      expect(result.ok).toBe(true);

      const persistedSelections = JSON.parse(
        await readFile(join(repoRoot, '.platform-state', 'deep-focus-selections.json'), 'utf-8'),
      ) as Record<string, {
        deepFocusPrimaryFocusId?: unknown;
        selectedFocusTargets?: Array<Record<string, unknown>>;
      }>;
      expect(persistedSelections[contextPackDir]?.deepFocusPrimaryFocusId).toBe('core');
      expect(persistedSelections[contextPackDir]?.selectedFocusTargets).toEqual([
        expect.objectContaining({
          path: 'apps/core',
          kind: 'directory',
          role: 'anchor',
          repoLocalPath: '/repos/monolith',
          focusId: 'core',
        }),
      ]);
      expect(persistedSelections[contextPackDir]?.selectedFocusTargets?.[0]).not.toHaveProperty('focus_id');

      const state = JSON.parse(
        await readFile(join(repoRoot, '.platform-state', 'workspace-context-sync.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(state.deep_focus_primary_focus_id).toBe('core');
      expect(state.selected_focus_targets).toEqual([
        expect.objectContaining({
          path: 'apps/core',
          kind: 'directory',
          role: 'anchor',
          repo_local_path: '/repos/monolith',
          focus_id: 'core',
        }),
      ]);
      expect((state.selected_focus_targets as Array<Record<string, unknown>>)[0]).not.toHaveProperty('focusId');
    } finally {
      vi.doUnmock('../paths');
      vi.resetModules();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('reads workspace-sync identity fields from snake-case and camelCase state', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-workspace-sync-identities-'));
    const contextPackDir = join(repoRoot, 'contextpacks', 'platform');

    try {
      vi.resetModules();
      vi.doMock('../paths', () => ({
        REPO_ROOT: repoRoot,
        DESKTOP_ROOT: join(repoRoot, 'src/frontend/desktop'),
      }));

      await mkdir(join(repoRoot, '.platform-state'), { recursive: true });
      await writeFile(
        join(repoRoot, '.platform-state', 'workspace-context-sync.json'),
        JSON.stringify({
          active_context_pack_dir: contextPackDir,
          active_context_pack_id: 'platform',
          selected_repo_ids: ['platform'],
          selected_focus_ids: [],
          deep_focus_enabled: true,
          deep_focus_primary_repo_id: 'platform',
          deep_focus_primary_focus_id: null,
          selected_focus_path: 'src/Api',
          selected_focus_target_kind: 'directory',
          selected_focus_targets: [
            {
              path: 'src/Api',
              kind: 'directory',
              role: 'anchor',
              repo_local_path: '/repos/platform',
              repo_id: 'platform',
            },
            {
              path: 'src/Core',
              kind: 'directory',
              role: 'primary',
              repoLocalPath: '/repos/core',
              repoId: 'core',
            },
          ],
          derived_writable_roots: [{
            path: 'src/Api',
            kind: 'directory',
            reason: 'selected-primary',
            repo_local_path: '/repos/platform',
          }],
          selected_support_targets: [],
          managed_folders: [],
          status: 'success',
        }, null, 2) + '\n',
        'utf-8',
      );

      const { readWorkspaceSyncStateSnapshot } = await import('./catalog');
      const snapshot = await readWorkspaceSyncStateSnapshot();

      expect(snapshot.selectedFocusTargets).toEqual([
        expect.objectContaining({
          path: 'src/Api',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
        }),
        expect.objectContaining({
          path: 'src/Core',
          repoLocalPath: '/repos/core',
          repoId: 'core',
        }),
      ]);
      expect(snapshot.derivedWritableRoots).toEqual([
        expect.objectContaining({
          path: 'src/Api',
          repoLocalPath: '/repos/platform',
        }),
      ]);
    } finally {
      vi.doUnmock('../paths');
      vi.resetModules();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
