import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

const childTaskFocusSnapshot = {
  version: 1,
  contextPackDir: '/tmp/context-packs/orders-estate',
  contextPackId: 'orders-estate',
  title: 'Parent task',
  primaryRepoId: 'orders-api',
  primaryRepoRoot: '/repo/orders-api',
  primaryFocusRelativePath: 'src/orders',
  primaryFocusTargetKind: 'directory',
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: false,
  contextPackBinding: {
    contextPackDir: '/tmp/context-packs/orders-estate',
    contextPackId: 'orders-estate',
    scopeMode: 'focused',
    selectedRepoIds: ['orders-api'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  },
};

const childTaskLineage = {
  parentTaskId: 'TASK-001',
  parentQmdRecordId: 'qmd-1',
  parentQmdScope: 'qmd/context-packs/orders-estate',
  rootTaskId: 'TASK-ROOT',
  followUpReason: 'Continue from parent archive.',
};

const distributedScope = {
  contextPackDir: '/tmp/context-packs/orders-estate',
  contextPackId: 'orders-estate',
  scopeMode: 'focused',
  selectedRepoIds: ['orders-api'],
  selectedFocusIds: [],
  deepFocusEnabled: false,
  deepFocusPrimaryRepoId: null,
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

const monolithScope = {
  ...distributedScope,
  selectedRepoIds: [],
  selectedFocusIds: ['orders-service'],
};

const deepFocusScope = {
  ...distributedScope,
  selectedRepoIds: ['orders-api'],
  deepFocusEnabled: true,
  deepFocusPrimaryRepoId: 'orders-api',
  selectedFocusPath: 'src/orders',
  selectedFocusTargetKind: 'directory',
  selectedFocusTargets: [
    {
      path: 'src/orders',
      kind: 'directory',
      role: 'anchor',
      repoId: 'orders-api',
      repoLocalPath: '/repo/orders-api',
    },
  ],
  selectedTestTarget: {
    path: 'tests/orders',
    kind: 'directory',
  },
  selectedSupportTargets: [
    {
      path: 'src/shared',
      kind: 'directory',
    },
  ],
};

function startSessionWithScope(childTaskExecutionScope: unknown) {
  return validateDesktopActionRequest({
    action: 'planner.startSession',
    payload: {
      contextPackDir: '/tmp/context-packs/orders-estate',
      childTaskFocusSnapshot,
      childTaskLineage,
      childTaskExecutionScope,
    },
  });
}

function startSessionWithReloadScope(plannerPlanningReloadScope: unknown, overrides: Record<string, unknown> = {}) {
  return validateDesktopActionRequest({
    action: 'planner.startSession',
    payload: {
      contextPackDir: '/tmp/context-packs/orders-estate',
      childTaskFocusSnapshot,
      childTaskLineage,
      childTaskExecutionScope: distributedScope,
      plannerPlanningReloadScope,
      ...overrides,
    },
  });
}

describe('desktopContract childTaskExecutionScope', () => {
  it('accepts distributed, monolith, and Deep Focus child execution scopes', () => {
    expect(startSessionWithScope(distributedScope)).toEqual([]);
    expect(startSessionWithScope(monolithScope)).toEqual([]);
    expect(startSessionWithScope(deepFocusScope)).toEqual([]);
  });

  it('accepts a Planner Planning Reload Scope only with child execution authority', () => {
    expect(startSessionWithReloadScope({
      ...distributedScope,
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
      selectedRepoIds: ['orders-api', 'billing-api'],
    })).toEqual([]);
  });

  it('rejects malformed Planner Planning Reload Scope with scoped errors', () => {
    const errors = startSessionWithReloadScope({
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
      schemaVersion: 2,
      purpose: 'child-task-authority',
    });

    expect(errors).toContain('payload.plannerPlanningReloadScope.schemaVersion must be 1.');
    expect(errors).toContain('payload.plannerPlanningReloadScope.purpose must be planner-planning-read-context.');
    expect(errors).toContain('payload.plannerPlanningReloadScope.scopeMode must be a non-empty string.');
    expect(errors).toContain('payload.plannerPlanningReloadScope.selectedRepoIds must be an array.');
  });

  it('rejects Planner Planning Reload Scope without child mode authority or with conflicting session modes', () => {
    expect(startSessionWithReloadScope({
      ...distributedScope,
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
    }, {
      childTaskExecutionScope: undefined,
    })).toContain('payload.plannerPlanningReloadScope requires payload.childTaskExecutionScope.');

    expect(startSessionWithReloadScope({
      ...distributedScope,
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
    }, {
      replayConversationId: 'replay-1',
    })).toContain('payload.replayConversationId cannot be combined with payload.plannerPlanningReloadScope.');
  });

  it('requires Planner Planning Reload Scope to stay in the parent context pack', () => {
    const errors = startSessionWithReloadScope({
      ...distributedScope,
      schemaVersion: 1,
      purpose: 'planner-planning-read-context',
      contextPackDir: '/tmp/context-packs/other',
      contextPackId: 'other',
    });

    expect(errors).toContain('payload.plannerPlanningReloadScope.contextPackDir must match payload.childTaskFocusSnapshot.contextPackDir.');
    expect(errors).toContain('payload.plannerPlanningReloadScope.contextPackId must match payload.childTaskFocusSnapshot.contextPackId.');
  });

  it('rejects omitted required child execution scope fields with scoped errors', () => {
    const errors = startSessionWithScope({
      contextPackDir: '/tmp/context-packs/orders-estate',
      contextPackId: 'orders-estate',
    });

    expect(errors).toContain('payload.childTaskExecutionScope.scopeMode must be a non-empty string.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedRepoIds must be an array.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusIds must be an array.');
    expect(errors).toContain('payload.childTaskExecutionScope.deepFocusEnabled must be a boolean.');
    expect(errors).toContain('payload.childTaskExecutionScope.deepFocusPrimaryRepoId must be a non-empty string or null.');
    expect(errors).toContain('payload.childTaskExecutionScope.deepFocusPrimaryFocusId must be a non-empty string or null.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusPath must be a string or null.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargetKind must be directory, file, or null.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargets must be an array.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedTestTarget must be an object or null.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedSupportTargets must be an array.');
  });

  it('requires child task mode when childTaskExecutionScope is provided', () => {
    expect(validateDesktopActionRequest({
      action: 'planner.startSession',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        childTaskLineage,
        childTaskExecutionScope: distributedScope,
      },
    })).toContain('payload.childTaskExecutionScope requires payload.childTaskFocusSnapshot.');

    expect(validateDesktopActionRequest({
      action: 'planner.startSession',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        childTaskFocusSnapshot,
        childTaskExecutionScope: distributedScope,
      },
    })).toContain('payload.childTaskExecutionScope requires payload.childTaskLineage.');
  });

  it('rejects replay and Deep Focus start-session payloads with childTaskExecutionScope', () => {
    expect(validateDesktopActionRequest({
      action: 'planner.startSession',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        replayConversationId: 'conversation-1',
        childTaskFocusSnapshot,
        childTaskLineage,
        childTaskExecutionScope: distributedScope,
      },
    })).toContain('payload.replayConversationId cannot be combined with payload.childTaskExecutionScope.');

    expect(validateDesktopActionRequest({
      action: 'planner.startSession',
      payload: {
        contextPackDir: '/tmp/context-packs/orders-estate',
        deepFocusSelection: { deepFocusEnabled: false },
        childTaskFocusSnapshot,
        childTaskLineage,
        childTaskExecutionScope: distributedScope,
      },
    })).toContain('payload.deepFocusSelection cannot be combined with payload.childTaskExecutionScope.');
  });

  it('requires childTaskExecutionScope to stay in the parent context pack', () => {
    const errors = startSessionWithScope({
      ...distributedScope,
      contextPackDir: '/tmp/context-packs/other',
      contextPackId: 'other',
    });

    expect(errors).toContain('payload.childTaskExecutionScope.contextPackDir must match payload.childTaskFocusSnapshot.contextPackDir.');
    expect(errors).toContain('payload.childTaskExecutionScope.contextPackId must match payload.childTaskFocusSnapshot.contextPackId.');
  });

  it('prefixes malformed child execution scope target errors', () => {
    const errors = startSessionWithScope({
      ...deepFocusScope,
      selectedRepoIds: [''],
      selectedFocusIds: [42],
      selectedFocusTargetKind: 'symlink',
      selectedFocusTargets: [
        {
          path: '../src/orders',
          kind: 'folder',
          role: 'writer',
        },
      ],
      selectedTestTarget: {
        path: '/tmp/tests',
        kind: 'suite',
      },
      selectedSupportTargets: [
        {
          path: 'src/shared',
          kind: 'module',
        },
      ],
    });

    expect(errors).toContain('payload.childTaskExecutionScope.selectedRepoIds[0] must be a non-empty string.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusIds[0] must be a non-empty string.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargetKind must be directory, file, or null.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargets[0].path must be a repo-root-relative path without traversal.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargets[0].kind must be directory or file.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargets[0].role must be anchor or primary when provided.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedTestTarget.path must be a repo-root-relative path without traversal.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedTestTarget.kind must be directory or file.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedSupportTargets[0].kind must be directory or file.');
  });

  it('requires explicit null Deep Focus fields and empty targets when disabled', () => {
    const errors = startSessionWithScope({
      ...distributedScope,
      deepFocusPrimaryRepoId: 'orders-api',
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: deepFocusScope.selectedFocusTargets,
      selectedTestTarget: deepFocusScope.selectedTestTarget,
      selectedSupportTargets: deepFocusScope.selectedSupportTargets,
    });

    expect(errors).toContain('payload.childTaskExecutionScope.deepFocusPrimaryRepoId must be null when payload.childTaskExecutionScope.deepFocusEnabled is false.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusPath must be null when payload.childTaskExecutionScope.deepFocusEnabled is false.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargetKind must be null when payload.childTaskExecutionScope.deepFocusEnabled is false.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedTestTarget must be null when payload.childTaskExecutionScope.deepFocusEnabled is false.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedFocusTargets must be empty when payload.childTaskExecutionScope.deepFocusEnabled is false.');
    expect(errors).toContain('payload.childTaskExecutionScope.selectedSupportTargets must be empty when payload.childTaskExecutionScope.deepFocusEnabled is false.');
  });

  it('rejects both Deep Focus primary anchors being set', () => {
    expect(startSessionWithScope({
      ...deepFocusScope,
      deepFocusPrimaryFocusId: 'orders-service',
    })).toContain('payload.childTaskExecutionScope.deepFocusPrimaryRepoId and payload.childTaskExecutionScope.deepFocusPrimaryFocusId cannot both be set.');
  });
});
