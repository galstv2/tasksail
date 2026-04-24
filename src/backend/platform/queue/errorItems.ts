import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { rename, unlink, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { activeItemPath, resolveQueuePaths } from './paths.js';
import { findRepoRoot } from '../core/index.js';
import {
  activateNextPendingItemIfReady,
  getActiveTaskIds,
  insertIntoQueueManifest,
  readQueueOrderManifest,
  writeQueueOrderManifest,
} from './operations.js';
import { transitionTask } from './taskRegistry.js';
import { readTaskJson, readTaskJsonSafe } from './taskJson.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';
import { release as releasePort } from '../container/portAllocator.js';
import { getPlatformConfig } from '../platform-config/get.js';

const execFileAsync = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Git helpers (retained for commitTaskSnapshot worktree commits)
// ---------------------------------------------------------------------------

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
        reject(new Error(`git ${args.join(' ')} failed in ${repoRoot} with exit ${code ?? 1}: ${details}`));
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

      const label = outcome === 'completed' ? 'completed' : 'pipeline failed';
      try {
        await runGit(binding.worktreeRoot, [
          'commit',
          '-m', `[tasksail] ${taskId}: ${label}`,
          '--no-verify',
        ]);
      } catch {
        // Nothing staged — git commit exits non-zero on empty tree. Skip.
        continue;
      }
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
 * finalize task worktrees via §4.15 finalizeTaskWorktrees, release port lease,
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

  // §4.15 + §6.3B: finalize all worktrees and run teardown ordering
  // (worktree → composeDownTask → portRelease → gcTaskRuntime) for this task
  // only. This also stamps .task.json.state = "failed" and finalizedAt.
  await finalizeTaskWorktrees(taskId, 'failed', root);

  // Defense-in-depth: explicit port release. finalizeTaskWorktrees owns the
  // canonical teardown ordering in production, but this guards test paths that
  // mock finalize and workflow paths where finalize is a no-op for missing
  // worktrees. releasePort is idempotent — a no-op when the row is absent.
  try { await releasePort(taskId, root); } catch { /* best-effort */ }

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
  try {
    const legacyActive = await readFile(activeItemPath(queuePaths.pendingDir), 'utf-8');
    if (legacyActive.trim() === activeItem) {
      await unlink(activeItemPath(queuePaths.pendingDir));
    }
  } catch {
    // Legacy singleton absent or owned by another active task.
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
 * MUST be called under the queue lock (the caller's activation critical section).
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

  // Determine the retry-suffix for the new activation.
  // Scan MUST run under the queue lock (enforced by caller's critical section).
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

  // Transition failed → pending in the task registry under the new taskId.
  // The original failed entry lives under requeuedTaskId; the new pending entry
  // uses retryTaskId. Transition the original failed entry to pending first, then
  // update its taskId in the registry via a remove+re-register is unnecessary —
  // the existing transitionTask call suffices for the old entry; the new activation
  // will register the retryTaskId entry when it runs.
  try { await transitionTask(root, requeuedTaskId, 'failed', 'pending'); } catch { /* best-effort */ }

  await insertIntoQueueManifest(queuePaths.pendingDir, retryFileName, options.insertAtIndex);

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

  return { requeuedItem: retryFileName, activatedItem };
}

/**
 * Move a failed task back to the dropbox (open) for operator review.
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
  try { await transitionTask(root, movedTaskId, 'failed', 'open'); } catch { /* best-effort */ }

  return { movedItem: options.fileName };
}
