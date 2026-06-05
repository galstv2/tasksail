import { describe, expect, it } from 'vitest';

import {
  isValidDesktopActionRequest,
  validateDesktopActionRequest,
  validatePlannerDraftModel,
  validatePlannerValidateChildTaskFocusResponse,
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
      'planner.listConversationHistory',
      'externalMcp.list',
    ]) {
      expect(validateDesktopActionRequest({ action })).toEqual([]);
    }
  });

  it('validates task-board retry cleanup payloads like kill payloads', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.retryKillCleanup',
      payload: { fileName: 'TASK-A.md', taskId: 'TASK-A' },
    })).toEqual([]);
    expect(validateDesktopActionRequest({
      action: 'taskBoard.retryKillCleanup',
      payload: { fileName: 'TASK-A.txt', taskId: 'TASK-A' },
    })).toContain('payload.fileName must be a non-empty markdown file name.');
    expect(validateDesktopActionRequest({
      action: 'taskBoard.retryKillCleanup',
      payload: { fileName: 'TASK-A.md', taskId: 'TASK-B' },
    })).toContain('payload.taskId must match payload.fileName without the .md suffix.');
  });

  it('validates task notification request payloads', () => {
    const markSeen = { notificationIds: ['n-1', 'n-2'], allVisible: true };
    for (const request of [{ action: 'taskNotifications.read' }, { action: 'taskNotifications.markSeen', payload: markSeen }, { action: 'taskNotifications.dismiss', payload: { notificationId: 'n-1' } }, { action: 'taskNotifications.dismissAll' }]) expect(validateDesktopActionRequest(request)).toEqual([]);
    for (const [request, error] of [
      [{ action: 'taskNotifications.markSeen', payload: { notificationIds: 'n-1' } }, 'payload.notificationIds must be a string array when provided.'],
      [{ action: 'taskNotifications.markSeen', payload: { notificationIds: ['n-1', ''] } }, 'payload.notificationIds[1] must be a non-empty string.'],
      [{ action: 'taskNotifications.markSeen', payload: { notificationIds: ['n-1'], allVisible: 'true' } }, 'payload.allVisible must be a boolean when provided.'],
      [{ action: 'taskNotifications.dismiss', payload: { notificationId: '' } }, 'payload.notificationId must be a non-empty string.'],
      [{ action: 'taskNotifications.read', payload: {} }, 'payload must be omitted.'],
    ] as Array<[unknown, string]>) expect(validateDesktopActionRequest(request)).toContain(error);
  });

  describe('planner conversation history actions', () => {
    it('accepts list and hydrate action discriminants', () => {
      expect(isValidDesktopActionRequest({
        action: 'planner.listConversationHistory',
      })).toBe(true);
      expect(isValidDesktopActionRequest({
        action: 'planner.hydrateConversation',
        payload: { recordId: 'conversation-1' },
      })).toBe(true);
    });

    it('rejects malformed hydrate payloads', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.hydrateConversation',
      })).toEqual(['payload must be an object.']);
      expect(validateDesktopActionRequest({
        action: 'planner.hydrateConversation',
        payload: { recordId: '' },
      })).toEqual(['payload.recordId must be a non-empty string.']);
      expect(validateDesktopActionRequest({
        action: 'planner.hydrateConversation',
        payload: { recordId: 42 },
      })).toEqual(['payload.recordId must be a non-empty string.']);
    });
  });

  describe('focusFilters.create', () => {
    const selection = {
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    };

    it('accepts repository type roles on focus filter selections', () => {
      expect(validateDesktopActionRequest({
        action: 'focusFilters.create',
        payload: {
          contextPackDir: '/tmp/pack',
          name: 'Backend',
          selection: {
            ...selection,
            repositoryTypes: { platform: 'primary', tools: 'support' },
          },
        },
      })).toEqual([]);
    });

    it('rejects malformed repository type roles on focus filter selections', () => {
      expect(validateDesktopActionRequest({
        action: 'focusFilters.create',
        payload: {
          contextPackDir: '/tmp/pack',
          name: 'Backend',
          selection: {
            ...selection,
            repositoryTypes: { platform: 'owner', '': 'primary' },
          },
        },
      })).toEqual([
        'payload.selection.repositoryTypes.platform must be primary or support.',
        'payload.selection.repositoryTypes keys must be non-empty strings.',
      ]);
    });
  });

  describe('planner.startSession', () => {
    const snapshot = {
      version: 1,
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
      title: 'Parent task',
      primaryRepoId: 'platform',
      primaryRepoRoot: '/repo',
      primaryFocusRelativePath: 'src/features/planner',
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      deepFocusEnabled: true,
      contextPackBinding: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        contextPackId: 'orders-estate',
        scopeMode: 'selected',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        selectedFocusPath: 'src/features/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    };
    const lineage = {
      parentTaskId: 'TASK-001',
      parentQmdRecordId: 'qmd-1',
      parentQmdScope: 'qmd/context-packs/orders-estate',
      rootTaskId: 'TASK-ROOT',
      followUpReason: 'Continue from the archived parent task.',
    };

    it('accepts optional replayConversationId in the payload', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          lilyPersonalityId: 'balanced',
          replayConversationId: 'conversation-1',
        },
      })).toEqual([]);
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          lilyPersonalityId: 'clinical',
        },
      })).toEqual([]);
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
        },
      })).toEqual([]);
    });

    it('rejects malformed start-session payloads', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: 'not-an-object',
      })).toEqual(['payload must be an object when provided.']);
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: { contextPackDir: 42 },
      })).toEqual(['payload.contextPackDir must be a string when provided.']);
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: { replayConversationId: '' },
      })).toEqual(['payload.replayConversationId must be a non-empty string when provided.']);
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: { lilyPersonalityId: 'enthusiastic' },
      })).toEqual(['payload.lilyPersonalityId must be balanced or clinical.']);
    });

    it('accepts child-task lineage with a valid focus snapshot', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          childTaskFocusSnapshot: snapshot,
          childTaskLineage: lineage,
        },
      })).toEqual([]);
    });

    it('rejects invalid child-task start-session combinations', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: { contextPackDir: '/tmp/context-packs/orders-estate', childTaskFocusSnapshot: snapshot },
      })).toContain('payload.childTaskFocusSnapshot requires payload.childTaskLineage.');
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: { contextPackDir: '/tmp/context-packs/orders-estate', childTaskLineage: lineage },
      })).toContain('payload.childTaskLineage requires payload.childTaskFocusSnapshot.');
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          replayConversationId: 'conversation-1',
          childTaskFocusSnapshot: snapshot,
          childTaskLineage: lineage,
        },
      })).toContain('payload.replayConversationId cannot be combined with payload.childTaskFocusSnapshot.');
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          deepFocusSelection: { deepFocusEnabled: false },
          childTaskFocusSnapshot: snapshot,
          childTaskLineage: lineage,
        },
      })).toContain('payload.deepFocusSelection cannot be combined with payload.childTaskFocusSnapshot.');
    });

    it('rejects malformed child-task lineage and snapshots', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          childTaskFocusSnapshot: snapshot,
          childTaskLineage: { ...lineage, parentTaskId: '' },
        },
      })).toContain('payload.childTaskLineage.parentTaskId must be a non-empty string.');
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          childTaskFocusSnapshot: { ...snapshot, version: 2 },
          childTaskLineage: lineage,
        },
      })).toContain('payload.childTaskFocusSnapshot.version must be 1.');
      expect(validateDesktopActionRequest({
        action: 'planner.startSession',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          childTaskFocusSnapshot: { ...snapshot, primaryRepoRoot: '' },
          childTaskLineage: lineage,
        },
      })).toContain('payload.childTaskFocusSnapshot.primaryRepoRoot must be a non-empty string.');
    });
  });

  describe('planner.updateSessionPersonality', () => {
    it('accepts balanced and clinical personality ids', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.updateSessionPersonality',
        payload: { lilyPersonalityId: 'balanced' },
      })).toEqual([]);
      expect(validateDesktopActionRequest({
        action: 'planner.updateSessionPersonality',
        payload: { lilyPersonalityId: 'clinical' },
      })).toEqual([]);
    });

    it('rejects malformed personality update payloads', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.updateSessionPersonality',
        payload: undefined,
      })).toEqual(['payload must be an object.']);
      expect(validateDesktopActionRequest({
        action: 'planner.updateSessionPersonality',
        payload: { lilyPersonalityId: 'warm' },
      })).toEqual(['payload.lilyPersonalityId must be balanced or clinical.']);
    });
  });

  describe('planner.validateChildTaskFocus', () => {
    const snapshot = {
      version: 1,
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
      title: 'Parent task',
      primaryRepoId: 'platform',
      primaryRepoRoot: '/repo',
      primaryFocusRelativePath: 'src/features/planner',
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      deepFocusEnabled: true,
      contextPackBinding: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        contextPackId: 'orders-estate',
        scopeMode: 'selected',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        selectedFocusPath: 'src/features/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    };

    it('accepts valid validation payloads', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.validateChildTaskFocus',
        payload: { contextPackDir: '/tmp/context-packs/orders-estate', snapshot },
      })).toEqual([]);
    });

    it('rejects malformed validation payloads', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.validateChildTaskFocus',
        payload: { snapshot },
      })).toContain('payload.contextPackDir must be a non-empty string.');
      expect(validateDesktopActionRequest({
        action: 'planner.validateChildTaskFocus',
        payload: { contextPackDir: '', snapshot },
      })).toContain('payload.contextPackDir must be a non-empty string.');
      expect(validateDesktopActionRequest({
        action: 'planner.validateChildTaskFocus',
        payload: { contextPackDir: '/tmp/context-packs/orders-estate' },
      })).toContain('payload.snapshot must be an object.');
      expect(validateDesktopActionRequest({
        action: 'planner.validateChildTaskFocus',
        payload: { contextPackDir: '/tmp/context-packs/orders-estate', snapshot: { ...snapshot, version: 2 } },
      })).toContain('payload.snapshot.version must be 1.');
    });

    it('validates exact response mode and message rules', () => {
      expect(validatePlannerValidateChildTaskFocusResponse({
        action: 'planner.validateChildTaskFocus',
        mode: 'valid',
        message: 'Parent task focus is still valid.',
        issues: [],
      })).toEqual([]);
      expect(validatePlannerValidateChildTaskFocusResponse({
        action: 'planner.validateChildTaskFocus',
        mode: 'fallback',
        message: "The parent task's saved focus no longer matches the current context pack or filesystem. Starting regular mode with the current live context instead.",
        issues: [{ code: 'context-pack-missing', label: 'Context pack directory', path: '/tmp/missing' }],
      })).toEqual([]);
      expect(validatePlannerValidateChildTaskFocusResponse({
        action: 'planner.validateChildTaskFocus',
        mode: 'valid',
        message: 'Different.',
        issues: [{ code: 'context-pack-missing', label: 'Context pack directory', path: '/tmp/missing' }],
      })).toEqual(expect.arrayContaining([
        'response.message must equal the valid planner focus validation message.',
        'response.issues must be empty when response.mode is valid.',
      ]));
      expect(validatePlannerValidateChildTaskFocusResponse({
        action: 'planner.validateChildTaskFocus',
        mode: 'fallback',
        message: 'Different.',
        issues: [],
      })).toEqual(expect.arrayContaining([
        'response.message must equal the fallback planner focus validation message.',
        'response.issues must not be empty when response.mode is fallback.',
      ]));
    });
  });

  describe('planner.sendMessage', () => {
    it('accepts optional displayText in the payload', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.sendMessage',
        payload: {
          text: 'Message sent to Lily.',
          displayText: 'Message shown in transcript.',
        },
      })).toEqual([]);
    });

    it('rejects malformed send-message payloads', () => {
      expect(validateDesktopActionRequest({
        action: 'planner.sendMessage',
      })).toEqual(['payload must be an object.']);
      expect(validateDesktopActionRequest({
        action: 'planner.sendMessage',
        payload: { text: '' },
      })).toEqual(['payload.text must be a non-empty string.']);
      expect(validateDesktopActionRequest({
        action: 'planner.sendMessage',
        payload: { text: 'Hello', displayText: 42 },
      })).toEqual(['payload.displayText must be a string when provided.']);
    });
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

    it('accepts a scoped test on a directory primary', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
              testTarget: { path: 'tests/orders', kind: 'directory' },
            },
          ],
        },
      });
      expect(errors).toEqual([]);
    });

    it('accepts scoped supports on a file primary', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            {
              path: 'src/orders/index.ts',
              kind: 'file',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
              supportTargets: [
                { path: 'docs/orders.md', kind: 'file' },
                { path: 'packages/shared', kind: 'directory' },
              ],
            },
          ],
        },
      });
      expect(errors).toEqual([]);
    });

    it('rejects scoped fields on a repo-root primary', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          selectedFocusTargets: [
            {
              path: '',
              kind: 'directory',
              role: 'anchor',
              testTarget: { path: 'tests', kind: 'directory' },
              supportTargets: [{ path: 'docs', kind: 'directory' }],
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[0] repo-root primary cannot include testTarget or supportTargets.',
      );
    });

    it('rejects a scoped test equal to another primary', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          selectedFocusTargets: [
            { path: 'src/orders', kind: 'directory', role: 'anchor' },
            {
              path: 'src/billing',
              kind: 'directory',
              testTarget: { path: 'src/orders', kind: 'directory' },
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[1].testTarget overlaps primary[0].',
      );
    });

    it('rejects a scoped support inside a primary writable root', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              supportTargets: [{ path: 'src/orders/docs', kind: 'directory' }],
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[0].supportTargets[0] overlaps primary[0] writable root.',
      );
    });

    it('allows a scoped support equal to a global support target', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
              supportTargets: [{ path: 'docs/orders', kind: 'directory' }],
            },
          ],
          selectedSupportTargets: [{ path: 'docs/orders', kind: 'directory' }],
        },
      });
      expect(errors).toEqual([]);
    });

    it('multiple primaries in different repos with identical relative paths do not produce overlap errors', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            // Primary in Tools whose testTarget shares a relative path with
            // primary[1]'s path in Platform. Pre-spec the cross-primary
            // path-equality check would fire. Post-spec it is suppressed.
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
              testTarget: { path: 'src/billing', kind: 'directory' },
            },
            // Primary in Platform whose supportTarget shares a relative path
            // with primary[0]'s path in Tools. Same false-positive shape,
            // also suppressed cross-repo.
            {
              path: 'src/billing',
              kind: 'directory',
              role: 'primary',
              repoLocalPath: '/repos/platform',
              repoId: 'platform',
              supportTargets: [{ path: 'src/orders', kind: 'directory' }],
            },
          ],
        },
      });
      const overlapErrors = errors.filter((message) => message.includes('overlaps'));
      expect(overlapErrors).toEqual([]);
    });

    it('multiple primaries in the same repo with overlapping support targets still produce overlap errors', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
            },
            {
              path: 'src/billing',
              kind: 'directory',
              role: 'primary',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
              supportTargets: [{ path: 'src/orders', kind: 'directory' }],
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[1].supportTargets[0] overlaps primary[0].',
      );
    });

    it('legacy state with no repoLocalPath is validated under single-repo rules', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          selectedFocusTargets: [
            { path: 'src/orders', kind: 'directory', role: 'anchor' },
            {
              path: 'src/billing',
              kind: 'directory',
              testTarget: { path: 'src/orders', kind: 'directory' },
            },
          ],
        },
      });
      // Both primaries omit repoLocalPath (legacy single-repo state).
      // The same-repo overlap check must still fire — repo-awareness must
      // not silently weaken validation for legacy state.
      expect(errors).toContain(
        'payload.selectedFocusTargets[1].testTarget overlaps primary[0].',
      );
    });

    it('rejects a primary focus target missing repoLocalPath when deep focus is on', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
            },
            { path: 'src/billing', kind: 'directory', role: 'primary', repoId: 'tools' },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[1].repoLocalPath must be a non-empty string in Deep Focus mode.',
      );
    });

    it('rejects missing scalar anchor fields with non-empty primaries', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.deepFocusPrimaryRepoId or payload.deepFocusPrimaryFocusId is required when Deep Focus primaries are selected.',
      );
    });

    it('rejects missing repoId in distributed mode', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'tools',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[0].repoId must be a non-empty string when payload.deepFocusPrimaryRepoId is set.',
      );
    });

    it('rejects missing focusId in monolith mode', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryFocusId: 'orders',
          selectedFocusTargets: [
            {
              path: 'services/orders/src',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/monolith',
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.selectedFocusTargets[0].focusId must be a non-empty string when payload.deepFocusPrimaryFocusId is set.',
      );
    });

    it('rejects a repo scalar equal to repoLocalPath instead of repoId', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: '/repos/tools',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
            },
          ],
        },
      });
      expect(errors).toContain(
        'payload.deepFocusPrimaryRepoId must equal the anchor target repoId.',
      );
    });

    it('rejects when both deepFocusPrimaryRepoId and deepFocusPrimaryFocusId are set', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: '/repos/tools',
          deepFocusPrimaryFocusId: '/repos/platform',
        },
      });
      expect(errors).toContain(
        'payload.deepFocusPrimaryRepoId and payload.deepFocusPrimaryFocusId cannot both be set.',
      );
    });

    it('rejects when anchor scalar disagrees with anchor target manifest id', () => {
      // Per spec §2.6 / §3.1: `deepFocusPrimaryRepoId` (distributed) and
      // `deepFocusPrimaryFocusId` (monolith) carry the anchor's manifest
      // identifier — `anchor.repoId` and `anchor.focusId` respectively, NOT
      // the resolved `repoLocalPath`. Mismatched scalar/anchor pairs are a
      // malformed payload.
      const distributedErrors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryRepoId: 'platform',
          selectedFocusTargets: [
            {
              path: 'src/orders',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/tools',
              repoId: 'tools',
            },
          ],
        },
      });
      expect(distributedErrors).toContain(
        'payload.deepFocusPrimaryRepoId must equal the anchor target repoId.',
      );

      const monolithErrors = validateDesktopActionRequest({
        action: 'contextPack.applySwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusEnabled: true,
          deepFocusPrimaryFocusId: 'orders',
          selectedFocusTargets: [
            {
              path: 'services/billing/src',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: '/repos/monolith',
              focusId: 'billing',
            },
          ],
        },
      });
      expect(monolithErrors).toContain(
        'payload.deepFocusPrimaryFocusId must equal the anchor target focusId.',
      );
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

    it('rejects deep focus primary fields when deepFocusEnabled is false', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.previewSwitch',
        payload: {
          contextPackDir: '/tmp/pack',
          scopeMode: 'focused',
          deepFocusPrimaryRepoId: 'orders-api',
        },
      });
      expect(errors).toContainEqual(
        'payload.deepFocusEnabled must be true when Deep Focus target metadata is provided.',
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
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
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
      for (const action of ['agentConfig.loadAgents', 'agentConfig.loadModelCatalog', 'agentConfig.loadCapabilities']) expect(validateDesktopActionRequest({ action })).toEqual([]);
    });

    it('accepts valid write payloads', () => {
      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.saveAgentModels',
          payload: {
            assignments: [
              { agent_id: 'provider-planner', model_id: 'gpt-4.1' }, { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6', reasoning_effort: 'high' },
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
              { agent_id: 'provider-builder', model_id: 'gpt-4.1', reasoning_effort: 'High' },
              null,
            ],
          },
        }),
      ).toEqual([
        'payload.assignments[0].agent_id must be a non-empty string.',
        'payload.assignments[0].model_id must match the approved agent model pattern.',
        'payload.assignments[1].reasoning_effort must be lowercase letters, numbers, or hyphens when provided.',
        'payload.assignments[2] must be an object.',
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
      expect(errors).toContainEqual('payload.mode must be one of distributed, distributed-platform, monolith, monolith-platform.');
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
      expect(errors).toContainEqual(
        'payload.mode must be one of distributed, distributed-platform, monolith, monolith-platform.',
      );
    });

    it('accepts platform estate create modes', () => {
      const errors = validateDesktopActionRequest({
        action: 'contextPack.create',
        payload: {
          contextPackDir: '/tmp/pack',
          discoveryRoot: '/tmp/root',
          mode: 'monolith-platform',
          bootstrapAnswers: {
            contextPackId: 'id',
            estateName: 'name',
            repositories: [
              {
                repoRoot: '/tmp/root',
                repoName: 'root',
                systemLayer: 'shared',
              },
            ],
          },
        },
      });

      expect(errors).toEqual([]);
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
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
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
      criticalRequirements: 'None',
      compatibilityRequirements: 'None',
      requiredValidation: 'None',
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
          server: { id: 'test', display_name: 'Test', purpose: 'Use this server for test fixtures.', preferred_for: ['test fixtures'], transport: 'sse', url: 'https://x.com', enabled: true },
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
          server: { id: 'test', display_name: 'Test', purpose: 'Use this server for test fixtures.', preferred_for: ['test fixtures'], transport: 'sse', url: 'https://x.com', enabled: true },
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
      expect(errors).toContain("payload.transport must be one of: 'http', 'sse'.");
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

describe('contextPack.setRepoCategory', () => {
  it('accepts a valid setRepoCategory request', () => {
    expect(
      validateDesktopActionRequest({
        action: 'contextPack.setRepoCategory',
        payload: {
          contextPackDir: '/tmp/my-pack',
          repoId: 'api',
          repoCategory: 'service',
        },
      }),
    ).toEqual([]);
  });

  it('rejects missing or non-canonical repoCategory', () => {
    for (const payload of [
      { contextPackDir: '/tmp/my-pack', repoId: 'api' },
      { contextPackDir: '/tmp/my-pack', repoId: 'api', repoCategory: 'worker' },
    ]) {
      expect(validateDesktopActionRequest({ action: 'contextPack.setRepoCategory', payload })).toContain('payload.repoCategory must be service, application, frontend, library, infrastructure, data, documentation, tool, or unknown.');
    }
  });

  it('rejects relative contextPackDir', () => {
    const errors = validateDesktopActionRequest({
      action: 'contextPack.setRepoCategory',
      payload: {
        contextPackDir: 'relative/path',
        repoId: 'api',
        repoCategory: 'service',
      },
    });
    expect(errors).toContain('payload.contextPackDir must be an absolute path.');
  });
});

describe('terminal.setTaskScope', () => {
  it('accepts null and non-empty taskGuid payloads', () => {
    expect(validateDesktopActionRequest({
      action: 'terminal.setTaskScope',
      payload: { taskGuid: null },
    })).toEqual([]);
    expect(validateDesktopActionRequest({
      action: 'terminal.setTaskScope',
      payload: { taskGuid: 'feedbeef-1234-4234-9234-123456789abc' },
    })).toEqual([]);
  });

  it('rejects missing, empty, and non-string taskGuid payloads', () => {
    expect(validateDesktopActionRequest({
      action: 'terminal.setTaskScope',
      payload: {},
    })).toContain('payload.taskGuid must be null or a non-empty string.');
    expect(validateDesktopActionRequest({
      action: 'terminal.setTaskScope',
      payload: { taskGuid: '' },
    })).toContain('payload.taskGuid must be null or a non-empty string.');
    expect(validateDesktopActionRequest({
      action: 'terminal.setTaskScope',
      payload: { taskGuid: 123 },
    })).toContain('payload.taskGuid must be null or a non-empty string.');
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
