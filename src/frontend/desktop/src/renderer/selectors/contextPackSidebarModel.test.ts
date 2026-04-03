import { describe, expect, it } from 'vitest';

import type {
  ContextPackCatalogEntry,
  ContextPackFocusTarget,
  ContextPackReseedExecutionResult,
  ContextPackSwitchExecutionResult,
} from '../../shared/desktopContract';
import {
  buildCompactSidebarModel,
  buildFocusHint,
  formatFocusLabel,
  formatRuntimeStatus,
  formatSource,
  mapRuntimeStatusTone,
  selectPreferredContextPackDir,
  summarizeReseedResult,
  summarizeSwitchResult,
} from './contextPackSidebarModel';

function makeFocusTarget(overrides: Partial<ContextPackFocusTarget> = {}): ContextPackFocusTarget {
  return {
    focusId: 'orders-api',
    displayName: 'Orders API',
    kind: 'repository',
    repoId: 'orders-api',
    serviceName: 'Orders API',
    systemLayer: 'backend',
    repoRole: 'backend-service',
    repositoryType: null,
    relativePath: null,
    focusType: null,
    group: null,
    defaultFocusable: true,
    activationPriority: 10,
    adjacentRepoIds: [],
    adjacentFocusIds: [],
    ...overrides,
  };
}

function makePack(overrides: Partial<ContextPackCatalogEntry> = {}): ContextPackCatalogEntry {
  return {
    contextPackId: 'orders-estate',
    displayName: 'Orders Estate',
    contextPackDir: '/tmp/packs/orders-estate',
    manifestPath: null,
    bootstrapReady: true,
    source: 'active-env',
    isActive: true,
    estateType: 'distributed-platform',
    defaultScopeMode: 'focused',
    repoCount: 1,
    primaryWorkingRepoIds: ['orders-api'],
    focusTargets: [makeFocusTarget()],
    ...overrides,
  };
}

describe('selectPreferredContextPackDir', () => {
  it('returns the first candidate that matches a known pack', () => {
    const packs = [makePack({ contextPackDir: '/a' }), makePack({ contextPackDir: '/b' })];
    expect(selectPreferredContextPackDir(packs, [null, '/b'])).toBe('/b');
  });

  it('falls back to the first pack dir when no candidate matches', () => {
    const packs = [makePack({ contextPackDir: '/a' })];
    expect(selectPreferredContextPackDir(packs, ['/unknown'])).toBe('/a');
  });

  it('returns empty string when pack list is empty', () => {
    expect(selectPreferredContextPackDir([], ['/x'])).toBe('');
  });
});

describe('formatSource', () => {
  it('maps known source values', () => {
    expect(formatSource('configured-path')).toBe('configured');
    expect(formatSource('search-root')).toBe('discovered');
    expect(formatSource('active-env')).toBe('active env');
    expect(formatSource('recent-state')).toBe('recent');
  });
});

describe('formatFocusLabel', () => {
  it('returns displayName for simple repository target', () => {
    expect(formatFocusLabel(makeFocusTarget())).toBe('Orders API');
  });

  it('appends repoId suffix when serviceName differs from displayName', () => {
    const target = makeFocusTarget({
      displayName: 'API Service',
      serviceName: 'Orders Service',
      repoId: 'orders-api',
    });
    expect(formatFocusLabel(target)).toBe('API Service · orders-api');
  });

  it('appends relativePath for focus-area kind', () => {
    const target = makeFocusTarget({
      kind: 'focus-area',
      displayName: 'Core Module',
      relativePath: 'src/core',
      repoId: null,
      serviceName: null,
    });
    expect(formatFocusLabel(target)).toBe('Core Module · src/core');
  });
});

describe('formatRuntimeStatus', () => {
  it('maps known statuses', () => {
    expect(formatRuntimeStatus('active')).toBe('active');
    expect(formatRuntimeStatus('active-dirty-workspace')).toBe('modified');
    expect(formatRuntimeStatus('activation-failed')).toBe('failed');
    expect(formatRuntimeStatus('workspace-sync-failed')).toBe('sync failed');
  });

  it('returns "inactive" for undefined', () => {
    expect(formatRuntimeStatus(undefined)).toBe('inactive');
  });
});

