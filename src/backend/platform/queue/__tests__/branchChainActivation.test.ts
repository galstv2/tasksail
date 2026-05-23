import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { existingBranchPreconditionsPass } from '../../core/worktreeMaterialization.js';
import {
  assertEveryMaterializedRepoHasBranchChainEntry,
  buildActivationBranchCandidatePlans,
  buildActivationBranchPlans,
  finalizeActivationBranchPlans,
  matchBranchChainRepoForRoot,
  normalizeActivationRepoRoot,
  resolveTaskBranchChainForActivation,
} from '../branchChainActivation.js';
import { formatBranchChainSection, type TaskBranchChainBinding } from '../markdown.js';

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8' }).trim();
}

function initGitRepo(repoDir: string): string {
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init']);
  git(repoDir, ['config', 'user.email', 'test@example.com']);
  git(repoDir, ['config', 'user.name', 'Test User']);
  writeFileSync(path.join(repoDir, 'README.md'), '# repo\n', 'utf-8');
  git(repoDir, ['add', 'README.md']);
  git(repoDir, ['commit', '-m', 'initial']);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

function binding(repoRoot: string, overrides: Partial<TaskBranchChainBinding> = {}): TaskBranchChainBinding {
  return {
    schemaVersion: 1,
    mode: 'continuation',
    rootTaskId: 'root-task',
    parentTaskId: 'parent-task',
    depth: 1,
    repos: [{
      repoRoot,
      repoLabel: 'wrong-label-is-ignored',
      chainSourceBranch: 'task/root-task',
      parentSourceBranch: 'task/root-task',
      parentBranchHead: 'abc',
      targetBranch: 'main',
    }],
    ...overrides,
  };
}

describe('branch chain activation planning', () => {
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

  it('ignores Branch Chain for standard tasks', () => {
    const repoRoot = tempDir('branch-chain-standard-');
    const result = resolveTaskBranchChainForActivation(
      formatBranchChainSection(binding(repoRoot)),
      'task-a',
      'standard',
      { parentTaskId: '', rootTaskId: '' },
    );

    expect(result).toBeNull();
  });

  it('keeps legacy child tasks without Branch Chain on the standard path', () => {
    const result = resolveTaskBranchChainForActivation(
      '# Legacy child\n\n## Task Lineage\n\n- Task Kind: child-task\n',
      'child-a',
      'child-task',
      { parentTaskId: 'parent-task', rootTaskId: 'root-task' },
    );

    expect(result).toBeNull();
  });

  it('throws invalid for malformed child Branch Chain markdown', () => {
    expect(() => resolveTaskBranchChainForActivation(
      '## Branch Chain\n\n```json\n{bad\n```',
      'child-a',
      'child-task',
      { parentTaskId: 'parent-task', rootTaskId: 'root-task' },
    )).toThrow('activation-branch-chain-invalid for task "child-a": malformed-json');
  });

  it('throws mismatch for lineage/depth/repo inconsistencies', () => {
    const repoRoot = tempDir('branch-chain-mismatch-');

    expect(() => resolveTaskBranchChainForActivation(
      formatBranchChainSection(binding(repoRoot, { rootTaskId: 'other-root', depth: 0 })),
      'child-a',
      'child-task',
      { parentTaskId: 'parent-task', rootTaskId: 'root-task' },
    )).toThrow('activation-branch-chain-mismatch for task "child-a":');
  });

  it('matches repos by normalized absolute root instead of label', () => {
    const repoRoot = tempDir('branch-chain-match-');
    const matched = matchBranchChainRepoForRoot(binding(repoRoot), `${repoRoot}/.`);

    expect(matched?.repoLabel).toBe('wrong-label-is-ignored');
  });

  it('leaves duplicate materialized root dedupe to the caller', () => {
    const repoRoot = tempDir('branch-chain-duplicates-');

    expect(() => assertEveryMaterializedRepoHasBranchChainEntry('child-a', binding(repoRoot), [
      { contextRoot: repoRoot, gitRoot: repoRoot },
      { contextRoot: path.join(repoRoot, 'src'), gitRoot: `${repoRoot}/.` },
    ])).not.toThrow();
  });

  it('fails when a child-scope repo is missing from Branch Chain and ignores extra Branch Chain repos', () => {
    const repoRoot = tempDir('branch-chain-present-');
    const missingRoot = tempDir('branch-chain-missing-');

    expect(() => assertEveryMaterializedRepoHasBranchChainEntry('child-a', binding(repoRoot), [
      { contextRoot: missingRoot, gitRoot: missingRoot },
    ])).toThrow(`activation-branch-chain-repo-missing for task "child-a": ${normalizeActivationRepoRoot(missingRoot)}`);

    expect(() => assertEveryMaterializedRepoHasBranchChainEntry('child-a', binding(repoRoot, {
      repos: [
        ...binding(repoRoot).repos,
        { ...binding(missingRoot).repos[0]!, repoRoot: missingRoot },
      ],
    }), [
      { contextRoot: repoRoot, gitRoot: repoRoot },
    ])).not.toThrow();
  });

  it('fails when a materialized repo matches multiple Branch Chain repo entries', () => {
    const repoRoot = tempDir('branch-chain-ambiguous-');

    expect(() => assertEveryMaterializedRepoHasBranchChainEntry('child-a', binding(repoRoot, {
      repos: [
        { ...binding(repoRoot).repos[0]!, repoRoot },
        { ...binding(repoRoot).repos[0]!, repoRoot: `${repoRoot}/.`, chainSourceBranch: 'task/other-root' },
      ],
    }), [
      { contextRoot: repoRoot, gitRoot: repoRoot },
    ])).toThrow(`activation-branch-chain-repo-ambiguous for task "child-a": ${normalizeActivationRepoRoot(repoRoot)}`);
  });

  it('plans standard task branches with the existing empty-origin fallback', async () => {
    const repoRoot = tempDir('branch-chain-empty-origin-');
    const plans = await buildActivationBranchPlans({
      taskId: 'child-a',
      branchChainBinding: null,
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
    });

    expect(plans[0]).toEqual(expect.objectContaining({
      mode: 'standard',
      worktreeBranch: 'task/child-a',
      baseCommitSha: '',
      addWorktree: false,
      createBranch: false,
      worktreeRootForBinding: repoRoot,
    }));
  });

  it('plans chained child activation from chainSourceBranch and ignores targetBranch', async () => {
    const repoRoot = tempDir('branch-chain-plan-');
    const head = initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const plans = await buildActivationBranchPlans({
      taskId: 'child-a',
      branchChainBinding: binding(repoRoot, {
        repos: [{
          ...binding(repoRoot).repos[0]!,
          chainSourceBranch: 'task/root-task',
          targetBranch: 'main',
        }],
      }),
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
    });

    expect(plans[0]).toEqual(expect.objectContaining({
      mode: 'chained',
      worktreePath: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a', 'worktrees', 'repo'),
      worktreeRootForBinding: path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a', 'worktrees', 'repo'),
      worktreeBranch: 'task/root-task',
      baseCommitSha: head,
      addWorktree: true,
      createBranch: false,
    }));
  });

  it('candidate planning for chained children does not reject a checked-out chainSourceBranch', async () => {
    const repoRoot = tempDir('branch-chain-candidate-');
    const checkedOutRoot = tempDir('branch-chain-candidate-worktree-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    git(repoRoot, ['worktree', 'add', checkedOutRoot, 'task/root-task']);

    const candidates = await buildActivationBranchCandidatePlans({
      taskId: 'child-a',
      branchChainBinding: binding(repoRoot),
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
    });

    expect(candidates[0]).toEqual(expect.objectContaining({
      mode: 'chained',
      worktreeBranch: 'task/root-task',
      createBranch: false,
      addWorktree: true,
    }));
    await expect(finalizeActivationBranchPlans({
      taskId: 'child-a',
      branchChainBinding: binding(repoRoot),
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
      candidatePlans: candidates,
    })).rejects.toThrow('activation-branch-chain-precondition-failed for task "child-a":');
  });

  it('candidate planning for standard tasks does not reject an existing task branch', async () => {
    const repoRoot = tempDir('branch-chain-standard-candidate-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/child-a']);

    const candidates = await buildActivationBranchCandidatePlans({
      taskId: 'child-a',
      branchChainBinding: null,
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
    });

    expect(candidates[0]).toEqual(expect.objectContaining({
      mode: 'standard',
      worktreeBranch: 'task/child-a',
      createBranch: true,
      addWorktree: true,
    }));
    await expect(finalizeActivationBranchPlans({
      taskId: 'child-a',
      branchChainBinding: null,
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
      candidatePlans: candidates,
    })).rejects.toThrow('activation-precondition-failed:');
  });

  it('resolves all chained branch preconditions before returning plans', async () => {
    const repoA = tempDir('branch-chain-repo-a-');
    const repoB = tempDir('branch-chain-repo-b-');
    initGitRepo(repoA);
    initGitRepo(repoB);
    git(repoA, ['branch', 'task/root-task']);

    await expect(buildActivationBranchPlans({
      taskId: 'child-a',
      branchChainBinding: binding(repoA, {
        repos: [
          { ...binding(repoA).repos[0]!, repoRoot: repoA },
          { ...binding(repoB).repos[0]!, repoRoot: repoB },
        ],
      }),
      materializationOrigins: [
        { contextRoot: repoA, gitRoot: repoA },
        { contextRoot: repoB, gitRoot: repoB },
      ],
      repoLabels: ['a', 'b'],
      repoRoot: tempDir('branch-chain-workspace-'),
    })).rejects.toThrow('activation-branch-chain-base-unresolved for task "child-a":');
  });

  it('surfaces injected base SHA resolution failures before preconditions', async () => {
    const repoRoot = tempDir('branch-chain-base-fail-');

    await expect(buildActivationBranchPlans({
      taskId: 'child-a',
      branchChainBinding: binding(repoRoot),
      materializationOrigins: [{ contextRoot: repoRoot, gitRoot: repoRoot }],
      repoLabels: ['repo'],
      repoRoot,
      execFileAsync: async () => {
        throw new Error('rev-parse failed');
      },
    })).rejects.toThrow('activation-branch-chain-base-unresolved for task "child-a": task/root-task: rev-parse failed');
  });
});

describe('existing branch worktree preconditions', () => {
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

  it('accepts an existing unchecked-out branch', async () => {
    const repoRoot = tempDir('existing-branch-ok-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);

    await expect(existingBranchPreconditionsPass(
      repoRoot,
      'task/root-task',
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', 'child-a', 'worktrees', 'repo'),
    )).resolves.toEqual({ ok: true });
  });

  it('rejects a missing branch', async () => {
    const repoRoot = tempDir('existing-branch-missing-');
    initGitRepo(repoRoot);

    await expect(existingBranchPreconditionsPass(repoRoot, 'task/root-task', path.join(repoRoot, 'wt')))
      .resolves.toEqual(expect.objectContaining({ ok: false, reason: 'branch-missing' }));
  });

  it('rejects an already registered worktree path', async () => {
    const repoRoot = tempDir('existing-branch-path-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    const worktreePath = path.join(tempDir('existing-branch-wt-'), 'repo');
    git(repoRoot, ['worktree', 'add', worktreePath, 'task/root-task']);
    git(repoRoot, ['checkout', '-b', 'other']);
    git(repoRoot, ['branch', 'task/other-child']);

    await expect(existingBranchPreconditionsPass(repoRoot, 'task/other-child', worktreePath))
      .resolves.toEqual(expect.objectContaining({ ok: false, reason: 'worktree-already-bound' }));
  });

  it('rejects a branch checked out in another worktree', async () => {
    const repoRoot = tempDir('existing-branch-checked-out-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    git(repoRoot, ['worktree', 'add', path.join(tempDir('existing-branch-other-wt-'), 'repo'), 'task/root-task']);

    await expect(existingBranchPreconditionsPass(repoRoot, 'task/root-task', path.join(repoRoot, 'new-wt')))
      .resolves.toEqual(expect.objectContaining({ ok: false, reason: 'worktree-already-bound' }));
  });

  it('does not reject merely because task/<childTaskId> exists', async () => {
    const repoRoot = tempDir('existing-branch-child-exists-');
    initGitRepo(repoRoot);
    git(repoRoot, ['branch', 'task/root-task']);
    git(repoRoot, ['branch', 'task/child-a']);

    await expect(existingBranchPreconditionsPass(repoRoot, 'task/root-task', path.join(repoRoot, 'new-wt')))
      .resolves.toEqual({ ok: true });
  });
});
