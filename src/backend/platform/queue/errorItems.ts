import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, rename, unlink, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveFocusedRepoRoot } from '../context-pack/focusedRepo.js';
import { resolveQueuePaths, HANDOFF_FILES } from './paths.js';
import { findRepoRoot } from '../core/index.js';
import { resetHandoffArtifacts } from './lifecycle.js';
import {
  activateNextPendingItemIfReady,
  insertIntoQueueManifest,
  readQueueOrderManifest,
  writeQueueOrderManifest,
} from './operations.js';
import { transitionTask } from './taskRegistry.js';

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

const PLATFORM_RESTORE_EXCLUDES = [
  'AgentWorkSpace/dropbox',
  'AgentWorkSpace/dropbox/**',
  'AgentWorkSpace/pendingitems',
  'AgentWorkSpace/pendingitems/**',
  'AgentWorkSpace/error-items',
  'AgentWorkSpace/error-items/**',
  'AgentWorkSpace/handoffs',
  'AgentWorkSpace/handoffs/**',
  'AgentWorkSpace/ImplementationSteps',
  'AgentWorkSpace/ImplementationSteps/**',
  '.platform-state/runtime',
  '.platform-state/runtime/**',
] as const;

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

function buildPathspecArgs(excludes: readonly string[]): string[] {
  return ['--', '.', ...excludes.map((entry) => `:(exclude)${entry}`)];
}

function excludeRoot(pattern: string): string {
  return pattern.replace(/\/\*\*$/, '').replace(/\/$/, '');
}

function isExcludedPath(relPath: string, excludes: readonly string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/$/, '');
  return excludes.some((pattern) => {
    const base = excludeRoot(pattern);
    return normalized === base || normalized.startsWith(`${base}/`);
  });
}

// ---------------------------------------------------------------------------
// Working tree restore
// ---------------------------------------------------------------------------

/**
 * Restore all repos visible to the active context pack to a clean HEAD state.
 * Best-effort: logs warnings on failure rather than throwing.
 */
export async function restoreWorkingTree(
  repoRoot: string,
  contextPackDir?: string,
): Promise<void> {
  const roots = await resolveRepoRoots(repoRoot, contextPackDir);
  for (const root of roots) {
    const isMainRepo = realpathSync(root) === realpathSync(repoRoot);
    const excludes = isMainRepo ? [...PLATFORM_RESTORE_EXCLUDES] : [];

    await runGit(root, [
      'restore', '--source', 'HEAD', '--staged', '--worktree',
      ...buildPathspecArgs(excludes),
    ]);

    const untracked = await runGit(root, [
      'ls-files', '--others', '--exclude-standard', '--directory', '-z',
    ]);
    const toRemove = untracked.stdout.split('\0').filter(Boolean)
      .map((e) => e.replace(/\/$/, ''))
      .filter((rel) => rel && !isExcludedPath(rel, excludes))
      .map((rel) => rm(path.join(root, rel), { recursive: true, force: true }));
    await Promise.all(toRemove);
  }
}

async function resolveRepoRoots(
  repoRoot: string,
  contextPackDir?: string,
): Promise<string[]> {
  if (!contextPackDir) return [];
  const focused = await resolveFocusedRepoRoot(contextPackDir, repoRoot);
  return [...new Set((focused?.visibleRepoRoots ?? []).map((r) => realpathSync(r)))];
}

// ---------------------------------------------------------------------------
// Programmatic task snapshot commit
// ---------------------------------------------------------------------------

/**
 * Commit all agent work to a local git snapshot before cleaning the worktree.
 *
 * When `resetHead` is true (failure path), HEAD is moved back after the commit
 * so that a subsequent `restoreWorkingTree()` restores to the pre-agent state.
 * The snapshot commit remains reachable via `git reflog`.
 *
 * When `resetHead` is false (success path), the commit stays as HEAD — no
 * worktree restore follows on the success path.
 *
 * Best-effort: returns false on failure instead of throwing.
 */
