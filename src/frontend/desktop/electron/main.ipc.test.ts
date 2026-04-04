// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
            title: 'Prototype contract review',
            taskKind: 'standard',
            summary: 'Review the contract.',
            desiredOutcome: 'Renderer can preview desktop actions.',
            constraints: 'Local only',
            acceptanceSignals: 'Dry-run result returns',
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
        draftTitle: 'Prototype contract review',
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

    expect(sendPlannerMessage).toHaveBeenCalledWith('Hello planner');
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

    expect(sendPlannerMessage).toHaveBeenNthCalledWith(1, 'First planner message');
    expect(sendPlannerMessage).toHaveBeenNthCalledWith(2, 'Second planner message');
    expect(maxConcurrent).toBe(1);
  });
});
