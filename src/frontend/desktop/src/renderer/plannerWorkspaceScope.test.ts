import { describe, expect, it } from 'vitest';

import type { ContextPackCatalogEntry, ContextPackFocusTarget } from '../shared/desktopContract';
import type { PlannerStagingSidecar } from '../shared/desktopContractPlanner';
import {
  buildCurrentWorkspaceScopeSummary,
  buildRecentTaskScopeSummary,
  deriveActivePackWorkspaceSelection,
  mapRecentTaskBindingToSelection,
} from './plannerWorkspaceScope';

type RecentBinding = PlannerStagingSidecar['contextPackBinding'];

function makeBinding(overrides: Partial<RecentBinding> = {}): RecentBinding {
  return {
    contextPackDir: '/packs/pack-1',
    contextPackId: 'pack-1',
    scopeMode: 'focused',
    selectedRepoIds: [],
    selectedFocusIds: [],
    deepFocusEnabled: false,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function focusTarget(
  focusId: string,
  displayName: string,
  repositoryType: 'primary' | 'support' | null,
): ContextPackFocusTarget {
  return {
    focusId,
    displayName,
    kind: 'repository',
    repoId: focusId,
    repoLocalPath: `/repos/${focusId}`,
    serviceName: null,
    systemLayer: null,
    repoRole: null,
    repositoryType,
    relativePath: null,
    focusType: null,
    group: null,
    defaultFocusable: true,
    activationPriority: 1,
    adjacentRepoIds: [],
    adjacentFocusIds: [],
  };
}

function makeActivePack(overrides: Partial<ContextPackCatalogEntry> = {}): ContextPackCatalogEntry {
  return {
    contextPackId: 'pack-1',
    displayName: 'Pack One',
    contextPackDir: '/packs/pack-1',
    manifestPath: null,
    bootstrapReady: true,
    source: 'active-env',
    isActive: true,
    estateType: 'distributed-platform',
    defaultScopeMode: 'focused',
    repoCount: 2,
    primaryWorkingRepoIds: [],
    focusTargets: [focusTarget('api', 'API', 'primary'), focusTarget('docs', 'Docs', 'support')],
    ...overrides,
  };
}

describe('deriveActivePackWorkspaceSelection', () => {
  it('defaults every field when no lastApplied* scope is present', () => {
    const selection = deriveActivePackWorkspaceSelection(makeActivePack());
    expect(selection.selectedRepoIds).toEqual([]);
    expect(selection.selectedFocusIds).toEqual([]);
    expect(selection.repositoryTypes).toBeUndefined();
    expect(selection.deepFocusEnabled).toBe(false);
    expect(selection.deepFocusPrimaryRepoId).toBeNull();
    expect(selection.deepFocusPrimaryFocusId).toBeNull();
    expect(selection.selectedFocusPath).toBeNull();
    expect(selection.selectedFocusTargetKind).toBeNull();
    expect(selection.selectedFocusTargets).toEqual([]);
    expect(selection.selectedTestTarget).toBeNull();
    expect(selection.selectedSupportTargets).toEqual([]);
  });

  it('derives repositoryTypes from focusTargets for selected repo/focus ids', () => {
    const selection = deriveActivePackWorkspaceSelection(
      makeActivePack({
        lastAppliedSelectedRepoIds: ['api', 'docs'],
        lastAppliedSelectedFocusIds: [],
      }),
    );
    expect(selection.selectedRepoIds).toEqual(['api', 'docs']);
    expect(selection.repositoryTypes).toEqual({ api: 'primary', docs: 'support' });
  });

  it('normalizes last-applied deep focus anchors and keeps the enabled flag', () => {
    const selection = deriveActivePackWorkspaceSelection(
      makeActivePack({
        lastAppliedDeepFocusEnabled: true,
        lastAppliedDeepFocusPrimaryRepoId: 'api',
        lastAppliedDeepFocusPrimaryFocusId: 'api',
      }),
    );
    expect(selection.deepFocusEnabled).toBe(true);
    expect(selection.deepFocusPrimaryRepoId).toBe('api');
    expect(selection.deepFocusPrimaryFocusId).toBe('api');
  });
});

describe('buildCurrentWorkspaceScopeSummary', () => {
  it('produces a current-workspace summary flagged Active when deep focus is off', () => {
    const pack = makeActivePack();
    const summary = buildCurrentWorkspaceScopeSummary(pack);
    expect(summary.source).toBe('current-workspace');
    expect(summary.title).toBe('Current workspace selection');
    expect(summary.triggerLabel).toBe('Current workspace selection details');
    expect(summary.flag).toBe('Active');
    expect(summary.selectedPack).toBe(pack);
  });

  it('flags Deep Focus when last-applied deep focus is enabled', () => {
    const summary = buildCurrentWorkspaceScopeSummary(
      makeActivePack({ lastAppliedDeepFocusEnabled: true }),
    );
    expect(summary.flag).toBe('Deep Focus');
  });
});

describe('mapRecentTaskBindingToSelection', () => {
  it('normalizes optional anchor ids to null when the sidecar omits them', () => {
    const selection = mapRecentTaskBindingToSelection(makeBinding());
    expect(selection.deepFocusPrimaryRepoId).toBeNull();
    expect(selection.deepFocusPrimaryFocusId).toBeNull();
    expect(selection.repositoryTypes).toBeUndefined();
    expect(selection.selectedTestTarget).toBeNull();
  });

  it('preserves anchor ids, repositoryTypes, and scope fields from the sidecar', () => {
    const selection = mapRecentTaskBindingToSelection(
      makeBinding({
        selectedRepoIds: ['api'],
        selectedFocusIds: ['api'],
        repositoryTypes: { api: 'primary' },
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'api',
        deepFocusPrimaryFocusId: 'api',
        selectedFocusPath: 'repos/api',
        selectedFocusTargetKind: 'directory',
      }),
    );
    expect(selection.selectedRepoIds).toEqual(['api']);
    expect(selection.repositoryTypes).toEqual({ api: 'primary' });
    expect(selection.deepFocusEnabled).toBe(true);
    expect(selection.deepFocusPrimaryRepoId).toBe('api');
    expect(selection.deepFocusPrimaryFocusId).toBe('api');
    expect(selection.selectedFocusPath).toBe('repos/api');
    expect(selection.selectedFocusTargetKind).toBe('directory');
  });

  it('clones and casts backend target arrays into frontend deep-focus targets', () => {
    const focusTarget = { path: 'repos/api', kind: 'directory' as const, repoId: 'api', focusId: 'api' };
    const testTarget = { path: 'repos/api/tests', kind: 'directory' as const };
    const supportTarget = {
      path: 'repos/lib',
      kind: 'directory' as const,
      effectiveScope: 'full-directory' as const,
    };
    const selection = mapRecentTaskBindingToSelection(
      makeBinding({
        selectedFocusTargets: [focusTarget],
        selectedTestTarget: testTarget,
        selectedSupportTargets: [supportTarget],
      }),
    );
    expect(selection.selectedFocusTargets).toEqual([
      { path: 'repos/api', kind: 'directory', repoId: 'api', focusId: 'api' },
    ]);
    expect(selection.selectedFocusTargets[0]).not.toBe(focusTarget);
    expect(selection.selectedTestTarget).toMatchObject({ path: 'repos/api/tests', kind: 'directory' });
    expect(selection.selectedTestTarget).not.toBe(testTarget);
    expect(selection.selectedSupportTargets[0]).not.toBe(supportTarget);
    expect(selection.selectedSupportTargets[0]).toMatchObject({ path: 'repos/lib', kind: 'directory' });
  });
});

describe('buildRecentTaskScopeSummary', () => {
  it('produces a recent-task summary flagged Recent from the converted binding', () => {
    const summary = buildRecentTaskScopeSummary(makeBinding({ selectedRepoIds: ['api'] }));
    expect(summary.source).toBe('recent-task');
    expect(summary.title).toBe('Selected recent task scope');
    expect(summary.triggerLabel).toBe('Selected recent task scope details');
    expect(summary.flag).toBe('Recent');
    expect(summary.selectedPack).toBeUndefined();
    expect(summary.selection.selectedRepoIds).toEqual(['api']);
  });

  it('attaches the matching pack when one is provided', () => {
    const pack = makeActivePack();
    const summary = buildRecentTaskScopeSummary(makeBinding(), pack);
    expect(summary.selectedPack).toBe(pack);
  });
});
