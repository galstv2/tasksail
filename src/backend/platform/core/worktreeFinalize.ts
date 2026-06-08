/**
 * Worktree finalize and teardown.
 *
 * Exports `finalizeTaskWorktrees` for success/failure terminal paths and
 * `finalizeWorktree` for per-binding teardown.
 *
 * Lock ordering:
 *   - retention-eviction.lock is Lock precedence: 7.
 *   - It MUST be acquired AFTER `.task.json.finalizedAt` has been persisted
 *     so concurrent scanners see a consistent retained set.
 *   - MUST NOT be acquired while holding any lock of precedence 1–6.
 */
import path from 'node:path';
import { existsSync, readdirSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { writeTextFileAtomicSync } from './io.js';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { getPlatformConfig } from '../platform-config/get.js';
import { readTaskJsonSafe, resolveTaskJsonPath } from '../queue/taskJson.js';
import type { TaskJson, TaskReadonlyContextBinding, TaskRepoBinding } from '../queue/taskJson.js';
import { acquireDirLock } from '../queue/operations.js';
import { removeReadonlyContextWorktree } from '../queue/supportContextMaterialization.js';
import { createLogger } from './logger.js';
import {
  discardTaskBindingsWithOwnership,
  finalizeFailedTaskBindingsWithOwnership,
  removeTaskWorkspaceAndRuntime,
  type ChainOwnedRollbackReport,
} from './worktreeBranchOwnership.js';

const execFile = promisify(execFileCb);
const log = createLogger('platform/core/worktreeFinalize');

export type FinalizeOutcome = 'completed' | 'failed';

export interface FinalizeTaskWorktreesResult {
  chainRollbackReport: ChainOwnedRollbackReport | null;
  skipNextActivation: boolean;
}

function retentionEvictionLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'retention-eviction.lock');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readonlyContextBindingsOf(taskJson: TaskJson): TaskReadonlyContextBinding[] {
  // taskJson.ts validates and normalizes `readonlyContextBindings` to a typed
  // array on read; the local optionality fallback just covers the legacy v1
  // sidecar shape where the field was absent entirely.
  return taskJson.contextPackBinding.readonlyContextBindings ?? [];
}

async function removeReadonlyContextBindings(args: {
  repoRoot: string;
  taskId: string;
  bindings: readonly TaskReadonlyContextBinding[];
  failOnError: boolean;
}): Promise<boolean> {
  let failed = false;
  for (const binding of args.bindings) {
    try {
      await removeReadonlyContextWorktree({
        repoRoot: args.repoRoot,
        taskId: args.taskId,
        binding,
      });
    } catch (err) {
      failed = true;
      if (args.failOnError) {
        throw err;
      }
    }
  }
  return failed;
}

/**
 * Write the updated `.task.json` back to disk with `finalizedAt` stamped and
 * `state` set. Uses a synchronous write to keep things simple (this runs on
 * the terminal state transition path where async coordination matters less).
 */
function persistTaskJson(taskId: string, repoRoot: string, state: FinalizeOutcome, finalizedAt: string): void {
  const sidecarPath = resolveTaskJsonPath(taskId, repoRoot);
  // Parent-dir precondition: if the task dir doesn't exist at all (e.g. crash
  // before materialization, or a legacy pending item that never booted), there
  // is nothing for the retention scanner to find — skip the write entirely.
  // This also avoids creating a dir only to rmSync it two lines later.
  if (!existsSync(path.dirname(sidecarPath))) {
    return;
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // File missing or corrupt — construct a minimal shell so we can write the
    // state+finalizedAt fields needed by the retention scan.
    json = {
      schema_version: 1,
      taskId,
      contextPackBinding: {
        contextPackPath: null,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings: [],
      },
      materialization: {
        strategy: 'copy',
        cloned: [],
        skipped: [],
      },
      frozenAt: new Date().toISOString(),
    };
  }
  json['state'] = state;
  json['finalizedAt'] = finalizedAt;
  writeTextFileAtomicSync(sidecarPath, JSON.stringify(json, null, 2) + '\n');
}

