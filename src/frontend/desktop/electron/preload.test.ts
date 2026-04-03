// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_SHELL_INVOKE_CHANNEL,
  DESKTOP_SHELL_STREAM_CHANNEL,
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
} from '../src/shared/desktopContract';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke,
    on,
    removeListener,
  },
}));

describe('electron preload bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the desktop shell API through the context bridge', async () => {
    const { exposeDesktopShell } = await import('./preload');

    exposeDesktopShell();

    expect(exposeInMainWorld).toHaveBeenCalledWith(
      'desktopShell',
      expect.objectContaining({
        getBootstrapInfo: expect.any(Function),
        submitPlannerDraft: expect.any(Function),
        getQueueStatus: expect.any(Function),
        getEnvironmentStatus: expect.any(Function),
        getObservabilitySnapshot: expect.any(Function),
        initiateFollowUp: expect.any(Function),
        pickContextPackDirectory: expect.any(Function),
        discoverContextPackPrefill: expect.any(Function),
        createContextPack: expect.any(Function),
        listContextPacks: expect.any(Function),
        reseedContextPack: expect.any(Function),
        previewContextPackSwitch: expect.any(Function),
        applyContextPackSwitch: expect.any(Function),
        clearActiveContextPack: expect.any(Function),
        activateContextPack: expect.any(Function),
        pickMarkdownFile: expect.any(Function),
        listArchivedTasks: expect.any(Function),
        submitReinforcementFeedback: expect.any(Function),
        updateRealignmentDoc: expect.any(Function),
        readReinforcementOverview: expect.any(Function),
        listReinforcementTasks: expect.any(Function),
        readAgentRewards: expect.any(Function),
        listRealignmentSessions: expect.any(Function),
        readRealignmentDoc: expect.any(Function),
        checkActiveWorkGuard: expect.any(Function),
        startRealignment: expect.any(Function),
        loadAgentConfig: expect.any(Function),
        loadModelCatalog: expect.any(Function),
        saveAgentModels: expect.any(Function),
        addModel: expect.any(Function),
        removeModel: expect.any(Function),
      }),
    );
  });

  it('returns bootstrap metadata for the renderer', async () => {
    const { bootstrapInfo, desktopShellApi } = await import('./preload');

    await expect(desktopShellApi.getBootstrapInfo()).resolves.toEqual(bootstrapInfo);
    expect(bootstrapInfo.appName).toBe('TaskSail');
    expect(bootstrapInfo.platform).toBe(process.platform);
    expect(bootstrapInfo.versions).toHaveProperty('chrome');
    expect(bootstrapInfo.versions).toHaveProperty('electron');
    expect(bootstrapInfo.versions.node).toEqual(expect.any(String));
  });

  it('invokes only approved IPC channels and does not expose unrestricted shell methods', async () => {
    invoke.mockResolvedValue({ ok: true, response: { action: 'queue.readStatus', mode: 'dry-run' } });
    const { desktopShellApi } = await import('./preload');

    await desktopShellApi.submitPlannerDraft(
      {
        title: 'Queue-ready planner draft',
        taskKind: 'standard',
        summary: 'Prepare the planner payload.',
        desiredOutcome: 'The preload bridge forwards the planner payload.',
        constraints: 'Read-only until confirm.',
        acceptanceSignals: 'IPC receives approved planner action.',
        parentTaskId: '',
        parentQmdRecordId: '',
        parentQmdScope: '',
        rootTaskId: '',
        followupReason: '',
        carryForwardSummary: '',
        suggestedPath: 'sequential',
        planningNotes: 'Dry-run only.',
      },
      'confirm',
    );
    await desktopShellApi.getQueueStatus();
    await desktopShellApi.getEnvironmentStatus();
    await desktopShellApi.getObservabilitySnapshot();
    await desktopShellApi.initiateFollowUp(
      {
        title: 'Create child-task intake for live follow-up integration',
        taskKind: 'child-task',
        summary: 'Start a child-task planning flow from completed work.',
        desiredOutcome: 'A new child task is created without reopening the parent.',
        constraints: 'Keep the parent task read-only.',
        acceptanceSignals: 'Carry-forward lineage is preserved.',
        parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        parentQmdRecordId: 'qmd://implementation-summary/CAP-CUSTOM-TERMINAL-08/final',
        parentQmdScope: 'qmd/context-packs/test-pack',
        rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
        followupReason: 'Carry completed renderer findings forward.',
        carryForwardSummary: 'Preserve the read-only console lock.',
        suggestedPath: 'sequential',
        planningNotes: 'Parent Final Summary Reference: qmd/context-packs/test-pack.md',
      },
      'confirm',
    );
    await desktopShellApi.pickContextPackDirectory(
      'discovery-root',
      '/tmp/workspaces',
    );
    await desktopShellApi.discoverContextPackPrefill(
      '/tmp/estate-root',
      'distributed',
    );
    await desktopShellApi.createContextPack({
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
            repoId: 'orders-api',
            systemLayer: 'backend',
            languages: ['python'],
          },
        ],
      },
    });
    await desktopShellApi.listContextPacks();
    await desktopShellApi.reseedContextPack('/tmp/context-packs/orders-estate');
    await desktopShellApi.previewContextPackSwitch(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
    );
    await desktopShellApi.applyContextPackSwitch(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api', 'orders-web'],
      ['services-billing'],
    );
    await desktopShellApi.clearActiveContextPack();
    await desktopShellApi.activateContextPack('platform-default');
    await desktopShellApi.pickMarkdownFile();
    await desktopShellApi.listArchivedTasks();
    await desktopShellApi.finalizeSpec('child-task');
    await desktopShellApi.submitReinforcementFeedback({
      contextPackDir: '/tmp/context-packs/orders-estate',
      taskId: 'T-1',
      feedbackType: 'positive',
      starRating: 4,
    });
    await desktopShellApi.updateRealignmentDoc({
      contextPackDir: '/tmp/context-packs/orders-estate',
      updates: { standingExpectations: ['Be concise'] },
    });
    await desktopShellApi.readReinforcementOverview();
    await desktopShellApi.listReinforcementTasks('2026');
    await desktopShellApi.readAgentRewards();
    await desktopShellApi.listRealignmentSessions();
    await desktopShellApi.readRealignmentDoc();
    await desktopShellApi.checkActiveWorkGuard();
    await desktopShellApi.startRealignment({
      contextPackDir: '/tmp/context-packs/orders-estate',
      triggerTaskId: 'T-1',
    });
    await desktopShellApi.loadAgentConfig();
    await desktopShellApi.loadModelCatalog();
    await desktopShellApi.saveAgentModels([
      { agent_id: 'planning-agent', model_id: 'gpt-4.1' },
      { agent_id: 'software-engineer', model_id: 'claude-sonnet-4.6' },
    ]);
    await desktopShellApi.addModel('Claude Sonnet 4.6', 'claude-sonnet-4.6');
    await desktopShellApi.removeModel('gpt-4.1');

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.submitDraft',
      payload: {
        draft: expect.objectContaining({
          title: 'Queue-ready planner draft',
          taskKind: 'standard',
        }),
        stage: 'confirm',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'queue.readStatus',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'environment.readStatus',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'observability.readSnapshot',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'followup.begin',
      payload: {
        draft: expect.objectContaining({
          taskKind: 'child-task',
          parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        }),
        stage: 'confirm',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.pickDirectory',
      payload: {
        purpose: 'discovery-root',
        defaultPath: '/tmp/workspaces',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.discoverPrefill',
      payload: {
        rootPath: '/tmp/estate-root',
        mode: 'distributed',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
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
              repoId: 'orders-api',
              systemLayer: 'backend',
              languages: ['python'],
            },
          ],
        },
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.list',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.reseed',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.previewSwitch',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        selectedFocusIds: ['services-billing'],
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.applySwitch',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api', 'orders-web'],
        selectedFocusIds: ['services-billing'],
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.clearActive',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'contextPack.activate',
      payload: {
        packId: 'platform-default',
        command: 'context-pack:activate',
        mode: 'status-only',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.pickMarkdownFile',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.listArchivedTasks',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.finalizeSpec',
      payload: { expectedTaskKind: 'child-task' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.submitFeedback',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        taskId: 'T-1',
        feedbackType: 'positive',
        starRating: 4,
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.updateRealignmentDoc',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        updates: { standingExpectations: ['Be concise'] },
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.readOverview',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.listTasks',
      payload: { year: '2026' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.readAgentRewards',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.listRealignmentSessions',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.readRealignmentDoc',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.checkActiveWorkGuard',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'reinforcement.startRealignment',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        triggerTaskId: 'T-1',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadAgents',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.loadModelCatalog',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.saveAgentModels',
      payload: {
        assignments: [
          { agent_id: 'planning-agent', model_id: 'gpt-4.1' },
          { agent_id: 'software-engineer', model_id: 'claude-sonnet-4.6' },
        ],
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.addModel',
      payload: {
        display_name: 'Claude Sonnet 4.6',
        model_id: 'claude-sonnet-4.6',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.removeModel',
      payload: { model_id: 'gpt-4.1' },
    });
    expect(desktopShellApi).not.toHaveProperty('runShellCommand');
    expect(desktopShellApi).not.toHaveProperty('writePendingItem');
    expect(desktopShellApi).not.toHaveProperty('writeHandoff');
  });

  describe('onStreamEvent validation', () => {
    it('invokes callback for well-formed stream events', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onStreamEvent(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_STREAM_CHANNEL,
      )?.[1];
      expect(handler).toBeDefined();

      const validEvent = { id: 'evt-1', role: 'swe', message: 'Hello', timestamp: Date.now() };
      handler!({} as Electron.IpcRendererEvent, validEvent);
      expect(callback).toHaveBeenCalledWith(validEvent);
    });

    it('drops malformed stream events missing required fields', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      desktopShellApi.onStreamEvent(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_STREAM_CHANNEL,
      )?.[1];

      handler!({} as Electron.IpcRendererEvent, { id: 'evt-1', role: 'swe' });
      handler!({} as Electron.IpcRendererEvent, { id: 'evt-1', message: 'Hello' });
      handler!({} as Electron.IpcRendererEvent, null);
      expect(callback).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(3);
      warnSpy.mockRestore();
    });
  });

  describe('onPlannerEvent validation', () => {
    it('invokes callback for well-formed planner events', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onPlannerEvent(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
      )?.[1];
      expect(handler).toBeDefined();

      const validEvent = { eventType: 'turn-complete', brokerStatus: 'idle' };
      handler!({} as Electron.IpcRendererEvent, validEvent);
      expect(callback).toHaveBeenCalledWith(validEvent);
    });

    it('drops malformed planner events missing required fields', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      desktopShellApi.onPlannerEvent(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
      )?.[1];

      handler!({} as Electron.IpcRendererEvent, { eventType: 'turn-complete' });
      handler!({} as Electron.IpcRendererEvent, { brokerStatus: 'idle' });
      handler!({} as Electron.IpcRendererEvent, 'not-an-object');
      expect(callback).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(3);
      warnSpy.mockRestore();
    });
  });
});