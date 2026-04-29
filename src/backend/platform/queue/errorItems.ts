import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { rename, unlink, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveQueuePaths } from './paths.js';
import { findRepoRoot } from '../core/index.js';
import {
  extractContextPackBinding,
  formatContextPackBindingSection,
} from './markdown.js';
import {
  activateNextPendingItemIfReady,
  acquireDirLockOrThrow,
  getActiveTaskIds,
  insertIntoQueueManifest,
  readQueueOrderManifest,
  writeQueueOrderManifest,
} from './operations.js';
import { removeTask, transitionTask } from './taskRegistry.js';
import { readTaskJson, readTaskJsonSafe } from './taskJson.js';
import { discardRetainedTaskWorktrees, finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { getPlatformConfig } from '../platform-config/get.js';

const execFileAsync = promisify(execFileCb);

async function restoreContextPackBindingForRecoveredItem(
  repoRoot: string,
  taskId: string,
  recoveredBody: string,
): Promise<string> {
  if (extractContextPackBinding(recoveredBody)) {
    return recoveredBody;
  }

  const intakePath = path.join(
    repoRoot,
    'AgentWorkSpace',
    'tasks',
    taskId,
    'handoffs',
    'intake.md',
  );
  try {
    const intakeBinding = extractContextPackBinding(await readFile(intakePath, 'utf-8'));
    if (intakeBinding) {
      return `${recoveredBody.trimEnd()}\n\n${formatContextPackBindingSection(intakeBinding)}\n`;
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
  }

  const activeContextPackPath = path.join(
    repoRoot,
    '.platform-state',
    'queue',
    'active-context-pack.json',
  );
  let raw: string;
  try {
    raw = await readFile(activeContextPackPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return recoveredBody;
    }
    throw err;
  }

  const binding = JSON.parse(raw) as Parameters<typeof formatContextPackBindingSection>[0];
  if (!binding.contextPackDir?.trim()) {
    return recoveredBody;
  }

  return `${recoveredBody.trimEnd()}\n\n${formatContextPackBindingSection(binding)}\n`;
}

// ---------------------------------------------------------------------------
// Git helpers (retained for commitTaskSnapshot worktree commits)
// ---------------------------------------------------------------------------

class GitCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

function runGit(repoRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.stdin.end();
    child.on('error', (err: Error) => {
      reject(new Error(`Failed to run git in ${repoRoot}: ${err.message}`, { cause: err }));
    });
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || '<no output>';
        reject(new GitCommandError(
          `git ${args.join(' ')} failed in ${repoRoot} with exit ${code ?? 1}: ${details}`,
          code,
          stdout,
          stderr,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Programmatic task snapshot commit
// ---------------------------------------------------------------------------

/**
 * Commit all agent work to a local git snapshot inside each task worktree.
 *
 * Reads task's repoBindings from .task.json and runs `git add -A` + `git commit`
 * in each binding's worktreeRoot (CWD = worktreeRoot), committing to the
 * task/<taskId> branch that lives in that worktree.
 *
 * No cross-process lock needed: each worktree has its own HEAD/index.
 *
 * Best-effort: returns false on failure instead of throwing.
 */
export async function commitTaskSnapshot(
  repoRoot: string,
  taskId: string,
  outcome: 'completed' | 'failed',
): Promise<boolean> {
  let taskJson;
  try {
    taskJson = readTaskJson(taskId, repoRoot);
  } catch {
    // Sidecar missing or corrupt — no bindings to commit in
    return true;
  }

  const bindings = taskJson.contextPackBinding.repoBindings;
  if (bindings.length === 0) {
    return true;
  }

  for (const binding of bindings) {
    try {
      await runGit(binding.worktreeRoot, ['add', '-A']);

      try {
        await runGit(binding.worktreeRoot, ['diff', '--cached', '--quiet']);
        // Empty staged tree: git diff --cached --quiet exits 0, so there is nothing to commit.
        continue;
      } catch (err) {
        if (!(err instanceof GitCommandError) || err.exitCode !== 1) {
          throw err;
        }
      }

      const label = outcome === 'completed' ? 'completed' : 'pipeline failed';
      await runGit(binding.worktreeRoot, [
        '-c', 'commit.gpgsign=false', // Platform-internal snapshots must ignore operator/global signing policy.
        'commit',
        '-m', `[tasksail] ${taskId}: ${label}`,
        '--no-verify',
      ]);
      // NOTE: resetHead behavior deleted — worktree will be finalized/torn down.
    } catch (err) {
      process.stderr.write(
        `Warning: task snapshot commit failed in ${binding.worktreeRoot}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Retry-suffix collision helpers (for requeueErrorItem)
// ---------------------------------------------------------------------------

/**
 * Scan across the UNION of all originalRoots in the task's repoBindings to find
 * the smallest monotonic N ≥ 1 such that no origin has a branch
 * `task/<original-slug>-retry<N>`.
 *
 * MUST be called under the queue lock to prevent concurrent requeues from
 * picking the same retry<N>.
 */
async function pickNextRetryN(taskId: string, root: string): Promise<number> {
  await assertQueueLockHeld(root);
  const sidecar = readTaskJsonSafe(taskId, root);
  if (!sidecar) return 1;
  const originalSlug = taskId.replace(/-retry\d+$/, '');
  const taken = new Set<number>();
  for (const binding of sidecar.contextPackBinding.repoBindings) {
    let stdout = '';
    try {
      const result = await execFileAsync('git', [
        '-C', binding.originalRoot, 'for-each-ref',
        '--format=%(refname:short)',
        `refs/heads/task/${originalSlug}-retry*`,
      ]);
      stdout = result.stdout;
    } catch {
      // No matching refs or git error — treat as empty
    }
    for (const line of stdout.split('\n')) {
      const m = line.match(/-retry(\d+)$/);
      if (m) taken.add(parseInt(m[1]!, 10));
    }
  }
  let n = 1;
  while (taken.has(n)) n++;
  return n;
}

export async function assertQueueLockHeld(repoRoot: string): Promise<void> {
  const ownerPath = path.join(resolveQueuePaths(repoRoot).queueLockDir, 'owner.json');
  const message = 'queue lock assertion failed: pickNextRetryN requires the queue lock';

  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(ownerPath, 'utf-8'));
  } catch (err) {
    throw new Error(message, { cause: err });
  }

  if (
    typeof owner !== 'object'
    || owner === null
    || !('pid' in owner)
    || typeof owner.pid !== 'number'
    || owner.pid !== process.pid
  ) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Move failed item to error-items
// ---------------------------------------------------------------------------

export interface MoveFailedItemResult {
  movedItem: string;
  errorItemPath: string;
  nextActiveItem: string | null;
}

/**
 * Move the currently active (failed) pending item to `error-items/`,
 * finalize task worktrees via §4.15 finalizeTaskWorktrees,
 * reset handoff artifacts, and auto-advance the queue.
 *
 * `taskId` is REQUIRED — the fallback directory enumeration has been deleted.
 * Callers must supply the failing task's ID directly.
 */
export async function moveFailedItemToErrorItems(options: {
  repoRoot?: string;
  taskId: string;
}): Promise<MoveFailedItemResult> {
  const root = options.repoRoot ?? findRepoRoot();
  const taskId = options.taskId;
  const queuePaths = resolveQueuePaths(root);

  const activeItem = `${taskId}.md`;
  const sourcePath = path.join(queuePaths.pendingDir, activeItem);
  await mkdir(queuePaths.errorItemsDir, { recursive: true });
  const destPath = path.join(queuePaths.errorItemsDir, activeItem);

  // F7: unconditional pipeline.lock removal BEFORE finalizeTaskWorktrees.
  // Stale locks would block re-activation if the same taskId is requeued with
  // retain_failed_task_worktrees=true.
  const taskRuntimePath = path.join(root, '.platform-state', 'runtime', 'tasks', taskId);
  await rm(path.join(taskRuntimePath, 'pipeline.lock'), { recursive: true, force: true }).catch(() => {});

  await commitTaskSnapshot(root, taskId, 'failed');

  // §4.15: finalize all worktrees for this task only. This also stamps
  // .task.json.state = "failed" and finalizedAt.
  await finalizeTaskWorktrees(taskId, 'failed', root);

  try {
    await rename(sourcePath, destPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw err;
    }
    // Backward-compatible recovery for tasks activated by the broken interim
    // implementation that removed pendingitems/<taskId>.md at activation time.
    // Preserve an operator-visible error item instead of letting failure
    // handling abort and leave stale active markers behind.
    let recoveredBody = '';
    try {
      recoveredBody = await readFile(
        path.join(queuePaths.taskHandoffs(taskId), 'professional-task.md'),
        'utf-8',
      );
    } catch {
      recoveredBody = `# ${taskId}\n\nOriginal pending item was missing during failure recovery.\n`;
    }
    recoveredBody = await restoreContextPackBindingForRecoveredItem(root, taskId, recoveredBody);
    await writeFile(
      destPath,
      `${recoveredBody.trimEnd()}\n\n---\n\nFailure recovery note: pendingitems/${activeItem} was already absent.\n`,
      'utf-8',
    );
  }

  // Transition active → failed in the task registry using .filter semantics.
  // §4.5 array-shaped active[]: findAndRemove uses splice (never blanket-clears peers).
  try { await transitionTask(root, taskId, 'active', 'failed'); } catch { /* best-effort */ }

  // Remove ONLY this task's marker — never the directory, never peer markers.
  try {
    await unlink(path.join(queuePaths.activeItemsDir, taskId));
  } catch {
    // Already cleared or missing — safe to continue
  }

  // Remove the moved item from the queue-order manifest; delete the file when empty
  try {
    const order = await readQueueOrderManifest(queuePaths.queueOrderPath);
    const filtered = order.filter((f) => f !== activeItem);
    if (filtered.length > 0) {
      await writeQueueOrderManifest(queuePaths.queueOrderPath, filtered);
    } else {
      await unlink(queuePaths.queueOrderPath);
    }
  } catch { /* best-effort */ }

  // Singleton-handoffs reset block DELETED (lines 260-262 in pre-§4.14A code).
  // Under the parallel model the per-task copy is at AgentWorkSpace/tasks/<taskId>/handoffs/
  // and is reaped by finalizeTaskWorktrees above. Touching the shared handoffs dir
  // here would be a blast-radius violation against peer tasks.

  let nextActiveItem: string | null = null;
  const activateResult = await activateNextPendingItemIfReady({
    paths: queuePaths,
    repoRoot: root,
  });
  if (activateResult.activated) {
    const newMarkers = getActiveTaskIds(queuePaths);
    nextActiveItem = newMarkers.length > 0 ? (newMarkers[0] ?? null) : null;
  }

  return {
    movedItem: activeItem,
    errorItemPath: destPath,
    nextActiveItem,
  };
}

// ---------------------------------------------------------------------------
// Requeue a failed item back to pending
// ---------------------------------------------------------------------------

/**
 * Move a failed item from `error-items/` back to `pendingitems/` and insert
 * it into the queue ordering manifest at the specified position.
 *
 * On requeue, derives a monotonic -retry<N> suffix to avoid branch collisions
 * when retain_failed_task_worktrees=true. The pending item file is renamed to
 * `<original-slug>-retry<N>.md` so that activation picks up the correct taskId
 * without needing an override parameter. Enforces max_retry_generations_per_slug.
 * Owns its queue mutation critical section internally.
 *
 * Retained-worktree disposal: once the rename succeeds and the queue lock is
 * released, the failed task's retained worktree, branch, parent dir, and
 * runtime state are discarded via `discardRetainedTaskWorktrees`. The failed
 * task's registry entry is also retired via `removeTask` — the new pending
 * file uses `<originalSlug>-retry<N>` (a different taskId), so the failed
 * entry would otherwise become an orphan. Operator intent to retry is the
 * signal that the forensic affordance of `retain_failed_task_worktrees=true`
 * is no longer needed for this task. The new retry task is materialized fresh
 * from `baseCommitSha` and registered under the new taskId at activation, so
 * the failed worktree and registry entry are never read after this point.
 */
export async function requeueErrorItem(options: {
  fileName: string;
  insertAtIndex: number;
  repoRoot?: string;
}): Promise<{ requeuedItem: string; activatedItem: string | null }> {
  const root = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(root);

  // Derive the original taskId from the filename.
  const requeuedTaskId = options.fileName.replace(/\.md$/, '');
  const originalSlug = requeuedTaskId.replace(/-retry\d+$/, '');

  await mkdir(queuePaths.pendingDir, { recursive: true });
  const release = await acquireDirLockOrThrow(queuePaths.queueLockDir, 'Requeue');
  let requeuedItem: string;
  try {
    const cfg = await getPlatformConfig(root);
    const n = await pickNextRetryN(requeuedTaskId, root);
    const cap = cfg.max_retry_generations_per_slug;

    if (n > cap) {
      // Collect the taken set for the error payload (pickNextRetryN computed it
      // internally; re-scan here to provide the structured payload).
      const sidecar = readTaskJsonSafe(requeuedTaskId, root);
      const takenSet = new Set<number>();
      if (sidecar) {
        for (const binding of sidecar.contextPackBinding.repoBindings) {
          try {
            const result = await execFileAsync('git', [
              '-C', binding.originalRoot, 'for-each-ref',
              '--format=%(refname:short)',
              `refs/heads/task/${originalSlug}-retry*`,
            ]);
            for (const line of result.stdout.split('\n')) {
              const m = line.match(/-retry(\d+)$/);
              if (m) takenSet.add(parseInt(m[1]!, 10));
            }
          } catch { /* swallow */ }
        }
      }
      throw Object.assign(
        new Error(
          `retry-generations-exhausted: slug="${originalSlug}" cap=${cap} foundGenerations=[${[...takenSet].sort((a, b) => a - b).join(',')}]`,
        ),
        {
          code: 'retry-generations-exhausted' as const,
          slug: originalSlug,
          cap,
          foundGenerations: [...takenSet].sort((a, b) => a - b),
        },
      );
    }

    // Derive the retry-suffixed filename so activation picks up the new taskId.
    const retryTaskId = `${originalSlug}-retry${n}`;
    const retryFileName = `${retryTaskId}.md`;

    const sourcePath = path.join(queuePaths.errorItemsDir, options.fileName);
    const destPath = path.join(queuePaths.pendingDir, retryFileName);

    await rename(sourcePath, destPath);

    // Retire the failed task's registry entry. The new pending file is
    // <originalSlug>-retry<N>.md (different taskId), and activation will
    // register the retry entry fresh. Transitioning the old entry to "pending"
    // would leave it as an orphan with no backing file — remove it instead.
    try { await removeTask(root, requeuedTaskId); } catch { /* best-effort */ }

    await insertIntoQueueManifest(queuePaths.pendingDir, retryFileName, options.insertAtIndex);
    requeuedItem = retryFileName;
  } finally {
    await release();
  }

  // Discard the retained worktree/branch/dirs for the now-superseded failed
  // task. Done OUTSIDE the queue lock: the lock guards manifest mutation, and
  // the failed task's IDs are already divorced from anything the queue cares
  // about. Best-effort — never throws.
  await discardRetainedTaskWorktrees(requeuedTaskId, root);

  // Singleton-handoffs reset block DELETED (lines 309-310 in pre-§4.14A code).
  // Touching the shared handoffs dir here is a blast-radius violation.

  let activatedItem: string | null = null;
  const activateResult2 = await activateNextPendingItemIfReady({
    paths: queuePaths,
    repoRoot: root,
  });
  if (activateResult2.activated) {
    const newMarkers = getActiveTaskIds(queuePaths);
    activatedItem = newMarkers.length > 0 ? (newMarkers[0] ?? null) : null;
  }

  return { requeuedItem, activatedItem };
}

/**
 * Move a failed task back to the dropbox (open) for operator review.
 *
 * Retained-worktree disposal: the dropbox round-trip path produces a brand-new
 * task ID via `queueNameForSource` (fresh timestamp prefix) when the operator
 * promotes the dropbox item again, so the failed task's worktree, branch, and
 * supporting dirs become permanent orphans the moment this rename succeeds.
 * Discard them now via `discardRetainedTaskWorktrees`, mirroring the requeue
 * behavior in `requeueErrorItem`.
 *
 * Registry transition: the failed entry is transitioned to "open" under the
 * SAME taskId/filename so the Task Board's registry-first reader surfaces the
 * dropbox file immediately. There is no auto-promotion path that would
 * re-register this entry on its own — `pollDropbox` only activates pending
 * items; dropbox→pending is operator-initiated. Without this transition the
 * file sits on disk in `dropbox/` with no registry record, invisible to the UI
 * until a process restart triggers `repairTaskRegistry`.
 *
 * Orphan-cleanup is handled by every downstream path that consumes the dropbox
 * file: `moveDropboxItemToPending` calls `removeTask(oldTaskId)` before
 * registering the fresh-timestamped entry, `deleteDropboxItem` calls
 * `removeTask(deletedTaskId)`, and `repairTaskRegistry` rebuilds from disk.
 */
export async function moveErrorItemToDropbox(options: {
  fileName: string;
  repoRoot?: string;
}): Promise<{ movedItem: string }> {
  const root = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(root);
  const sourcePath = path.join(queuePaths.errorItemsDir, options.fileName);
  const destPath = path.join(queuePaths.dropboxDir, options.fileName);

  await rename(sourcePath, destPath);

  const movedTaskId = options.fileName.replace(/\.md$/, '');
  // Transition failed → open so the Task Board surfaces the file in the open
  // column without waiting for a process restart. Downstream consumers
  // (moveDropboxItemToPending, deleteDropboxItem) clean up this entry under
  // the old taskId before registering anything new.
  try {
    await transitionTask(root, movedTaskId, 'failed', 'open');
  } catch { /* best-effort */ }

  // Discard retained worktree/branch/dirs for the failed task. The dropbox
  // re-intake will materialize a fresh task ID + worktree, so the failed
  // task's state is now an orphan. Best-effort — never throws.
  await discardRetainedTaskWorktrees(movedTaskId, root);

  return { movedItem: options.fileName };
}