/**
 * Finalize a single repo binding (worktree + branch) based on outcome.
 *
 * Success path: remove worktree dir; retain `task/<taskId>` branch so the
 * operator can merge or open a PR. TaskSail does NOT auto-merge.
 *
 * Failure path with retain=true: preserve both worktree dir and branch for
 * operator inspection.
 *
 * Failure path with retain=false: remove worktree dir + task-owned branch.
 *
 * MUST call `git worktree prune` after every `remove --force` to clear orphan
 * admin entries that would block a future `git worktree add` at the same path.
 */
export async function finalizeWorktree(
  binding: TaskRepoBinding,
  outcome: FinalizeOutcome,
  repoRoot: string,
): Promise<void> {
  if (outcome === 'completed') {
    try {
      await execFile('git', [
        '-C', binding.originalRoot,
        'worktree', 'remove', '--force', binding.worktreeRoot,
      ]);
    } catch {
      // Worktree dir may have been removed out-of-band (e.g. by quit-time
      // cleanup); ignore the error and fall through to prune unconditionally.
    }
    try {
      await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']);
    } catch (err) {
      log.warn('worktree.prune.failed', {
        originalRoot: binding.originalRoot,
        error: errorMessage(err),
      });
    }
    return;
  }

  const cfg = await getPlatformConfig(repoRoot);
  if (cfg.retain_failed_task_worktrees) {
    // Default: retain dir + branch for inspection. FIFO eviction runs in
    // `finalizeTaskWorktrees` after all bindings for the current task are done.
    return;
  }

  await finalizeFailedTaskBindingsWithOwnership({
    repoRoot,
    taskId: binding.branchChainTaskId ?? path.basename(binding.worktreeBranch),
    bindings: [binding],
    retainFailedWorktree: false,
  });
}

/**
 * Discard a previously-retained failed task's worktrees, branches, and
 * supporting state. Called by the queue's requeue paths
 * (`requeueErrorItem`, `moveErrorItemToDropbox`) at the moment the operator
 * decides to retry the task — at that point the forensic affordance of
 * `retain_failed_task_worktrees=true` has served its purpose, and leaving
 * the orphan worktree behind would only accumulate disk usage until FIFO
 * eviction kicks in.
 *
 * Tear-down scope per task:
 *   - each binding's worktree dir (`git worktree remove --force`)
 *   - each binding's branch (`git branch -D task/<taskId>`)
 *   - `AgentWorkSpace/tasks/<taskId>/` parent dir
 *   - `.platform-state/runtime/tasks/<taskId>/` runtime state
 *
 * Safety properties:
 *   - Best-effort throughout — never throws. Tolerant of missing
 *     `.task.json` (no bindings to walk), already-removed worktree dirs
 *     or branches (concurrent FIFO eviction), and missing parent dirs.
 *   - Idempotent: safe to call when retain=false was in effect at finalize
 *     time and there is nothing left to discard.
 *   - Does NOT acquire `retention-eviction.lock`. Both this helper and the
 *     FIFO eviction scanner converge on the same final state for any given
 *     victim, so a concurrent race is harmless (each operation is wrapped
 *     in `.catch()` or `force: true`).
 */
export async function discardRetainedTaskWorktrees(
  taskId: string,
  repoRoot: string,
): Promise<void> {
  const taskJson = readTaskJsonSafe(taskId, repoRoot);
  if (taskJson) {
    await discardTaskBindingsWithOwnership({
      repoRoot,
      taskId,
      bindings: taskJson.contextPackBinding.repoBindings,
    });
    await removeReadonlyContextBindings({
      repoRoot,
      taskId,
      bindings: readonlyContextBindingsOf(taskJson),
      failOnError: false,
    });
  }
  removeTaskWorkspaceAndRuntime(repoRoot, taskId);
}

