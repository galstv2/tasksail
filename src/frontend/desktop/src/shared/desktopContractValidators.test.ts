import { describe, expect, it } from 'vitest';

import {
  isValidDesktopActionRequest,
  validateDesktopActionRequest,
  validatePlannerDraftModel,
} from './desktopContractValidators';

describe('validateDesktopActionRequest', () => {
  it('rejects a non-object request', () => {
    expect(validateDesktopActionRequest(null)).toEqual([
      'Desktop action request must be an object.',
    ]);
  });

  it('rejects an unknown action name', () => {
    expect(validateDesktopActionRequest({ action: 'not.real' })).toEqual([
      'action must be one of the approved desktop actions.',
    ]);
  });

  it('accepts payload-less actions with no errors', () => {
    for (const action of [
      'queue.readStatus',
      'environment.readStatus',
      'observability.readSnapshot',
      'contextPack.list',
      'contextPack.clearActive',
      'planner.pickMarkdownFile',
      'planner.listArchivedTasks',
      'externalMcp.list',
    ]) {
      expect(validateDesktopActionRequest({ action })).toEqual([]);
    }
  });

  describe('contextPack.pickDirectory', () => {
    it('requires a payload object', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.pickDirectory',
      });
      expect(errors).toEqual(['payload must be an object.']);
    });

    it('validates purpose enum', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.pickDirectory',
        payload: { purpose: 'bad' },
      });
      expect(errors).toContainEqual(
        'payload.purpose must be discovery-root or context-pack-destination.',
      );
    });

    it('accepts a valid pickDirectory request', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.pickDirectory',
        payload: { purpose: 'discovery-root' },
      });
      expect(errors).toEqual([]);
    });

    it('validates defaultPath when provided', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.pickDirectory',
        payload: { purpose: 'discovery-root', defaultPath: 'relative' },
      });
      expect(errors).toContainEqual(
        'payload.defaultPath must be an absolute path string when provided.',
      );
    });
  });

  describe('contextPack.discoverPrefill', () => {
    it('requires rootPath as absolute path', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.discoverPrefill',
        payload: { rootPath: 'relative', mode: 'auto' },
      });
      expect(errors).toContainEqual('payload.rootPath must be an absolute path string.');
    });

    it('accepts a valid discoverPrefill request', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.discoverPrefill',
        payload: { rootPath: '/tmp/root', mode: 'auto' },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('contextPack.previewSwitch / applySwitch', () => {
    it('validates switch payload fields', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.previewSwitch',
        payload: { contextPackDir: 'relative', scopeMode: 'bad' },
      });
      expect(errors).toContainEqual('payload.contextPackDir must be an absolute path string.');
      expect(errors).toContainEqual(
        'payload.scopeMode must be focused.',
      );
    });

    it('accepts a valid switch request', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: { contextPackDir: '/tmp/pack', scopeMode: 'focused' },
      });
      expect(errors).toEqual([]);
    });

    it('accepts valid deep focus switch metadata', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api'],
          deepFocusEnabled: true,
          selectedFocusPath: 'src/orders',
          selectedFocusTargetKind: 'directory',
          selectedTestTarget: {
            path: 'tests/orders',
            kind: 'directory',
          },
          selectedSupportTargets: [
            {
              path: 'docs/orders.md',
              kind: 'file',
            },
          ],
        },
      });
      expect(errors).toEqual([]);
    });

    it('accepts repo-root deep focus metadata without selectedFocusTargetKind', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          selectedRepoIds: ['orders-api'],
          deepFocusEnabled: true,
          selectedFocusPath: '',
        },
      });
      expect(errors).toEqual([]);
    });

    it('validates selectedRepoIds array entries', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.previewSwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          selectedRepoIds: ['valid', ''],
        },
      });
      expect(errors).toContainEqual(
        'payload.selectedRepoIds[1] must be a non-empty string.',
      );
    });

    it('rejects deep focus metadata when deep focus is disabled', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.previewSwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          selectedFocusPath: 'src/orders',
        },
      });
      expect(errors).toContainEqual(
        'payload.deepFocusEnabled must be true when Deep Focus target metadata is provided.',
      );
    });

    it('rejects multi-select repo ids in deep focus mode', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.previewSwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          selectedRepoIds: ['orders-api', 'orders-web'],
          selectedFocusTargetKind: 'directory',
        },
      });
      expect(errors).toContainEqual(
        'payload.selectedRepoIds must contain at most one entry when deepFocusEnabled is true.',
      );
    });
  });

  describe('contextPack.reseed', () => {
    it('requires contextPackDir as absolute path', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.reseed',
        payload: { contextPackDir: '' },
      });
      expect(errors).toContainEqual('payload.contextPackDir must be an absolute path string.');
    });
  });

  describe('contextPack.activate', () => {
    it('validates packId, command, and mode', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.activate',
        payload: { packId: '', command: 'wrong', mode: 'wrong' },
      });
      expect(errors).toContainEqual('payload.packId must be a non-empty string.');
      expect(errors).toContainEqual(
        'payload.command must match the approved activation helper path.',
      );
      expect(errors).toContainEqual('payload.mode must be status-only.');
    });

    it('accepts a valid activate request', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.activate',
        payload: {
          packId: 'my-pack',
          command: 'context-pack:activate',
          mode: 'status-only',
        },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('planner.submitDraft / followup.begin', () => {
    const validDraft = {
      summary: 'Summary',
      desiredOutcome: 'Outcome',
      constraints: '',
      acceptanceSignals: '',
      carryForwardSummary: 'carry',
      planningNotes: '',
      taskKind: 'standard' as const,
      suggestedPath: 'sequential' as const,
    };

    it('accepts a valid planner submission', () => {
      const errors = validateDesktopActionRequest({
        action: 'planner.submitDraft',
        payload: { draft: validDraft, stage: 'preview' },
      });
      expect(errors).toEqual([]);
    });

    it('validates stage enum', () => {
      const errors = validateDesktopActionRequest({
        action: 'followup.begin',
        payload: {
          draft: {
            ...validDraft,
            taskKind: 'child-task' as const,
            parentTaskId: 'T-01',
            parentQmdRecordId: 'R-01',
            parentQmdScope: 'scope',
            rootTaskId: 'T-00',
            followupReason: 'reason',
          },
          stage: 'bad',
        },
      });
      expect(errors).toContainEqual('payload.stage must be compose, preview, or confirm.');
    });

    it('requires child-task lineage fields for follow-up submission', () => {
      const errors = validateDesktopActionRequest({
        action: 'followup.begin',
        payload: {
          draft: {
            ...validDraft,
            taskKind: 'child-task' as const,
          },
          stage: 'preview',
        },
      });
      expect(errors).toContain('payload.draft.parentTaskId must be a string.');
      expect(errors).toContain('payload.draft.followupReason must be a string.');
    });

    it('requires payload to be an object', () => {
      const errors = validateDesktopActionRequest({
        action: 'planner.submitDraft',
        payload: null,
      });
      expect(errors).toEqual(['payload must be an object.']);
    });
  });

  describe('agentConfig.*', () => {
    it('accepts payload-less read actions', () => {
      expect(validateDesktopActionRequest({ action: 'agentConfig.loadAgents' })).toEqual([]);
      expect(validateDesktopActionRequest({ action: 'agentConfig.loadModelCatalog' })).toEqual([]);
    });

    it('accepts valid write payloads', () => {
      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.saveAgentModels',
          payload: {
            assignments: [
              { agent_id: 'planning-agent', model_id: 'gpt-4.1' },
              { agent_id: 'software-engineer', model_id: 'claude-sonnet-4.6' },
            ],
          },
        }),
      ).toEqual([]);

      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.addModel',
          payload: {
            display_name: 'GPT 5.4',
            model_id: 'gpt-5.4',
          },
        }),
      ).toEqual([]);

      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.removeModel',
          payload: { model_id: 'gpt-5.4' },
        }),
      ).toEqual([]);
    });

    it('rejects malformed write payloads', () => {
      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.saveAgentModels',
          payload: {
            assignments: [
              { agent_id: '', model_id: 'bad model' },
              null,
            ],
          },
        }),
      ).toEqual([
        'payload.assignments[0].agent_id must be a non-empty string.',
        'payload.assignments[0].model_id must match the approved agent model pattern.',
        'payload.assignments[1] must be an object.',
      ]);

      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.addModel',
          payload: { display_name: '', model_id: 'bad model' },
        }),
      ).toEqual([
        'payload.display_name must be a non-empty string.',
        'payload.model_id must match the approved agent model pattern.',
      ]);

      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.removeModel',
          payload: { model_id: 'bad model' },
        }),
      ).toEqual(['payload.model_id must match the approved agent model pattern.']);
    });
  });

  describe('contextPack.create', () => {
    it('requires payload to be an object', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.create',
        payload: null,
      });
      expect(errors).toEqual(['payload must be an object.']);
    });

    it('validates top-level create fields', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.create',
        payload: {
          contextPackDir: 'relative',
          discoveryRoot: '',
          mode: 'bad',
          bootstrapAnswers: {
            contextPackId: 'id',
            estateName: 'name',
            repositories: [
              {
                repoRoot: '/tmp/repo',
                repoName: 'repo',
                systemLayer: 'backend',
              },
            ],
          },
        },
      });
      expect(errors).toContainEqual('payload.contextPackDir must be an absolute path string.');
      expect(errors).toContainEqual('payload.discoveryRoot must be an absolute path string.');
      expect(errors).toContainEqual('payload.mode must be auto, distributed, or monolith.');
    });

    it('validates bootstrapAnswers.repositories is non-empty', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.create',
        payload: {
          contextPackDir: '/tmp/pack',
          discoveryRoot: '/tmp/root',
          mode: 'auto',
          bootstrapAnswers: {
            contextPackId: 'id',
            estateName: 'name',
            repositories: [],
          },
        },
      });
      expect(errors).toContainEqual(
        'payload.bootstrapAnswers.repositories must be a non-empty array.',
      );
    });
  });
});

