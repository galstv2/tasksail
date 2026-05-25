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
      listRepoTree: vi.fn(),
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
      listRepoTree: vi.fn(),
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

  it('forwards planner history and replay message arguments unchanged', async () => {
    const shell = {
      startPlannerSession: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.startSession' } }),
      updatePlannerSessionPersonality: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.updateSessionPersonality' } }),
      sendPlannerMessage: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage' } }),
      listPlannerConversationHistory: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.listConversationHistory' } }),
      hydratePlannerConversation: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.hydrateConversation' } }),
    } as unknown as Window['desktopShell'];

    const client = createDesktopShellClient(() => shell);

    await client.startPlannerSession({
      contextPackDir: '/tmp/context-packs/orders-estate',
      replayConversationId: 'conversation-1',
    });
    await client.updatePlannerSessionPersonality({ lilyPersonalityId: 'clinical' });
    await client.sendPlannerMessage('Message sent to Lily.', 'Message shown in transcript.');
    await client.sendPlannerMessage('Plain message only.');
    await client.listPlannerConversationHistory();
    await client.hydratePlannerConversation('conversation-1');

    expect(shell.startPlannerSession).toHaveBeenCalledWith({
      contextPackDir: '/tmp/context-packs/orders-estate',
      replayConversationId: 'conversation-1',
    });
    expect(shell.updatePlannerSessionPersonality).toHaveBeenCalledWith({ lilyPersonalityId: 'clinical' });
    expect(shell.sendPlannerMessage).toHaveBeenNthCalledWith(
      1,
      'Message sent to Lily.',
      'Message shown in transcript.',
    );
    expect(shell.sendPlannerMessage).toHaveBeenNthCalledWith(
      2,
      'Plain message only.',
      undefined,
    );
    expect(shell.listPlannerConversationHistory).toHaveBeenCalledTimes(1);
    expect(shell.hydratePlannerConversation).toHaveBeenCalledWith('conversation-1');
  });

  it('forwards parent context bundle payload unchanged through the shell seam', async () => {
    const shell = {
      readParentContextBundle: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readParentContextBundle' } }),
    } as unknown as Window['desktopShell'];
    const client = createDesktopShellClient(() => shell);
    const payload = {
      parentTaskId: 'TASK-001',
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    };

    await client.readParentContextBundle(payload);

    expect(shell.readParentContextBundle).toHaveBeenCalledWith(payload);
  });

  it('forwards parent chain archive bundle payload unchanged through the shell seam', async () => {
    const shell = {
      readParentChainArchiveBundle: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readParentChainArchiveBundle' } }),
    } as unknown as Window['desktopShell'];
    const client = createDesktopShellClient(() => shell);
    const payload = {
      parentTaskId: 'TASK-001',
      rootTaskId: 'TASK-ROOT',
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    };

    await client.readParentChainArchiveBundle(payload);

    expect(shell.readParentChainArchiveBundle).toHaveBeenCalledWith(payload);
  });

  it('forwards parent archive markdown payload unchanged through the shell seam', async () => {
    const shell = {
      readParentArchiveMarkdown: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readParentArchiveMarkdown' } }),
    } as unknown as Window['desktopShell'];
    const client = createDesktopShellClient(() => shell);
    const payload = {
      parentTaskId: 'TASK-001',
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    };

    await client.readParentArchiveMarkdown(payload);

    expect(shell.readParentArchiveMarkdown).toHaveBeenCalledWith(payload);
  });

  it('forwards validateChildTaskFocus payload unchanged through the shell seam', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.validateChildTaskFocus',
        mode: 'valid',
        message: 'Parent task focus is still valid.',
        issues: [],
      },
    });

    const shell = {
      validateChildTaskFocus,
    } as unknown as Window['desktopShell'];

    const client = createDesktopShellClient(() => shell);
    const payload = {
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

    await client.validateChildTaskFocus(payload);

    expect(validateChildTaskFocus).toHaveBeenCalledTimes(1);
    expect(validateChildTaskFocus).toHaveBeenCalledWith(payload);
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
      listRepoTree: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.listRepoTree' } }),
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
    await client.listRepoTree('/tmp/estate-root/orders-api', 'src');
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
    expect(shell.listRepoTree).toHaveBeenCalledWith('/tmp/estate-root/orders-api', 'src');
    expect(shell.reseedContextPack).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
    );
    expect(shell.previewContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
      undefined,
    );
    expect(shell.applyContextPackSwitch).toHaveBeenCalledWith(
      '/tmp/context-packs/orders-estate',
      'focused',
      ['orders-api'],
      ['services-billing'],
      undefined,
    );
    expect(shell.clearActiveContextPack).toHaveBeenCalledTimes(1);
    expect(shell.activateContextPack).toHaveBeenCalledWith('platform-default');
  });

  it('uses the live window desktop shell when the shared client is imported once', async () => {
    window.desktopShell = {
      log: {
        emit: vi.fn().mockResolvedValue({ ok: true }),
      },
      getBootstrapInfo: vi.fn().mockResolvedValue({ appName: 'TaskSail' }),
      describeActiveProvider: vi.fn().mockResolvedValue({
        providerId: 'test-provider',
        homeDirName: 'test-home',
        registryPath: '/repo/.provider/registry.json',
        agentConfigPaths: {
          root: '.provider',
          instructions: '.provider/instructions',
          prompts: '.provider/prompts',
          profiles: '.provider/agents',
          registry: '.provider/registry.json',
        },
        promptPathEnvVars: { handoffsDir: 'TEST_HANDOFFS_DIR', implStepsDir: 'TEST_IMPL_STEPS_DIR' },
        contextPackEnvVars: { paths: 'TEST_CONTEXT_PACK_PATHS', searchRoots: 'TEST_CONTEXT_PACK_SEARCH_ROOTS' },
        roster: [],
      }),
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
      listRepoTree: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.listRepoTree' } }),
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
      updatePlannerSessionPersonality: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.updateSessionPersonality' } }),
      validateChildTaskFocus: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Parent task focus is still valid.', issues: [] } }),
      sendPlannerMessage: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage' } }),
      endPlannerSession: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.endSession' } }),
      savePlannerDraft: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.saveDraft' } }),
      readStagedDraft: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readStagedDraft' } }),
      finalizeSpec: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.finalizeSpec' } }),
      pickMarkdownFile: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.pickMarkdownFile', mode: 'cancelled' } }),
      uploadSpec: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.uploadSpec', mode: 'submitted', accepted: true, message: '', draftTitle: '', submittedPath: '', observationMode: true } }),
      getBypassTemplate: vi.fn().mockResolvedValue(''),
      listArchivedTasks: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.listArchivedTasks', mode: 'empty', tasks: [] } }),
      readParentContextBundle: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readParentContextBundle' } }),
      readParentChainArchiveBundle: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readParentChainArchiveBundle' } }),
      readParentArchiveMarkdown: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.readParentArchiveMarkdown' } }),
      listPlannerConversationHistory: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.listConversationHistory', mode: 'empty', conversations: [] } }),
      hydratePlannerConversation: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.hydrateConversation', mode: 'not-found', record: null } }),
      submitReinforcementFeedback: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.submitFeedback' } }),
      updateRealignmentDoc: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.updateRealignmentDoc' } }),
      readReinforcementOverview: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.readOverview' } }),
      listReinforcementTasks: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.listTasks' } }),
      readAgentRewards: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.readAgentRewards' } }),
      listRealignmentSessions: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.listRealignmentSessions' } }),
      readRealignmentDoc: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.readRealignmentDoc' } }),
      checkActiveWorkGuard: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.checkActiveWorkGuard', allowed: true } }),
      startRealignment: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.startRealignment', mode: 'started' } }),
      runRealignmentAnalysis: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.runRealignmentAnalysis', mode: 'analysis-started' } }),
      dismissRealignment: vi.fn().mockResolvedValue({ ok: true, response: { action: 'reinforcement.dismissRealignment', mode: 'dismissed' } }),
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
      killTask: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.killTask', mode: 'kill-requested', message: 'Stop requested.', taskId: 'task' } }),
      retryKillCleanup: vi.fn().mockResolvedValue({ ok: true, response: { action: 'taskBoard.retryKillCleanup', mode: 'cleanup-retry-scheduled', message: 'Retry cleanup scheduled.', taskId: 'task' } }),
      setRepositoryType: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.setRepositoryType', mode: 'updated', message: 'Updated.' } }),
      setRepoCategory: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.setRepoCategory', mode: 'updated', message: 'Updated.' } }),
      getBackendServiceStatus: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'idle', lastCheckedAt: null, error: null, message: 'Idle.' } }),
      startBackendServices: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'healthy', lastCheckedAt: null, error: null, message: 'Running.' } }),
      stopBackendServices: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'idle', lastCheckedAt: null, error: null, message: 'Stopped.' } }),
      checkBackendHealth: vi.fn().mockResolvedValue({ ok: true, response: { action: 'services.readStatus', mode: 'observed', status: 'healthy', lastCheckedAt: null, error: null, message: 'Healthy.' } }),
      listInstructionFiles: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentInstructions.listFiles', mode: 'read-only', message: '0 file(s).', files: [] } }),
      readInstructionFile: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentInstructions.readFile', mode: 'read-only', message: 'Read.', fileName: '', relativePath: '', content: '' } }),
      writeInstructionFile: vi.fn().mockResolvedValue({ ok: true, response: { action: 'agentInstructions.writeFile', mode: 'mutated', message: 'Saved.', fileName: '', relativePath: '' } }),
      saveDeepFocusSelections: vi.fn().mockResolvedValue({ ok: true, response: { action: 'deepFocus.saveSelections', mode: 'saved', message: 'Saved.' } }),
      loadDeepFocusSelections: vi.fn().mockResolvedValue({ ok: true, response: { action: 'deepFocus.loadSelections', mode: 'read-only', message: 'No saved selections found.', selections: null } }),
      clearDeepFocusSelections: vi.fn().mockResolvedValue({ ok: true, response: { action: 'deepFocus.clearSelections', mode: 'cleared', message: 'Cleared.' } }),
      listFocusFilters: vi.fn().mockResolvedValue({ ok: true, response: { action: 'focusFilters.list', mode: 'read-only', filters: [], message: 'No focus filters saved.' } }),
      createFocusFilter: vi.fn().mockResolvedValue({ ok: true, response: { action: 'focusFilters.create', mode: 'created', filter: null, filters: [], message: 'Focus filter saved.' } }),
      deleteFocusFilter: vi.fn().mockResolvedValue({ ok: true, response: { action: 'focusFilters.delete', mode: 'deleted', filters: [], message: 'Focus filter deleted.' } }),
      loadContextPackSidebarState: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPackSidebarState.load', mode: 'read-only', state: null, message: 'No context-pack sidebar state saved.' } }),
      saveContextPackSidebarState: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPackSidebarState.save', mode: 'saved', message: 'Context-pack sidebar state saved.' } }),
      deleteContextPack: vi.fn().mockResolvedValue({ ok: true, response: { action: 'contextPack.delete', mode: 'deleted', contextPackDir: '/tmp/context-pack', mirrorDir: '/tmp/mirror', message: 'Context pack deleted.' } }),
      cancelTask: vi.fn().mockResolvedValue({ ok: true, response: { action: 'cancel-task', mode: 'cancelled', message: 'Pipeline stopped.', taskId: 'TASK-1' } }),
      setTerminalTaskScope: vi.fn().mockResolvedValue({ ok: true, response: { action: 'terminal.setTaskScope', mode: 'scoped', selectedTaskGuid: null, events: [], taskScopes: [], message: 'Terminal task scope reset to all tasks.' } }),
      onStreamEvent: vi.fn().mockReturnValue(vi.fn()),
      onPlannerEvent: vi.fn().mockReturnValue(vi.fn()),
      onTaskBoardUpdate: vi.fn().mockReturnValue(vi.fn()),
      subscribeContextPackCatalogChanged: vi.fn().mockReturnValue(vi.fn()),
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
      agent_scope: { mode: 'allowlist', agent_ids: ['provider-qa'] },
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
    await desktopShellClient.saveAgentModels([{ agent_id: 'provider-planner', model_id: 'gpt-4.1' }]);
    await desktopShellClient.addModel('GPT 4.1', 'gpt-4.1');
    await desktopShellClient.removeModel('gpt-4.1');

    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).loadAgentConfig).toHaveBeenCalledTimes(1);
    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).loadModelCatalog).toHaveBeenCalledTimes(1);
    expect((window.desktopShell as unknown as Record<string, ReturnType<typeof vi.fn>>).saveAgentModels).toHaveBeenCalledWith([
      { agent_id: 'provider-planner', model_id: 'gpt-4.1' },
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
    await desktopShellClient.runRealignmentAnalysis({
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
    });
    await desktopShellClient.dismissRealignment({
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
    });

    expect(window.desktopShell.readReinforcementOverview).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.listReinforcementTasks).toHaveBeenCalledWith('2026');
    expect(window.desktopShell.readAgentRewards).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.listRealignmentSessions).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.readRealignmentDoc).toHaveBeenCalledTimes(1);
    expect(window.desktopShell.runRealignmentAnalysis).toHaveBeenCalledWith({
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
    });
    expect(window.desktopShell.dismissRealignment).toHaveBeenCalledWith({
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
    });
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
