import { describe, expect, it } from 'vitest';
import {
  applyPromotePrimary,
  applyRestoreUndo,
  applyScopedRoleAction,
  derivePrimaryIds,
  deriveWorkingFocusIdsFromTargets,
} from './sidebarDeepFocusReducers';
import type { DeepFocusDraft, TopLevelTarget } from './SidebarDeepFocusControls.types';
import type { ContextPackPrimaryFocusTarget } from '../../shared/desktopContract';

// Per spec §2.1: TopLevelTarget.id is the manifest identifier
// (repoId in distributed mode, focusId in monolith mode). repoLocalPath is the
// resolved filesystem path. The two are distinct strings.
const TOOLS: TopLevelTarget = {
  id: 'tools',
  label: 'Tools',
  rootPath: '',
  repoLocalPath: '/repos/tools',
  ancillaryAllowed: false,
  systemLayer: null,
};
const PLATFORM: TopLevelTarget = {
  id: 'platform',
  label: 'Platform',
  rootPath: '',
  repoLocalPath: '/repos/platform',
  ancillaryAllowed: false,
  systemLayer: null,
};

function emptyDraft(): DeepFocusDraft {
  return {
    selectedWorkingFocusIds: [],
    state: {
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedFocusTargets: [],
      selectedTestTarget: undefined,
      selectedSupportTargets: [],
    },
    scopeCursor: { kind: 'global' },
  };
}