export async function commitTaskSnapshot(
  repoRoot: string,
  taskId: string,
  outcome: 'completed' | 'failed',
  contextPackDir?: string,
): Promise<boolean> {
  const resetHead = outcome === 'failed';
  const roots = await resolveRepoRoots(repoRoot, contextPackDir);
  if (roots.length === 0) {
    return true;
  }

  for (const root of roots) {
    try {
      await runGit(root, ['add', '-A']);

      const label = outcome === 'completed' ? 'completed' : 'pipeline failed';
      try {
        await runGit(root, [
          'commit',
          '-m', `[tasksail] ${taskId}: ${label}`,
          '--no-verify',
        ]);
      } catch {
        // Nothing staged — git commit exits non-zero on empty tree. Skip.
        continue;
      }

      if (resetHead) {
        await runGit(root, ['reset', '--soft', 'HEAD~1']);
      }
    } catch (err) {
      process.stderr.write(
        `Warning: task snapshot commit failed in ${root}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return false;
    }
  }

  return true;
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
 * restore the git working tree to HEAD, reset handoff artifacts,
 * and auto-advance the queue.
 */
export async function moveFailedItemToErrorItems(options: {
  repoRoot?: string;
  contextPackDir?: string;
  taskId?: string;
}): Promise<MoveFailedItemResult> {
  const root = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(root);

  let activeItem: string;
  try {
    activeItem = (await readFile(queuePaths.activeItemLink, 'utf-8')).trim();
  } catch {
    throw new Error('No active item to move to error-items.');
  }
  if (!activeItem) {
    throw new Error('No active item to move to error-items.');
  }

  const taskId = activeItem.replace(/\.md$/, '');
  const sourcePath = path.join(queuePaths.pendingDir, activeItem);
  await mkdir(queuePaths.errorItemsDir, { recursive: true });
  const destPath = path.join(queuePaths.errorItemsDir, activeItem);

  await commitTaskSnapshot(root, taskId, 'failed', options.contextPackDir);
  await rename(sourcePath, destPath);

  // Transition active → failed in the task registry
  try { await transitionTask(root, taskId, 'active', 'failed'); } catch { /* best-effort */ }

  try {
    await unlink(queuePaths.activeItemLink);
  } catch {
    // Already cleared or missing — safe to continue
  }

  // Clean up task-bound context pack sidecar (mirrors completeActiveItem)
  try {
    await unlink(queuePaths.activeContextPackPath);
  } catch { /* absent for legacy tasks */ }

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

  try {
    await restoreWorkingTree(root, options.contextPackDir);
  } catch (err) {
    process.stderr.write(
      `Warning: git working tree restore failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  await resetHandoffArtifacts(queuePaths.handoffsDir, HANDOFF_FILES, {
    implementationStepsDir: path.join(root, 'AgentWorkSpace', 'ImplementationSteps'),
  });

  let nextActiveItem: string | null = null;
  const activated = await activateNextPendingItemIfReady(
    queuePaths.pendingDir,
    queuePaths.handoffsDir,
    queuePaths.templatesDir,
  );
  if (activated) {
    try {
      nextActiveItem = (await readFile(queuePaths.activeItemLink, 'utf-8')).trim() || null;
    } catch {
      // Could not read — leave null
    }
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
 */
export async function requeueErrorItem(options: {
  fileName: string;
  insertAtIndex: number;
  repoRoot?: string;
}): Promise<{ requeuedItem: string; activatedItem: string | null }> {
  const root = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(root);
  const sourcePath = path.join(queuePaths.errorItemsDir, options.fileName);
  const destPath = path.join(queuePaths.pendingDir, options.fileName);

  await rename(sourcePath, destPath);

  // Transition failed → pending in the task registry
  const requeuedTaskId = options.fileName.replace(/\.md$/, '');
  try { await transitionTask(root, requeuedTaskId, 'failed', 'pending'); } catch { /* best-effort */ }

  await insertIntoQueueManifest(queuePaths.pendingDir, options.fileName, options.insertAtIndex);

  // Reset the workspace first; runtime receipts now persist until the next
  // task activation succeeds so operators can still inspect the failed run.
  await resetHandoffArtifacts(queuePaths.handoffsDir, HANDOFF_FILES, {
  });

  let activatedItem: string | null = null;
  const activated = await activateNextPendingItemIfReady(
    queuePaths.pendingDir,
    queuePaths.handoffsDir,
    queuePaths.templatesDir,
  );
  if (activated) {
    try {
      activatedItem = (await readFile(queuePaths.activeItemLink, 'utf-8')).trim() || null;
    } catch {
      // Could not read — leave null
    }
  }

  return { requeuedItem: options.fileName, activatedItem };
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
