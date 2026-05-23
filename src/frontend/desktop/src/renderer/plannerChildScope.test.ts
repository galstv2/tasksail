import { describe, expect, it } from 'vitest';

import {
  areChildScopesEqual,
  buildChildScopeStandardRolePack,
  buildLilyPlanningReloadScope,
  childScopeFromFocusSnapshot,
  deriveChildScopeAbsentParentWarning,
  updateStandardChildScope,
  updateStandardChildScopeRole,
  validateChildScopePrimarySelection,
} from './plannerChildScope';
import type { PlannerChildTaskExecutionScope, PlannerFocusSnapshot } from '../shared/desktopContract';
import type { ContextPackCatalogEntry } from '../shared/desktopContract';

const parentScope: PlannerChildTaskExecutionScope = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'focused',
  selectedRepoIds: ['orders-api', 'billing-api'],
  selectedFocusIds: [],
  deepFocusEnabled: true,
  deepFocusPrimaryRepoId: 'orders-api',
  deepFocusPrimaryFocusId: null,
  selectedFocusPath: 'src/orders',
  selectedFocusTargetKind: 'directory',
  selectedFocusTargets: [{
    path: 'src/orders',
    kind: 'directory',
    repoId: 'orders-api',
    repoLocalPath: '/repo/orders-api',
    role: 'anchor',
    supportTargets: [{ path: 'src/shared', kind: 'directory', repoId: 'orders-api' }],
  }],
  selectedTestTarget: { path: 'tests/orders', kind: 'directory', repoId: 'orders-api' },
  selectedSupportTargets: [{ path: 'src/billing', kind: 'directory', repoId: 'billing-api' }],
};

