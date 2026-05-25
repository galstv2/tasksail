import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildParentTaskBranchViewRequest } from './plannerChildScopeSession';
import type { ArchivedTaskEntry, PlannerFocusSnapshot } from '../shared/desktopContract';

const handoff = (repoRoot: string, repoLabel = 'repo') => ({
  repoRoot,
  repoLabel,
  branch: 'task/parent',
  baseCommitSha: 'base',
  headCommitSha: 'head',
  commitsAhead: 1,
  status: 'committed',
});

function taskWithBinding(
  binding: PlannerFocusSnapshot['contextPackBinding'],
  branchHandoffs: ArchivedTaskEntry['branchHandoffs'],
  status: NonNullable<ArchivedTaskEntry['branchChainAvailability']>['status'] = 'ready',
): ArchivedTaskEntry {
  return {
    taskId: 'TASK-1',
    title: 'Sensitive title',
    summary: 'Sensitive summary',
    rootTaskId: 'TASK-1',
    qmdRecordId: 'qmd-1',
    followupReason: 'Continue',
    year: '2026',
    archivePath: '/archives/TASK-1/archive.md',
    archivedAt: null,
    contextPackName: 'Orders',
    branchHandoffs,
    branchChainAvailability: { status, message: status },
    plannerFocusSnapshot: {
      version: 1,
      contextPackDir: binding.contextPackDir,
      contextPackId: binding.contextPackId,
      title: 'Parent',
      primaryRepoId: 'tools',
      primaryRepoRoot: '/repo/tools',
      primaryFocusRelativePath: null,
      primaryFocusTargetKind: null,
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      deepFocusEnabled: binding.deepFocusEnabled,
      contextPackBinding: binding,
    },
  };
}

