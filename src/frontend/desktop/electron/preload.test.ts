// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_SHELL_INVOKE_CHANNEL,
  DESKTOP_SHELL_STREAM_CHANNEL,
  DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
  DESKTOP_SHELL_TASK_BOARD_CHANNEL,
  DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL,
  CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
} from '../src/shared/desktopContract';
import { LOG_EMIT_CHANNEL } from '../src/shared/desktopContractLogging';

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
    invoke.mockResolvedValue(undefined);
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
        listRepoTree: expect.any(Function),
        reseedContextPack: expect.any(Function),
        previewContextPackSwitch: expect.any(Function),
        applyContextPackSwitch: expect.any(Function),
        clearActiveContextPack: expect.any(Function),
        activateContextPack: expect.any(Function),
        pickMarkdownFile: expect.any(Function),
        listArchivedTasks: expect.any(Function),
        readParentContextBundle: expect.any(Function),
        readParentChainArchiveBundle: expect.any(Function),
        readParentArchiveMarkdown: expect.any(Function),
        listPlannerConversationHistory: expect.any(Function),
        hydratePlannerConversation: expect.any(Function),
        submitReinforcementFeedback: expect.any(Function),
        updateRealignmentDoc: expect.any(Function),
        readReinforcementOverview: expect.any(Function),
        listReinforcementTasks: expect.any(Function),
        readAgentRewards: expect.any(Function),
        listRealignmentSessions: expect.any(Function),
        readRealignmentDoc: expect.any(Function),
        checkActiveWorkGuard: expect.any(Function),
        startRealignment: expect.any(Function),
        runRealignmentAnalysis: expect.any(Function),
        dismissRealignment: expect.any(Function),
        loadAgentConfig: expect.any(Function),
        loadModelCatalog: expect.any(Function),
        saveAgentModels: expect.any(Function),
        addModel: expect.any(Function),
        removeModel: expect.any(Function),
        listLogFiles: expect.any(Function),
        readLogFile: expect.any(Function),
        readTaskNotifications: expect.any(Function),
        markTaskNotificationsSeen: expect.any(Function),
        dismissTaskNotification: expect.any(Function),
        dismissAllTaskNotifications: expect.any(Function),
        onTaskNotificationsUpdate: expect.any(Function),
        describeActiveProvider: expect.any(Function),
        updatePlannerSessionPersonality: expect.any(Function),
        log: expect.objectContaining({ emit: expect.any(Function) }),
      }),
    );
  });

  it('exposes provider metadata without provider-specific bridge names', async () => {
    const { exposeDesktopShell } = await import('./preload');

    exposeDesktopShell();

    const exposedContract = exposeInMainWorld.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(exposedContract.describeActiveProvider).toEqual(expect.any(Function));
    expect(Object.keys(exposedContract).join('\n')).not.toMatch(/copilot|COPILOT|\.github/u);
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

  it('passes renderer log payloads through the dedicated log channel', async () => {
    const { desktopShellApi } = await import('./preload');
    const payload = validLogPayload();

    await desktopShellApi.log.emit(payload);

    expect(invoke).toHaveBeenCalledWith(LOG_EMIT_CHANNEL, payload);
  });

  it('does not validate renderer log payloads in preload', async () => {
    const { desktopShellApi } = await import('./preload');
    const { task_id: _taskId, ...payload } = validLogPayload();

    await desktopShellApi.log.emit(payload as Parameters<typeof desktopShellApi.log.emit>[0]);

    expect(invoke).toHaveBeenCalledWith(LOG_EMIT_CHANNEL, payload);
  });

  it('forwards task notification invokes over the approved desktop channel', async () => {
    const { desktopShellApi } = await import('./preload');
    const markSeenPayload = { notificationIds: ['n-1'], allVisible: true };

    await desktopShellApi.readTaskNotifications();
    await desktopShellApi.markTaskNotificationsSeen(markSeenPayload);
    await desktopShellApi.dismissTaskNotification('n-1');
    await desktopShellApi.dismissAllTaskNotifications();

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.read',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.markSeen',
      payload: markSeenPayload,
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.dismiss',
      payload: { notificationId: 'n-1' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskNotifications.dismissAll',
    });
  });

  it('forwards taskBoard.readTaskContent with optional artifactRelativePath omitted and supplied', async () => {
    const { desktopShellApi } = await import('./preload');

    await desktopShellApi.readTaskContent('task.md', 'completed');
    await desktopShellApi.readTaskContent('task.md', 'completed', 'handoffs/final-summary.md');

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readTaskContent',
      payload: { fileName: 'task.md', column: 'completed' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readTaskContent',
      payload: { fileName: 'task.md', column: 'completed', artifactRelativePath: 'handoffs/final-summary.md' },
    });
  });

  it('forwards taskBoard.readChildChainBranchInventory with optional expectedRootTaskId omitted and supplied', async () => {
    const { desktopShellApi } = await import('./preload');

    await desktopShellApi.readChildChainBranchInventory('CHILD-1');
    await desktopShellApi.readChildChainBranchInventory('CHILD-1', 'ROOT-1');

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: 'CHILD-1' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'taskBoard.readChildChainBranchInventory',
      payload: { taskId: 'CHILD-1', expectedRootTaskId: 'ROOT-1' },
    });
  });

  it('bridges externalMcp.validateLocalCommand with the correct action and payload', async () => {
    const { desktopShellApi } = await import('./preload');

    await desktopShellApi.validateExternalMcpLocalCommand({ command: 'npx' });

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'externalMcp.validateLocalCommand',
      payload: { command: 'npx' },
    });
  });

  it('invokes only approved IPC channels and does not expose unrestricted shell methods', async () => {
    invoke.mockResolvedValue({ ok: true, response: { action: 'queue.readStatus', mode: 'dry-run' } });
    const { desktopShellApi } = await import('./preload');

    await desktopShellApi.submitPlannerDraft(
      {
        taskKind: 'standard',
        summary: 'Prepare the planner payload.',
        desiredOutcome: 'The preload bridge forwards the planner payload.',
        constraints: 'Read-only until confirm.',
        criticalRequirements: 'None',
        compatibilityRequirements: 'None',
        requiredValidation: 'None',
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
    await desktopShellApi.setTerminalTaskScope('feedbeef-1234-4234-9234-123456789abc');
    await desktopShellApi.setTerminalTaskScope(null);
    await desktopShellApi.initiateFollowUp(
      {
        taskKind: 'child-task',
        summary: 'Start a child-task planning flow from completed work.',
        desiredOutcome: 'A new child task is created without reopening the parent.',
        constraints: 'Keep the parent task read-only.',
        criticalRequirements: 'None',
        compatibilityRequirements: 'None',
        requiredValidation: 'None',
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
    await desktopShellApi.listRepoTree('/tmp/estate-root/orders-api', 'src/components');
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
    await desktopShellApi.startPlannerSession({
      contextPackDir: '/tmp/context-packs/orders-estate',
      replayConversationId: 'conversation-1',
    });
    await desktopShellApi.sendPlannerMessage(
      'Message sent to Lily.',
      'Message shown in transcript.',
    );
    await desktopShellApi.sendPlannerMessage('Plain message only.');
    await desktopShellApi.listPlannerConversationHistory();
    await desktopShellApi.hydratePlannerConversation('conversation-1');
    await desktopShellApi.pickMarkdownFile();
    await desktopShellApi.listArchivedTasks();
    await desktopShellApi.readParentContextBundle({
      parentTaskId: 'TASK-001',
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    });
    await desktopShellApi.readParentChainArchiveBundle({
      parentTaskId: 'TASK-001',
      rootTaskId: 'TASK-ROOT',
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    });
    await desktopShellApi.readParentArchiveMarkdown({
      parentTaskId: 'TASK-001',
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    });
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
    await desktopShellApi.loadCapabilities();
    await desktopShellApi.saveAgentModels([
      { agent_id: 'provider-planner', model_id: 'gpt-4.1' },
      { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6', reasoning_effort: 'high' },
    ]);
    await desktopShellApi.addModel('Claude Sonnet 4.6', 'claude-sonnet-4.6');
    await desktopShellApi.removeModel('gpt-4.1');
    await desktopShellApi.uploadSpec('## Request Summary\n\nUploaded bypass intake.', {
      requirePlannerSidecar: true,
      expectedTaskKind: 'child-task',
    });

    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.submitDraft',
      payload: {
        draft: expect.objectContaining({
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
      action: 'terminal.setTaskScope',
      payload: { taskGuid: 'feedbeef-1234-4234-9234-123456789abc' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'terminal.setTaskScope',
      payload: { taskGuid: null },
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
      action: 'contextPack.listRepoTree',
      payload: {
        repoLocalPath: '/tmp/estate-root/orders-api',
        relativePath: 'src/components',
      },
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
      action: 'planner.startSession',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        replayConversationId: 'conversation-1',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.sendMessage',
      payload: {
        text: 'Message sent to Lily.',
        displayText: 'Message shown in transcript.',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.sendMessage',
      payload: {
        text: 'Plain message only.',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.listConversationHistory',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.hydrateConversation',
      payload: { recordId: 'conversation-1' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.pickMarkdownFile',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.listArchivedTasks',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readParentContextBundle',
      payload: {
        parentTaskId: 'TASK-001',
        contextPackDir: '/tmp/context-packs/orders-estate',
        contextPackId: 'orders-estate',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readParentChainArchiveBundle',
      payload: {
        parentTaskId: 'TASK-001',
        rootTaskId: 'TASK-ROOT',
        contextPackDir: '/tmp/context-packs/orders-estate',
        contextPackId: 'orders-estate',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.readParentArchiveMarkdown',
      payload: {
        parentTaskId: 'TASK-001',
        contextPackDir: '/tmp/context-packs/orders-estate',
        contextPackId: 'orders-estate',
      },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.finalizeSpec',
      payload: { expectedTaskKind: 'child-task' },
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'planner.uploadSpec',
      payload: {
        content: '## Request Summary\n\nUploaded bypass intake.',
        requirePlannerSidecar: true,
        expectedTaskKind: 'child-task',
      },
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
      action: 'agentConfig.loadCapabilities',
    });
    expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
      action: 'agentConfig.saveAgentModels',
      payload: {
        assignments: [
          { agent_id: 'provider-planner', model_id: 'gpt-4.1' },
          { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6', reasoning_effort: 'high' },
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

  describe('onTaskBoardUpdate completedItems shape validation', () => {
    it('does not invoke renderer callback when completedItems contains a malformed row (missing taskId)', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onTaskBoardUpdate(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_TASK_BOARD_CHANNEL,
      )?.[1];
      expect(handler).toBeDefined();

      // A push whose completedItems row has an empty taskId — must be rejected.
      const malformedBoard = {
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: '0 open, 0 pending, 0 failed, 1 completed.',
        boardSnapshotSequence: 2,
        dropboxItems: [],
        pendingItems: [],
        errorItems: [],
        completedItems: [
          // taskId is empty — isArchivedTaskEntry requires a non-empty string
          { taskId: '', title: 'Bad task', summary: '', rootTaskId: 'done-1', qmdRecordId: 'task:pack:done-1', followupReason: '', year: '2026', archivePath: '/archive/done-1/archive.md', archivedAt: null, contextPackName: 'pack' },
        ],
      };
      handler!({} as Electron.IpcRendererEvent, malformedBoard);

      // Callback must NOT have been called — the malformed row fails the guard.
      expect(callback).not.toHaveBeenCalled();
      const logCalls = invoke.mock.calls.filter((call) => call[0] === LOG_EMIT_CHANNEL);
      expect(logCalls.length).toBeGreaterThanOrEqual(1);
      expect(logCalls[0]?.[1]).toMatchObject({ msg: 'preload.task-board-update.malformed' });
    });

    it('invokes renderer callback when completedItems contains a valid row with optional metadata', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onTaskBoardUpdate(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_TASK_BOARD_CHANNEL,
      )?.[1];

      // A valid completed push that also carries optional childChain + branchHandoffs.
      const validBoard = {
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: '0 open, 0 pending, 0 failed, 1 completed.',
        boardSnapshotSequence: 3,
        dropboxItems: [],
        pendingItems: [],
        errorItems: [],
        completedItems: [
          {
            taskId: 'done-1',
            title: 'Done task',
            summary: '',
            rootTaskId: 'done-1',
            qmdRecordId: 'task:pack:done-1',
            followupReason: '',
            year: '2026',
            archivePath: '/archive/done-1/archive.md',
            archivedAt: '2026-01-01T00:00:00Z',
            contextPackName: 'pack',
            childChain: {
              rootTaskId: 'done-1',
              parentTaskId: null,
              previousTaskId: null,
              depth: 0,
              state: 'completed',
              currentTipTaskId: 'done-1',
              isCurrentTip: true,
              archivePath: '/archive/done-1/archive.md',
              archiveArtifactDir: '/archive/done-1',
              parentArchivePath: null,
              parentArchiveArtifactDir: null,
            },
            branchHandoffs: [],
          },
        ],
      };
      handler!({} as Electron.IpcRendererEvent, validBoard);

      // Callback must be called — valid shape passes the guard.
      expect(callback).toHaveBeenCalledWith(validBoard);
    });
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

      const validEvent = {
        id: 'evt-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        role: 'swe',
        source: 'pipeline',
        taskId: 'task-1',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'info',
        message: 'Hello',
      };
      handler!({} as Electron.IpcRendererEvent, validEvent);
      expect(callback).toHaveBeenCalledWith(validEvent);
    });

    it('drops malformed stream events missing required fields', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onStreamEvent(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_STREAM_CHANNEL,
      )?.[1];

      handler!({} as Electron.IpcRendererEvent, { id: 'evt-1', role: 'swe' });
      handler!({} as Electron.IpcRendererEvent, { id: 'evt-1', message: 'Hello' });
      handler!({} as Electron.IpcRendererEvent, null);
      expect(callback).not.toHaveBeenCalled();
      const logCalls = invoke.mock.calls.filter((call) => call[0] === LOG_EMIT_CHANNEL);
      expect(logCalls).toHaveLength(3);
      expect(logCalls[0]?.[1]).toMatchObject({
        msg: 'preload.stream-event.malformed',
        extra: { data: { id: 'evt-1', role: 'swe' } },
      });
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

      const validEvent = {
        eventType: 'planner.turn.completed',
        sessionId: 'planner-session-1',
        brokerStatus: 'idle',
      };
      handler!({} as Electron.IpcRendererEvent, validEvent);
      expect(callback).toHaveBeenCalledWith(validEvent);
    });

    it('drops malformed planner events missing required fields', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onPlannerEvent(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_PLANNER_EVENT_CHANNEL,
      )?.[1];

      handler!({} as Electron.IpcRendererEvent, {
        eventType: 'planner.turn.completed',
        brokerStatus: 'idle',
      });
      handler!({} as Electron.IpcRendererEvent, {
        eventType: 'planner.turn.completed',
        sessionId: 42,
        brokerStatus: 'idle',
      });
      handler!({} as Electron.IpcRendererEvent, {
        sessionId: 'planner-session-1',
        brokerStatus: 'idle',
      });
      handler!({} as Electron.IpcRendererEvent, 'not-an-object');
      expect(callback).not.toHaveBeenCalled();
      const logCalls = invoke.mock.calls.filter((call) => call[0] === LOG_EMIT_CHANNEL);
      expect(logCalls).toHaveLength(4);
      expect(logCalls[0]?.[1]).toMatchObject({
        msg: 'preload.planner-event.malformed',
        extra: {
          plannerEvent: {
            eventType: 'planner.turn.completed',
            brokerStatus: 'idle',
          },
        },
      });
    });
  });

  describe('onTaskBoardUpdate validation', () => {
    it('invokes callback for well-formed task board updates', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onTaskBoardUpdate(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_TASK_BOARD_CHANNEL,
      )?.[1];
      expect(handler).toBeDefined();

      const validBoard = {
        action: 'taskBoard.readBoard',
        mode: 'read-only',
        message: '0 open, 0 pending, 0 failed, 0 completed.',
        boardSnapshotSequence: 1,
        dropboxItems: [],
        pendingItems: [],
        errorItems: [],
        completedItems: [],
      };
      handler!({} as Electron.IpcRendererEvent, validBoard);
      expect(callback).toHaveBeenCalledWith(validBoard);
    });

    it('drops malformed task board updates and logs a structured warning', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onTaskBoardUpdate(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_TASK_BOARD_CHANNEL,
      )?.[1];

      // Missing boardSnapshotSequence — rejected by the strengthened guard.
      handler!({} as Electron.IpcRendererEvent, { action: 'taskBoard.readBoard', mode: 'read-only' });
      handler!({} as Electron.IpcRendererEvent, { action: 'taskBoard.somethingElse' });
      handler!({} as Electron.IpcRendererEvent, null);
      expect(callback).not.toHaveBeenCalled();
      const logCalls = invoke.mock.calls.filter((call) => call[0] === LOG_EMIT_CHANNEL);
      expect(logCalls).toHaveLength(3);
      expect(logCalls[0]?.[1]).toMatchObject({
        msg: 'preload.task-board-update.malformed',
        extra: { action: 'taskBoard.readBoard', type: 'object' },
      });
      expect(logCalls[1]?.[1]).toMatchObject({
        msg: 'preload.task-board-update.malformed',
        extra: { action: 'taskBoard.somethingElse', type: 'object' },
      });
      expect(logCalls[2]?.[1]).toMatchObject({
        msg: 'preload.task-board-update.malformed',
        extra: { action: null, type: 'object' },
      });
    });
  });

  describe('onTaskNotificationsUpdate validation', () => {
    it('invokes callback for well-formed task notification events', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onTaskNotificationsUpdate(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL,
      )?.[1];
      expect(handler).toBeDefined();

      const validEvent = taskNotificationEvent();
      handler!({} as Electron.IpcRendererEvent, validEvent);
      expect(callback).toHaveBeenCalledWith(validEvent);
    });

    it('drops malformed task notification events and logs a structured warning', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.onTaskNotificationsUpdate(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL,
      )?.[1];

      handler!({} as Electron.IpcRendererEvent, { type: 'snapshot', snapshot: { action: 'taskNotifications.read' } });
      handler!({} as Electron.IpcRendererEvent, { type: 'upsert' });
      handler!({} as Electron.IpcRendererEvent, null);

      expect(callback).not.toHaveBeenCalled();
      const logCalls = invoke.mock.calls.filter((call) => call[0] === LOG_EMIT_CHANNEL);
      expect(logCalls).toHaveLength(3);
      expect(logCalls[0]?.[1]).toMatchObject({
        msg: 'preload.task-notifications-update.malformed',
        extra: { type: 'object', eventType: 'snapshot' },
      });
      expect(logCalls[1]?.[1]).toMatchObject({
        msg: 'preload.task-notifications-update.malformed',
        extra: { type: 'object', eventType: 'upsert' },
      });
      expect(logCalls[2]?.[1]).toMatchObject({
        msg: 'preload.task-notifications-update.malformed',
        extra: { type: 'object', eventType: null },
      });
    });
  });

  describe('agentConfig extension IPC bridge', () => {
    it('bridges all six extension actions over the approved invoke channel with correct action names', async () => {
      const { desktopShellApi } = await import('./preload');

      await desktopShellApi.listAgentExtensions();
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.listExtensions',
      });

      await desktopShellApi.addAgentExtension({
        id: 'my-skill',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
      });
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.addExtension',
        payload: expect.objectContaining({ id: 'my-skill' }),
      });

      await desktopShellApi.reseedAgentExtension({ id: 'my-skill' });
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.reseedExtension',
        payload: { id: 'my-skill' },
      });

      await desktopShellApi.deleteAgentExtension({ id: 'my-skill' });
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.deleteExtension',
        payload: { id: 'my-skill' },
      });

      await desktopShellApi.loadAgentExtensionAssignments();
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.loadExtensionAssignments',
      });

      await desktopShellApi.saveAgentExtensionAssignments({
        assignments: [{ agent_id: 'software-engineer', extension_ids: ['my-skill'] }],
      });
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.saveExtensionAssignments',
        payload: expect.objectContaining({ assignments: expect.any(Array) }),
      });
    });

    it('bridges external MCP assignment actions over the approved invoke channel', async () => {
      const { desktopShellApi } = await import('./preload');

      await desktopShellApi.loadExternalMcpAssignments();
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.loadExternalMcpAssignments',
      });

      await desktopShellApi.saveExternalMcpAssignments({
        assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }],
      });
      expect(invoke).toHaveBeenCalledWith(DESKTOP_SHELL_INVOKE_CHANNEL, {
        action: 'agentConfig.saveExternalMcpAssignments',
        payload: expect.objectContaining({ assignments: expect.any(Array) }),
      });
    });

    it('does not include COPILOT or provider-specific names in bridged extension action names', async () => {
      const { desktopShellApi } = await import('./preload');
      const bridgedKeys = Object.keys(desktopShellApi).join('\n');

      expect(bridgedKeys).not.toMatch(/COPILOT|copilot_/u);
      expect(desktopShellApi).toHaveProperty('listAgentExtensions');
      expect(desktopShellApi).toHaveProperty('addAgentExtension');
      expect(desktopShellApi).toHaveProperty('reseedAgentExtension');
      expect(desktopShellApi).toHaveProperty('deleteAgentExtension');
      expect(desktopShellApi).toHaveProperty('loadAgentExtensionAssignments');
      expect(desktopShellApi).toHaveProperty('saveAgentExtensionAssignments');
    });
  });

  describe('subscribeContextPackCatalogChanged validation', () => {
    it('invokes callback for well-formed context-pack catalog events', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.subscribeContextPackCatalogChanged(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
      )?.[1];
      expect(handler).toBeDefined();

      const validEvent = {
        changedRoot: '/tmp/contextpacks',
        reason: 'rename',
      } as const;
      handler!({} as Electron.IpcRendererEvent, validEvent);
      expect(callback).toHaveBeenCalledWith(validEvent);
    });

    it('drops malformed context-pack catalog events and logs a structured warning', async () => {
      const { desktopShellApi } = await import('./preload');
      const callback = vi.fn();
      desktopShellApi.subscribeContextPackCatalogChanged(callback);

      const handler = on.mock.calls.find(
        (call) => call[0] === CONTEXT_PACK_CATALOG_CHANGED_CHANNEL,
      )?.[1];

      handler!({} as Electron.IpcRendererEvent, {
        changedRoot: '/tmp/contextpacks',
        reason: 'invalid-reason',
      });
      handler!({} as Electron.IpcRendererEvent, { reason: 'rename' });
      handler!({} as Electron.IpcRendererEvent, null);

      expect(callback).not.toHaveBeenCalled();
      const logCalls = invoke.mock.calls.filter((call) => call[0] === LOG_EMIT_CHANNEL);
      expect(logCalls).toHaveLength(3);
      expect(logCalls[0]?.[1]).toMatchObject({
        msg: 'preload.context-pack-catalog-event.malformed',
        extra: { reason: 'invalid-reason', type: 'object' },
      });
      expect(logCalls[1]?.[1]).toMatchObject({
        msg: 'preload.context-pack-catalog-event.malformed',
        extra: { reason: 'rename', type: 'object' },
      });
      expect(logCalls[2]?.[1]).toMatchObject({
        msg: 'preload.context-pack-catalog-event.malformed',
        extra: { reason: null, type: 'object' },
      });
    });
  });
});

function validLogPayload() {
  return {
    ts: '2026-05-12T14:23:01.482Z',
    level: 'info',
    stack: 'renderer',
    module: 'src/renderer/preload-test',
    msg: 'preload.test',
    pid: 0,
    task_id: null,
    agent_id: null,
    provider_id: null,
    span_id: null,
  } as const;
}

function taskNotificationEvent() {
  return {
    type: 'snapshot',
    snapshot: {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 1,
      notifications: [{
        notificationId: 'a'.repeat(64),
        dedupeKey: 'task:TASK-001:completed',
        type: 'task-completed',
        severity: 'success',
        taskId: 'TASK-001',
        taskGuid: null,
        taskTitle: 'Ship notification center',
        taskFileName: 'TASK-001.md',
        contextPackId: 'platform',
        contextPackDir: '/tmp/context-packs/platform',
        contextPackLabel: 'platform',
        archivePath: '/tmp/archive/TASK-001.md',
        errorItemPath: null,
        createdAt: '2026-05-25T10:00:00.000Z',
        seenAt: null,
        dismissedAt: null,
        message: 'Task completed.',
      }],
      generatedAt: '2026-05-25T10:01:00.000Z',
      message: 'Loaded task notifications.',
    },
  } as const;
}