describe('applyScopedRoleAction make-primary multi-repo', () => {
  it('selecting primaries from two different repos retains both, stamping path AND identity', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/foo', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'platform', target: { path: 'src/bar', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    const targets = draft.state.selectedFocusTargets ?? [];
    expect(targets.map((t) => t.repoLocalPath)).toEqual(['/repos/tools', '/repos/platform']);
    expect(targets.map((t) => t.repoId)).toEqual(['tools', 'platform']);
  });

  it('selecting the same relative src path in two repos retains both targets', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'platform', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    expect(draft.state.selectedFocusTargets).toEqual([
      expect.objectContaining({ path: 'src', kind: 'directory', repoLocalPath: '/repos/tools', repoId: 'tools' }),
      expect.objectContaining({ path: 'src', kind: 'directory', repoLocalPath: '/repos/platform', repoId: 'platform' }),
    ]);
    expect(draft.selectedWorkingFocusIds).toEqual(['tools', 'platform']);
  });

  it('promotes and restores one same-path primary without matching the other repo', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'platform', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    const platformPrimary = draft.state.selectedFocusTargets?.[1];
    expect(platformPrimary).toBeDefined();
    const promoted = applyPromotePrimary(draft, platformPrimary!, 'distributed');
    expect(promoted?.state.selectedFocusTargets?.[0]?.role).toBe('primary');
    expect(promoted?.state.selectedFocusTargets?.[1]).toEqual(expect.objectContaining({
      repoId: 'platform',
      role: 'anchor',
    }));
    expect(promoted?.selectedWorkingFocusIds).toEqual(['platform', 'tools']);

    const restoreResult = applyRestoreUndo(
      {
        ...draft,
        selectedWorkingFocusIds: ['tools'],
        state: {
          ...draft.state,
          selectedFocusTargets: [draft.state.selectedFocusTargets![0]!],
        },
      },
      {
        kind: 'primary',
        target: platformPrimary!,
        index: 1,
        cursor: { kind: 'primary', index: 1 },
        label: 'src removed',
      },
      false,
      'distributed',
    );

    expect(restoreResult.kind).toBe('apply');
    if (restoreResult.kind === 'apply') {
      expect(restoreResult.next.state.selectedFocusTargets).toHaveLength(2);
      expect(restoreResult.next.state.selectedFocusTargets?.map((target) => target.repoId)).toEqual(['tools', 'platform']);
      expect(restoreResult.next.selectedWorkingFocusIds).toEqual(['tools', 'platform']);
    }
  });

  it('selectedWorkingFocusIds holds manifest IDs (anchor first, then add order)', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/foo', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'platform', target: { path: 'src/bar', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    expect(draft.selectedWorkingFocusIds).toEqual(['tools', 'platform']);
    const targets = draft.state.selectedFocusTargets ?? [];
    expect(targets[0]?.role).toBe('anchor');
    expect(targets[0]?.repoLocalPath).toBe('/repos/tools');
    expect(targets[0]?.repoId).toBe('tools');
    expect(targets[1]?.role).toBe('primary');
    expect(targets[1]?.repoLocalPath).toBe('/repos/platform');
    expect(targets[1]?.repoId).toBe('platform');
  });

  it('prevents child primary targets under an existing folder primary target', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    const next = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/app', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    expect(next.state.selectedFocusTargets).toHaveLength(1);
    expect(next.state.selectedFocusTargets?.[0]).toEqual(expect.objectContaining({
      path: 'src',
      repoId: 'tools',
    }));
  });

  it('promoting a parent primary target prunes covered child primaries and supports', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/app', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'add-primary-support', index: 0 }, {
      topLevelId: 'tools', target: { path: 'src/docs', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = {
      ...draft,
      state: {
        ...draft.state,
        selectedSupportTargets: [{ path: 'src/readme', kind: 'file' }],
      },
    };

    const next = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    expect(next.state.selectedFocusTargets).toHaveLength(1);
    expect(next.state.selectedFocusTargets?.[0]).toEqual(expect.objectContaining({
      path: 'src',
      repoId: 'tools',
    }));
    expect(next.state.selectedFocusTargets?.[0]?.supportTargets ?? []).toEqual([]);
    expect(next.state.selectedSupportTargets).toEqual([]);
  });

  it('allows parent support for a child folder primary target', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/app', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    const next = applyScopedRoleAction(draft, { type: 'add-primary-support', index: 0 }, {
      topLevelId: 'tools', target: { path: 'src', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    expect(next.state.selectedFocusTargets?.[0]).toEqual(expect.objectContaining({
      path: 'src/app',
      kind: 'directory',
      supportTargets: [expect.objectContaining({
        path: 'src',
        kind: 'directory',
        repoLocalPath: '/repos/tools',
        repoId: 'tools',
      })],
    }));
  });

  it('monolith mode stamps focusId instead of repoId', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/foo', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'monolith',
    }).next;
    const targets = draft.state.selectedFocusTargets ?? [];
    expect(targets[0]?.focusId).toBe('tools');
    expect(targets[0]?.repoId).toBeUndefined();
    expect(draft.selectedWorkingFocusIds).toEqual(['tools']);
  });

  it('removing the anchor promotes the next primary and reorders manifest-ID list', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/foo', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'platform', target: { path: 'src/bar', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    const result = applyScopedRoleAction(draft, { type: 'remove-primary', index: 0 }, {
      topLevelId: 'tools', target: { path: 'src/foo', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    });
    expect(result.removePrimaryTarget?.repoId).toBe('tools');
    expect(result.removePrimaryTarget?.repoLocalPath).toBe('/repos/tools');

    // Simulate the side-effect handler: drop index 0, promote index 0, recompute IDs.
    const remaining = (draft.state.selectedFocusTargets ?? [])
      .filter((_, i) => i !== 0)
      .map((t, i) => ({ ...t, role: i === 0 ? ('anchor' as const) : ('primary' as const) }));
    expect(remaining[0]?.repoId).toBe('platform');
    expect(remaining[0]?.role).toBe('anchor');
    expect(deriveWorkingFocusIdsFromTargets(remaining, 'distributed')).toEqual(['platform']);
  });

  it('removing the last primary in a non-anchor repo prunes that repo from selectedWorkingFocusIds', () => {
    let draft = emptyDraft();
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'tools', target: { path: 'src/foo', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;
    draft = applyScopedRoleAction(draft, { type: 'make-primary' }, {
      topLevelId: 'platform', target: { path: 'src/bar', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    }).next;

    const result = applyScopedRoleAction(draft, { type: 'remove-primary', index: 1 }, {
      topLevelId: 'platform', target: { path: 'src/bar', kind: 'directory' },
      topLevelTargets: [TOOLS, PLATFORM], deepFocusMode: 'distributed',
    });
    expect(result.removePrimaryTarget?.repoId).toBe('platform');

    const remaining = (draft.state.selectedFocusTargets ?? []).filter((_, i) => i !== 1);
    expect(deriveWorkingFocusIdsFromTargets(remaining, 'distributed')).toEqual(['tools']);
  });
});