async function runRetentionEviction(
  repoRoot: string,
  cap: number,
): Promise<void> {
  const tasksBaseDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks');
  const lockPath = retentionEvictionLockPath(repoRoot);

  // Ensure parent directory exists (acquireDirLock calls mkdir non-recursively;
  // if the parent doesn't exist it silently retries, causing a multi-second timeout).
  try { mkdirSync(path.dirname(lockPath), { recursive: true }); } catch { /* already exists */ }

  // Lock precedence: 7 — acquired after .task.json.finalizedAt is persisted.
  const release = await acquireDirLock(lockPath, 60, 200);
  if (!release) {
    // Best-effort: if we cannot acquire the lock within the timeout, skip
    // eviction. The next task finalization will re-try. Log for observability.
    log.warn('retention_eviction.lock_timeout', { lockPath });
    return;
  }

  try {
    let taskEntries: string[];
    try {
      taskEntries = readdirSync(tasksBaseDir);
    } catch {
      return; // tasks dir does not exist yet — nothing to evict
    }

    const retainedTasks: Array<{
      taskId: string;
      finalizedAt: string;
      bindings: TaskRepoBinding[];
      readonlyContextBindings: TaskReadonlyContextBinding[];
    }> = [];

    for (const entry of taskEntries) {
      const meta = readTaskJsonSafe(entry, repoRoot);
      if (meta?.state === 'failed' && meta.finalizedAt) {
        retainedTasks.push({
          taskId: entry,
          finalizedAt: meta.finalizedAt,
          bindings: meta.contextPackBinding.repoBindings,
          readonlyContextBindings: readonlyContextBindingsOf(meta),
        });
      }
    }

    // Sort oldest-first by finalizedAt ISO8601 string (lexicographic sort is
    // correct for ISO8601 timestamps — oldest first).
    retainedTasks.sort((a, b) => a.finalizedAt.localeCompare(b.finalizedAt));

    // Evict until the retained set is within the cap.
    // cap=0 evicts everything including the task just finalized.
    while (retainedTasks.length > cap) {
      const victim = retainedTasks.shift()!;
      await discardTaskBindingsWithOwnership({
        repoRoot,
        taskId: victim.taskId,
        bindings: victim.bindings,
      }).catch((err: unknown) => {
        log.warn('retention_eviction.discard.failed', {
          taskId: victim.taskId,
          error: errorMessage(err),
        });
      });
      await removeReadonlyContextBindings({
        repoRoot,
        taskId: victim.taskId,
        bindings: victim.readonlyContextBindings,
        failOnError: false,
      });
      rmSync(path.join(tasksBaseDir, victim.taskId), { recursive: true, force: true });
    }
  } finally {
    await release();
  }
}

/**
 * Finalize all worktrees for a task and update `.task.json` state.
 *
 * Called by:
 * - `completePendingItem` after archival (outcome='completed')
 * - `moveFailedItemToErrorItems` (outcome='failed')
 * - `pipelineSupervisor.recoverOnStartup` (outcome='failed')
 *
 * NOT called by `cleanupWorkspaceOnQuit` — that uses its own sync teardown.
 *
 * @param taskId   The task identifier.
 * @param outcome  'completed' or 'failed'.
 * @param repoRoot The TaskSail platform repo root (NOT `binding.originalRoot`).
 */
export async function finalizeTaskWorktrees(
  taskId: string,
  outcome: FinalizeOutcome,
  repoRoot: string,
): Promise<void> {
  await finalizeTaskWorktreesWithReport(taskId, outcome, repoRoot);
}

