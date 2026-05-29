import { describe, expect, it } from 'vitest';

import type {
  ArchivedTaskChildParentBlockedTip,
  AgentConfigLoadCapabilitiesResponse,
  ContextPackListRepoTreeResponse,
  DesktopActionResponse,
  DesktopInvokeResult,
  PlannerListArchivedTasksResponse,
  PlannerStartSessionPayload,
  TaskNotificationSnapshot,
  TaskBoardReadBoardResponse,
  TerminalSetTaskScopeResponse,
} from './desktopContract';
import { DESKTOP_ACTION_NAMES, DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL } from './desktopContract';
import { validateDesktopActionRequest } from './desktopContractValidators';

describe('desktopContract', () => {
  it('keeps planner.startSession approved with child execution scope payload typing', () => {
    expect(DESKTOP_ACTION_NAMES).toContain('planner.startSession');
    expect(DESKTOP_ACTION_NAMES).toContain('planner.updateSessionPersonality');
    const payload: PlannerStartSessionPayload = {
      contextPackDir: '/tmp/context-packs/orders-estate',
      lilyPersonalityId: 'clinical',
      childTaskExecutionScope: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        contextPackId: 'orders-estate',
        scopeMode: 'focused',
        selectedRepoIds: ['orders-api'],
        selectedFocusIds: [],
        repositoryTypes: { 'orders-api': 'primary' },
        deepFocusEnabled: false,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    };

    expect(payload.childTaskExecutionScope?.selectedRepoIds).toEqual(['orders-api']);
    expect(payload.childTaskExecutionScope?.repositoryTypes?.['orders-api']).toBe('primary');
    expect(payload.lilyPersonalityId).toBe('clinical');
  });

  it('includes terminal.setTaskScope in the approved desktop actions', () => {
    expect(DESKTOP_ACTION_NAMES).toContain('terminal.setTaskScope');
    const response: TerminalSetTaskScopeResponse = {
      action: 'terminal.setTaskScope',
      mode: 'scoped',
      selectedTaskGuid: null,
      events: [],
      taskScopes: [],
      message: 'Terminal task scope reset to all tasks.',
    };
    expect(response.action).toBe('terminal.setTaskScope');
  });

  it('accepts taskboard active, activating, stopping, and pending read-model items', () => {
    const response: TaskBoardReadBoardResponse = {
      action: 'taskBoard.readBoard',
      mode: 'read-only',
      message: '0 open, 4 pending, 0 failed, 0 completed.',
      dropboxItems: [],
      pendingItems: [
        { fileName: 'ACTIVE.md', taskId: 'ACTIVE', title: 'Active', state: 'active' },
        {
          fileName: 'ACTIVATING.md',
          taskId: 'ACTIVATING',
          title: 'Activating',
          state: 'activating',
          activationPhase: 'materializing-worktree',
          activationStartedAt: '2026-05-23T10:00:00Z',
          activationUpdatedAt: '2026-05-23T10:00:05Z',
        },
        {
          fileName: 'STOPPING.md',
          taskId: 'STOPPING',
          title: 'Stopping',
          state: 'stopping',
          stopRequestedAt: '2026-05-23T10:00:10Z',
          stopCleanupStatus: 'failed',
          stopCleanupFailedAt: '2026-05-23T10:01:10Z',
          stopCleanupErrorCode: 'failed-item-cleanup-failed',
          stopCleanupMessage: 'Cleanup failed.',
          stopCleanupRetryable: true,
        },
        { fileName: 'PENDING.md', taskId: 'PENDING', title: 'Pending', state: 'pending' },
      ],
      errorItems: [],
      completedItems: [],
    };

    expect(response.pendingItems.map((item) => item.state)).toEqual([
      'active',
      'activating',
      'stopping',
      'pending',
    ]);
  });

  it('keeps taskBoard.retryKillCleanup approved', () => {
    expect(DESKTOP_ACTION_NAMES).toContain('taskBoard.retryKillCleanup');
    expect(validateDesktopActionRequest({
      action: 'taskBoard.retryKillCleanup',
      payload: { fileName: 'TASK-A.md', taskId: 'TASK-A' },
    })).toEqual([]);
  });

  it('keeps task notification actions and channel approved', () => {
    expect(DESKTOP_SHELL_TASK_NOTIFICATIONS_CHANNEL).toBe('desktop-shell:task-notifications');
    expect(DESKTOP_ACTION_NAMES).toEqual(expect.arrayContaining([
      'taskNotifications.read',
      'taskNotifications.markSeen',
      'taskNotifications.dismiss',
      'taskNotifications.dismissAll',
    ]));

    const response: TaskNotificationSnapshot = {
      action: 'taskNotifications.read',
      mode: 'read-only',
      unseenCount: 0,
      notifications: [],
      generatedAt: '2026-05-25T10:00:00.000Z',
      message: 'Loaded task notifications.',
    };
    const desktopResponse: DesktopActionResponse = response;
    expect(desktopResponse.action).toBe('taskNotifications.read');
  });

  it('accepts optional test metadata on repo tree responses', () => {
    const response: ContextPackListRepoTreeResponse = {
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      currentPath: 'src',
      repoLocalPath: '/repo',
      truncated: false,
      entries: [
        {
          name: 'externalMcpHandlers.test.ts',
          relativePath: 'src/frontend/desktop/electron/externalMcpHandlers.test.ts',
          kind: 'file',
          hasChildren: false,
          isTest: true,
          artifactType: 'test-code',
          pathKind: 'tests',
        },
      ],
    };

    expect(response.entries[0]?.isTest).toBe(true);
  });

  it('accepts planner submit requests without sourceState and with legacy complete sourceState', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.submitDraft',
        payload: {
          stage: 'confirm',
          draft: {
            title: 'Refine planner composer review flow',
            taskKind: 'standard',
            summary: 'Validate approved desktop submission.',
            desiredOutcome: 'Dropbox submission succeeds through the helper seam.',
            constraints: 'Keep validation within approved desktop contracts.',
            acceptanceSignals: 'Submitted path is surfaced in the UI.',
            criticalRequirements: 'CR-1: Preserve desktop submit behavior.',
            compatibilityRequirements: 'COMP-1: Keep legacy sourceState compatible.',
            requiredValidation: 'VAL-1: Runtime validation accepts the draft.',
            parentTaskId: '',
            parentQmdRecordId: '',
            parentQmdScope: '',
            rootTaskId: '',
            followupReason: '',
            carryForwardSummary: '',
            suggestedPath: 'sequential',
            planningNotes: 'Operator-triggered confirm path.',
          },
        },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'planner.submitDraft',
        payload: {
          stage: 'confirm',
          draft: {
            title: 'Refine planner composer review flow',
            taskKind: 'standard',
            summary: 'Validate approved desktop submission.',
            desiredOutcome: 'Dropbox submission succeeds through the helper seam.',
            constraints: 'Keep validation within approved desktop contracts.',
            acceptanceSignals: 'Submitted path is surfaced in the UI.',
            criticalRequirements: 'CR-1: Preserve desktop submit behavior.',
            compatibilityRequirements: 'COMP-1: Keep legacy sourceState compatible.',
            requiredValidation: 'VAL-1: Runtime validation accepts the draft.',
            parentTaskId: '',
            parentQmdRecordId: '',
            parentQmdScope: '',
            rootTaskId: '',
            followupReason: '',
            carryForwardSummary: '',
            suggestedPath: 'sequential',
            planningNotes: 'Operator-triggered confirm path.',
            sourceState: 'complete',
          },
        },
      }),
    ).toEqual([]);
  });

  it('accepts creation-oriented context-pack requests', () => {
    expect(
      validateDesktopActionRequest({
        action: 'contextPack.pickDirectory',
        payload: {
          purpose: 'discovery-root',
          defaultPath: '/tmp/workspaces',
        },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.discoverPrefill',
        payload: {
          rootPath: '/tmp/estate-root',
          mode: 'auto',
        },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.create',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          discoveryRoot: '/tmp/estate-root',
          mode: 'distributed',
          bootstrapAnswers: {
            contextPackId: 'orders-estate',
            estateName: 'Orders Estate',
            defaultScopeMode: 'focused',
            primaryWorkingRepoIds: ['orders-api'],
            repositories: [
              {
                repoRoot: '/tmp/estate-root/orders-api',
                repoName: 'Orders API',
                repoId: 'orders-api',
                systemLayer: 'backend',
                repositoryType: 'primary',
                languages: ['python'],
                artifactRoots: ['src'],
                documentPaths: ['docs'],
              },
            ],
          },
        },
      }),
    ).toEqual([]);
  });

  it('rejects malformed creation-oriented context-pack requests', () => {
    expect(
      validateDesktopActionRequest({
        action: 'contextPack.pickDirectory',
        payload: {
          purpose: 'unknown-purpose',
          defaultPath: 'relative/path',
        },
      }),
    ).toEqual([
      'payload.purpose must be discovery-root or context-pack-destination.',
      'payload.defaultPath must be an absolute path string when provided.',
    ]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.discoverPrefill',
        payload: {
          rootPath: 'relative/path',
          mode: 'wide',
        },
      }),
    ).toEqual([
      'payload.rootPath must be an absolute path string.',
      'payload.mode must be one of auto, distributed, distributed-platform, monolith, monolith-platform.',
    ]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.create',
        payload: {
          contextPackDir: 'relative/path',
          discoveryRoot: 'relative/root',
          mode: 'wide',
          bootstrapAnswers: {
            contextPackId: '',
            estateName: '',
            repositories: [
                {
                  repoRoot: 'relative/repo',
                  repoName: '',
                  repositoryType: 'leader',
                  systemLayer: 'unknown',
                  languages: ['python', ''],
                },
            ],
            focusableAreas: [
              {
                adjacentFocusAreaIds: ['billing', ''],
              },
            ],
          },
        },
      }),
    ).toEqual([
      'payload.contextPackDir must be an absolute path string.',
      'payload.discoveryRoot must be an absolute path string.',
      'payload.mode must be one of distributed, distributed-platform, monolith, monolith-platform.',
      'payload.bootstrapAnswers.contextPackId must be a non-empty string.',
      'payload.bootstrapAnswers.estateName must be a non-empty string.',
      'payload.bootstrapAnswers.repositories[0].repoRoot must be an absolute path string.',
      'payload.bootstrapAnswers.repositories[0].repoName must be a non-empty string.',
      'payload.bootstrapAnswers.repositories[0].repositoryType must be primary or support when provided.',
      'payload.bootstrapAnswers.repositories[0].systemLayer must be backend, frontend, infrastructure, database, documents, or shared.',
      'payload.bootstrapAnswers.repositories[0].languages[1] must be a non-empty string.',
      'payload.bootstrapAnswers.focusableAreas[0] must include focusId, relativePath, or an absolute path.',
      'payload.bootstrapAnswers.focusableAreas[0].adjacentFocusAreaIds[1] must be a non-empty string.',
    ]);
  });

  it('accepts approved context-pack switch requests', () => {
    expect(
      validateDesktopActionRequest({
        action: 'contextPack.previewSwitch',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api', 'orders-web'],
          selectedFocusIds: ['services-billing'],
        },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.listRepoTree',
        payload: {
          repoLocalPath: '/tmp/estate-root/orders-api',
          relativePath: 'src/components',
        },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.clearActive',
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.reseed',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
        },
      }),
    ).toEqual([]);
  });

  it('rejects malformed context-pack switch payloads', () => {
    expect(
      validateDesktopActionRequest({
        action: 'contextPack.listRepoTree',
        payload: {
          repoLocalPath: 'relative/path',
          relativePath: '../secrets',
        },
      }),
    ).toEqual([
      'payload.repoLocalPath must be an absolute path string.',
      'payload.relativePath must be a repo-root-relative path without traversal.',
    ]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: 'relative/path',
          scopeMode: 'wide-open',
          selectedRepoIds: ['orders-api', ''],
          selectedFocusIds: [''],
        },
      }),
    ).toEqual([
      'payload.contextPackDir must be an absolute path string.',
      'payload.scopeMode must be focused.',
      'payload.selectedRepoIds[1] must be a non-empty string.',
      'payload.selectedFocusIds[0] must be a non-empty string.',
    ]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.reseed',
        payload: {
          contextPackDir: 'relative/path',
        },
      }),
    ).toEqual(['payload.contextPackDir must be an absolute path string.']);
  });

  it('accepts planner.pickMarkdownFile as a payload-less action', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.pickMarkdownFile',
      }),
    ).toEqual([]);
  });

  it('accepts planner.listArchivedTasks as a payload-less action', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.listArchivedTasks',
      }),
    ).toEqual([]);
  });

  it('accepts planner.listArchivedTasks blocked child parent tip metadata', () => {
    const blockedTips: ArchivedTaskChildParentBlockedTip[] = [
      { rootTaskId: 'root-open', blockedParentTaskId: 'root-open', currentTipTaskId: 'child-open', chainState: 'planned', boardState: 'open', title: 'Open child', fileName: 'child-open.md', message: 'This chain already has a child task in progress or needing attention.' },
      { rootTaskId: 'root-pending', blockedParentTaskId: 'root-pending', currentTipTaskId: 'child-pending', chainState: 'pending', boardState: 'pending', title: 'Pending child', fileName: 'child-pending.md', message: 'This chain already has a child task in progress or needing attention.' },
      { rootTaskId: 'root-active', blockedParentTaskId: 'root-active', currentTipTaskId: 'child-active', chainState: 'active', boardState: 'active', title: 'Active child', fileName: 'child-active.md', message: 'This chain already has a child task in progress or needing attention.' },
      { rootTaskId: 'root-failed', blockedParentTaskId: 'root-failed', currentTipTaskId: 'child-failed', chainState: 'failed', boardState: 'failed', title: 'Failed child', fileName: 'child-failed.md', message: 'This chain already has a child task in progress or needing attention.' },
      { rootTaskId: 'root-missing', blockedParentTaskId: null, currentTipTaskId: 'child-missing', chainState: 'planned', boardState: null, title: null, fileName: null, message: 'This chain already has a child task in progress or needing attention.' },
    ];
    const response: PlannerListArchivedTasksResponse = {
      action: 'planner.listArchivedTasks',
      mode: 'found',
      message: 'Found archived tasks.',
      tasks: [],
      childParentBlockedTips: blockedTips,
    };

    expect(response.childParentBlockedTips?.map((tip) => tip.boardState)).toEqual([
      'open',
      'pending',
      'active',
      'failed',
      null,
    ]);
  });

  it('accepts planner.finalizeSpec with optional expectedTaskKind payload', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.finalizeSpec',
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'planner.finalizeSpec',
        payload: { expectedTaskKind: 'child-task' },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'planner.finalizeSpec',
        payload: { expectedTaskKind: 'standard' },
      }),
    ).toEqual([]);
  });

  it('rejects planner.finalizeSpec with invalid expectedTaskKind', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.finalizeSpec',
        payload: { expectedTaskKind: 'bogus' },
      }),
    ).toEqual(['payload.expectedTaskKind must be standard or child-task when provided.']);
  });

  it('accepts planner.uploadSpec sidecar authority requirements for bypass task modes', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.uploadSpec',
        payload: {
          content: '## Request Summary\n\nUploaded intake.',
          requirePlannerSidecar: true,
          expectedTaskKind: 'child-task',
        },
      }),
    ).toEqual([]);
  });

  it('rejects malformed planner.uploadSpec sidecar authority payloads', () => {
    expect(
      validateDesktopActionRequest({
        action: 'planner.uploadSpec',
        payload: {
          content: '## Request Summary\n\nUploaded intake.',
          requirePlannerSidecar: 'yes',
        },
      }),
    ).toEqual(['payload.requirePlannerSidecar must be a boolean when provided.']);

    expect(
      validateDesktopActionRequest({
        action: 'planner.uploadSpec',
        payload: {
          content: '## Request Summary\n\nUploaded intake.',
          expectedTaskKind: 'recent',
        },
      }),
    ).toEqual(['payload.expectedTaskKind must be standard or child-task when provided.']);

    expect(
      validateDesktopActionRequest({
        action: 'planner.uploadSpec',
        payload: {
          content: '## Request Summary\n\nUploaded intake.',
          expectedTaskKind: 'child-task',
        },
      }),
    ).toEqual(['payload.expectedTaskKind requires payload.requirePlannerSidecar to be true.']);
  });

  it('rejects malformed context-pack list requests only when action is invalid', () => {
    expect(
      validateDesktopActionRequest({
        action: 'contextPack.list',
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'contextPack.deleteAll',
      }),
    ).toEqual(['action must be one of the approved desktop actions.']);
  });

  it('models agentConfig success payloads as DesktopInvokeResult response variants', () => {
    const response: DesktopActionResponse = {
      action: 'agentConfig.loadAgents',
      mode: 'read-only',
      message: '4 agent(s) loaded.',
      agents: [
        {
          agent_id: 'provider-builder',
          human_name: 'Dalton',
          role_name: 'Software Engineer',
          required_model: 'claude-sonnet-4.6',
          workflow_order: 2,
        },
      ],
    };

    const result: DesktopInvokeResult = {
      ok: true,
      response,
    };

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected ok desktop invoke result.');
    }
    expect(result.response.action).toBe('agentConfig.loadAgents');
    expect(result.response.mode).toBe('read-only');

    const capabilities: AgentConfigLoadCapabilitiesResponse = {
      action: 'agentConfig.loadCapabilities',
      mode: 'read-only',
      message: 'Loaded 2 reasoning effort option(s).',
      providerId: 'copilot',
      cliVersion: 'GitHub Copilot CLI 1.0.54',
      effortChoices: ['low', 'high'],
      stale: false,
    };
    expect(DESKTOP_ACTION_NAMES).toContain('agentConfig.loadCapabilities');
    expect(capabilities.effortChoices).toEqual(['low', 'high']);
  });

  it('accepts agentConfig write requests with typed payloads', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveAgentModels',
        payload: {
          assignments: [
            { agent_id: 'provider-planner', model_id: 'gpt-4.1' },
            { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6', reasoning_effort: 'medium' },
          ],
        },
      }),
    ).toEqual([]);

    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addModel',
        payload: { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
      }),
    ).toEqual([]);
  });

  it('includes all six extension action names in DESKTOP_ACTION_NAMES', () => {
    const extensionActions = [
      'agentConfig.listExtensions',
      'agentConfig.addExtension',
      'agentConfig.reseedExtension',
      'agentConfig.deleteExtension',
      'agentConfig.loadExtensionAssignments',
      'agentConfig.saveExtensionAssignments',
    ] as const;
    for (const action of extensionActions) {
      expect(DESKTOP_ACTION_NAMES).toContain(action);
    }
  });

});
