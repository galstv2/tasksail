// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveProvider } from '../../../backend/platform/cli-provider/index.js';

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
    const { buildContextPackReseedArgs, executeContextPackReseedAction } = await import('./main');

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


  it('lists context packs from approved configured sources', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-packs-'));
    try {
      const configuredPack = join(tempRoot, 'configured-pack');
      const searchRoot = join(tempRoot, 'search-root');
      const discoveredPack = join(searchRoot, 'orders-estate');

      await mkdir(join(configuredPack, 'qmd'), { recursive: true });
      await mkdir(join(discoveredPack, 'qmd'), { recursive: true });
      await writeFile(
        join(configuredPack, 'qmd', 'repo-sources.json'),
        JSON.stringify({
          context_pack_id: 'configured-pack',
          display_name: 'Configured Pack',
          repositories: [
            {
              repo_id: 'orders-api',
              repo_name: 'Orders API',
              repository_type: 'primary',
              service_name: 'orders-api',
            },
          ],
          primary_working_repo_ids: ['orders-api'],
        }),
      );
        await writeFile(
          join(discoveredPack, 'qmd', 'repo-sources.json'),
          JSON.stringify({
            context_pack_id: 'orders-estate',
            display_name: 'Orders Estate',
          repositories: [
            {
              repo_id: 'orders-web',
              repo_name: 'Orders Web',
              repository_type: 'support',
            },
          ],
          }),
        );
        const monolithPack = join(searchRoot, 'monolith-estate');
        await mkdir(join(monolithPack, 'qmd'), { recursive: true });
        await writeFile(
          join(monolithPack, 'qmd', 'repo-sources.json'),
          JSON.stringify({
            context_pack_id: 'monolith-estate',
            display_name: 'Monolith Estate',
            estate_type: 'monolith',
            focusable_areas: [
              {
                focus_id: 'core',
                focus_name: 'Core Module',
                relative_path: 'src/core',
                focus_type: 'service',
                repository_type: 'primary',
              },
            ],
            primary_focus_area_ids: ['core'],
          }),
        );

        const contextPackEnvVars = getActiveProvider(process.cwd()).contextPackEnvVars();
        vi.stubEnv(contextPackEnvVars.paths, configuredPack);
        vi.stubEnv(contextPackEnvVars.searchRoots, searchRoot);
        vi.stubEnv('ACTIVE_CONTEXT_PACK_DIR', configuredPack);

      const { listAvailableContextPacks } = await import('./main');
      const response = await listAvailableContextPacks();

      expect(response.action).toBe('contextPack.list');
      expect(response.contextPacks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            contextPackId: 'configured-pack',
            contextPackDir: configuredPack,
            isActive: true,
            source: 'configured-path',
            primaryWorkingRepoIds: ['orders-api'],
            focusTargets: [
              expect.objectContaining({
                repoId: 'orders-api',
                repositoryType: 'primary',
              }),
            ],
          }),
          expect.objectContaining({
            contextPackId: 'orders-estate',
            contextPackDir: discoveredPack,
            source: 'search-root',
            focusTargets: [
              expect.objectContaining({
                repoId: 'orders-web',
                repositoryType: 'support',
              }),
            ],
          }),
          expect.objectContaining({
            contextPackId: 'monolith-estate',
            contextPackDir: monolithPack,
            source: 'search-root',
            primaryWorkingRepoIds: ['core'],
            focusTargets: [
              expect.objectContaining({
                focusId: 'core',
                kind: 'focus-area',
                repositoryType: 'primary',
              }),
            ],
          }),
        ]),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('adds repo-local default context-pack search roots', async () => {
    const { getDefaultContextPackSearchRoots } = await import('./main');

    expect(
      getDefaultContextPackSearchRoots('/tmp/workspaces/tasksail'),
    ).toEqual([
      '/tmp/workspaces/tasksail/contextpacks',
      '/tmp/workspaces/tasksail/context-packs',
      '/tmp/workspaces/context-packs',
    ]);
  });

  it('builds context-pack workspace args with the required action flag', async () => {
    const { buildContextPackWorkspaceArgs } = await import('./main');

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
    const { buildContextPackWorkspaceArgs } = await import('./main');

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

  it('serializes repo-root deep focus without requiring selectedFocusTargetKind', async () => {
    const { buildContextPackWorkspaceArgs } = await import('./main');

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

  it('assigns repositoryType defaults during discovery prefill normalization', async () => {
    const { executeContextPackDiscoveryAction } = await import('./main');

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
            repositoryType: 'primary',
          }),
          expect.objectContaining({
            repoId: 'orders-web',
            repositoryType: 'support',
          }),
        ],
      }),
    });
  });

  it('derives discovery suggestions from Windows-native root paths', async () => {
    const { executeContextPackDiscoveryAction } = await import('./main');

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
      const contextPackDir = join(tempRoot, 'context-packs', 'mono-pack');
      const discoveryRoot = join(tempRoot, 'brand-new-monolith');
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

      const { executeContextPackCreateAction } = await import('./main');
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
      const contextPackDir = join(tempRoot, 'context-packs', 'orders-estate');
      const discoveryRoot = join(tempRoot, 'orders-estate-root');
      const bootstrapRunner = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          context_pack_id: 'orders-estate',
          display_name: 'Orders Estate',
          discovery_root: discoveryRoot,
          discovery_mode: 'distributed',
          estate_type: 'distributed-platform',
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

      const { executeContextPackCreateAction } = await import('./main');
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
              },
            ],
          },
        },
        bootstrapRunner,
        planRunner,
        seedRunner,
      );

      expect(result).toEqual({
        ok: true,
        response: expect.objectContaining({
          action: 'contextPack.create',
          result: expect.objectContaining({
            contextPackId: 'orders-estate',
            estateType: 'distributed-platform',
            seedStatus: 'success',
            primaryWorkingRepoIds: ['orders-api'],
          }),
        }),
      });
      expect(seedRunner).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('merges configured context-pack search roots with repo-local defaults', async () => {
    const { resolveContextPackSearchRoots } = await import('./main');

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
      '/tmp/workspaces/tasksail/context-packs',
    ]);
  });

  it('surfaces drift and restore metadata from workspace sync state in the catalog', async () => {
    const { deriveContextPackRuntimeState } = await import('./main');

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
        attachedManagedFolders: [],
        missingManagedFolders: [
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
        status: 'active-dirty-workspace',
        restoreAvailable: true,
        driftDetected: true,
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
    const { executeContextPackWorkspaceAction } = await import('./main');

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
              warnings: ['missing docs path'],
              folders_to_add: ['/tmp/context-packs/orders-estate'],
              folders_to_remove: [],
              managed_folders: ['/tmp/context-packs/orders-estate'],
              target_folders: ['/tmp/context-packs/orders-estate'],
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
          warnings: ['missing docs path'],
        }),
      }),
    });
  });

  it('surfaces structured wrapper failures for context-pack workspace actions', async () => {
    const { handleDesktopAction } = await import('./main');

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
    const { handleDesktopAction } = await import('./main');

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
    const { handleDesktopAction } = await import('./main');

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
    const { executeContextPackDiscoveryAction } = await import('./main');

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

  it('updates monolith focus area repository type and primary focus ids together', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-pack-mutation-'));
    const contextPackDir = join(tempRoot, 'monolith-estate');
    const manifestPath = join(contextPackDir, 'qmd', 'repo-sources.json');
    try {
      await mkdir(join(contextPackDir, 'qmd'), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify({
          context_pack_id: 'monolith-estate',
          estate_type: 'monolith',
          focusable_areas: [
            {
              focus_id: 'core',
              focus_name: 'Core',
              repository_type: 'support',
            },
            {
              focus_id: 'docs',
              focus_name: 'Docs',
              repository_type: 'primary',
            },
          ],
          primary_focus_area_ids: ['docs'],
        }),
      );

      const { executeSetRepositoryTypeAction } = await import('./main.contextPack');
      const result = await executeSetRepositoryTypeAction({
        contextPackDir,
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

      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as {
        focusable_areas: Array<{ focus_id: string; repository_type: string }>;
        primary_focus_area_ids: string[];
      };
      expect(manifest.focusable_areas).toEqual([
        expect.objectContaining({ focus_id: 'core', repository_type: 'primary' }),
        expect.objectContaining({ focus_id: 'docs', repository_type: 'primary' }),
      ]);
      expect(manifest.primary_focus_area_ids).toEqual(['core', 'docs']);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('mirrors saved Deep Focus selections into the active workspace sync state', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-deep-focus-sync-'));
    const contextPackDir = join(repoRoot, 'contextpacks', 'orders');

    try {
      vi.resetModules();
      vi.doMock('./paths', () => ({
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

      const { saveDeepFocusSelections } = await import('./main.contextPackActions');
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
      vi.doUnmock('./paths');
      vi.resetModules();
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