export async function finalizeTaskWorktreesWithReport(
  taskId: string,
  outcome: FinalizeOutcome,
  repoRoot: string,
): Promise<FinalizeTaskWorktreesResult> {
  // Tolerate missing sidecar: crash-recovery paths and legacy test fixtures
  // that seed a task without a .task.json still need runtime GC to run. The
  // binding loop below is a no-op when the sidecar is absent; persistTaskJson
  // synthesizes a minimal shell so finalizedAt is still stamped.
  const taskJson = readTaskJsonSafe(taskId, repoRoot);
  const cfg = await getPlatformConfig(repoRoot);

  let failedOwnershipResult: Awaited<ReturnType<typeof finalizeFailedTaskBindingsWithOwnership>> | null = null;
  if (taskJson && outcome === 'failed') {
    failedOwnershipResult = await finalizeFailedTaskBindingsWithOwnership({
      repoRoot,
      taskId,
      bindings: taskJson.contextPackBinding.repoBindings,
      retainFailedWorktree: cfg.retain_failed_task_worktrees,
    });
  } else if (taskJson) {
    for (const binding of taskJson.contextPackBinding.repoBindings) {
      await finalizeWorktree(binding, outcome, repoRoot);
    }
  }

  let preserveTaskStateForReadonlyCleanup = false;
  if (taskJson && (outcome === 'completed' || !cfg.retain_failed_task_worktrees)) {
    preserveTaskStateForReadonlyCleanup = await removeReadonlyContextBindings({
      repoRoot,
      taskId,
      bindings: readonlyContextBindingsOf(taskJson),
      failOnError: outcome === 'completed',
    });
  }

  // Stamp finalizedAt and persist BEFORE acquiring the retention-eviction lock,
  // so concurrent scanners see this task in the retained set when they scan.
  const finalizedAt = new Date().toISOString();
  persistTaskJson(taskId, repoRoot, outcome, finalizedAt);

  // Completed tasks remove the parent dir after QMD archival; failed tasks
  // remove it only when retention is disabled. Retained failures keep the
  // parent dir for operator inspection.
  const parentDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);

  if (outcome === 'completed') {
    rmSync(parentDir, { recursive: true, force: true });
  } else if (
    outcome === 'failed'
    && !cfg.retain_failed_task_worktrees
    && !failedOwnershipResult?.preserveTaskState
    && !preserveTaskStateForReadonlyCleanup
  ) {
    rmSync(parentDir, { recursive: true, force: true });
  }

  // FIFO retention eviction runs only on the failed+retain=true path.
  // The .task.json.finalizedAt is already persisted above, so the eviction
  // scanner will see the current task in the retained set.
  if (outcome === 'failed' && cfg.retain_failed_task_worktrees) {
    // Eviction errors MUST NOT propagate — wrap in try/catch.
    try {
      await runRetentionEviction(repoRoot, cfg.max_retained_failed_task_worktrees);
    } catch (err) {
      log.warn('retention_eviction.failed', {
        taskId,
        error: errorMessage(err),
      });
    }
  }

  try {
    if (!failedOwnershipResult?.preserveTaskState && !preserveTaskStateForReadonlyCleanup) {
      await gcTaskRuntime(taskId, outcome, repoRoot);
    }
  } catch (err) {
    log.warn('runtime_gc.failed', {
      taskId,
      error: errorMessage(err),
    });
  }

  return {
    chainRollbackReport: failedOwnershipResult?.chainRollbackReport ?? null,
    skipNextActivation: failedOwnershipResult?.skipNextActivation ?? false,
  };
}

const GC_SENTINEL_NAME = '.gc-after-ts';

function runtimeTaskDir(taskId: string, repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'tasks', taskId);
}

function gcSentinelPath(taskId: string, repoRoot: string): string {
  return path.join(runtimeTaskDir(taskId, repoRoot), GC_SENTINEL_NAME);
}

