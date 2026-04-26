/**
 * §B7-sweep: detect when per-task branches have landed (or been deleted) in
 * each binding's originalRoot, stamp the sidecar, and clean up once every
 * binding is handled.
 *
 * Triggered at the top of every queue advance — startup recovery, after each
 * completion, manual refresh. No background timer.
 *
 * Defense-in-depth (risk 5.9): a branch with zero commits beyond its base SHA
 * is NEVER marked merged-into-head, even if `merge-base --is-ancestor` would
 * trivially succeed. That keeps a B1 regression from silently deleting every
 * completed task — empty branches surface a stderr warning instead.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rmSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readTaskJsonSafe, writeTaskJson } from './taskJson.js';
import type { TaskRepoBinding } from './taskJson.js';
import { removeTask } from './taskRegistry.js';
import { acquireDirLock } from './dirLock.js';

const execFileP = promisify(execFile);

export interface BindingHandledStatus {
  originalRoot: string;
  branch: string;
  handled: boolean;
  via?: 'merged-into-head' | 'branch-deleted';
}

export interface SweepResult {
  scanned: number;
  bindingsMarked: number;
  tasksFullyMerged: number;
  tasksCleanedUp: number;
}

function emptySweepResult(): SweepResult {
  return { scanned: 0, bindingsMarked: 0, tasksFullyMerged: 0, tasksCleanedUp: 0 };
}

function sweepLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'merge-detection-sweep.lock');
}

export async function probeBindingHandled(binding: TaskRepoBinding): Promise<BindingHandledStatus> {
  let branchExists = true;
  try {
    await execFileP('git', [
      '-C', binding.originalRoot,
      'rev-parse', '--verify',
      `refs/heads/${binding.worktreeBranch}`,
    ]);
  } catch {
    branchExists = false;
  }
  if (!branchExists) {
    return { originalRoot: binding.originalRoot, branch: binding.worktreeBranch, handled: true, via: 'branch-deleted' };
  }

  // Defense-in-depth: refuse merged-into-head when the branch has zero
  // commits beyond its base. Without this guard, a B1 regression that left
  // every task branch identical to base would cause sweep to silently
  // delete every completed task.
  try {
    const { stdout } = await execFileP('git', [
      '-C', binding.originalRoot,
      'rev-list', '--count',
      `${binding.baseCommitSha}..${binding.worktreeBranch}`,
    ]);
    const aheadCount = Number(stdout.trim());
    if (!Number.isFinite(aheadCount) || aheadCount < 1) {
      process.stderr.write(
        `[mergeDetectionSweep] empty-branch-skip: ${binding.worktreeBranch} @ ${binding.originalRoot} ` +
        `has 0 commits beyond base — likely B1/B5 regression\n`,
      );
      return { originalRoot: binding.originalRoot, branch: binding.worktreeBranch, handled: false };
    }

    await execFileP('git', [
      '-C', binding.originalRoot,
      'merge-base', '--is-ancestor',
      binding.worktreeBranch, 'HEAD',
    ]);
    return { originalRoot: binding.originalRoot, branch: binding.worktreeBranch, handled: true, via: 'merged-into-head' };
  } catch {
    return { originalRoot: binding.originalRoot, branch: binding.worktreeBranch, handled: false };
  }
}

export async function runMergeDetectionSweep(repoRoot: string): Promise<SweepResult> {
  const result = emptySweepResult();
  const tasksDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks');
  if (!existsSync(tasksDir)) return result;

  // Lock precedence: acquired after the queue lock has been released and does
  // not nest with other platform locks. A held lock only skips this best-effort
  // sweep; the peer process owns the in-progress scan.
  const lockPath = sweepLockPath(repoRoot);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const release = await acquireDirLock(lockPath, 1, 0);
  if (!release) {
    process.stderr.write(
      `[mergeDetectionSweep] sweep-lock-held: another process is sweeping; skipping\n`,
    );
    return result;
  }

  try {
    for (const taskId of readdirSync(tasksDir)) {
      const sidecar = readTaskJsonSafe(taskId, repoRoot);
      if (sidecar === null) continue;
      if (sidecar.state !== 'completed' && sidecar.state !== 'merged') continue;
      const bindings = sidecar.contextPackBinding.repoBindings;
      if (bindings.length === 0) continue;

      result.scanned += 1;

      let mutated = false;
      let allHandled: boolean;
      if (sidecar.state === 'merged') {
        allHandled = true;
      } else {
        for (const binding of bindings) {
          if (binding.mergedAt !== undefined) continue;
          const status = await probeBindingHandled(binding);
          if (status.handled) {
            binding.mergedAt = new Date().toISOString();
            binding.mergedVia = status.via;
            result.bindingsMarked += 1;
            mutated = true;
          }
        }
        allHandled = bindings.every((b) => b.mergedAt !== undefined);
      }

      if (allHandled) {
        sidecar.state = 'merged';
        writeTaskJson(taskId, repoRoot, sidecar);
        result.tasksFullyMerged += 1;

        for (const binding of bindings) {
          if (binding.mergedVia === 'branch-deleted') {
            continue;
          }

          try {
            await execFileP('git', [
              '-C', binding.originalRoot,
              'rev-parse', '--verify',
              `refs/heads/${binding.worktreeBranch}`,
            ]);
          } catch {
            continue;
          }

          try {
            await execFileP('git', [
              '-C', binding.originalRoot,
              'merge-base', '--is-ancestor',
              binding.worktreeBranch, 'HEAD',
            ]);
          } catch {
            process.stderr.write(
              `[mergeDetectionSweep] ancestry-revert-detected: ${binding.worktreeBranch} ` +
              `@ ${binding.originalRoot} is no longer an ancestor of HEAD; ` +
              `refusing force-delete. Operator may have reverted the merge.\n`,
            );
            continue;
          }

          try {
            await execFileP('git', [
              '-C', binding.originalRoot,
              'branch', '-D',
              binding.worktreeBranch,
            ]);
          } catch {
            // Branch deletion refused (for example, checked out elsewhere).
          }
        }

        const taskDir = path.join(tasksDir, taskId);
        try {
          rmSync(taskDir, { recursive: true, force: true });
          result.tasksCleanedUp += 1;
          try {
            await removeTask(repoRoot, taskId);
          } catch {
            // Registry update is best-effort; the dir is already gone.
          }
        } catch {
          // Filesystem holds leave a persisted merged sidecar for re-entry:
          // bindings stay audit-stamped and cleanup is retried without probing.
        }
      } else if (mutated) {
        writeTaskJson(taskId, repoRoot, sidecar);
      }
    }
  } finally {
    await release();
  }

  return result;
}
