import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

const snapshot = {
  version: 1,
  contextPackDir: '/packs/parent',
  contextPackId: 'parent',
  title: 'Parent',
  primaryRepoId: 'platform',
  primaryRepoRoot: '/repo/platform',
  primaryFocusRelativePath: null,
  primaryFocusTargetKind: null,
  primaryFocusTargets: [],
  selectedTestTarget: null,
  supportTargets: [],
  deepFocusEnabled: false,
  contextPackBinding: {
    contextPackDir: '/packs/parent',
    contextPackId: 'parent',
    scopeMode: 'repo-selection',
    primaryRepoId: 'platform',
    selectedRepoIds: ['platform'],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  },
};

const lineage = {
  parentTaskId: 'PARENT-1',
  parentQmdRecordId: 'qmd-1',
  parentQmdScope: 'qmd/context-packs/parent',
  rootTaskId: 'PARENT-1',
  followUpReason: 'Continue',
};

const handoff = {
  repoRoot: '/repo/platform',
  repoLabel: 'platform',
  branch: 'task/root',
  baseCommitSha: 'abc',
  headCommitSha: 'def',
  commitsAhead: 1,
  status: 'committed',
};

function payload(overrides = {}) {
  return {
    action: 'planner.startSession',
    payload: {
      contextPackDir: '/packs/parent',
      childTaskFocusSnapshot: snapshot,
      childTaskLineage: lineage,
      parentTaskBranchView: {
        schemaVersion: 1,
        parentTaskId: 'PARENT-1',
        contextPackDir: '/packs/parent',
        contextPackId: 'parent',
        branchChainAvailability: { status: 'ready', message: 'ready' },
        branchHandoffs: [handoff],
      },
      ...overrides,
    },
  };
}

describe('desktop contract parent branch view validation', () => {
  it('accepts ready, missing legacy, and invalid-handoff child payloads', () => {
    expect(validateDesktopActionRequest(payload())).toEqual([]);
    expect(validateDesktopActionRequest(payload({
      parentTaskBranchView: {
        schemaVersion: 1,
        parentTaskId: 'PARENT-1',
        contextPackDir: '/packs/parent',
        contextPackId: 'parent',
        branchChainAvailability: { status: 'missing-branch-handoffs', message: 'missing' },
      },
    }))).toEqual([]);
    expect(validateDesktopActionRequest(payload({
      parentTaskBranchView: {
        schemaVersion: 1,
        parentTaskId: 'PARENT-1',
        contextPackDir: '/packs/parent',
        contextPackId: 'parent',
        branchChainAvailability: { status: 'invalid-branch-handoffs', message: 'invalid' },
      },
    }))).toEqual([]);
  });

  it('rejects mismatched context, replay/deep focus combinations, and ready without handoffs', () => {
    expect(validateDesktopActionRequest(payload({
      parentTaskBranchView: {
        schemaVersion: 1,
        parentTaskId: 'PARENT-1',
        contextPackDir: '/packs/other',
        contextPackId: 'parent',
        branchChainAvailability: { status: 'ready', message: 'ready' },
        branchHandoffs: [handoff],
      },
    }))).toContain('payload.parentTaskBranchView.contextPackDir must match payload.childTaskFocusSnapshot.contextPackDir.');
    expect(validateDesktopActionRequest(payload({ replayConversationId: 'recent-1' }))).toContain('payload.replayConversationId cannot be combined with payload.parentTaskBranchView.');
    expect(validateDesktopActionRequest(payload({ deepFocusSelection: { deepFocusEnabled: false } }))).toContain('payload.deepFocusSelection cannot be combined with payload.parentTaskBranchView.');
    expect(validateDesktopActionRequest(payload({
      parentTaskBranchView: {
        schemaVersion: 1,
        parentTaskId: 'PARENT-1',
        contextPackDir: '/packs/parent',
        contextPackId: 'parent',
        branchChainAvailability: { status: 'ready', message: 'ready' },
      },
    }))).toContain('payload.parentTaskBranchView.branchHandoffs must be a non-empty array when branch handoffs are ready.');
  });
});
