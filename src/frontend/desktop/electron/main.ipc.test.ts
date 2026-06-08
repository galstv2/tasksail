// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PLANNER_FOCUS_FALLBACK_MESSAGE,
  PLANNER_FOCUS_VALID_MESSAGE,
} from './planner/focusValidation';

const SYSTEM_SETTINGS_CONFIG = {
  schema_version: 1,
  cli_provider: 'copilot',
  slice_artifact_format: 'markdown' as const,
  container_runtime: 'direct' as const,
  container_engine_host: 'auto' as const,
  container_engine_wsl_distro: null,
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  auto_merge: false,
  external_mcp_local_enabled: true,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [] as string[],
};

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
  relaunch: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
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

describe('electron main bootstrap — IPC dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('returns typed dry-run responses for approved desktop actions', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction({
        action: 'planner.submitDraft',
        payload: {
          stage: 'preview',
          draft: {
            taskKind: 'standard',
            summary: 'Review the contract.',
            desiredOutcome: 'Renderer can preview desktop actions.',
            constraints: 'Local only',
            acceptanceSignals: 'Dry-run result returns',
            criticalRequirements: 'CR-1: Preserve preview behavior.',
            compatibilityRequirements: 'COMP-1: Keep IPC dry-run compatible.',
            requiredValidation: 'VAL-1: Runtime validation accepts the request.',
            parentTaskId: '',
            parentQmdRecordId: '',
            parentQmdScope: '',
            rootTaskId: '',
            followupReason: '',
            carryForwardSummary: '',
            suggestedPath: 'sequential',
            planningNotes: 'No helper call',
            sourceState: 'active',
          },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.submitDraft',
        mode: 'dry-run',
        accepted: true,
      }),
    });

    await expect(
      handleDesktopAction({
        action: 'queue.readStatus',
      }, {
        submitDraft: vi.fn(),
        submitFollowUp: vi.fn(),
        readQueueStatus: async () => ({
          action: 'queue.readStatus',
          mode: 'observed',
          queueDepth: 1,
          pendingReviewCount: 2,
          activeTaskId: 'CAP-CUSTOM-TERMINAL-06',
          message: 'Observed repo queue state.',
        }),
        readEnvironmentStatus: async () => ({
          action: 'environment.readStatus',
          mode: 'read-only',
          message: 'Desktop packaging guidance is available.',
          platform: 'linux',
          repoRoot: '/repo',
          packageOutputDir: 'src/frontend/desktop/release/linux-unpacked',
          packageArtifactName: 'TaskSail.AppImage',
          packageCommand: 'npm run package:linux',
          hostMode: 'repo-root-native',
          validationSummary: 'Helpers available.',
          launchPolicy: 'Host native.',
          helperStatuses: [],
          contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack',
          contextPackWritePlanHint: 'Use --write-plan.',
          bootstrapFlowHint: 'Use bootstrap flags.',
        }),
        readObservability: vi.fn(),
      }),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'queue.readStatus',
        mode: 'observed',
        queueDepth: expect.any(Number),
      }),
    });

    await expect(
      handleDesktopAction(
        {
          action: 'environment.readStatus',
        },
        {
          submitDraft: vi.fn(),
          submitFollowUp: vi.fn(),
          readQueueStatus: vi.fn(),
          readEnvironmentStatus: async () => ({
            action: 'environment.readStatus',
            mode: 'read-only',
            message: 'Desktop packaging guidance is available.',
            platform: 'linux',
            repoRoot: '/repo',
            packageOutputDir: 'src/frontend/desktop/release/linux-unpacked',
            packageArtifactName: 'TaskSail.AppImage',
            packageCommand: 'npm run package:linux',
            hostMode: 'repo-root-native',
            validationSummary: 'Helpers available.',
            launchPolicy: 'Host native.',
            helperStatuses: [],
            contextPackCommand: 'tsx src/backend/platform/context-pack/cli.ts --context-pack-dir /path/to/context-pack',
            contextPackWritePlanHint: 'Use --write-plan.',
            bootstrapFlowHint: 'Use bootstrap flags.',
          }),
          readObservability: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'environment.readStatus',
        packageCommand: 'npm run package:linux',
        hostMode: 'repo-root-native',
      }),
    });

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.reseed',
          payload: {
            contextPackDir: '/tmp/context-packs/orders-estate',
          },
        },
        {
          submitDraft: vi.fn(),
          submitFollowUp: vi.fn(),
          readQueueStatus: vi.fn(),
          readEnvironmentStatus: vi.fn(),
          readObservability: vi.fn(),
          listContextPacks: vi.fn(),
          reseedContextPack: async () => ({
            ok: true,
            response: {
              action: 'contextPack.reseed',
              mode: 'reseeded',
              message: 'Reseeded.',
              commandPath: 'src/backend/scripts/python/repo-context-app.py',
              result: {
                contextPackDir: '/tmp/context-packs/orders-estate',
                overallStatus: 'seeded',
                reportPath: '/tmp/report.json',
                seededRepoCount: 2,
                blockedRepoCount: 0,
                conventionsSummaryStatus: 'available',
                conventionsPolicy: 'only-if-missing',
                workspaceFolderCount: null,
                workspaceFileCount: null,
              },
            },
          }),
          previewContextPackSwitch: vi.fn(),
          applyContextPackSwitch: vi.fn(),
          clearActiveContextPack: vi.fn(),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.reseed',
        mode: 'reseeded',
      }),
    });
  });

  it('returns typed responses for context-pack creation actions', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.pickDirectory',
          payload: {
            purpose: 'discovery-root',
            defaultPath: '/tmp/workspaces',
          },
        },
        {
          pickContextPackDirectory: async () => ({
            ok: true,
            response: {
              action: 'contextPack.pickDirectory',
              mode: 'selected',
              message: 'Selected.',
              purpose: 'discovery-root',
              selectedPath: '/tmp/workspaces/orders',
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.pickDirectory',
        mode: 'selected',
      }),
    });

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.discoverPrefill',
          payload: {
            rootPath: '/tmp/estate-root',
            mode: 'distributed',
          },
        },
        {
          discoverContextPackPrefill: async () => ({
            ok: true,
            response: {
              action: 'contextPack.discoverPrefill',
              mode: 'discovered',
              message: 'Discovered.',
              rootPath: '/tmp/estate-root',
              discoveryMode: 'distributed',
              estateType: 'distributed',
              suggestedContextPackId: 'orders-estate',
              suggestedDisplayName: 'Orders Estate',
              warnings: [],
              candidateRepos: [],
              candidateFocusAreas: [],
              highSignalPaths: [],
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.discoverPrefill',
        estateType: 'distributed',
      }),
    });

    await expect(
      handleDesktopAction(
        {
          action: 'contextPack.create',
          payload: {
            contextPackDir: '/tmp/context-packs/orders-estate',
            discoveryRoot: '/tmp/estate-root',
            mode: 'distributed',
            bootstrapAnswers: {
              contextPackId: 'orders-estate',
              estateName: 'Orders Estate',
              repositories: [
                {
                  repoRoot: '/tmp/estate-root/orders-api',
                  repoName: 'Orders API',
                  systemLayer: 'backend',
                },
              ],
            },
          },
        },
        {
          createContextPack: async () => ({
            ok: true,
            response: {
              action: 'contextPack.create',
              mode: 'created',
              message: 'Created.',
              commandPath: 'src/backend/scripts/python/bootstrap-context-pack.py',
              result: {
                contextPackId: 'orders-estate',
                displayName: 'Orders Estate',
                contextPackDir: '/tmp/context-packs/orders-estate',
                discoveryRoot: '/tmp/estate-root',
                discoveryMode: 'distributed',
                estateType: 'distributed-platform',
                defaultScopeMode: 'focused',
                bootstrapAnswersPath: '/tmp/context-packs/orders-estate/qmd/bootstrap/bootstrap-answers.json',
                discoveryDraftPath: '/tmp/context-packs/orders-estate/qmd/bootstrap/discovery-structure.json',
                manifestPath: '/tmp/context-packs/orders-estate/qmd/repo-sources.json',
                planPath: '/tmp/context-packs/orders-estate/qmd/bootstrap/seed-plan.json',
                repositoryCount: 1,
                focusTargetCount: 1,
                primaryWorkingRepoIds: ['orders-api'],
                primaryFocusAreaIds: [],
                seedStatus: 'success',
                warnings: [],
              },
            },
          }),
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.create',
        mode: 'created',
      }),
    });
  });

  it('routes planner.startSession through the injected planner handler', async () => {
    const { handleDesktopAction } = await import('./main');
    const startPlannerSession = vi.fn(async () => ({ sessionId: 'planner-broker-1', created: true }));

    await expect(
      handleDesktopAction(
        {
          action: 'planner.startSession',
        },
        {
          startPlannerSession,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: {
        action: 'planner.startSession',
        mode: 'started',
        accepted: true,
        message: 'Planner session started.',
        sessionId: 'planner-broker-1',
        brokerStatus: 'idle',
      },
    });

    expect(startPlannerSession).toHaveBeenCalledTimes(1);
  });

  it('returns planner.startSession handler errors instead of throwing', async () => {
    const { handleDesktopAction } = await import('./main');

    await expect(
      handleDesktopAction(
        { action: 'planner.startSession' },
        {
          startPlannerSession: vi.fn(async () => {
            throw new Error('Lily reasoning effort "max" is not advertised by the installed Copilot CLI.');
          }),
        },
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'planner.startSession',
      error: 'Lily reasoning effort "max" is not advertised by the installed Copilot CLI.',
    });
  });

  it('routes agentConfig.loadCapabilities through the injected handler', async () => {
    const { handleDesktopAction } = await import('./main');
    const loadAgentConfigCapabilities = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'agentConfig.loadCapabilities' as const,
        mode: 'read-only' as const,
        message: 'Loaded 2 reasoning effort option(s).',
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['low', 'high'],
        stale: false,
      },
    }));

    await expect(
      handleDesktopAction(
        { action: 'agentConfig.loadCapabilities' },
        { loadAgentConfigCapabilities },
      ),
    ).resolves.toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'agentConfig.loadCapabilities',
        effortChoices: ['low', 'high'],
      }),
    });
    expect(loadAgentConfigCapabilities).toHaveBeenCalledTimes(1);
  });

  it('routes planner.sendMessage through the injected broker handler', async () => {
    const { handleDesktopAction } = await import('./main');
    const sendPlannerMessage = vi.fn(async () => 'sent' as const);

    await expect(
      handleDesktopAction(
        {
          action: 'planner.sendMessage',
          payload: {
            text: 'Hello planner',
          },
        },
        {
          sendPlannerMessage,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      response: {
        action: 'planner.sendMessage',
        mode: 'sent',
        accepted: true,
        message: 'Message sent to planner session.',
      },
    });

    expect(sendPlannerMessage).toHaveBeenCalledWith('Hello planner', undefined);
  });

  it('accepts repeated planner.sendMessage requests while broker-owned serialization is in effect', async () => {
    const { handleDesktopAction } = await import('./main');
    let activeSends = 0;
    let maxConcurrent = 0;
    let queue = Promise.resolve();
    const sendPlannerMessage = vi.fn(async (_text: string) => {
      const result = queue.then(async () => {
        activeSends += 1;
        maxConcurrent = Math.max(maxConcurrent, activeSends);
        await Promise.resolve();
        activeSends -= 1;
        return 'sent' as const;
      });
      queue = result.then(() => undefined);
      return result;
    });

    const firstResult = handleDesktopAction(
      {
        action: 'planner.sendMessage',
        payload: { text: 'First planner message' },
      },
      {
        sendPlannerMessage,
      },
    );

    const secondResult = handleDesktopAction(
      {
        action: 'planner.sendMessage',
        payload: { text: 'Second planner message' },
      },
      {
        sendPlannerMessage,
      },
    );

    await expect(firstResult).resolves.toEqual({
      ok: true,
      response: {
        action: 'planner.sendMessage',
        mode: 'sent',
        accepted: true,
        message: 'Message sent to planner session.',
      },
    });
    await expect(secondResult).resolves.toEqual({
      ok: true,
      response: {
        action: 'planner.sendMessage',
        mode: 'sent',
        accepted: true,
        message: 'Message sent to planner session.',
      },
    });

    expect(sendPlannerMessage).toHaveBeenNthCalledWith(1, 'First planner message', undefined);
    expect(sendPlannerMessage).toHaveBeenNthCalledWith(2, 'Second planner message', undefined);
    expect(maxConcurrent).toBe(1);
  });

  describe('planner.validateChildTaskFocus', () => {
    function buildPayload() {
      return {
        contextPackDir: '/tmp/context-packs/orders-estate',
        snapshot: {
          version: 1 as const,
          contextPackDir: '/tmp/context-packs/orders-estate',
          contextPackId: 'orders-estate',
          title: 'Parent task',
          primaryRepoId: 'platform',
          primaryRepoRoot: '/tmp/repo',
          primaryFocusRelativePath: 'src/planner',
          primaryFocusTargetKind: 'directory' as const,
          primaryFocusTargets: [{
            path: 'src/planner',
            kind: 'directory' as const,
            repoId: 'platform',
            focusId: 'planner',
            role: 'anchor' as const,
          }],
          selectedTestTarget: { path: 'tests/planner.test.ts', kind: 'file' as const },
          supportTargets: [],
          deepFocusEnabled: true,
          contextPackBinding: {
            contextPackDir: '/tmp/context-packs/orders-estate',
            contextPackId: 'orders-estate',
            scopeMode: 'selected' as const,
            selectedRepoIds: ['platform'],
            selectedFocusIds: ['planner'],
            deepFocusEnabled: true,
            selectedFocusPath: 'src/planner',
            selectedFocusTargetKind: 'directory' as const,
            selectedFocusTargets: [{
              path: 'src/planner',
              kind: 'directory' as const,
              repoId: 'platform',
              focusId: 'planner',
              role: 'anchor' as const,
            }],
            selectedTestTarget: { path: 'tests/planner.test.ts', kind: 'file' as const },
            selectedSupportTargets: [],
          },
        },
      };
    }

    it('returns mode: valid with the exact valid message text when no issues exist', async () => {
      const { handleDesktopAction } = await import('./main');
      const validateChildTaskFocus = vi.fn(async () => []);

      await expect(
        handleDesktopAction(
          { action: 'planner.validateChildTaskFocus', payload: buildPayload() },
          { validateChildTaskFocus },
        ),
      ).resolves.toEqual({
        ok: true,
        response: {
          action: 'planner.validateChildTaskFocus',
          mode: 'valid',
          message: PLANNER_FOCUS_VALID_MESSAGE,
          issues: [],
        },
      });
    });

    it('returns mode: fallback with the exact fallback message text when issues exist', async () => {
      const { handleDesktopAction } = await import('./main');
      const validateChildTaskFocus = vi.fn(async () => [
        { code: 'context-pack-mismatch' as const, label: 'Context pack directory', path: '/tmp/old' },
      ]);

      const result = await handleDesktopAction(
        { action: 'planner.validateChildTaskFocus', payload: buildPayload() },
        { validateChildTaskFocus },
      );

      expect(result).toEqual({
        ok: true,
        response: expect.objectContaining({
          action: 'planner.validateChildTaskFocus',
          mode: 'fallback',
          message: PLANNER_FOCUS_FALLBACK_MESSAGE,
        }),
      });
    });

    it('includes issue details in the fallback response', async () => {
      const { handleDesktopAction } = await import('./main');
      const validateChildTaskFocus = vi.fn(async () => [
        { code: 'primary-focus-path-missing' as const, label: 'Primary focus path', path: '/tmp/repo/src/missing' },
        { code: 'selected-repo-id-missing' as const, label: 'Selected repo ID', id: 'missing-repo' },
      ]);

      const result = await handleDesktopAction(
        { action: 'planner.validateChildTaskFocus', payload: buildPayload() },
        { validateChildTaskFocus },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.response).toMatchObject({
        action: 'planner.validateChildTaskFocus',
        mode: 'fallback',
        issues: [
          { code: 'primary-focus-path-missing', label: 'Primary focus path', path: '/tmp/repo/src/missing' },
          { code: 'selected-repo-id-missing', label: 'Selected repo ID', id: 'missing-repo' },
        ],
      });
    });

    it('rejects malformed payloads at the IPC boundary', async () => {
      const { handleDesktopAction } = await import('./main');
      const validateChildTaskFocus = vi.fn(async () => []);

      const result = await handleDesktopAction(
        // Missing snapshot field -> request validator should reject before the handler runs.
        { action: 'planner.validateChildTaskFocus', payload: { contextPackDir: '/tmp/context-packs/orders-estate' } },
        { validateChildTaskFocus },
      );

      expect(result.ok).toBe(false);
      expect(validateChildTaskFocus).not.toHaveBeenCalled();
    });

    it('returns a non-success envelope when validateChildTaskFocusSnapshot throws', async () => {
      const { handleDesktopAction } = await import('./main');
      const validateChildTaskFocus = vi.fn(async () => {
        throw new Error('validator boom');
      });

      const result = await handleDesktopAction(
        { action: 'planner.validateChildTaskFocus', payload: buildPayload() },
        { validateChildTaskFocus },
      );

      expect(result).toEqual({
        ok: false,
        action: 'planner.validateChildTaskFocus',
        error: 'validator boom',
      });
    });
  });

  it('dispatches systemSettings.read and systemSettings.save to injected handlers', async () => {
    const { handleDesktopAction } = await import('./main');

    const readSystemSettings = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'systemSettings.read' as const,
        mode: 'read-only' as const,
        message: 'Loaded platform settings.',
        defaultConfigPath: '/repo/config/platform.default.json',
        runtimeConfigPath: '/repo/.platform-state/platform.json',
        defaultFileHash: 'h1',
        runtimeFileHash: 'rt1',
        config: SYSTEM_SETTINGS_CONFIG,
        runtimeConfig: SYSTEM_SETTINGS_CONFIG,
        runtimeStatus: 'valid' as const,
        runtimeWarning: null,
        tasksActive: false,
        envOverrides: [],
      },
    }));
    const saveSystemSettings = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'systemSettings.save' as const,
        mode: 'saved' as const,
        message: 'Saved platform settings.',
        defaultConfigPath: '/repo/config/platform.default.json',
        runtimeConfigPath: '/repo/.platform-state/platform.json',
        defaultFileHash: 'h2',
        runtimeFileHash: 'rt2',
        config: SYSTEM_SETTINGS_CONFIG,
        runtimeConfig: SYSTEM_SETTINGS_CONFIG,
        runtimeStatus: 'valid' as const,
        runtimeWarning: null,
        tasksActive: false,
        envOverrides: [],
      },
    }));

    const readResult = await handleDesktopAction({ action: 'systemSettings.read' }, { readSystemSettings });
    expect(readSystemSettings).toHaveBeenCalledTimes(1);
    expect(readResult.ok).toBe(true);

    const savePayload = { baseDefaultFileHash: 'h1', config: SYSTEM_SETTINGS_CONFIG };
    const saveResult = await handleDesktopAction(
      { action: 'systemSettings.save', payload: savePayload },
      { saveSystemSettings },
    );
    expect(saveSystemSettings).toHaveBeenCalledWith(savePayload);
    expect(saveResult.ok).toBe(true);
  });

  it('dispatches systemSettings.restart to the injected restart handler', async () => {
    const { handleDesktopAction } = await import('./main');
    const restartApp = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'systemSettings.restart' as const,
        mode: 'restarting' as const,
        message: 'Restarting TaskSail to apply settings…',
      },
    }));

    const result = await handleDesktopAction({ action: 'systemSettings.restart' }, { restartApp });

    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('dispatches logExplorer.listFiles and logExplorer.readFile to injected handlers', async () => {
    const { handleDesktopAction } = await import('./main');
    const listLogExplorerFiles = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'logExplorer.listFiles' as const,
        mode: 'read-only' as const,
        message: 'Loaded log files.',
        sourceLabel: 'TaskSail platform logs',
        categories: { info: [], warn: [], error: [] },
      },
    }));
    const readLogExplorerFile = vi.fn(async () => ({
      ok: true as const,
      response: {
        action: 'logExplorer.readFile' as const,
        mode: 'read-only' as const,
        message: 'Loaded log file.',
        category: 'info' as const,
        fileName: 'tasksail.jsonl',
        displayName: 'tasksail.jsonl',
        sizeBytes: 0,
        modifiedAt: '2026-06-03T00:00:00.000Z',
        totalLines: 0,
        totalMatchingLines: 0,
        startLine: 0,
        endLine: 0,
        hasOlder: false,
        hasNewer: false,
        levelFilter: 'all' as const,
        records: [],
      },
    }));

    const listResult = await handleDesktopAction(
      { action: 'logExplorer.listFiles' },
      { listLogExplorerFiles, readLogExplorerFile },
    );
    expect(listLogExplorerFiles).toHaveBeenCalledTimes(1);
    expect(listResult.ok).toBe(true);

    const payload = { category: 'info' as const, fileName: 'tasksail.jsonl', limit: 100, levelFilter: 'debug' as const };
    const readResult = await handleDesktopAction(
      { action: 'logExplorer.readFile', payload },
      { listLogExplorerFiles, readLogExplorerFile },
    );
    expect(readLogExplorerFile).toHaveBeenCalledWith(payload);
    expect(readResult.ok).toBe(true);
  });

  it('rejects malformed logExplorer.readFile payloads before the handler runs', async () => {
    const { handleDesktopAction } = await import('./main');
    const readLogExplorerFile = vi.fn();

    const result = await handleDesktopAction(
      { action: 'logExplorer.readFile', payload: { category: 'debug', fileName: '../tasksail.jsonl' } },
      { readLogExplorerFile },
    );

    expect(result.ok).toBe(false);
    expect(readLogExplorerFile).not.toHaveBeenCalled();
  });

  it('drives a real app relaunch for systemSettings.restart via the default app handlers', async () => {
    const { handleDesktopAction } = await import('./main');

    const result = await handleDesktopAction({ action: 'systemSettings.restart' });

    expect(result.ok).toBe(true);
    expect(appMock.relaunch).toHaveBeenCalledTimes(1);
    expect(appMock.quit).toHaveBeenCalledTimes(1);
  });

  it('reports restart unavailable when no restartApp dependency is wired', async () => {
    const { createDefaultDesktopActionHandlers } = await import('./ipc/desktopActionHandlers');

    const result = await createDefaultDesktopActionHandlers().restartApp();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not available');
    }
  });
});
