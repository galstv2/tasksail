import { vi } from 'vitest';

import type { DesktopShellClient } from '../../renderer/services/desktopShellClient';
import {
  createBootstrapInfo,
  createProviderFrontendDescriptor,
  createQueueStatus,
  createEnvironmentStatus,
  createObservabilitySnapshot,
} from './fixtureFactory';
import {
  createListContextPacksResponse,
  createSwitchResponse,
  createReseedResponse,
  createPickDirectoryResponse,
  createDiscoverPrefillResponse,
  createCreateContextPackResponse,
  createPlannerSubmitResponse,
  createFollowUpResponse,
  createActivateContextPackResponse,
  createPickMarkdownFileCancelledResponse,
} from '../helpers/mockResponses';

type MockClientOverrides = {
  [K in keyof DesktopShellClient]?: DesktopShellClient[K];
};

const agentModelOverrides = new Map([
  ['provider-planner', 'gpt-4.1'],
  ['provider-pm', 'gpt-5.4'],
  ['provider-builder', 'claude-sonnet-4.6'],
  ['provider-qa', 'gpt-5.4'],
]);

function createAgentConfigFixtureAgents() {
  return createProviderFrontendDescriptor().roster
    .filter((entry) => agentModelOverrides.has(entry.agentId))
    .map((entry) => ({
      agent_id: entry.agentId,
      human_name: entry.humanName,
      role_name: entry.roleName,
      required_model: agentModelOverrides.get(entry.agentId) ?? 'gpt-4.1',
      workflow_order: entry.workflowOrder - 1,
    }));
}

