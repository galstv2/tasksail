import { describe, expect, it } from 'vitest';

import type { ContextPackPrimaryFocusTarget } from '../../shared/desktopContract';
import type { TopLevelTarget } from './SidebarDeepFocusControls.types';
import { buildScopeSummaryViewModel } from './sidebarDeepFocusSelectors';

const TOOLS: TopLevelTarget = {
  id: 'tools',
  label: 'Tools',
  rootPath: '',
  repoLocalPath: '/repos/tools',
  ancillaryAllowed: false,
  systemLayer: null,
};

function primary(
  path: string,
  repoLocalPath: string,
  overrides: Partial<ContextPackPrimaryFocusTarget> = {},
): ContextPackPrimaryFocusTarget {
  return {
    path,
    kind: 'directory',
    role: 'primary',
    repoLocalPath,
    repoId: repoLocalPath.split('/').pop() ?? '',
    ...overrides,
  };
}

describe('buildScopeSummaryViewModel', () => {
  it('returns "No scope set" when there are no primaries and no scalar selection', () => {
    const vm = buildScopeSummaryViewModel(null, [], null, null, null, []);
    expect(vm.primaryCount).toBe(0);
    expect(vm.titleSentence).toBe('No scope set');
    expect(vm.primaryRows).toHaveLength(0);
    expect(vm.hasGlobalBlock).toBe(false);
  });

  it('synthesises a single anchor row from a legacy scalar primary selection', () => {
    const vm = buildScopeSummaryViewModel(TOOLS, [], 'src', 'directory', null, []);
    expect(vm.primaryCount).toBe(1);
    expect(vm.titleSentence).toBe('1 primary target');
    expect(vm.primaryRows).toHaveLength(1);
    expect(vm.primaryRows[0].isAnchor).toBe(true);
    expect(vm.primaryRows[0].basenameLabel).toBe('src');
    expect(vm.primaryRows[0].repoPrefixLabel).toBeNull();
  });

  it('reports "N primary targets" when multiple primaries share one repo', () => {
    const vm = buildScopeSummaryViewModel(
      TOOLS,
      [primary('src', '/repos/tools'), primary('lib', '/repos/tools')],
      null,
      null,
      null,
      [],
    );
    expect(vm.primaryCount).toBe(2);
    expect(vm.repoCount).toBe(1);
    expect(vm.titleSentence).toBe('2 primary targets');
    expect(vm.primaryRows.every((row) => row.repoPrefixLabel === null)).toBe(true);
  });

  it('appends "across N repos" when primaries span multiple repos and splits the prefix', () => {
    const vm = buildScopeSummaryViewModel(
      TOOLS,
      [
        primary('src', '/repos/tools', { role: 'anchor' }),
        primary('src', '/repos/platform'),
      ],
      null,
      null,
      null,
      [],
    );
    expect(vm.primaryCount).toBe(2);
    expect(vm.repoCount).toBe(2);
    expect(vm.titleSentence).toBe('2 primary targets across 2 repos');
    expect(vm.primaryRows[0].repoPrefixLabel).toBe('tools');
    expect(vm.primaryRows[0].basenameLabel).toBe('src');
    expect(vm.primaryRows[0].isAnchor).toBe(true);
    expect(vm.primaryRows[1].repoPrefixLabel).toBe('platform');
    expect(vm.primaryRows[1].isAnchor).toBe(false);
  });

  it('marks rows expandable when scopedTest or scopedSupports are set', () => {
    const vm = buildScopeSummaryViewModel(
      TOOLS,
      [
        primary('src', '/repos/tools', {
          role: 'anchor',
          testTarget: { path: 'tests', kind: 'directory' },
        }),
        primary('lib', '/repos/tools', {
          supportTargets: [{ path: 'docs', kind: 'directory' }],
        }),
        primary('vendor', '/repos/tools'),
      ],
      null,
      null,
      null,
      [],
    );
    expect(vm.primaryRows[0].expandable).toBe(true);
    expect(vm.primaryRows[1].expandable).toBe(true);
    expect(vm.primaryRows[2].expandable).toBe(false);
  });

  it('uses each primary\'s own repo basename for whole-repo primaries spanning multiple repos', () => {
    const vm = buildScopeSummaryViewModel(
      TOOLS,
      [
        primary('', '/repos/platform', { role: 'anchor' }),
        primary('', '/repos/tools'),
      ],
      null,
      null,
      null,
      [],
    );
    expect(vm.titleSentence).toBe('2 primary targets across 2 repos');
    expect(vm.primaryRows[0].basenameLabel).toBe('platform');
    expect(vm.primaryRows[0].repoPrefixLabel).toBeNull();
    expect(vm.primaryRows[1].basenameLabel).toBe('tools');
    expect(vm.primaryRows[1].repoPrefixLabel).toBeNull();
  });

  it('treats both null and undefined globalTest as null and surfaces hasGlobalBlock', () => {
    const vmEmpty = buildScopeSummaryViewModel(
      TOOLS,
      [primary('src', '/repos/tools')],
      null,
      null,
      undefined,
      [],
    );
    expect(vmEmpty.globalTest).toBeNull();
    expect(vmEmpty.hasGlobalBlock).toBe(false);

    const vmWithGlobals = buildScopeSummaryViewModel(
      TOOLS,
      [primary('src', '/repos/tools')],
      null,
      null,
      { path: 'tests', kind: 'directory' },
      [{ path: 'docs', kind: 'directory' }],
    );
    expect(vmWithGlobals.globalTest).toEqual({ path: 'tests', kind: 'directory' });
    expect(vmWithGlobals.globalSupports).toHaveLength(1);
    expect(vmWithGlobals.hasGlobalBlock).toBe(true);
  });
});
