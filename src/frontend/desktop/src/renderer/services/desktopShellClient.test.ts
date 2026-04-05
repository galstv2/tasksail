// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  createFollowUpDraft,
  createLocalDraft,
  toFollowUpDirectSubmissionDraft,
  toPlannerDirectSubmissionDraft,
} from '../plannerComposer';
import { createDesktopShellClient, desktopShellClient } from './desktopShellClient';

describe('desktopShellClient', () => {
  it('delegates queue, environment, and observability reads through the current shell seam', async () => {
    const shell = {
      getBootstrapInfo: vi.fn(),
      getQueueStatus: vi.fn().mockResolvedValue({ ok: true, response: { action: 'queue.readStatus' } }),
      getEnvironmentStatus: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'environment.readStatus' } }),
      getObservabilitySnapshot: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'observability.readSnapshot' } }),
      submitPlannerDraft: vi.fn(),
      initiateFollowUp: vi.fn(),
      pickContextPackDirectory: vi.fn(),
      discoverContextPackPrefill: vi.fn(),
      createContextPack: vi.fn(),
      listContextPacks: vi.fn(),
      reseedContextPack: vi.fn(),
      previewContextPackSwitch: vi.fn(),
      applyContextPackSwitch: vi.fn(),
      clearActiveContextPack: vi.fn(),
      activateContextPack: vi.fn(),
      savePlannerDraft: vi.fn(),
      readStagedDraft: vi.fn(),
      finalizeSpec: vi.fn(),
    } as unknown as Window['desktopShell'];

    const client = createDesktopShellClient(() => shell);

    await expect(client.getQueueStatus()).resolves.toEqual({
      ok: true,
      response: { action: 'queue.readStatus' },
    });
    await expect(client.getEnvironmentStatus()).resolves.toEqual({
      ok: true,
      response: { action: 'environment.readStatus' },
    });
    await expect(client.getObservabilitySnapshot()).resolves.toEqual({
      ok: true,
      response: { action: 'observability.readSnapshot' },
    });

    expect(shell.getQueueStatus).toHaveBeenCalledTimes(1);
    expect(shell.getEnvironmentStatus).toHaveBeenCalledTimes(1);
    expect(shell.getObservabilitySnapshot).toHaveBeenCalledTimes(1);
  });

  it('forwards planner draft submission arguments unchanged', async () => {
    const draft = createLocalDraft(
      {
        title: 'Adapter forwards draft data',
        summary: 'Thin renderer adapters should pass planner payloads through unchanged.',
        desiredOutcome: 'Renderer callers depend on the adapter seam instead of the preload global.',
        constraints: ['Do not alter planner payload shape.', 'Preserve stage ordering.'],
        acceptanceSignals: ['submitPlannerDraft receives the same draft object and stage.'],
        planningNotes: 'Local adapter test only.',
        suggestedPath: 'sequential',
      },
    );
    const shell = {
      getBootstrapInfo: vi.fn(),
      getQueueStatus: vi.fn(),
      getEnvironmentStatus: vi.fn(),
      getObservabilitySnapshot: vi.fn(),
      submitPlannerDraft: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.submitDraft' } }),
      initiateFollowUp: vi.fn(),
      pickContextPackDirectory: vi.fn(),
      discoverContextPackPrefill: vi.fn(),
      createContextPack: vi.fn(),
      listContextPacks: vi.fn(),
      reseedContextPack: vi.fn(),
      previewContextPackSwitch: vi.fn(),
      applyContextPackSwitch: vi.fn(),
      clearActiveContextPack: vi.fn(),
      activateContextPack: vi.fn(),
      savePlannerDraft: vi.fn(),
      readStagedDraft: vi.fn(),
      finalizeSpec: vi.fn(),
    } as unknown as Window['desktopShell'];

    const client = createDesktopShellClient(() => shell);

    const submissionDraft = toPlannerDirectSubmissionDraft(draft);

    await client.submitPlannerDraft(submissionDraft, 'confirm');

    expect(shell.submitPlannerDraft).toHaveBeenCalledWith(submissionDraft, 'confirm');
  });

  it('forwards follow-up initiation arguments unchanged', async () => {
    const draft = createFollowUpDraft(
      {
        parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        parentTaskTitle: 'Closed parent task',
        parentQmdRecordId: 'QMD-123',
        parentQmdScope: 'desktop-renderer',
        rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
        followupReason: 'Need a renderer-side adapter seam for the desktop shell.',
        carryForwardSummary: 'The parent task closed successfully and now needs a contained follow-up.',
        childTitle: 'Adapter forwards follow-up data',
        requestedAdjustment: 'Verify the desktop shell adapter passes follow-up arguments through.',
        desiredOutcome: 'Follow-up submission uses the shared adapter seam without payload drift.',
        constraints: ['Preserve child-task lineage.', 'Do not rewrite draft fields.'],
        acceptanceSignals: ['initiateFollowUp receives the same draft object and stage.'],
        planningNotes: 'Local follow-up adapter test only.',
        suggestedPath: 'sequential',
      },
    );

    const shell = {
      getBootstrapInfo: vi.fn(),
      getQueueStatus: vi.fn(),
      getEnvironmentStatus: vi.fn(),
      getObservabilitySnapshot: vi.fn(),
      submitPlannerDraft: vi.fn(),
      initiateFollowUp: vi.fn().mockResolvedValue({ ok: true, response: { action: 'followup.begin' } }),
      pickContextPackDirectory: vi.fn(),
      discoverContextPackPrefill: vi.fn(),
      createContextPack: vi.fn(),
      listContextPacks: vi.fn(),
      reseedContextPack: vi.fn(),
      previewContextPackSwitch: vi.fn(),
      applyContextPackSwitch: vi.fn(),
      clearActiveContextPack: vi.fn(),
      activateContextPack: vi.fn(),
      savePlannerDraft: vi.fn(),
      readStagedDraft: vi.fn(),
      finalizeSpec: vi.fn(),
    } as unknown as Window['desktopShell'];

    const client = createDesktopShellClient(() => shell);

    const submissionDraft = toFollowUpDirectSubmissionDraft(draft);

    await client.initiateFollowUp(submissionDraft, 'preview');

    expect(shell.initiateFollowUp).toHaveBeenCalledWith(submissionDraft, 'preview');
  });

  it('forwards context-pack activation and bootstrap info calls unchanged', async () => {
    const shell = {
      getBootstrapInfo: vi.fn().mockResolvedValue({ appName: 'TaskSail' }),
      getQueueStatus: vi.fn(),
      getEnvironmentStatus: vi.fn(),
      getObservabilitySnapshot: vi.fn(),
      submitPlannerDraft: vi.fn(),
      initiateFollowUp: vi.fn(),
      pickContextPackDirectory: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.pickDirectory' } }),
      discoverContextPackPrefill: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.discoverPrefill' } }),
      createContextPack: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.create' } }),
      listContextPacks: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.list' } }),
      reseedContextPack: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.reseed' } }),
      previewContextPackSwitch: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.previewSwitch' } }),
      applyContextPackSwitch: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.applySwitch' } }),
      clearActiveContextPack: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.clearActive' } }),
      activateContextPack: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.activate' } }),
      savePlannerDraft: vi.fn(),
      readStagedDraft: vi.fn(),
      finalizeSpec: vi.fn(),
    } as unknown as Window['desktopShell'];

    const client = createDesktopShellClient(() => shell);

    await expect(client.getBootstrapInfo()).resolves.toEqual({ appName: 'TaskSail' });
    await client.pickContextPackDirectory('discovery-root', '/tmp/workspaces');
    await client.discoverContextPackPrefill('/tmp/estate-root', 'distributed');
    await client.createContextPack({
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
    });
    await client.listContextPacks();
    await client.reseedContextPack('/tmp/context-packs/orders-estate');
    await client.previewContextPackSwitch(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
    );
    await client.applyContextPackSwitch(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
    );
    await client.clearActiveContextPack();
    await client.activateContextPack('platform-default');

    expect(shell.getBootstrapInfo).toHaveBeenCalledTimes(1);
    expect(shell.pickContextPackDirectory).toHaveBeenCalledWith(
      'discovery-root',
      '/tmp/workspaces',
    );
    expect(shell.discoverContextPackPrefill).toHaveBeenCalledWith(
      '/tmp/estate-root',
      'distributed',
    );
    expect(shell.createContextPack).toHaveBeenCalledWith({
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
    });
    expect(shell.listContextPacks).toHaveBeenCalledTimes(1);
    expect(shell.reseedContextPack).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
    );
    expect(shell.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
    );
    expect(shell.applyContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
    );
    expect(shell.clearActiveContextPack).toHaveBeenCalledTimes(1);
    expect(shell.activateContextPack).toHaveBeenCalledWith('platform-default');
  });

  it('uses the live window desktop shell when the shared client is imported once', async () => {
    window.desktopShell = {
      getBootstrapInfo: vi.fn().mockResolvedValue({ appName: 'TaskSail' }),
      getQueueStatus: vi.fn().mockResolvedValue({ ok: true, response: { action: 'queue.readStatus' } }),
      deletePendingItem: vi.fn().mockResolvedValue({ ok: true, response: { action: 'queue.deletePendingItem' } }),
      getEnvironmentStatus: vi.fn().mockResolvedValue({ ok: true, response: { action: 'environment.readStatus' } }),
      getObservabilitySnapshot: vi.fn().mockResolvedValue({ ok: true, response: { action: 'observability.readSnapshot' } }),
      submitPlannerDraft: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.submitDraft' } }),
      initiateFollowUp: vi.fn().mockResolvedValue({ ok: true, response: { action: 'followup.begin' } }),
      pickContextPackDirectory: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.pickDirectory' } }),
      discoverContextPackPrefill: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.discoverPrefill' } }),
      createContextPack: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.create' } }),
      listContextPacks: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.list' } }),
      reseedContextPack: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.reseed' } }),
      previewContextPackSwitch: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.previewSwitch' } }),
      applyContextPackSwitch: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.applySwitch' } }),
      clearActiveContextPack: vi
        .fn()
        .mockResolvedValue({ ok: true, response: { action: 'contextPack.clearActive' } }),
      activateContextPack: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.activate' } }),
      startPlannerSession: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.startSession' } }),
      sendPlannerMessage: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage' } }),
      endPlannerSession: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.endSession' } }),
      savePlannerDraft: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.saveDraft' } }),
      readStagedDraft: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readStagedDraft' } }),
      finalizeSpec: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.finalizeSpec' } }),
      pickMarkdownFile: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.pickMarkdownFile', mode: 'cancelled' } }),
      listArchivedTasks: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.listArchivedTasks', mode: 'empty', tasks: [] } }),
      submitReinforcementFeedback: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.submitFeedback' } }),
      updateRealignmentDoc: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.updateRealignmentDoc' } }),
      readReinforcementOverview: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.readOverview' } }),
      listReinforcementTasks: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.listTasks' } }),
      readAgentRewards: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.readAgentRewards' } }),
      listRealignmentSessions: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.listRealignmentSessions' } }),
      readRealignmentDoc: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.readRealignmentDoc' } }),
      checkActiveWorkGuard: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.checkActiveWorkGuard', allowed: true } }),
      startRealignment: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.startRealignment', mode: 'started' } }),
      listExternalMcpServers: vi.fn().mockResolvedValue({ ok: true, response: { action: 'externalMcp.list', servers: [] } }),
      addExternalMcpServer: vi.fn().mockResolvedValue({ ok: true, response: { action: 'externalMcp.add', servers: [] } }),
      updateExternalMcpServer: vi.fn().mockResolvedValue({ ok: true, response: { action: 'externalMcp.update', servers: [] } }),
      removeExternalMcpServer: vi.fn().mockResolvedValue({ ok: true, response: { action: 'externalMcp.remove', servers: [] } }),
      toggleExternalMcpServer: vi.fn().mockResolvedValue({ ok: true, response: { action: 'externalMcp.toggleEnabled', servers: [] } }),
      validateExternalMcpConnection: vi.fn().mockResolvedValue({ ok: true, response: { action: 'externalMcp.validateConnection', success: true } }),
      loadAgentConfig: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.loadAgents', agents: [] } }),
      loadModelCatalog: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.loadModelCatalog', models: [] } }),
      saveAgentModels: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.saveAgentModels', agents: [] } }),
      addModel: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.addModel', models: [] } }),
      removeModel: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentConfig.removeModel', models: [] } }),
      readTaskBoard: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.readBoard' } }),
      readTaskContent: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.readTaskContent', mode: 'not-found', message: 'Not found.', content: '', fileName: '' } }),
      reorderPending: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.reorderPending' } }),
      requeueErrorItem: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.requeueErrorItem' } }),
      deleteTask: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.deleteTask', mode: 'deleted', message: 'Deleted.', fileName: 'task.md', column: 'open' } }),
      moveToPending: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.moveToPending', mode: 'moved', message: 'Moved.', movedItem: 'task.md' } }),
      moveToOpen: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.moveToOpen', mode: 'moved', message: 'Moved.', movedItem: 'task.md' } }),
      setRepositoryType: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.setRepositoryType', mode: 'updated', message: 'Updated.' } }),
      getBackendServiceStatus: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'idle', lastCheckedAt: null, error: null, message: 'Idle.' } }),
      startBackendServices: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'healthy', lastCheckedAt: null, error: null, message: 'Running.' } }),
      stopBackendServices: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'idle', lastCheckedAt: null, error: null, message: 'Stopped.' } }),
      checkBackendHealth: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'healthy', lastCheckedAt: null, error: null, message: 'Healthy.' } }),
      listInstructionFiles: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentInstructions.listFiles', mode: 'read-only', message: '0 file(s).', files: [] } }),
      readInstructionFile: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentInstructions.readFile', mode: 'read-only', message: 'Read.', fileName: '', relativePath: '', content: '' } }),
      writeInstructionFile: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentInstructions.writeFile', mode: 'mutated', message: 'Saved.', fileName: '', relativePath: '' } }),
      onStreamEvent: vi.fn().mockReturnValue(vi.fn()),
      onPlannerEvent: vi.fn().mockReturnValue(vi.fn()),
      onTaskBoardUpdate: vi.fn().mockReturnValue(vi.fn()),
    } as Window['desktopShell'];

    await desktopShellClient.getQueueStatus();
    await desktopShellClient.pickContextPackDirectory('discovery-root');
    await desktopShellClient.discoverContextPackPrefill('/tmp/estate-root');
    await desktopShellClient.reseedContextPack('/tmp/context-packs/orders-estate');
    await desktopShellClient.previewContextPackSwitch('/tmp/context-packs/orders-estate');
    await desktopShellClient.createContextPack({
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
    });
    await desktopShellClient.activateContextPack('platform-default');

    expect(window.desktopShell.getQueueStatus).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.pickContextPackDirectory).toHaveBeenCalledWith(
      'discovery-root',
      undefined,
    );
    expect(window.desktopShell.discoverContextPackPrefill).toHaveBeenCalledWith(
      '/tmp/estate-root',
      undefined,
    );
    expect(window.desktopShell.reseedContextPack).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
    );
    expect(window.desktopShell.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      undefined,
      undefined,
      undefined,
    );
    expect(window.desktopShell.createContextPack).toHaveBeenCalledWith({
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
    });
    expect(window.desktopShell.activateContextPack).toHaveBeenCalledWith('platform-default');

    // Exercise external MCP client methods.
    await desktopShellClient.listExternalMcpServers();
    await desktopShellClient.addExternalMcpServer({
      id: 'test', display_name: 'Test', purpose: 'Test',
      transport: 'sse', url: 'https://x.com', enabled: true,
      agent_scope: { mode: 'allowlist', agent_ids: ['swe'] },
    });
    await desktopShellClient.updateExternalMcpServer({
      id: 'test', display_name: 'Updated', purpose: 'Updated',
      transport: 'http', url: 'https://y.com', enabled: false,
      agent_scope: { mode: 'allowlist', agent_ids: ['qa'] },
    });
    await desktopShellClient.removeExternalMcpServer('test');
    await desktopShellClient.toggleExternalMcpServer('test');
    await desktopShellClient.validateExternalMcpConnection({
      transport: 'sse', url: 'https://x.com/sse',
    });

    expect(window.desktopShell.listExternalMcpServers).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.addExternalMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test', display_name: 'Test' }),
    );
    expect(window.desktopShell.updateExternalMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test', display_name: 'Updated' }),
    );
    expect(window.desktopShell.removeExternalMcpServer).toHaveBeenCalledWith('test');
    expect(window.desktopShell.toggleExternalMcpServer).toHaveBeenCalledWith('test');
    expect(window.desktopShell.validateExternalMcpConnection).toHaveBeenCalledWith({
      transport: 'sse', url: 'https://x.com/sse',
    });

    await desktopShellClient.loadAgentConfig();
    await desktopShellClient.loadModelCatalog();
    await desktopShellClient.saveAgentModels([{ agent_id: 'planning-agent', model_id: 'gpt-4.1' }]);
    await desktopShellClient.addModel('GPT 4.1', 'gpt-4.1');
    await desktopShellClient.removeModel('gpt-4.1');

    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).loadAgentConfig).toHaveBeenCalledTimes(1);
    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).loadModelCatalog).toHaveBeenCalledTimes(1);
    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).saveAgentModels).toHaveBeenCalledWith([
      { agent_id: 'planning-agent', model_id: 'gpt-4.1' },
    ]);
    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).addModel).toHaveBeenCalledWith('GPT 4.1', 'gpt-4.1');
    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).removeModel).toHaveBeenCalledWith('gpt-4.1');

    // Exercise reinforcement write methods.
    await desktopShellClient.submitReinforcementFeedback({
      contextPackDir: '/packs/pack-a',
      taskId: 'T-1',
      feedbackType: 'positive',
      starRating: 5,
      comment: 'great',
    });
    await desktopShellClient.updateRealignmentDoc({
      contextPackDir: '/packs/pack-a',
      field: 'priority',
      value: '"high"',
    });

    expect(window.desktopShell.submitReinforcementFeedback).toHaveBeenCalledWith({
      contextPackDir: '/packs/pack-a',
      taskId: 'T-1',
      feedbackType: 'positive',
      starRating: 5,
      comment: 'great',
    });
    expect(window.desktopShell.updateRealignmentDoc).toHaveBeenCalledWith({
      contextPackDir: '/packs/pack-a',
      field: 'priority',
      value: '"high"',
    });

    // Exercise reinforcement read methods.
    await desktopShellClient.readReinforcementOverview();
    await desktopShellClient.listReinforcementTasks('2026');
    await desktopShellClient.readAgentRewards();
    await desktopShellClient.listRealignmentSessions();
    await desktopShellClient.readRealignmentDoc();

    expect(window.desktopShell.readReinforcementOverview).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.listReinforcementTasks).toHaveBeenCalledWith('2026');
    expect(window.desktopShell.readAgentRewards).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.listRealignmentSessions).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.readRealignmentDoc).toHaveBeenCalledTimes(1);
  });

  it('clientFactory mock returns cancelled response for pickMarkdownFile by default', async () => {
    const { createMockClient } = await import('../../test/factories/clientFactory');
    const mockClient = createMockClient();

    const result = await mockClient.pickMarkdownFile();
    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'planner.pickMarkdownFile',
        mode: 'cancelled',
        filename: null,
        content: null,
      }),
    });
  });
});