const selectedPack: ContextPackCatalogEntry = {
  contextPackId: 'orders',
  displayName: 'Orders',
  contextPackDir: '/packs/orders',
  manifestPath: null,
  bootstrapReady: true,
  source: 'configured-path',
  isActive: true,
  estateType: 'distributed-platform',
  defaultScopeMode: null,
  repoCount: 3,
  primaryWorkingRepoIds: [],
  focusTargets: [
    {
      focusId: 'orders-api',
      displayName: 'Orders API',
      kind: 'repository',
      repoId: 'orders-api',
      repoLocalPath: '/repo/orders-api',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 0,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
    {
      focusId: 'billing-api',
      displayName: 'Billing API',
      kind: 'repository',
      repoId: 'billing-api',
      repoLocalPath: '/repo/billing-api',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 1,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
    {
      focusId: 'payments-api',
      displayName: 'Payments API',
      kind: 'repository',
      repoId: 'payments-api',
      repoLocalPath: '/repo/payments-api',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 2,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    },
  ],
};

const monolithPack: ContextPackCatalogEntry = {
  ...selectedPack,
  contextPackId: 'monolith',
  displayName: 'Monolith',
  contextPackDir: '/packs/monolith',
  estateType: 'monolith',
  focusTargets: [
    {
      ...selectedPack.focusTargets[0]!,
      focusId: 'frontend',
      repoId: 'monolith',
      repoLocalPath: '/repo/monolith',
      relativePath: 'src/frontend',
    },
    {
      ...selectedPack.focusTargets[1]!,
      focusId: 'backend',
      repoId: 'monolith',
      repoLocalPath: '/repo/monolith',
      relativePath: 'src/backend',
    },
  ],
};

describe('plannerChildScope', () => {
  it('converts a planner focus snapshot into a child execution scope without mutating it', () => {
    const snapshot: PlannerFocusSnapshot = {
      version: 1,
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      title: 'Parent',
      primaryRepoId: 'orders-api',
      primaryRepoRoot: '/repo/orders-api',
      primaryFocusRelativePath: 'src/orders',
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      deepFocusEnabled: false,
      contextPackBinding: {
        ...parentScope,
        deepFocusEnabled: false,
        deepFocusPrimaryRepoId: undefined,
        deepFocusPrimaryFocusId: undefined,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    };

    const scope = childScopeFromFocusSnapshot(snapshot);
    scope.selectedRepoIds.push('new-repo');

    expect(scope.deepFocusPrimaryRepoId).toBeNull();
    expect(snapshot.contextPackBinding.selectedRepoIds).toEqual(['orders-api', 'billing-api']);
    expect(scope.repositoryTypes).toEqual({ 'orders-api': 'primary', 'billing-api': 'support' });
  });

  it('builds deterministic read context while preserving child execution authority', () => {
    const childScope: PlannerChildTaskExecutionScope = {
      ...parentScope,
      selectedRepoIds: ['orders-api'],
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        repoId: 'orders-api',
        repoLocalPath: '/repo/orders-api',
        role: 'primary',
      }],
      selectedTestTarget: null,
      selectedSupportTargets: [{ path: 'src/payments', kind: 'directory', repoId: 'payments-api' }],
    };

    const reload = buildLilyPlanningReloadScope(parentScope, childScope, selectedPack);

    expect(reload.schemaVersion).toBe(1);
    expect(reload.purpose).toBe('lily-planning-read-context');
    expect(reload.selectedRepoIds).toEqual(['orders-api', 'billing-api']);
    expect(reload.repositoryTypes).toEqual({ 'orders-api': 'support', 'billing-api': 'support' });
    expect(reload.selectedFocusTargets).toEqual(childScope.selectedFocusTargets);
    expect(reload.selectedSupportTargets).toEqual([
      { path: 'src/payments', kind: 'directory', repoId: 'payments-api', repoLocalPath: '/repo/payments-api' },
      { path: 'src/billing', kind: 'directory', repoId: 'billing-api', repoLocalPath: '/repo/billing-api' },
      { path: 'tests/orders', kind: 'directory', repoId: 'orders-api', repoLocalPath: '/repo/orders-api' },
    ]);
  });

  it('derives standard primary/support roles from independent child-scope role metadata', () => {
    const pack = buildChildScopeStandardRolePack(selectedPack, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api', 'billing-api'],
      repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });

    expect(pack.focusTargets.map((target) => [target.focusId, target.repositoryType])).toEqual([
      ['orders-api', 'primary'],
      ['billing-api', 'support'],
      ['payments-api', null],
    ]);
    expect(selectedPack.focusTargets.map((target) => target.repositoryType)).toEqual([null, null, null]);
  });

  it('keeps standard role badges visible after a target is unchecked without making it selected', () => {
    const unchecked = updateStandardChildScope(selectedPack, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api', 'billing-api'],
      repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, 'billing-api');
    const pack = buildChildScopeStandardRolePack(selectedPack, unchecked);

    expect(unchecked.selectedRepoIds).toEqual(['orders-api']);
    expect(unchecked.repositoryTypes).toEqual({ 'orders-api': 'primary', 'billing-api': 'support' });
    expect(pack.focusTargets.map((target) => [target.focusId, target.repositoryType])).toEqual([
      ['orders-api', 'primary'],
      ['billing-api', 'support'],
      ['payments-api', null],
    ]);
  });

  it('updates standard child-scope roles without changing selected distributed or monolith IDs', () => {
    const distributed = updateStandardChildScopeRole(selectedPack, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api', 'billing-api', 'payments-api'],
      repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support', 'payments-api': 'support' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, 'billing-api', 'primary');
    expect(distributed.selectedRepoIds).toEqual(['orders-api', 'billing-api', 'payments-api']);
    expect(distributed.repositoryTypes).toEqual({ 'orders-api': 'primary', 'billing-api': 'primary', 'payments-api': 'support' });

    const monolith = updateStandardChildScopeRole(monolithPack, {
      ...parentScope,
      contextPackDir: '/packs/monolith',
      contextPackId: 'monolith',
      deepFocusEnabled: false,
      selectedRepoIds: [],
      selectedFocusIds: ['frontend', 'backend'],
      repositoryTypes: { frontend: 'primary', backend: 'primary' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, 'frontend', 'support');
    expect(monolith.selectedFocusIds).toEqual(['frontend', 'backend']);
    expect(monolith.repositoryTypes).toEqual({ frontend: 'support', backend: 'primary' });
  });

  it('requires at least one Primary in standard and Deep Focus child scopes', () => {
    expect(validateChildScopePrimarySelection(selectedPack, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['billing-api'],
      repositoryTypes: { 'billing-api': 'support' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    })).toContain('Primary Selection Required');

    expect(validateChildScopePrimarySelection(selectedPack, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['billing-api'],
      repositoryTypes: { 'billing-api': 'primary' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    })).toBeNull();

    expect(validateChildScopePrimarySelection(selectedPack, {
      ...parentScope,
      selectedFocusTargets: [],
    })).toContain('Primary Selection Required');

    expect(validateChildScopePrimarySelection(selectedPack, parentScope)).toBeNull();
  });

  it('compares child scopes by effective scope instead of stale unselected role metadata', () => {
    expect(areChildScopesEqual({
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api'],
      repositoryTypes: { 'orders-api': 'primary' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api'],
      repositoryTypes: { 'billing-api': 'support', 'orders-api': 'primary' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    })).toBe(true);
  });

  it('fails closed for cross-context-pack reload scope unions', () => {
    expect(() => buildLilyPlanningReloadScope(parentScope, {
      ...parentScope,
      contextPackId: 'other',
    })).toThrow("Child scope must stay in the selected parent's context pack.");
  });

  it('warns when child scope adds targets absent from the parent', () => {
    const standardParentScope: PlannerChildTaskExecutionScope = {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api'],
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    };
    expect(deriveChildScopeAbsentParentWarning(standardParentScope, {
      ...standardParentScope,
      selectedRepoIds: ['orders-api', 'new-api'],
    }, selectedPack)).toBe('Added to child scope: new-api');
  });

  it('summarizes standard child additions and parent-only read context by label', () => {
    expect(deriveChildScopeAbsentParentWarning({
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api', 'billing-api'],
      repositoryTypes: { 'orders-api': 'primary', 'billing-api': 'support' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, {
      ...parentScope,
      deepFocusEnabled: false,
      selectedRepoIds: ['orders-api', 'payments-api'],
      repositoryTypes: { 'orders-api': 'primary', 'payments-api': 'support' },
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, selectedPack)).toBe('Added to child scope: Payments API · Parent read-only: Billing API');
  });

  it('summarizes Deep Focus child additions including scoped support targets', () => {
    expect(deriveChildScopeAbsentParentWarning(parentScope, {
      ...parentScope,
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        repoId: 'orders-api',
        repoLocalPath: '/repo/orders-api',
        role: 'anchor',
        supportTargets: [{ path: '', kind: 'directory', repoId: 'payments-api', repoLocalPath: '/repo/payments-api' }],
      }],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    }, selectedPack)).toBe('Added to child scope: Payments API · Parent read-only: shared, orders +1');
  });

  it('does not warn when child support reuses an existing parent primary target', () => {
    expect(deriveChildScopeAbsentParentWarning(parentScope, {
      ...parentScope,
      selectedSupportTargets: [
        { path: 'src/orders', kind: 'directory', repoId: 'orders-api' },
      ],
    }, selectedPack)).toBe('Parent read-only: billing');
  });

  it('hydrates monolith Deep Focus read-context targets by focus ID', () => {
    const parentMonolithScope: PlannerChildTaskExecutionScope = {
      ...parentScope,
      contextPackDir: '/packs/monolith',
      contextPackId: 'monolith',
      selectedRepoIds: [],
      selectedFocusIds: ['backend'],
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: 'backend',
      selectedFocusTargets: [{ path: 'src/backend', kind: 'directory', repoId: 'monolith', focusId: 'backend' }],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    };
    const childMonolithScope: PlannerChildTaskExecutionScope = {
      ...parentMonolithScope,
      selectedFocusIds: ['frontend'],
      deepFocusPrimaryFocusId: 'frontend',
      selectedFocusTargets: [{ path: 'src/frontend', kind: 'directory', repoId: 'monolith', focusId: 'frontend' }],
    };

    const reload = buildLilyPlanningReloadScope(parentMonolithScope, childMonolithScope, monolithPack);

    expect(reload.selectedFocusIds).toEqual(['frontend', 'backend']);
    expect(reload.selectedFocusTargets).toEqual(childMonolithScope.selectedFocusTargets);
    expect(reload.selectedSupportTargets).toEqual([
      { path: 'src/backend', kind: 'directory', repoId: 'monolith', focusId: 'backend', repoLocalPath: '/repo/monolith' },
    ]);
  });
});
