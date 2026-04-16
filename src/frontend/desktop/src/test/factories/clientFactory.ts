import { vi } from 'vitest';

import type { DesktopShellClient } from '../../renderer/services/desktopShellClient';
import {
  createBootstrapInfo,
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

export function createMockClient(
  overrides: MockClientOverrides = {},
): DesktopShellClient {
  return {
    getBootstrapInfo: vi.fn().mockResolvedValue(createBootstrapInfo()),
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
    listExternalMcpServers: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.list',
          mode: 'read-only',
          message: '0 server(s) configured.',
          servers: [],
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
    loadAgentConfig: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'agentConfig.loadAgents',
          mode: 'read-only',
          message: 'Loaded 4 agent assignments.',
          agents: [
            {
              agent_id: 'planning-agent',
              human_name: 'Lily',
              role_name: 'Planning Specialist',
              required_model: 'gpt-4.1',
              workflow_order: 0,
            },
            {
              agent_id: 'product-manager',
              human_name: 'Alice',
              role_name: 'Product Manager',
              required_model: 'gpt-5.4',
              workflow_order: 1,
            },
            {
              agent_id: 'software-engineer',
              human_name: 'Dalton',
              role_name: 'Software Engineer',
              required_model: 'claude-sonnet-4.6',
              workflow_order: 2,
            },
            {
              agent_id: 'qa',
              human_name: 'Ron',
              role_name: 'QA and Closeout',
              required_model: 'gpt-5.4',
              workflow_order: 3,
            },
          ],
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
          agents: [
            {
              agent_id: 'planning-agent',
              human_name: 'Lily',
              role_name: 'Planning Specialist',
              required_model: 'gpt-4.1',
              workflow_order: 0,
            },
            {
              agent_id: 'product-manager',
              human_name: 'Alice',
              role_name: 'Product Manager',
              required_model: 'gpt-5.4',
              workflow_order: 1,
            },
            {
              agent_id: 'software-engineer',
              human_name: 'Dalton',
              role_name: 'Software Engineer',
              required_model: 'claude-sonnet-4.6',
              workflow_order: 2,
            },
            {
              agent_id: 'qa',
              human_name: 'Ron',
              role_name: 'QA and Closeout',
              required_model: 'gpt-5.4',
              workflow_order: 3,
            },
          ],
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
    readTaskBoard: vi
      .fn()
      .mockResolvedValue({
        ok: true,
        response: {
          action: 'taskBoard.readBoard',
          mode: 'read-only',
          message: '0 open, 0 pending, 0 failed, 0 completed.',
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
    ...overrides,
  };
}
