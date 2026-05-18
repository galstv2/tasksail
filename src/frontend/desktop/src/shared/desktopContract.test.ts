import { describe, expect, it } from 'vitest';

import type {
  ContextPackListRepoTreeResponse,
  DesktopActionResponse,
  DesktopInvokeResult,
  TerminalSetTaskScopeResponse,
} from './desktopContract';
import { DESKTOP_ACTION_NAMES } from './desktopContract';
import { validateDesktopActionRequest } from './desktopContractValidators';

describe('desktopContract', () => {
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
  });

  it('accepts agentConfig write requests with typed payloads', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveAgentModels',
        payload: {
          assignments: [
            { agent_id: 'provider-planner', model_id: 'gpt-4.1' },
            { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6' },
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

});
