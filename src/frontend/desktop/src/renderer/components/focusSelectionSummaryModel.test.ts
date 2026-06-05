import { describe, expect, it } from 'vitest';

import type {
  ContextPackCatalogEntry,
  ContextPackFocusFilterSelection,
  ContextPackFocusTarget,
} from '../../shared/desktopContract';
import { buildFocusSelectionSummaryGroups } from './focusSelectionSummaryModel';

function focusTarget(
  id: string,
  displayName: string,
  repoLocalPath: string,
  repositoryType: 'primary' | 'support' | null = 'primary',
): ContextPackFocusTarget {
  return {
    focusId: id,
    displayName,
    kind: 'repository',
    repoId: id,
    repoLocalPath,
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

function pack(overrides: Partial<ContextPackCatalogEntry> = {}): ContextPackCatalogEntry {
  return {
    contextPackId: 'pack',
    displayName: 'Platform Pack',
    contextPackDir: '/packs/platform',
    manifestPath: null,
    bootstrapReady: true,
    source: 'configured-path',
    isActive: true,
    estateType: 'distributed-platform',
    defaultScopeMode: 'focused',
    repoCount: 2,
    primaryWorkingRepoIds: [],
    focusTargets: [
      focusTarget('platform', 'Platform', '/workspace/platform'),
      focusTarget('tools', 'Tools', '/workspace/tools'),
      focusTarget('docs', 'Docs', '/workspace/docs', 'support'),
    ],
    ...overrides,
  };
}

function selection(overrides: Partial<ContextPackFocusFilterSelection> = {}): ContextPackFocusFilterSelection {
  return {
    selectedRepoIds: [],
    selectedFocusIds: [],
    deepFocusEnabled: true,
    deepFocusPrimaryRepoId: 'platform',
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
    ...overrides,
  };
}

function valueFor(
  groups: ReturnType<typeof buildFocusSelectionSummaryGroups>,
  label: 'Primary' | 'Test' | 'Support',
): string {
  const group = groups.find((entry) => entry.label === label);
  if (!group) throw new Error(`Missing group ${label}`);
  return group.value;
}

describe('buildFocusSelectionSummaryGroups', () => {
  it('labels distributed multi-repo child primaries by path, not parent display names', () => {
    const groups = buildFocusSelectionSummaryGroups(selection({
      selectedFocusTargets: [
        {
          path: 'libs',
          kind: 'directory',
          repoLocalPath: '/workspace/platform',
          repoId: 'platform',
          role: 'anchor',
        },
        {
          path: 'Acme.Cli',
          kind: 'directory',
          repoLocalPath: '/workspace/tools',
          repoId: 'tools',
          role: 'primary',
        },
      ],
    }), pack());

    expect(valueFor(groups, 'Primary')).toBe('platform/libs, tools/Acme.Cli');
    expect(valueFor(groups, 'Primary')).not.toBe('Platform, Tools');
  });

  it('keeps single-repo nested primary labels unprefixed', () => {
    const groups = buildFocusSelectionSummaryGroups(selection({
      selectedFocusTargets: [{
        path: 'libs',
        kind: 'directory',
        repoLocalPath: '/workspace/platform',
        repoId: 'platform',
        role: 'anchor',
      }],
    }), pack());

    expect(valueFor(groups, 'Primary')).toBe('libs');
  });

  it('labels whole-repo primaries with the repo label instead of slash', () => {
    const groups = buildFocusSelectionSummaryGroups(selection({
      selectedFocusTargets: [{
        path: '',
        kind: 'directory',
        repoLocalPath: '/workspace/platform',
        repoId: 'platform',
        role: 'anchor',
      }],
    }), pack());

    expect(valueFor(groups, 'Primary')).toBe('Platform');
    expect(valueFor(groups, 'Primary')).not.toBe('/');
  });

  it('uses selectedFocusPath for legacy scalar Deep Focus selections', () => {
    const groups = buildFocusSelectionSummaryGroups(selection({
      selectedFocusTargets: [],
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
    }), pack());

    expect(valueFor(groups, 'Primary')).toBe('orders');
    expect(valueFor(groups, 'Primary')).not.toBe('Platform');
  });

  it('labels global test and support targets by path even when identity metadata is present', () => {
    const groups = buildFocusSelectionSummaryGroups(selection({
      selectedFocusTargets: [{
        path: 'libs',
        kind: 'directory',
        repoLocalPath: '/workspace/platform',
        repoId: 'platform',
        role: 'anchor',
      }],
      selectedTestTarget: {
        path: 'tests/platform',
        kind: 'directory',
        repoLocalPath: '/workspace/platform',
        repoId: 'platform',
      },
      selectedSupportTargets: [{
        path: 'docs/platform.md',
        kind: 'file',
        repoLocalPath: '/workspace/platform',
        repoId: 'platform',
      }],
    }), pack());

    expect(valueFor(groups, 'Test')).toBe('Global: platform');
    expect(valueFor(groups, 'Support')).toBe('Global: platform.md');
    expect(valueFor(groups, 'Test')).not.toBe('Global: Platform');
    expect(valueFor(groups, 'Support')).not.toBe('Global: Platform');
  });

  it('preserves standard mode primary and support grouping', () => {
    const groups = buildFocusSelectionSummaryGroups(selection({
      deepFocusEnabled: false,
      selectedRepoIds: ['platform', 'docs'],
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
      repositoryTypes: { platform: 'primary', docs: 'support' },
    }), pack());

    expect(groups).toEqual([
      { label: 'Primary', value: 'Platform', tone: 'primary' },
      { label: 'Support', value: 'Docs', tone: 'support' },
    ]);
  });
});
