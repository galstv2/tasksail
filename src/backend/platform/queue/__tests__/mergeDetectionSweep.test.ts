/**
 * §B7-sweep: merge-detection sweep — eight scenarios per spec §3.7.
 *
 * Test 8 (empty-branch defense) is the most important. Without it, a B1
 * regression that left task branches identical to base would cause sweep
 * to silently delete every completed task on the next queue advance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMergeDetectionSweep } from '../mergeDetectionSweep.js';
import type { TaskJson, TaskRepoBinding } from '../taskJson.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function initRepo(repoPath: string): string {
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, ['init', '-q', '-b', 'main']);
  git(repoPath, ['config', 'user.email', 'test@example.com']);
  git(repoPath, ['config', 'user.name', 'Test']);
  git(repoPath, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(path.join(repoPath, 'README.md'), '# baseline\n');
  git(repoPath, ['add', 'README.md']);
  git(repoPath, ['commit', '-q', '-m', 'baseline']);
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function addWorktreeWithCommit(
  originalRoot: string,
  worktreeRoot: string,
  branch: string,
  baseSha: string,
  fileName: string,
): void {
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreeRoot, baseSha], {
    cwd: originalRoot, stdio: 'pipe',
  });
  writeFileSync(path.join(worktreeRoot, fileName), 'x\n');
  git(worktreeRoot, ['add', fileName]);
  git(worktreeRoot, ['commit', '-q', '-m', `add ${fileName}`]);
}

function addEmptyWorktree(
  originalRoot: string,
  worktreeRoot: string,
  branch: string,
  baseSha: string,
): void {
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  execFileSync('git', ['worktree', 'add', '-b', branch, worktreeRoot, baseSha], {
    cwd: originalRoot, stdio: 'pipe',
  });
}

function mergeBranchIntoMain(originalRoot: string, branch: string): void {
  // Use a fast-forward merge so HEAD strictly advances. The branch then becomes
  // an ancestor of HEAD, which is what `merge-base --is-ancestor` checks.
  git(originalRoot, ['merge', '--ff-only', branch]);
}

function detachWorktreeAndDeleteBranch(originalRoot: string, worktreeRoot: string, branch: string): void {
  // git refuses to delete a branch that has a checked-out worktree.
  execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
    cwd: originalRoot, stdio: 'pipe',
  });
  execFileSync('git', ['branch', '-D', branch], { cwd: originalRoot, stdio: 'pipe' });
}

// Model post-finalize state: the worktree dir + admin entry are gone, but the
// branch ref is retained for operator merge/PR. Required before sweep can
// successfully `branch -D` (git refuses to delete a checked-out branch).
function simulateFinalize(originalRoot: string, worktreeRoot: string): void {
  execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
    cwd: originalRoot, stdio: 'pipe',
  });
}

interface TaskFixtureOpts {
  taskId: string;
  bindings: TaskRepoBinding[];
  state?: TaskJson['state'];
}

function writeTaskSidecar(platformRoot: string, opts: TaskFixtureOpts): string {
  const dir = path.join(platformRoot, 'AgentWorkSpace', 'tasks', opts.taskId);
  mkdirSync(dir, { recursive: true });
  const sidecar = {
    schema_version: 2,
    taskId: opts.taskId,
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: opts.bindings,
    },
    materialization: {
      strategy: 'copy' as const,
      cloned: [] as string[],
      skipped: [] as string[],
      composeProjectName: `tasksail-${opts.taskId}`,
    },
    frozenAt: new Date().toISOString(),
    finalizedAt: new Date().toISOString(),
    state: opts.state ?? 'completed',
  };
  writeFileSync(path.join(dir, '.task.json'), JSON.stringify(sidecar, null, 2) + '\n', 'utf-8');
  return dir;
}

function readSidecar(platformRoot: string, taskId: string): TaskJson {
  const p = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
  return JSON.parse(readFileSync(p, 'utf-8')) as TaskJson;
}

describe('runMergeDetectionSweep', () => {
  let platformRoot: string;

  beforeEach(() => {
    platformRoot = mkdtempSync(path.join(tmpdir(), 'ts-sweep-'));
  });

  afterEach(() => {
    rmSync(platformRoot, { recursive: true, force: true });
  });

  it('1. single binding merged into HEAD: stamped via merged-into-head; cleaned up', async () => {
    const taskId = 'sweep-merged';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const baseSha = initRepo(originalRoot);
    addWorktreeWithCommit(originalRoot, worktreeRoot, `task/${taskId}`, baseSha, 'feature.ts');
    mergeBranchIntoMain(originalRoot, `task/${taskId}`);
    simulateFinalize(originalRoot, worktreeRoot);

    writeTaskSidecar(platformRoot, {
      taskId,
      bindings: [{
        originalRoot,
        worktreeRoot,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseSha,
      }],
    });

    const result = await runMergeDetectionSweep(platformRoot);
    expect(result.scanned).toBe(1);
    expect(result.bindingsMarked).toBe(1);
    expect(result.tasksFullyMerged).toBe(1);
    expect(result.tasksCleanedUp).toBe(1);

    // Task dir gone.
    expect(existsSync(path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);
    // Branch ref gone.
    expect(() => git(originalRoot, ['rev-parse', '--verify', `refs/heads/task/${taskId}`])).toThrow();
  });

  it('2. single binding deleted out-of-band: stamped via branch-deleted; cleaned up; no branch-delete attempted', async () => {
    const taskId = 'sweep-deleted';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const baseSha = initRepo(originalRoot);
    addWorktreeWithCommit(originalRoot, worktreeRoot, `task/${taskId}`, baseSha, 'feature.ts');
    detachWorktreeAndDeleteBranch(originalRoot, worktreeRoot, `task/${taskId}`);

    writeTaskSidecar(platformRoot, {
      taskId,
      bindings: [{
        originalRoot,
        worktreeRoot,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseSha,
      }],
    });

    const result = await runMergeDetectionSweep(platformRoot);
    expect(result.bindingsMarked).toBe(1);
    expect(result.tasksCleanedUp).toBe(1);
    expect(existsSync(path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);
  });

  it('3. two bindings, only first merged: first stamped; task dir + second branch preserved', async () => {
    const taskId = 'sweep-partial';
    const originalA = path.join(platformRoot, 'origin', 'repoA');
    const originalB = path.join(platformRoot, 'origin', 'repoB');
    const worktreeA = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repoA');
    const worktreeB = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repoB');
    const baseShaA = initRepo(originalA);
    const baseShaB = initRepo(originalB);
    addWorktreeWithCommit(originalA, worktreeA, `task/${taskId}`, baseShaA, 'a.ts');
    addWorktreeWithCommit(originalB, worktreeB, `task/${taskId}`, baseShaB, 'b.ts');
    mergeBranchIntoMain(originalA, `task/${taskId}`);
    // B is NOT merged.

    writeTaskSidecar(platformRoot, {
      taskId,
      bindings: [
        { originalRoot: originalA, worktreeRoot: worktreeA, worktreeBranch: `task/${taskId}`, baseCommitSha: baseShaA },
        { originalRoot: originalB, worktreeRoot: worktreeB, worktreeBranch: `task/${taskId}`, baseCommitSha: baseShaB },
      ],
    });

    const result = await runMergeDetectionSweep(platformRoot);
    expect(result.scanned).toBe(1);
    expect(result.bindingsMarked).toBe(1);
    expect(result.tasksFullyMerged).toBe(0);
    expect(result.tasksCleanedUp).toBe(0);

    // Task dir survives; sidecar reflects first binding stamped.
    const sidecar = readSidecar(platformRoot, taskId);
    const [b1, b2] = sidecar.contextPackBinding.repoBindings;
    expect(b1!.mergedAt).toBeDefined();
    expect(b1!.mergedVia).toBe('merged-into-head');
    expect(b2!.mergedAt).toBeUndefined();

    // Second branch still intact.
    expect(() => git(originalB, ['rev-parse', '--verify', `refs/heads/task/${taskId}`])).not.toThrow();
  });

  it('4. two bindings, both merged across successive sweep runs: second sweep cleans up', async () => {
    const taskId = 'sweep-2pass';
    const originalA = path.join(platformRoot, 'origin', 'repoA');
    const originalB = path.join(platformRoot, 'origin', 'repoB');
    const worktreeA = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repoA');
    const worktreeB = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repoB');
    const baseShaA = initRepo(originalA);
    const baseShaB = initRepo(originalB);
    addWorktreeWithCommit(originalA, worktreeA, `task/${taskId}`, baseShaA, 'a.ts');
    addWorktreeWithCommit(originalB, worktreeB, `task/${taskId}`, baseShaB, 'b.ts');
    mergeBranchIntoMain(originalA, `task/${taskId}`);
    // Both worktrees are removed at completion (modeling finalizeTaskWorktrees).
    simulateFinalize(originalA, worktreeA);
    simulateFinalize(originalB, worktreeB);

    writeTaskSidecar(platformRoot, {
      taskId,
      bindings: [
        { originalRoot: originalA, worktreeRoot: worktreeA, worktreeBranch: `task/${taskId}`, baseCommitSha: baseShaA },
        { originalRoot: originalB, worktreeRoot: worktreeB, worktreeBranch: `task/${taskId}`, baseCommitSha: baseShaB },
      ],
    });

    // Pass 1 — only A is merged.
    const r1 = await runMergeDetectionSweep(platformRoot);
    expect(r1.tasksCleanedUp).toBe(0);

    // Now merge B too.
    mergeBranchIntoMain(originalB, `task/${taskId}`);
    const r2 = await runMergeDetectionSweep(platformRoot);
    expect(r2.scanned).toBe(1);
    expect(r2.bindingsMarked).toBe(1);   // only B is newly stamped this pass
    expect(r2.tasksCleanedUp).toBe(1);
    expect(existsSync(path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(false);
    // Both branches deleted by sweep.
    expect(() => git(originalA, ['rev-parse', '--verify', `refs/heads/task/${taskId}`])).toThrow();
    expect(() => git(originalB, ['rev-parse', '--verify', `refs/heads/task/${taskId}`])).toThrow();
  });

  it('5. failed task is skipped (state=failed)', async () => {
    const taskId = 'sweep-failed';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const baseSha = initRepo(originalRoot);
    addWorktreeWithCommit(originalRoot, worktreeRoot, `task/${taskId}`, baseSha, 'f.ts');
    mergeBranchIntoMain(originalRoot, `task/${taskId}`);

    writeTaskSidecar(platformRoot, {
      taskId,
      state: 'failed',
      bindings: [{
        originalRoot,
        worktreeRoot,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseSha,
      }],
    });

    const result = await runMergeDetectionSweep(platformRoot);
    expect(result.scanned).toBe(0);
    expect(result.tasksCleanedUp).toBe(0);
    expect(existsSync(path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(true);
  });

  it('6. in-flight task (state=active) is skipped', async () => {
    const taskId = 'sweep-active';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const baseSha = initRepo(originalRoot);
    addWorktreeWithCommit(originalRoot, worktreeRoot, `task/${taskId}`, baseSha, 'a.ts');
    mergeBranchIntoMain(originalRoot, `task/${taskId}`);

    writeTaskSidecar(platformRoot, {
      taskId,
      state: 'active',
      bindings: [{
        originalRoot,
        worktreeRoot,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseSha,
      }],
    });

    const result = await runMergeDetectionSweep(platformRoot);
    expect(result.scanned).toBe(0);
    expect(existsSync(path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(true);
  });

  it('7. v1 sidecar (no mergedAt fields) parses correctly and sweep proceeds', async () => {
    const taskId = 'sweep-v1';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const baseSha = initRepo(originalRoot);
    addWorktreeWithCommit(originalRoot, worktreeRoot, `task/${taskId}`, baseSha, 'v1.ts');
    mergeBranchIntoMain(originalRoot, `task/${taskId}`);
    simulateFinalize(originalRoot, worktreeRoot);

    // Hand-write a v1-shaped sidecar — schema_version: 1, no mergedAt fields.
    const dir = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, '.task.json'),
      JSON.stringify({
        schema_version: 1,
        taskId,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [{
            originalRoot,
            worktreeRoot,
            worktreeBranch: `task/${taskId}`,
            baseCommitSha: baseSha,
          }],
        },
        materialization: {
          strategy: 'copy', cloned: [], skipped: [], composeProjectName: `tasksail-${taskId}`,
        },
        frozenAt: new Date().toISOString(),
        finalizedAt: new Date().toISOString(),
        state: 'completed',
      }, null, 2) + '\n',
      'utf-8',
    );

    const result = await runMergeDetectionSweep(platformRoot);
    expect(result.scanned).toBe(1);
    expect(result.tasksCleanedUp).toBe(1);
  });

  it('8. EMPTY BRANCH defense: zero commits beyond base is NEVER marked merged-into-head', async () => {
    // This is the safety net for B1/B5 regression. If we ever ship B7-sweep
    // without this guard, a B1 regression that left every task branch
    // identical to base would silently delete every completed task.
    const taskId = 'sweep-empty';
    const originalRoot = path.join(platformRoot, 'origin', 'repo');
    const worktreeRoot = path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', 'repo');
    const baseSha = initRepo(originalRoot);
    addEmptyWorktree(originalRoot, worktreeRoot, `task/${taskId}`, baseSha);
    // Branch HEAD == baseSha, so merge-base --is-ancestor would trivially succeed.

    writeTaskSidecar(platformRoot, {
      taskId,
      bindings: [{
        originalRoot,
        worktreeRoot,
        worktreeBranch: `task/${taskId}`,
        baseCommitSha: baseSha,
      }],
    });

    const result = await runMergeDetectionSweep(platformRoot);

    // Behavioral contract: empty branch must NOT be marked handled, and the
    // task dir + branch ref must remain intact so an operator can investigate.
    expect(result.bindingsMarked).toBe(0);
    expect(result.tasksFullyMerged).toBe(0);
    expect(result.tasksCleanedUp).toBe(0);

    expect(existsSync(path.join(platformRoot, 'AgentWorkSpace', 'tasks', taskId))).toBe(true);
    expect(() => git(originalRoot, ['rev-parse', '--verify', `refs/heads/task/${taskId}`])).not.toThrow();

    // Sidecar binding must remain unstamped (no mergedAt, no mergedVia).
    const sidecar = readSidecar(platformRoot, taskId);
    const binding = sidecar.contextPackBinding.repoBindings[0]!;
    expect(binding.mergedAt).toBeUndefined();
    expect(binding.mergedVia).toBeUndefined();
  });
});