describe('mapRuntimeStatusTone', () => {
  it('returns active tone for active status', () => {
    expect(mapRuntimeStatusTone('active')).toBe('active');
  });

  it('returns completed tone for inactive and undefined', () => {
    expect(mapRuntimeStatusTone('inactive')).toBe('completed');
    expect(mapRuntimeStatusTone(undefined)).toBe('completed');
  });

  it('returns blocked tone for failure statuses', () => {
    expect(mapRuntimeStatusTone('activation-failed')).toBe('blocked');
    expect(mapRuntimeStatusTone('workspace-sync-failed')).toBe('blocked');
  });
});

describe('buildFocusHint', () => {
  it('returns null when no focus targets exist', () => {
    expect(buildFocusHint({ selectedPack: makePack({ focusTargets: [] }) })).toBeNull();
  });

  it('returns distributed-platform hint for selected repos', () => {
    const hint = buildFocusHint({ selectedPack: makePack() });
    expect(hint).toContain('selected repos');
  });

  it('returns monolith hint for non-distributed packs', () => {
    const hint = buildFocusHint({
      selectedPack: makePack({ estateType: 'monolith' }),
    });
    expect(hint).toContain('selected focus areas');
  });
});

describe('summarizeSwitchResult', () => {
  it('returns null for null input', () => {
    expect(summarizeSwitchResult(null)).toBeNull();
  });

  it('formats result with warning count', () => {
    const result: ContextPackSwitchExecutionResult = {
      ok: true,
      wrapperAction: 'apply',
      stage: 'complete',
      status: 'ok',
      activation: { performed: true, exitCode: 0, output: '' },
      envStateCleared: false,
      error: null,
      contextPackId: 'pack-1',
      contextPackDir: '/tmp/pack',
      workspaceFile: null,
      stateFile: null,
      scopeMode: 'focused',
      selectedRepoIds: [],
      selectedFocusIds: [],
      warnings: ['w1', 'w2'],
      foldersToAdd: [],
      foldersToRemove: [],
      managedFolders: [],
      targetFolders: [],
      lastSyncedAt: null,
    };
    expect(summarizeSwitchResult(result)).toBe('apply · complete · 2 warnings');
  });
});

describe('summarizeReseedResult', () => {
  it('returns null for null input', () => {
    expect(summarizeReseedResult(null)).toBeNull();
  });

  it('formats result counts', () => {
    const result: ContextPackReseedExecutionResult = {
      contextPackDir: '/tmp/pack',
      overallStatus: 'ok',
      reportPath: null,
      seededRepoCount: 3,
      blockedRepoCount: 1,
      conventionsSummaryStatus: null,
      conventionsPolicy: 'only-if-missing',
    };
    expect(summarizeReseedResult(result)).toBe('ok · 3 seeded · 1 blocked');
  });
});

describe('buildCompactSidebarModel', () => {
  const baseArgs = {
    contextPacks: [makePack()],
    activeContextPackDir: '/tmp/packs/orders-estate',
    selectedContextPackDir: '/tmp/packs/orders-estate',
    selectedRepoIds: ['orders-api'],
    selectedFocusIds: [],
    lastResult: null,
    lastReseedResult: null,
  };

  it('builds heading and location from active pack', () => {
    const model = buildCompactSidebarModel(baseArgs);
    expect(model.activeHeading).toBe('Orders Estate');
    expect(model.activeLocation).toBe('Orders Estate is active');
  });

  it('shows "No active context pack" when none is active', () => {
    const model = buildCompactSidebarModel({
      ...baseArgs,
      contextPacks: [makePack({ isActive: false, displayName: 'Inactive Pack' })],
      activeContextPackDir: null,
    });
    expect(model.activeHeading).toBe('Inactive Pack');
    expect(model.activeLocation).toBe('No active context pack is currently applied.');
    expect(model.activeStatusLabel).toBe('no active pack');
  });

  it('populates selectedPackSummary chips for distributed platform', () => {
    const model = buildCompactSidebarModel(baseArgs);
    const labels = model.selectedPackSummary.map((c) => c.label);
    expect(labels).toContain('Distributed');
    expect(labels).toContain('1 repo');
    expect(labels).toContain('1 focus');
  });

  it('returns empty selectedPackSummary when no pack is selected', () => {
    const model = buildCompactSidebarModel({
      ...baseArgs,
      selectedContextPackDir: '/nonexistent',
    });
    expect(model.selectedPackSummary).toHaveLength(0);
  });

  it('includes focus summary from selected working focuses', () => {
    const model = buildCompactSidebarModel(baseArgs);
    expect(model.selectedWorkingFocusSummary).toBe('Orders API');
  });
});
