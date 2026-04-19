/**
 * §4.15 Worktree finalize and teardown — MG-4 keystone.
 *
 * Exports `finalizeTaskWorktrees` (primary entry point called by §4.14A failure
 * path and §4.3 success path) and `finalizeWorktree` (per-binding helper).
 *
 * Lock ordering per §0.6:
 *   - retention-eviction.lock is Lock precedence: 7.
 *   - It MUST be acquired AFTER `.task.json.finalizedAt` has been persisted
 *     so concurrent scanners see a consistent retained set.
 *   - MUST NOT be acquired while holding any lock of precedence 1–6.
 */
import path from 'node:path';
import { readdirSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { getPlatformConfig } from '../platform-config/get.js';
import { readTaskJson, readTaskJsonSafe, resolveTaskJsonPath } from '../queue/taskJson.js';
import type { TaskRepoBinding } from '../queue/taskJson.js';
import { acquireDirLock } from '../queue/operations.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FinalizeOutcome = 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function retentionEvictionLockPath(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'runtime', 'retention-eviction.lock');
}

/**
 * Write the updated `.task.json` back to disk with `finalizedAt` stamped and
 * `state` set. Uses a synchronous write to keep things simple (this runs on
 * the terminal state transition path where async coordination matters less).
 */
function persistTaskJson(taskId: string, repoRoot: string, state: FinalizeOutcome, finalizedAt: string): void {
  const sidecarPath = resolveTaskJsonPath(taskId, repoRoot);
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
        composeProjectName: 'repo-context-mcp',
      },
      frozenAt: new Date().toISOString(),
    };
  }
  json['state'] = state;
  json['finalizedAt'] = finalizedAt;
  writeFileSync(sidecarPath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Per-binding teardown
// ---------------------------------------------------------------------------

/**
 * Finalize a single repo binding (worktree + branch) based on outcome.
 *
 * Success path: remove worktree dir; retain `task/<taskId>` branch so the
 * operator can merge or open a PR. TaskSail does NOT auto-merge.
 *
 * Failure path with retain=true: preserve both worktree dir and branch for
 * operator inspection.
 *
 * Failure path with retain=false: remove worktree dir + delete branch.
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
    // Remove worktree dir; retain branch for operator merge/PR.
    try {
      await execFile('git', [
        '-C', binding.originalRoot,
        'worktree', 'remove', '--force', binding.worktreeRoot,
      ]);
    } catch {
      // Worktree dir may have been removed out-of-band (e.g. by §4.10 quit-time
      // cleanup); ignore the error and fall through to prune unconditionally.
    }
    await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']);
    return;
  }

  // Failure path
  const cfg = await getPlatformConfig(repoRoot);
  if (cfg.retain_failed_task_worktrees) {
    // Default: retain dir + branch for inspection. FIFO eviction runs in
    // `finalizeTaskWorktrees` after all bindings for the current task are done.
    return;
  }

  // retain_failed_task_worktrees=false: remove worktree dir + delete branch.
  try {
    await execFile('git', [
      '-C', binding.originalRoot,
      'worktree', 'remove', '--force', binding.worktreeRoot,
    ]);
  } catch {
    // Out-of-band removal already happened; proceed to prune.
  }
  await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']);
  await execFile('git', [
    '-C', binding.originalRoot,
    'branch', '-D', binding.worktreeBranch,
  ]);
}

// ---------------------------------------------------------------------------
// FIFO retention eviction (runs under retention-eviction.lock — precedence 7)
// ---------------------------------------------------------------------------

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
    process.stderr.write(
      `[worktreeFinalize] retention-eviction-lock-timeout: could not acquire ${lockPath} within timeout — skipping eviction\n`,
    );
    return;
  }

  try {
    // Enumerate all retained (state=failed + finalizedAt present) task entries.
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
    }> = [];

    for (const entry of taskEntries) {
      const meta = readTaskJsonSafe(entry, repoRoot);
      if (meta?.state === 'failed' && meta.finalizedAt) {
        retainedTasks.push({
          taskId: entry,
          finalizedAt: meta.finalizedAt,
          bindings: meta.contextPackBinding.repoBindings,
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
      for (const binding of victim.bindings) {
        // One-shot eviction: force the no-retain branch for this victim.
        // All errors are swallowed — eviction is best-effort.
        await execFile('git', [
          '-C', binding.originalRoot,
          'worktree', 'remove', '--force', binding.worktreeRoot,
        ]).catch(() => {});
        await execFile('git', ['-C', binding.originalRoot, 'worktree', 'prune']).catch(() => {});
        await execFile('git', [
          '-C', binding.originalRoot,
          'branch', '-D', binding.worktreeBranch,
        ]).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[worktreeFinalize] retention-eviction-failed: taskId=${victim.taskId} branch=${binding.worktreeBranch} err=${msg}\n`,
          );
        });
      }
      rmSync(
        path.join(tasksBaseDir, victim.taskId),
        { recursive: true, force: true },
      );
    }
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Primary export
// ---------------------------------------------------------------------------

/**
 * Finalize all worktrees for a task and update `.task.json` state.
 *
 * Called by:
 * - §4.3 `completePendingItem` after archival (outcome='completed')
 * - §4.14A `moveFailedItemToErrorItems` (outcome='failed')
 * - §5.2 `pipelineSupervisor.recoverOnStartup` (outcome='failed')
 *
 * NOT called by §4.10 `cleanupWorkspaceOnQuit` — that uses its own sync teardown.
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
  const taskJson = readTaskJson(taskId, repoRoot);

  for (const binding of taskJson.contextPackBinding.repoBindings) {
    await finalizeWorktree(binding, outcome, repoRoot);
  }

  // Stamp finalizedAt and persist BEFORE acquiring the retention-eviction lock,
  // so concurrent scanners see this task in the retained set when they scan.
  const finalizedAt = new Date().toISOString();
  persistTaskJson(taskId, repoRoot, outcome, finalizedAt);

  // Parent-dir cleanup policy:
  //   completed:            always remove parent dir (artifacts consumed by archival)
  //   failed+retain=false:  remove parent dir (matching no-retention intent)
  //   failed+retain=true:   PRESERVE parent dir for operator inspection
  const cfg = await getPlatformConfig(repoRoot);
  const parentDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);

  if (outcome === 'completed') {
    rmSync(parentDir, { recursive: true, force: true });
  } else if (outcome === 'failed' && !cfg.retain_failed_task_worktrees) {
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
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[worktreeFinalize] retention-eviction-error: taskId=${taskId} err=${msg}\n`,
      );
    }
  }
}