/**
 * Schedule deferred GC of `.platform-state/runtime/tasks/<taskId>/`.
 *
 * Writes an on-disk sentinel FIRST (the authoritative trigger that survives
 * crashes), THEN schedules an opportunistic `setTimeout` for the
 * in-session common case. The opportunistic timer is not tracked — its
 * cancellation on quit is not required because quit cleanup wipes runtime task
 * state and the sentinel file is the post-restart authority.
 *
 * Outcome semantics:
 *   - 'completed': retain for `completed_task_runtime_retention_ms` (default 1h),
 *     then delete.
 *   - 'failed' with `retain_failed_task_worktrees=true`: retain in-session
 *     until the operator requeues (via `requeueErrorItem`) or returns the
 *     item to the dropbox (via `moveErrorItemToDropbox`), at which point
 *     `discardRetainedTaskWorktrees` removes it. NO sentinel is written —
 *     the sweep interprets a missing sentinel as retain-until-requeue.
 *   - 'failed' with `retain_failed_task_worktrees=false`: same retention window
 *     as 'completed', then delete.
 */
export async function gcTaskRuntime(
  taskId: string,
  outcome: FinalizeOutcome,
  repoRoot: string,
): Promise<void> {
  const cfg = await getPlatformConfig(repoRoot);
  const retentionMs = cfg.completed_task_runtime_retention_ms;
  const retainFailed = cfg.retain_failed_task_worktrees;

  const runtimeDir = runtimeTaskDir(taskId, repoRoot);
  if (!existsSync(runtimeDir)) {
    // Nothing to GC — treat as a silent idempotent no-op.
    return;
  }

  if (outcome === 'failed' && retainFailed) {
    // Retain indefinitely in-session. MUST NOT write a sentinel — the sweep
    // interprets a missing sentinel as retain-indefinitely.
    return;
  }

  // Sentinel write MUST precede the setTimeout. If the timer fired first and a
  // subsequent crash interrupted the sentinel write, a restart would find an
  // orphan runtime dir with no record of why. Ordering closes that window.
  const sentinel = gcSentinelPath(taskId, repoRoot);
  const deleteAfter = Date.now() + retentionMs;
  try {
    mkdirSync(path.dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, String(deleteAfter), 'utf-8');
  } catch (err) {
    log.warn('runtime_gc.sentinel_write.failed', {
      taskId,
      error: errorMessage(err),
    });
    // Fall through — setTimeout still fires as best-effort.
  }

  // Opportunistic in-session timer. The sentinel is authoritative, so a missed
  // timer (process restart) is reclaimed by `sweepRuntimeGC` at next startup.
  const timer = setTimeout(() => {
    try {
      if (existsSync(sentinel)) {
        rmSync(runtimeDir, { recursive: true, force: true });
      }
    } catch {
      // Open subscribers on POSIX may keep file handles alive after unlink;
      // Windows may refuse the rm outright. Either way, the next-restart
      // sentinel sweep is the fallback.
    }
  }, retentionMs);
  // Do not hold the event loop on the timer — quit-nuke + sentinel handle the
  // rest.
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * Startup sweep for deferred GC.
 *
 * Called by `recoverOnStartup`. Walks `.platform-state/runtime/tasks/` and
 * deletes every task subtree whose `.gc-after-ts` epoch has passed.
 * A task subtree without a sentinel is treated as retain-indefinitely (by
 * design — see `gcTaskRuntime`'s failed+retain branch).
 */
export function sweepRuntimeGC(repoRoot: string, now: number = Date.now()): void {
  const runtimeTasksDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks');
  if (!existsSync(runtimeTasksDir)) return;

  let taskIds: string[];
  try {
    taskIds = readdirSync(runtimeTasksDir);
  } catch {
    return;
  }

  for (const taskId of taskIds) {
    const sentinel = gcSentinelPath(taskId, repoRoot);
    if (!existsSync(sentinel)) continue;
    let epoch: number;
    try {
      epoch = Number(readFileSync(sentinel, 'utf-8').trim());
    } catch {
      continue;
    }
    if (!Number.isFinite(epoch)) continue;
    if (epoch > now) continue;
    try {
      rmSync(runtimeTaskDir(taskId, repoRoot), { recursive: true, force: true });
    } catch {
      // Open handles or permission errors — next sweep retries.
    }
  }
}
