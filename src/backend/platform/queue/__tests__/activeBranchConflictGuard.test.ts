import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  findActivationBranchConflicts,
  normalizeBranchConflictKey,
} from '../activeBranchConflictGuard.js';
import type { ActivationBranchCandidatePlan } from '../branchChainActivation.js';

function sidecar(repoRoot: string, taskId: string, bindings: Array<{ originalRoot: string; worktreeBranch: string }>): void {
  const dir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, '.task.json'), JSON.stringify({
    schema_version: 2,
    taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: bindings.map((binding) => ({
        originalRoot: binding.originalRoot,
        worktreeRoot: path.join(repoRoot, 'worktrees', taskId),
        worktreeBranch: binding.worktreeBranch,
        baseCommitSha: 'abc',
      })),
    },
    materialization: { strategy: 'copy', cloned: [], skipped: [] },
    frozenAt: '2026-05-19T00:00:00Z',
    finalizedAt: null,
    state: 'active',
  }, null, 2), 'utf-8');
}

function candidate(overrides: Partial<ActivationBranchCandidatePlan>): ActivationBranchCandidatePlan {
  return {
    mode: 'standard',
    originalRoot: '/repo',
    contextRoot: '/repo',
    repoLabel: 'repo',
    worktreePath: '/repo/AgentWorkSpace/tasks/task/worktrees/repo',
    worktreeRootForBinding: '/repo/AgentWorkSpace/tasks/task/worktrees/repo',
    worktreeBranch: 'task/candidate',
    addWorktree: true,
    createBranch: true,
    branchChainRepo: null,
    ...overrides,
  };
}

describe('active branch conflict guard', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  it('normalizes roots and preserves exact branch casing', () => {
    const root = tempDir('branch-conflict-root-');
    const link = path.join(tempDir('branch-conflict-link-parent-'), 'repo-link');
    symlinkSync(root, link);

    expect(normalizeBranchConflictKey({
      originalRoot: link,
      worktreeBranch: ' Feature/Case ',
    })).toEqual({
      originalRoot: realpathSync(root),
      worktreeBranch: 'Feature/Case',
    });
  });

  it('matches by normalized root and branch, not repo label', () => {
    const repoRoot = tempDir('branch-conflict-platform-');
    const gitRoot = tempDir('branch-conflict-git-');
    sidecar(repoRoot, 'active-a', [{ originalRoot: `${gitRoot}/.`, worktreeBranch: 'task/root' }]);

    const result = findActivationBranchConflicts({
      repoRoot,
      candidateTaskId: 'child-a',
      activeTaskIds: ['active-a'],
      activationBranchCandidatePlans: [candidate({
        mode: 'chained',
        originalRoot: gitRoot,
        repoLabel: 'different-label',
        worktreeBranch: 'task/root',
        createBranch: false,
      })],
    });

    expect(result.blocked).toBe(true);
    expect(result.conflicts).toEqual([expect.objectContaining({
      conflictingTaskId: 'active-a',
      repoLabel: 'different-label',
      worktreeBranch: 'task/root',
    })]);
  });

  it('ignores self-conflicts and unreadable active sidecars', () => {
    const repoRoot = tempDir('branch-conflict-self-');
    const gitRoot = tempDir('branch-conflict-git-');
    sidecar(repoRoot, 'candidate', [{ originalRoot: gitRoot, worktreeBranch: 'task/candidate' }]);

    const result = findActivationBranchConflicts({
      repoRoot,
      candidateTaskId: 'candidate',
      activeTaskIds: ['candidate', 'missing-sidecar', 'old.completing'],
      activationBranchCandidatePlans: [candidate({ originalRoot: gitRoot })],
    });

    expect(result).toEqual({
      blocked: false,
      conflicts: [],
      unreadableActiveTaskIds: ['missing-sidecar'],
    });
  });

  it('does not use targetBranch-like active bindings when worktreeBranch differs', () => {
    const repoRoot = tempDir('branch-conflict-target-');
    const gitRoot = tempDir('branch-conflict-git-');
    sidecar(repoRoot, 'active-main', [{ originalRoot: gitRoot, worktreeBranch: 'main' }]);
    sidecar(repoRoot, 'active-root', [{ originalRoot: gitRoot, worktreeBranch: 'task/root' }]);

    const result = findActivationBranchConflicts({
      repoRoot,
      candidateTaskId: 'child-a',
      activeTaskIds: ['active-main', 'active-root'],
      activationBranchCandidatePlans: [candidate({
        mode: 'chained',
        originalRoot: gitRoot,
        worktreeBranch: 'task/root',
        createBranch: false,
      })],
    });

    expect(result.blocked).toBe(true);
    expect(result.conflicts.map((conflict) => conflict.conflictingTaskId)).toEqual(['active-root']);
  });

  it('sorts multiple conflicts deterministically', () => {
    const repoRoot = tempDir('branch-conflict-sort-');
    const repoA = tempDir('branch-conflict-a-');
    const repoB = tempDir('branch-conflict-b-');
    sidecar(repoRoot, 'z-owner', [{ originalRoot: repoB, worktreeBranch: 'task/z' }]);
    sidecar(repoRoot, 'a-owner', [{ originalRoot: repoA, worktreeBranch: 'task/a' }]);

    const result = findActivationBranchConflicts({
      repoRoot,
      candidateTaskId: 'candidate',
      activeTaskIds: ['z-owner', 'a-owner'],
      activationBranchCandidatePlans: [
        candidate({ originalRoot: repoB, worktreeBranch: 'task/z' }),
        candidate({ originalRoot: repoA, worktreeBranch: 'task/a' }),
      ],
    });

    expect(result.conflicts.map((conflict) => conflict.conflictingTaskId)).toEqual(['a-owner', 'z-owner']);
  });
});