const distributedBinding: PlannerFocusSnapshot['contextPackBinding'] = {
  contextPackDir: '/packs/orders',
  contextPackId: 'orders',
  scopeMode: 'repo-selection',
  primaryRepoId: 'tools',
  selectedRepoIds: ['tools', 'platform'],
  selectedFocusIds: [],
  repositoryTypes: { tools: 'primary', platform: 'primary' },
  deepFocusEnabled: false,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

const monolithBinding: PlannerFocusSnapshot['contextPackBinding'] = {
  contextPackDir: '/packs/mono',
  contextPackId: 'mono',
  scopeMode: 'focus-selection',
  primaryFocusId: 'api',
  selectedRepoIds: [],
  selectedFocusIds: ['api'],
  repositoryTypes: { api: 'primary' },
  deepFocusEnabled: false,
  selectedFocusPath: null,
  selectedFocusTargetKind: null,
  selectedFocusTargets: [],
  selectedTestTarget: null,
  selectedSupportTargets: [],
};

describe('plannerChildScopeSession parent branch handoff coverage', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('warns for distributed-platform primary repos missing branch handoff coverage', () => {
    const request = buildParentTaskBranchViewRequest(taskWithBinding(distributedBinding, [handoff('/repo/tools', 'tools')]));

    expect(request).toEqual(expect.objectContaining({ parentTaskId: 'TASK-1', contextPackId: 'orders' }));
    expect(warn).toHaveBeenCalledWith('plannerParentBranchView.coverage.partial', {
      parentTaskId: 'TASK-1',
      contextPackId: 'orders',
      estateType: 'distributed-platform',
      expectedPrimaryRepoCount: 2,
      branchHandoffCount: 1,
      missingPrimaryRepoIds: [],
    });
    expect(Object.keys(warn.mock.calls[0]![1] as Record<string, unknown>)).toEqual([
      'parentTaskId',
      'contextPackId',
      'estateType',
      'expectedPrimaryRepoCount',
      'branchHandoffCount',
      'missingPrimaryRepoIds',
    ]);
    expect(JSON.stringify(warn.mock.calls[0]![1])).not.toContain('Sensitive');
    expect(JSON.stringify(warn.mock.calls[0]![1])).not.toContain('/archives');
    expect(JSON.stringify(warn.mock.calls[0]![1])).not.toContain('task/parent');
    expect(JSON.stringify(warn.mock.calls[0]![1])).not.toContain('head');
  });

  it('does not warn for distributed-platform support repos missing branch handoff coverage', () => {
    buildParentTaskBranchViewRequest(taskWithBinding({
      ...distributedBinding,
      repositoryTypes: { tools: 'primary', platform: 'support' },
    }, [handoff('/repo/tools', 'tools')]));

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns for monolith primary focus with no branch handoff and not when covered', () => {
    buildParentTaskBranchViewRequest(taskWithBinding(monolithBinding, []));
    expect(warn).toHaveBeenCalledWith('plannerParentBranchView.coverage.partial', {
      parentTaskId: 'TASK-1',
      contextPackId: 'mono',
      estateType: 'monolith',
      expectedPrimaryRepoCount: 1,
      branchHandoffCount: 0,
      missingPrimaryRepoIds: [],
    });

    warn.mockClear();
    buildParentTaskBranchViewRequest(taskWithBinding(monolithBinding, [handoff('/repo/mono', 'mono')]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('handles monolith Deep Focus target coverage as one repo', () => {
    const binding = {
      ...monolithBinding,
      deepFocusEnabled: true,
      selectedFocusIds: ['api', 'web'],
      selectedFocusTargets: [
        { path: 'src/api', kind: 'directory' as const, focusId: 'api' },
        { path: 'src/web', kind: 'directory' as const, focusId: 'web' },
      ],
    };
    buildParentTaskBranchViewRequest(taskWithBinding(binding, []));
    expect(warn).toHaveBeenCalledWith('plannerParentBranchView.coverage.partial', {
      parentTaskId: 'TASK-1',
      contextPackId: 'mono',
      estateType: 'monolith',
      expectedPrimaryRepoCount: 1,
      branchHandoffCount: 0,
      missingPrimaryRepoIds: [],
    });

    warn.mockClear();
    buildParentTaskBranchViewRequest(taskWithBinding(binding, [handoff('/repo/mono', 'mono')]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('handles distributed Deep Focus repo coverage and duplicate handoffs', () => {
    const sameRepo = {
      ...distributedBinding,
      deepFocusEnabled: true,
      selectedFocusTargets: [
        { path: 'src/a', kind: 'directory' as const, repoId: 'tools', repoLocalPath: '/repo/tools' },
        { path: 'src/b', kind: 'directory' as const, repoId: 'tools', repoLocalPath: '/repo/tools' },
      ],
    };
    buildParentTaskBranchViewRequest(taskWithBinding(sameRepo, [handoff('/repo/tools', 'tools')]));
    expect(warn).not.toHaveBeenCalled();

    const twoRepos = {
      ...sameRepo,
      selectedFocusTargets: [
        ...sameRepo.selectedFocusTargets,
        { path: 'src/p', kind: 'directory' as const, repoId: 'platform', repoLocalPath: '/repo/platform' },
      ],
    };
    buildParentTaskBranchViewRequest(taskWithBinding(twoRepos, [
      handoff('/repo/tools', 'tools'),
      handoff('/repo/platform', 'platform'),
    ]));
    expect(warn).not.toHaveBeenCalled();

    buildParentTaskBranchViewRequest(taskWithBinding(twoRepos, [
      handoff('/repo/tools', 'tools'),
      handoff('/repo/tools', 'tools-again'),
    ]));
    expect(warn).toHaveBeenCalledWith('plannerParentBranchView.coverage.partial', {
      parentTaskId: 'TASK-1',
      contextPackId: 'orders',
      estateType: 'distributed-platform',
      expectedPrimaryRepoCount: 2,
      branchHandoffCount: 1,
      missingPrimaryRepoIds: ['platform'],
    });
  });

  it('suppresses already-surfaced statuses and missing focus snapshots', () => {
    buildParentTaskBranchViewRequest(taskWithBinding(distributedBinding, [], 'missing-branch-handoffs'));
    buildParentTaskBranchViewRequest(taskWithBinding(distributedBinding, [], 'invalid-branch-handoffs'));
    buildParentTaskBranchViewRequest({ ...taskWithBinding(distributedBinding, []), plannerFocusSnapshot: undefined });

    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps request construction alive when coverage assessment fails', () => {
    const binding = {
      ...distributedBinding,
      get selectedRepoIds(): string[] {
        throw new Error('boom');
      },
    } as PlannerFocusSnapshot['contextPackBinding'];

    expect(buildParentTaskBranchViewRequest(taskWithBinding(binding, []))).toEqual(expect.objectContaining({
      parentTaskId: 'TASK-1',
    }));
    expect(warn).toHaveBeenCalledWith('plannerParentBranchView.coverage.assessment-failed', {
      parentTaskId: 'TASK-1',
    });
  });
});