function createSystemSettingsFixtureConfig() {
  return {
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
}

export function createMockClient(
  overrides: MockClientOverrides = {},
): DesktopShellClient {
  return {
    getBootstrapInfo: vi.fn().mockResolvedValue(createBootstrapInfo()),
    describeActiveProvider: vi.fn().mockResolvedValue(createProviderFrontendDescriptor()),
    getQueueStatus: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createQueueStatus() }),
    deletePendingItem: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'queue.deletePendingItem',
          mode: 'deleted',
          message: 'Removed pending queue item task-002.md.',
          queueName: 'task-002.md',
        },
      }),
    getEnvironmentStatus: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createEnvironmentStatus() }),
    getObservabilitySnapshot: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createObservabilitySnapshot() }),
    submitPlannerDraft: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createPlannerSubmitResponse() }),
    initiateFollowUp: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createFollowUpResponse() }),
    pickContextPackDirectory: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createPickDirectoryResponse() }),
    discoverContextPackPrefill: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createDiscoverPrefillResponse(),
      }),
    createContextPack: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createCreateContextPackResponse(),
      }),
    listContextPacks: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createListContextPacksResponse(),
      }),
    listRepoTree: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'contextPack.listRepoTree',
          mode: 'read-only',
          message: 'Listed repo tree entries.',
          entries: [],
          currentPath: '',
          repoLocalPath: '/tmp/repo',
          truncated: false,
        },
      }),
    reseedContextPack: vi
      .fn()
      .mockResolvedValue({ ok: true, response: createReseedResponse() }),
    setRepositoryType: vi
      .fn()
      .mockResolvedValue({ ok: true, response: { action: 'contextPack.setRepositoryType', mode: 'updated', message: 'Updated.' } }),
    setRepoCategory: vi
      .fn()
      .mockResolvedValue({ ok: true, response: { action: 'contextPack.setRepoCategory', mode: 'updated', message: 'Updated.' } }),
    previewContextPackSwitch: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createSwitchResponse('contextPack.previewSwitch', 'preview'),
      }),
    applyContextPackSwitch: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createSwitchResponse('contextPack.applySwitch', 'applied'),
      }),
    clearActiveContextPack: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createSwitchResponse('contextPack.clearActive', 'cleared'),
      }),
    activateContextPack: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createActivateContextPackResponse(),
      }),
    startPlannerSession: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner session started.', sessionId: 'planner-mock-1', brokerStatus: 'idle' },
      }),
    updatePlannerSessionPersonality: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.updateSessionPersonality',
        mode: 'updated',
        accepted: true,
        message: 'Planner personality updated.',
        lilyPersonalityId: 'balanced',
      },
    }),
    validateChildTaskFocus: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.validateChildTaskFocus',
          mode: 'valid',
          message: 'Parent task focus is still valid.',
          issues: [],
        },
      }),
    sendPlannerMessage: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent to planner session.' },
      }),
    endPlannerSession: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Planner session ended.' },
      }),
    savePlannerDraft: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.saveDraft',
          mode: 'instructed',
          accepted: true,
          message: 'Save-draft instruction sent.',
          brokerStatus: 'completed',
        },
      }),
    readStagedDraft: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.readStagedDraft',
          mode: 'empty',
          message: 'No staged draft.',
          draft: null,
          brokerStatus: 'completed',
        },
      }),
    finalizeSpec: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.finalizeSpec',
          mode: 'finalized',
          accepted: true,
          message: 'Spec promoted.',
          destinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
          brokerStatus: 'idle',
        },
      }),
    pickMarkdownFile: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: createPickMarkdownFileCancelledResponse(),
      }),
    uploadSpec: vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.uploadSpec', mode: 'submitted', accepted: true, message: '', draftTitle: '', submittedPath: '', observationMode: true } }),
    getBypassTemplate: vi.fn().mockResolvedValue(''),
    listArchivedTasks: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'empty',
          message: 'No archived tasks.',
          tasks: [],
        },
      }),
    readParentContextBundle: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.readParentContextBundle',
        mode: 'loaded',
        accepted: true,
        message: 'Parent context bundle loaded.',
        bundle: {
          schemaVersion: 1,
          parentTaskId: 'TASK-001',
          rootTaskId: 'TASK-001',
          parentTaskTitle: 'Parent task',
          archivePath: '/tmp/archive.md',
          archiveArtifactDir: null,
          status: 'legacy-flat-archive',
          missing: [],
          files: [],
          totalBytes: 0,
          truncated: false,
          fallbackSummary: null,
        },
      },
    }),
    readParentChainArchiveBundle: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.readParentChainArchiveBundle',
        mode: 'loaded',
        accepted: true,
        message: 'Parent chain archive bundle loaded.',
        bundle: {
          schemaVersion: 1,
          parentTaskId: 'TASK-001',
          rootTaskId: 'TASK-001',
          currentTipTaskId: null,
          status: 'no-chain-state',
          tasks: [],
          missingTaskIds: [],
          totalBytes: 0,
          truncated: false,
        },
      },
    }),
    readParentArchiveMarkdown: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.readParentArchiveMarkdown',
        mode: 'loaded',
        accepted: true,
        message: 'Parent archive markdown loaded.',
        taskId: 'TASK-001',
        title: 'Parent task',
        archivePath: '/archive/task.md',
        archivedAt: null,
        content: '# Parent task',
        sizeBytes: 13,
      },
    }),
    listPlannerConversationHistory: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listConversationHistory',
          mode: 'empty',
          message: 'No planner conversation history.',
          conversations: [],
        },
      }),
    hydratePlannerConversation: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.hydrateConversation',
          mode: 'not-found',
          message: 'Planner conversation not found.',
          record: null,
        },
      }),
    listExternalMcpServers: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.list',
          mode: 'read-only',
          message: '0 server(s) configured.',
          servers: [],
          localEnabled: false,
        },
      }),
    addExternalMcpServer: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.add',
          mode: 'mutated',
          message: 'Server added.',
          servers: [],
        },
      }),
    updateExternalMcpServer: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.update',
          mode: 'mutated',
          message: 'Server updated.',
          servers: [],
        },
      }),
    removeExternalMcpServer: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.remove',
          mode: 'mutated',
          message: 'Server removed.',
          servers: [],
        },
      }),
    toggleExternalMcpServer: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.toggleEnabled',
          mode: 'mutated',
          message: 'Server toggled.',
          servers: [],
        },
      }),
    validateExternalMcpConnection: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.validateConnection',
          mode: 'validated',
          success: true,
          message: 'Connection successful.',
        },
      }),
    validateExternalMcpLocalCommand: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.validateLocalCommand',
          mode: 'validated',
          found: false,
          message: 'Command not found on PATH.',
        },
      }),
    readSystemSettings: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'systemSettings.read',
          mode: 'read-only',
          message: 'Loaded platform settings.',
          defaultConfigPath: '/repo/config/platform.default.json',
          runtimeConfigPath: '/repo/.platform-state/platform.json',
          defaultFileHash: 'fixture-default-hash',
          runtimeFileHash: 'fixture-runtime-hash',
          config: createSystemSettingsFixtureConfig(),
          runtimeConfig: createSystemSettingsFixtureConfig(),
          runtimeStatus: 'valid',
          runtimeWarning: null,
          tasksActive: false,
          envOverrides: [],
        },
      }),
    saveSystemSettings: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'systemSettings.save',
          mode: 'saved',
          message: 'Saved platform settings.',
          defaultConfigPath: '/repo/config/platform.default.json',
          runtimeConfigPath: '/repo/.platform-state/platform.json',
          defaultFileHash: 'fixture-default-hash-2',
          runtimeFileHash: 'fixture-runtime-hash-2',
          config: createSystemSettingsFixtureConfig(),
          runtimeConfig: createSystemSettingsFixtureConfig(),
          runtimeStatus: 'valid',
          runtimeWarning: null,
          tasksActive: false,
          envOverrides: [],
        },
      }),
    restartTaskSail: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'systemSettings.restart',
          mode: 'restarting',
          message: 'Restarting TaskSail to apply settings…',
        },
      }),
    listLogFiles: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'logExplorer.listFiles',
        mode: 'read-only',
        message: 'Loaded log files.',
        sourceLabel: 'TaskSail platform logs',
        categories: { info: [], warn: [], error: [] },
      },
    }),
    readLogFile: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'logExplorer.readFile',
        mode: 'read-only',
        message: 'Loaded log file.',
        category: 'info',
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
        levelFilter: 'all',
        records: [],
      },
    }),
    loadAgentConfig: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: 'Loaded 4 agent assignments.',
          agents: createAgentConfigFixtureAgents(),
        },
      }),
    loadModelCatalog: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadModelCatalog',
          mode: 'read-only',
          message: 'Loaded 3 model(s).',
          models: [
            { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
            { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
            { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
          ],
        },
      }),
    saveAgentModels: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.saveAgentModels',
          mode: 'mutated',
          message: 'Agent assignments saved.',
          agents: createAgentConfigFixtureAgents(),
        },
      }),
    addModel: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.addModel',
          mode: 'mutated',
          message: 'Model added.',
          models: [
            { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
            { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
            { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
            { display_name: 'GPT 5.5', model_id: 'gpt-5.5' },
          ],
        },
      }),
    removeModel: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.removeModel',
          mode: 'mutated',
          message: 'Model removed.',
          models: [
            { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
            { display_name: 'GPT 5.4', model_id: 'gpt-5.4' },
          ],
        },
      }),
    submitReinforcementFeedback: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.submitFeedback',
          mode: 'submitted',
          passed: true,
          message: 'Feedback submitted.',
        },
      }),
    updateRealignmentDoc: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.updateRealignmentDoc',
          mode: 'updated',
          passed: true,
          message: 'Realignment doc updated.',
        },
      }),
    readReinforcementOverview: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.readOverview',
          mode: 'read-only',
          message: '0 task(s), streak 0/10.',
          overview: {
            totalTasks: 0,
            totalReward: 0,
            unrewardedCount: 0,
            streakProgress: 0,
            streakThreshold: 10,
            lastSettlementId: null,
            agents: [],
          },
        },
      }),
    listReinforcementTasks: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.listTasks',
          mode: 'read-only',
          message: '0 task(s).',
          tasks: [],
          availableYears: [],
        },
      }),
    readAgentRewards: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.readAgentRewards',
          mode: 'read-only',
          message: '0 agent(s).',
          agents: [],
        },
      }),
    listRealignmentSessions: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.listRealignmentSessions',
          mode: 'read-only',
          message: '0 session(s).',
          sessions: [],
        },
      }),
    readRealignmentDoc: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.readRealignmentDoc',
          mode: 'read-only',
          message: 'No document yet.',
          document: {
            standingExpectations: [],
            version: 0,
            updatedAt: '',
          },
        },
      }),
    checkActiveWorkGuard: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.checkActiveWorkGuard',
          mode: 'guard-check',
          allowed: true,
          message: 'No active work. Corrective realignment is allowed.',
          activeTaskId: null,
        },
      }),
    startRealignment: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.startRealignment',
          mode: 'started',
          message: 'Corrective realignment session started.',
          session: {
            realignmentId: 'RA-mock',
            triggerTaskId: 'T-1',
            triggerFeedbackId: 'ui-triggered',
            participatingAgents: [],
            failureAnalysis: '',
            rootCause: '',
            correctiveActions: [],
            status: 'open',
            meetingNotes: '',
            createdAt: '2026-03-23T00:00:00Z',
          },
        },
      }),
    runRealignmentAnalysis: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.runRealignmentAnalysis',
          mode: 'analysis-started',
          message: 'Realignment analysis job registered.',
          job: {
            jobId: 'realignment:RA-mock',
            realignmentId: 'RA-mock',
            status: 'started',
          },
        },
      }),
    dismissRealignment: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.dismissRealignment',
          mode: 'dismissed',
          message: 'Realignment dismissed.',
          realignmentId: 'RA-mock',
        },
      }),
    readTaskContent: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.readTaskContent',
          mode: 'not-found',
          message: 'Not found.',
          content: '',
          fileName: '',
        },
      }),
    readChildChainBranchInventory: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.readChildChainBranchInventory',
          mode: 'not-chain-task',
          message: 'Not a chain task.',
        },
      }),
    readTaskBoard: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 0 pending, 0 failed, 0 completed.',
          boardSnapshotSequence: 1,
          dropboxItems: [],
          pendingItems: [],
          errorItems: [],
          completedItems: [],
        },
      }),
    reorderPending: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.reorderPending',
          mode: 'reordered',
          message: 'Pending queue reordered (0 item(s)).',
        },
      }),
    requeueErrorItem: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.requeueErrorItem',
          mode: 'requeued',
          message: 'Error item requeued.',
          requeuedItem: 'task-err.md',
        },
      }),
    deleteTask: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.deleteTask',
          mode: 'deleted',
          message: 'Deleted task.md from open.',
          fileName: 'task.md',
          column: 'open',
        },
      }),
    moveToPending: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.moveToPending',
          mode: 'moved',
          message: 'Moved task.md to pending.',
          movedItem: '20260328T000000Z-task.md',
        },
      }),
    moveToOpen: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.moveToOpen',
          mode: 'moved',
          message: 'Moved task-err.md to open.',
          movedItem: 'task-err.md',
        },
      }),
    killTask: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'taskBoard.killTask',
        mode: 'kill-requested',
        message: 'Stop requested.',
        taskId: 'task-active',
      },
    }),
    retryKillCleanup: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'taskBoard.retryKillCleanup',
        mode: 'cleanup-retry-scheduled',
        message: 'Retry cleanup scheduled.',
        taskId: 'task-active',
      },
    }),
    getBackendServiceStatus: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'services.readStatus', mode: 'observed', status: 'idle', lastCheckedAt: null, error: null, message: 'Idle.' },
    }),
    startBackendServices: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'services.readStatus', mode: 'observed', status: 'healthy', lastCheckedAt: null, error: null, message: 'Running.' },
    }),
    stopBackendServices: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'services.readStatus', mode: 'observed', status: 'idle', lastCheckedAt: null, error: null, message: 'Stopped.' },
    }),
    checkBackendHealth: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'services.readStatus', mode: 'observed', status: 'healthy', lastCheckedAt: null, error: null, message: 'Healthy.' },
    }),
    saveDeepFocusSelections: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'deepFocus.saveSelections', mode: 'saved', message: 'Deep focus selections saved.' },
    }),
    loadDeepFocusSelections: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'deepFocus.loadSelections', mode: 'read-only', message: 'No saved selections found.', selections: null },
    }),
    clearDeepFocusSelections: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'deepFocus.clearSelections', mode: 'cleared', message: 'Deep focus selections cleared.' },
    }),
    listFocusFilters: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'focusFilters.list', mode: 'read-only', filters: [], message: 'No focus filters saved.' },
    }),
    createFocusFilter: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'focusFilters.create', mode: 'created', filter: null, filters: [], message: 'Focus filter saved.' },
    }),
    deleteFocusFilter: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'focusFilters.delete', mode: 'deleted', filters: [], message: 'Focus filter deleted.' },
    }),
    loadContextPackSidebarState: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'contextPackSidebarState.load', mode: 'read-only', state: null, message: 'No context-pack sidebar state saved.' },
    }),
    saveContextPackSidebarState: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'contextPackSidebarState.save', mode: 'saved', message: 'Context-pack sidebar state saved.' },
    }),
    deleteContextPack: vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'contextPack.delete', mode: 'deleted', contextPackDir: '/tmp/context-pack', mirrorDir: '/tmp/mirror', message: 'Context pack deleted.' },
    }),
    subscribeContextPackCatalogChanged: vi.fn().mockReturnValue(vi.fn()),
    listInstructionFiles: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentInstructions.listFiles',
        mode: 'read-only',
        message: '0 file(s) in profiles.',
        files: [],
      },
    }),
    readInstructionFile: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentInstructions.readFile',
        mode: 'read-only',
        message: 'Read file.',
        fileName: '',
        relativePath: '',
        content: '',
      },
    }),
    writeInstructionFile: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentInstructions.writeFile',
        mode: 'mutated',
        message: 'Saved file.',
        fileName: '',
        relativePath: '',
      },
    }),
    listAgentExtensions: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.listExtensions',
        mode: 'read-only',
        message: '0 extension(s) loaded.',
        extensions: [],
      },
    }),
    addAgentExtension: vi.fn().mockResolvedValue({
      ok: false,
      action: 'agentConfig.addExtension',
      error: 'Mock: add not configured.',
    }),
    reseedAgentExtension: vi.fn().mockResolvedValue({
      ok: false,
      action: 'agentConfig.reseedExtension',
      error: 'Mock: reseed not configured.',
    }),
    deleteAgentExtension: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.deleteExtension',
        mode: 'deleted',
        message: 'Deleted.',
        id: 'mock-id',
      },
    }),
    loadAgentExtensionAssignments: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '0 agent assignment(s) loaded.',
        assignments: [],
      },
    }),
    saveAgentExtensionAssignments: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveExtensionAssignments',
        mode: 'mutated',
        message: 'Saved extension assignments for 0 agent(s).',
        assignments: [],
      },
    }),
    loadExternalMcpAssignments: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.loadExternalMcpAssignments',
        mode: 'read-only',
        message: '0 agent assignment(s) loaded.',
        assignments: [],
      },
    }),
    saveExternalMcpAssignments: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'agentConfig.saveExternalMcpAssignments',
        mode: 'mutated',
        message: 'Saved external MCP assignments for 0 agent(s).',
        assignments: [],
      },
    }),
    ...overrides,
  };
}