describe('derivePrimaryIds (multi-repo anchor)', () => {
  it('returns null IDs when targets is empty', () => {
    const result = derivePrimaryIds([], 'distributed');
    expect(result).toEqual({ deepFocusPrimaryRepoId: null, deepFocusPrimaryFocusId: null });
  });

  it('returns anchor repoId in distributed mode', () => {
    const targets: ContextPackPrimaryFocusTarget[] = [
      { path: 'src/foo', kind: 'directory', role: 'anchor', repoLocalPath: '/repos/tools', repoId: 'tools' },
      { path: 'src/bar', kind: 'directory', role: 'primary', repoLocalPath: '/repos/platform', repoId: 'platform' },
    ];
    const result = derivePrimaryIds(targets, 'distributed');
    expect(result).toEqual({ deepFocusPrimaryRepoId: 'tools', deepFocusPrimaryFocusId: null });
  });

  it('returns anchor focusId in monolith mode', () => {
    const targets: ContextPackPrimaryFocusTarget[] = [
      { path: 'src/foo', kind: 'directory', role: 'anchor', repoLocalPath: '/repos/tools', focusId: 'tools' },
    ];
    const result = derivePrimaryIds(targets, 'monolith');
    expect(result).toEqual({ deepFocusPrimaryRepoId: null, deepFocusPrimaryFocusId: 'tools' });
  });
});

describe('applyScopedRoleAction support-scope mutual exclusion (spec §5.2 / §10)', () => {
  function draftWithPrimaries(
    primaries: ContextPackPrimaryFocusTarget[],
    selectedSupportTargets: DeepFocusDraft['state']['selectedSupportTargets'] = [],
  ): DeepFocusDraft {
    return {
      selectedWorkingFocusIds: primaries
        .map((p) => p.repoId)
        .filter((id): id is string => typeof id === 'string'),
      state: {
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: null,
        deepFocusPrimaryFocusId: null,
        selectedFocusPath: primaries[0]?.path ?? null,
        selectedFocusTargetKind: primaries[0]?.kind ?? null,
        selectedFocusTargets: primaries,
        selectedTestTarget: undefined,
        selectedSupportTargets,
      },
      scopeCursor: { kind: 'global' },
    };
  }

  const PRIMARY_TOOLS: ContextPackPrimaryFocusTarget = {
    path: 'src/api', kind: 'directory', role: 'anchor', repoLocalPath: '/repos/tools', repoId: 'tools',
  };
  const PRIMARY_PLATFORM: ContextPackPrimaryFocusTarget = {
    path: 'src/web', kind: 'directory', role: 'primary', repoLocalPath: '/repos/platform', repoId: 'platform',
  };
  it('promote-test-to-global is a no-op when the target is already the global test', () => {
    // Idempotent: the chip should never be visible in this state (the
    // detection helper hides it), but the reducer must still be safe if
    // the action is dispatched twice quickly.
    const target = { path: 'tests/shared', kind: 'directory' as const };
    const draft: DeepFocusDraft = {
      ...draftWithPrimaries([PRIMARY_TOOLS, PRIMARY_PLATFORM]),
      state: {
        ...draftWithPrimaries([PRIMARY_TOOLS, PRIMARY_PLATFORM]).state,
        selectedTestTarget: target,
      },
    };
    const result = applyScopedRoleAction(draft, { type: 'promote-test-to-global' }, {
      topLevelId: 'tools',
      target,
      topLevelTargets: [TOOLS, PLATFORM],
      deepFocusMode: 'distributed',
    });
    expect(result.next).toBe(draft);
  });

  it('promote-support-to-global is a no-op when the target is already in the global support bucket', () => {
    const target = { path: 'lib/shared', kind: 'directory' as const };
    const draft = draftWithPrimaries(
      [PRIMARY_TOOLS, PRIMARY_PLATFORM],
      [target],
    );
    const result = applyScopedRoleAction(draft, { type: 'promote-support-to-global' }, {
      topLevelId: 'tools',
      target,
      topLevelTargets: [TOOLS, PLATFORM],
      deepFocusMode: 'distributed',
    });
    expect(result.next).toBe(draft);
  });

});