describe('validatePlannerDraftModel', () => {
  it('rejects non-object input', () => {
    expect(validatePlannerDraftModel('string')).toEqual([
      'payload.draft must be an object.',
    ]);
  });

  it('reports missing string fields', () => {
    const errors = validatePlannerDraftModel({});
    expect(errors).toContainEqual('payload.draft.summary must be a string.');
    expect(errors).toContainEqual(
      'payload.draft.suggestedPath must be sequential or parallel.',
    );
  });

  it('validates optional sourceState when provided', () => {
    const draft = {
      summary: 'S',
      desiredOutcome: 'O',
      constraints: '',
      acceptanceSignals: '',
      carryForwardSummary: 'carry',
      planningNotes: '',
      suggestedPath: 'sequential',
      sourceState: 'bad',
    };
    const errors = validatePlannerDraftModel(draft);
    expect(errors).toContainEqual(
      'payload.draft.sourceState must be idle, active, blocked, complete, or completed.',
    );
  });

  it('accepts a fully valid draft with no errors', () => {
    const draft = {
      summary: 'S',
      desiredOutcome: 'O',
      constraints: '',
      acceptanceSignals: '',
      carryForwardSummary: 'carry',
      planningNotes: '',
      suggestedPath: 'sequential',
    };
    expect(validatePlannerDraftModel(draft)).toEqual([]);
  });
});

