import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  partitionSelectedMaterializationRoots,
  type BranchAuthorityPartition,
} from '../activationBranchAuthorityPartition.js';
import type { SelectedMaterializationRoot } from '../../context-pack/taskWorktreeSelection.js';
import type { TaskPackSnapshot } from '../../context-pack/taskPackSnapshot.js';
import type { TaskContextPackSelection } from '../taskJson.js';

function root(parent: string, name: string): string {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function selected(repoId: string, originalRoot: string, role: 'primary' | 'support'): SelectedMaterializationRoot {
  return { repoId, role, originalRoot, gitRoot: originalRoot };
}

function selection(overrides: Partial<TaskContextPackSelection>): TaskContextPackSelection {
  return {
    contextPackDir: '/pack',
    contextPackId: 'pack',
    scopeMode: 'repo-selection',
    selectedRepoIds: [],
    selectedFocusIds: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<TaskPackSnapshot>): TaskPackSnapshot {
  return {
    schemaVersion: 2,
    stagedAt: '2026-05-25T00:00:00Z',
    taskId: 'task-1',
    contextPackDir: '/pack',
    contextPackId: 'pack',
    estateType: 'distributed-platform',
    primary: { repoId: null, focusId: null, repoRoot: '/primary', primaryFocusRelativePath: null },
    support: [],
    focusAreas: [],
    selectedFocusIds: [],
    qmdScopeRoot: 'qmd/context-packs/pack',
    estateRepoIds: [],
    declaredRepoRoots: [],
    deepFocus: {
      enabled: false,
      primaryFocusTargetKind: null,
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      writableRoots: [],
      readonlyContextRoots: [],
      warnings: [],
    },
    ...overrides,
  };
}

function partition(args: {
  selection: TaskContextPackSelection;
  selectedRoots: SelectedMaterializationRoot[];
  snapshot?: TaskPackSnapshot;
}): BranchAuthorityPartition {
  return partitionSelectedMaterializationRoots({
    taskId: 'task-1',
    snapshot: args.snapshot ?? snapshot({}),
    selection: args.selection,
    selectedRoots: args.selectedRoots,
  });
}

describe('activation branch authority partition', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'activation-branch-authority-'));
    tempDirs.push(dir);
    return dir;
  }

  it('uses frozen standard repositoryTypes to separate primaries from support', () => {
    const base = tempRoot();
    const tools = root(base, 'tools');
    const platform = root(base, 'platform');

    const result = partition({
      selection: selection({
        selectedRepoIds: ['tools', 'platform'],
        primaryRepoId: 'tools',
        repositoryTypes: { tools: 'primary', platform: 'support' },
      }),
      selectedRoots: [
        selected('tools', tools, 'primary'),
        selected('platform', platform, 'support'),
      ],
    });

    expect(result.branchOwnedRoots).toEqual([
      expect.objectContaining({ repoId: 'tools', originalRoot: tools, reason: 'standard-primary' }),
    ]);
    expect(result.readonlyContextRoots).toEqual([
      expect.objectContaining({ repoId: 'platform', originalRoot: platform, reason: 'standard-support' }),
    ]);
  });

  it('uses scalar primaryRepoId for legacy standard tasks without repositoryTypes', () => {
    const base = tempRoot();
    const platform = root(base, 'platform');
    const tools = root(base, 'tools');

    const result = partition({
      selection: selection({
        selectedRepoIds: ['platform', 'tools'],
        primaryRepoId: 'platform',
      }),
      selectedRoots: [
        selected('platform', platform, 'primary'),
        selected('tools', tools, 'support'),
      ],
    });

    expect(result.branchOwnedRoots.map((entry) => [entry.repoId, entry.reason])).toEqual([
      ['platform', 'legacy-scalar-primary'],
    ]);
    expect(result.readonlyContextRoots.map((entry) => [entry.repoId, entry.reason])).toEqual([
      ['tools', 'legacy-scalar-support'],
    ]);
  });

  it('keeps multiple standard primaries branch-owned and support read-only', () => {
    const base = tempRoot();
    const platform = root(base, 'platform');
    const tools = root(base, 'tools');
    const docs = root(base, 'docs');

    const result = partition({
      selection: selection({
        selectedRepoIds: ['platform', 'tools', 'docs'],
        primaryRepoId: 'platform',
        repositoryTypes: { platform: 'primary', tools: 'primary', docs: 'support' },
      }),
      selectedRoots: [
        selected('platform', platform, 'primary'),
        selected('tools', tools, 'primary'),
        selected('docs', docs, 'support'),
      ],
    });

    expect(result.branchOwnedRoots.map((entry) => entry.repoId)).toEqual(['platform', 'tools']);
    expect(result.readonlyContextRoots.map((entry) => entry.repoId)).toEqual(['docs']);
  });

  it('classifies Deep Focus writable repos, including test targets, by snapshot root membership', () => {
    const base = tempRoot();
    const platform = root(base, 'platform');
    const tests = root(base, 'tests');
    const tools = root(base, 'tools');

    const result = partition({
      selection: selection({
        deepFocusEnabled: true,
        selectedFocusTargets: [
          {
            repoId: 'platform',
            repoLocalPath: platform,
            path: 'src',
            kind: 'directory',
            testTarget: { repoId: 'tests', repoLocalPath: tests, path: 'specs', kind: 'directory' },
          },
        ],
        selectedTestTarget: { repoId: 'tests', repoLocalPath: tests, path: 'global', kind: 'directory' },
        selectedSupportTargets: [{ repoId: 'tools', repoLocalPath: tools, path: 'tools', kind: 'directory' }],
      }),
      selectedRoots: [
        selected('platform', platform, 'primary'),
        selected('tests', tests, 'support'),
        selected('tools', tools, 'support'),
      ],
      snapshot: snapshot({
        estateType: 'distributed-platform',
        deepFocus: {
          ...snapshot({}).deepFocus,
          enabled: true,
          writableRoots: [
            { repoLocalPath: platform, path: 'src', kind: 'directory', reason: 'selected-primary' },
            { repoLocalPath: tests, path: 'specs', kind: 'directory', reason: 'scoped-test-target' },
          ],
          readonlyContextRoots: [
            { repoLocalPath: tools, path: 'tools', kind: 'directory', reason: 'support-target' },
          ],
        },
      }),
    });

    expect(result.branchOwnedRoots.map((entry) => [entry.repoId, entry.reason])).toEqual([
      ['platform', 'deep-focus-writable'],
      ['tests', 'deep-focus-writable'],
    ]);
    expect(result.readonlyContextRoots.map((entry) => [entry.repoId, entry.reason])).toEqual([
      ['tools', 'deep-focus-readonly'],
    ]);
  });

  it('dedupes same-root monolith support by keeping the branch-owned root only', () => {
    const base = tempRoot();
    const mono = root(base, 'mono');

    const result = partition({
      selection: selection({
        scopeMode: 'focus-selection',
        selectedFocusIds: ['docs', 'api'],
        primaryFocusId: 'api',
      }),
      selectedRoots: [
        selected('mono', mono, 'support'),
        selected('mono', `${mono}/.`, 'primary'),
      ],
      snapshot: snapshot({
        estateType: 'monolith',
        primary: { repoId: null, focusId: 'api', repoRoot: mono, primaryFocusRelativePath: 'apps/api' },
        deepFocus: {
          ...snapshot({}).deepFocus,
          writableRoots: [
            { repoLocalPath: mono, path: 'apps/api', kind: 'directory', reason: 'selected-primary' },
          ],
          readonlyContextRoots: [
            { repoLocalPath: mono, path: 'docs', kind: 'directory', reason: 'support-target' },
          ],
        },
      }),
    });

    expect(result.branchOwnedRoots).toHaveLength(1);
    expect(result.branchOwnedRoots[0]).toEqual(expect.objectContaining({
      repoId: 'mono',
      reason: 'monolith-writable',
    }));
    expect(result.readonlyContextRoots).toEqual([]);
  });
});