describe('externalMcp validators', () => {
  describe('externalMcp.add', () => {
    it('requires a payload object', () => {
      const errors = validateDesktopActionRequest({ action: 'externalMcp.add' });
      expect(errors).toContain('payload must be an object.');
    });

    it('requires payload.server to be an object', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: { server: 'not-an-object' },
      });
      expect(errors).toContain('payload.server must be an object.');
    });

    it('requires server fields', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: { server: {} },
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e: string) => e.includes('id'))).toBe(true);
      expect(errors.some((e: string) => e.includes('purpose'))).toBe(true);
      expect(errors.some((e: string) => e.includes('url'))).toBe(true);
    });

    it('accepts valid server payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'test', display_name: 'Test', purpose: 'Test',
            transport: 'sse', url: 'https://x.com', enabled: true,
          },
        },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.update', () => {
    it('uses the same validation as add', () => {
      const errors = validateDesktopActionRequest({ action: 'externalMcp.update' });
      expect(errors).toContain('payload must be an object.');
    });

    it('accepts valid update request', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.update',
        payload: {
          server: {
            id: 'test', display_name: 'Test', purpose: 'Test',
            transport: 'sse', url: 'https://x.com', enabled: true,
          },
        },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.toggleEnabled', () => {
    it('requires payload with serverId', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.toggleEnabled',
        payload: {},
      });
      expect(errors).toContain('payload.serverId must be a non-empty string.');
    });

    it('accepts valid toggleEnabled request', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.toggleEnabled',
        payload: { serverId: 'test-id' },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.remove', () => {
    it('requires payload with serverId', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.remove',
        payload: {},
      });
      expect(errors).toContain('payload.serverId must be a non-empty string.');
    });

    it('accepts valid remove request', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.remove',
        payload: { serverId: 'test-id' },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.validateConnection', () => {
    it('requires payload with transport and url', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.validateConnection',
        payload: {},
      });
      expect(errors).toContain('payload.transport must be a non-empty string.');
    });

    it('accepts valid connection payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.validateConnection',
        payload: { transport: 'sse', url: 'https://x.com/sse' },
      });
      expect(errors).toEqual([]);
    });
  });
});

describe('isValidDesktopActionRequest', () => {
  it('returns true for a valid request', () => {
    expect(isValidDesktopActionRequest({ action: 'queue.readStatus' })).toBe(true);
  });

  it('returns false for an invalid request', () => {
    expect(isValidDesktopActionRequest(null)).toBe(false);
    expect(isValidDesktopActionRequest({ action: 'bogus' })).toBe(false);
  });
});
