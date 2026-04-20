import path from 'node:path';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { mkdir, rmdir, readdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { moveFile, readTextFile, writeTextFile, ensureDir, findRepoRoot } from '../core/index.js';
import { withOriginLock, materializeWorktreeDeps, preconditionsPass } from '../core/worktreeMaterialization.js';
import { resolveFocusedRepoRoot } from '../context-pack/focusedRepo.js';
import { resolveTaskMaterializationConfig } from '../context-pack/types.js';
import { activeItemPath, deriveQueueStatePaths, resolveQueuePaths, HANDOFF_FILES } from './paths.js';
import type { QueuePaths } from './paths.js';
import {
  handoffWorkspaceIsReady,
  resetHandoffArtifacts,
  initializeTaskArtifacts,
  clearRuntimeReceipts,
} from './lifecycle.js';
import { syncRetrospectiveRequiredMetadata } from './retrospectiveFlag.js';
import { extractTaskTitle, extractLineageValue, extractContextPackBinding } from './markdown.js';
import { registerTask, removeTask, transitionTask } from './taskRegistry.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { startPipeline } from '../agent-runner/pipelineSupervisor.js';
import { allocate as allocatePort, release as releasePort } from '../container/portAllocator.js';
import { composeProjectName } from '../container/containerNaming.js';
import { runMergeDetectionSweep } from './mergeDetectionSweep.js';

const execFileAsync = promisify(execFile);

/**
 * Acquire a directory-based lock using mkdir atomicity.
 * Returns a release function on success, or null if the lock could not be acquired.
 */
export async function acquireDirLock(
  lockDir: string,
  maxRetries = 30,
  backoffMs = 50,
): Promise<(() => Promise<void>) | null> {
  let waitMs = backoffMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await mkdir(lockDir);
      return async () => {
        try {
          await rmdir(lockDir);
        } catch {
          // Lock dir may already be removed
        }
      };
    } catch {
      // Expected: lock held by another process
    }

    await sleep(waitMs);
    waitMs = Math.min(waitMs * 2, 2000);
  }

  return null;
}

/**
 * Acquire the queue lock or throw. Convenience wrapper for callers that
 * must hold the lock and should fail loudly if it is unavailable.
 */
export async function acquireDirLockOrThrow(
  lockDir: string,
  operationName: string,
): Promise<() => Promise<void>> {
  const release = await acquireDirLock(lockDir);
  if (!release) {
    throw new Error(
      `${operationName} blocked: could not acquire queue lock. Another operation may be in progress.`,
    );
  }
  return release;
}

/**
 * Return the task IDs of all currently active tasks.
 * Reads `.active-items/<taskId>` markers, filtering out `.completing` sentinels
 * per §4.1 marker-dir contract. Sentinels are bookkeeping and MUST NOT be
 * counted by the activation cap guard.
 */
export function getActiveTaskIds(paths: QueuePaths): string[] {
  try {
    return readdirSync(paths.activeItemsDir).filter(
      (f) => !f.endsWith('.completing'),
    );
  } catch {
    return [];
  }
}

/**
 * Return true if at least one active task marker exists in `.active-items/`.
 * Applies the same `.completing` sentinel filter as `getActiveTaskIds`.
 */
export function hasAnyActiveTask(paths: QueuePaths): boolean {
  return getActiveTaskIds(paths).length > 0;
}

/**
 * Read the queue ordering manifest. Returns an empty array if absent or corrupt.
 */
export async function readQueueOrderManifest(
  manifestPath: string,
): Promise<string[]> {
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as { order?: string[] };
    return Array.isArray(manifest.order) ? manifest.order : [];
  } catch {
    return [];
  }
}

/**
 * Write the queue ordering manifest.
 */
export async function writeQueueOrderManifest(
  queueOrderPath: string,
  order: string[],
): Promise<void> {
  await ensureDir(path.dirname(queueOrderPath));
  await writeTextFile(queueOrderPath, JSON.stringify({ order }, null, 2) + '\n');
}

/**
 * Insert a file into the queue-order manifest at a given index, reconciling
 * the manifest with the actual .md files on disk. Removes stale entries,
 * appends untracked files, and writes the updated manifest.
 *
 * Shared by moveDropboxItemToPending and requeueErrorItem.
 */
export async function insertIntoQueueManifest(
  pendingDir: string,
  fileName: string,
  insertAtIndex: number,
  queueOrderPath?: string,
): Promise<void> {
  const resolvedPath = queueOrderPath
    ?? deriveQueueStatePaths(pendingDir).queueOrderPath;
  const currentFiles = (await readdir(pendingDir))
    .filter((e) => e.endsWith('.md') && !e.startsWith('.'))
    .sort();

  const manifest = await readQueueOrderManifest(resolvedPath);
  const tracked = new Set(manifest);
  const reconciled = manifest.filter((f) => currentFiles.includes(f));
  for (const f of currentFiles) {
    if (!tracked.has(f) && f !== fileName) reconciled.push(f);
  }
  const filtered = reconciled.filter((f) => f !== fileName);
  const idx = Math.max(0, Math.min(insertAtIndex, filtered.length));
  filtered.splice(idx, 0, fileName);
  await writeQueueOrderManifest(resolvedPath, filtered);
}

/**
 * Get the path to the next pending item to activate.
 * Uses queue-order.json manifest when present, falls back to alphabetical.
 * Skips any task IDs in the `skipTaskIds` set (already active tasks).
 */
export async function nextPendingItemPath(
  pendingDir: string,
  queueOrderPath?: string,
  skipTaskIds?: ReadonlySet<string>,
): Promise<string | null> {
  const resolvedPath = queueOrderPath
    ?? deriveQueueStatePaths(pendingDir).queueOrderPath;
  const entries = await readdir(pendingDir);
  const mdFiles = entries
    .filter((e) => {
      if (!e.endsWith('.md') || e.startsWith('.')) return false;
      if (skipTaskIds && skipTaskIds.has(e.replace(/\.md$/, ''))) return false;
      return true;
    })
    .sort();

  if (mdFiles.length === 0) return null;

  const manifest = await readQueueOrderManifest(resolvedPath);
  if (manifest.length > 0) {
    const mdSet = new Set(mdFiles);
    for (const name of manifest) {
      if (mdSet.has(name)) {
        return path.join(pendingDir, name);
      }
    }
  }

  return path.join(pendingDir, mdFiles[0]);
}

/**
 * Pattern matching the compact ISO-8601 timestamp prefix added by this
 * module (e.g., `20260330T070710Z_` or `20260330T070710Z-`). Used to strip stale prefixes so
 * that round-tripping between open and pending doesn't accumulate them.
 */
const QUEUE_TIMESTAMP_PREFIX_RE = /^\d{8}T\d{6}Z[-_]/;

/**
 * Generate a timestamped queue name for a source file.
 * Strips any existing timestamp prefix first so round-tripping between
 * dropbox and pending doesn't accumulate multiple prefixes.
 */
export function queueNameForSource(sourceFile: string): string {
  const baseName = path.basename(sourceFile).replace(QUEUE_TIMESTAMP_PREFIX_RE, '');
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${ts}_${baseName}`;
}

/**
 * Move .md files from the dropbox directory into the pending directory.
 * Non-markdown files are ignored with a warning.
 * Returns the number of files moved.
 */
export async function moveDropboxItemsOnce(
  dropboxDir: string,
  pendingDir: string,
): Promise<number> {
  await ensureDir(pendingDir);
  const entries = await readdir(dropboxDir);
  let moved = 0;

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const sourcePath = path.join(dropboxDir, entry);

    if (!entry.endsWith('.md')) continue;

    let targetName = queueNameForSource(sourcePath);
    let targetPath = path.join(pendingDir, targetName);

    // Avoid collisions
    let suffix = 1;
    while (existsSync(targetPath)) {
      targetPath = path.join(
        pendingDir,
        `${targetName.replace(/\.md$/, '')}-${suffix}.md`,
      );
      suffix++;
    }

    await moveFile(sourcePath, targetPath);

    // Register the task in the centralized registry.
    const finalFileName = path.basename(targetPath);
    const repoRoot = path.resolve(pendingDir, '..', '..');
    try {
      const head = await readTextFile(targetPath);
      const title = head ? extractTaskTitle(head) || null : null;
      const binding = head ? extractContextPackBinding(head) : null;
      await registerTask(repoRoot, {
        taskId: finalFileName.replace(/\.md$/, ''),
        fileName: finalFileName,
        title,
        state: 'pending',
        contextPackId: binding?.contextPackId ?? null,
        contextPackDir: binding?.contextPackDir ?? null,
        scopeMode: binding?.scopeMode ?? null,
        selectedRepoIds: binding?.selectedRepoIds ?? [],
        selectedFocusIds: binding?.selectedFocusIds ?? [],
        deepFocusEnabled: binding?.deepFocusEnabled,
        selectedFocusPath: binding?.selectedFocusPath,
        selectedFocusTargetKind: binding?.selectedFocusTargetKind,
        selectedTestTarget: binding?.selectedTestTarget,
        selectedSupportTargets: binding?.selectedSupportTargets,
        createdAt: new Date().toISOString(),
        completedAt: null,
        archivePath: null,
      });
    } catch {
      // Registry update is best-effort — file move is the authoritative operation
    }

    moved++;
  }

  return moved;
}

/**
 * Move a single named file from dropbox to pendingitems, register it in the
 * task registry, update the queue-order manifest, and attempt immediate
 * activation if no active item exists.
 *
 * @precondition Caller must hold the queue mutation lock (e.g., via
 * `withQueueMutationLock` in the Electron main process).
 */
export async function moveDropboxItemToPending(options: {
  fileName: string;
  insertAtIndex: number;
  repoRoot?: string;
}): Promise<{ movedItem: string; activatedItem: string | null }> {
  const root = options.repoRoot ?? findRepoRoot();
  const queuePaths = resolveQueuePaths(root);

  const base = path.basename(options.fileName);
  if (!base.endsWith('.md') || base.startsWith('.')) {
    throw new Error('Move to pending blocked: file must be a visible .md file.');
  }

  const sourcePath = path.join(queuePaths.dropboxDir, base);

  // Generate timestamped name with collision avoidance
  const targetName = queueNameForSource(sourcePath);
  let targetPath = path.join(queuePaths.pendingDir, targetName);
  let suffix = 1;
  while (existsSync(targetPath)) {
    targetPath = path.join(
      queuePaths.pendingDir,
      `${targetName.replace(/\.md$/, '')}-${suffix}.md`,
    );
    suffix++;
  }

  await moveFile(sourcePath, targetPath);

  const finalFileName = path.basename(targetPath);
  const oldTaskId = base.replace(/\.md$/, '');

  // Clear stale registry entry from prior repair (may not exist)
  await removeTask(root, oldTaskId).catch(() => {});

  try {
    const head = await readTextFile(targetPath);
    const title = head ? extractTaskTitle(head) || null : null;
    const binding = head ? extractContextPackBinding(head) : null;
    await registerTask(root, {
      taskId: finalFileName.replace(/\.md$/, ''),
      fileName: finalFileName,
      title,
      state: 'pending',
      contextPackId: binding?.contextPackId ?? null,
      contextPackDir: binding?.contextPackDir ?? null,
      scopeMode: binding?.scopeMode ?? null,
      selectedRepoIds: binding?.selectedRepoIds ?? [],
      selectedFocusIds: binding?.selectedFocusIds ?? [],
      deepFocusEnabled: binding?.deepFocusEnabled,
      selectedFocusPath: binding?.selectedFocusPath,
      selectedFocusTargetKind: binding?.selectedFocusTargetKind,
      selectedTestTarget: binding?.selectedTestTarget,
      selectedSupportTargets: binding?.selectedSupportTargets,
      createdAt: new Date().toISOString(),
      completedAt: null,
      archivePath: null,
    });
  } catch {
    // Registry update is best-effort — file move is authoritative
  }

  await insertIntoQueueManifest(queuePaths.pendingDir, finalFileName, options.insertAtIndex);

  let activatedItem: string | null = null;
  const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot: root });
  if (result.activated) {
    // Read newly activated item from .active-items/ directory
    const markers = getActiveTaskIds(queuePaths);
    activatedItem = markers.length > 0 ? (markers[0] as string) : null;
  }

  return { movedItem: finalFileName, activatedItem };
}

export interface ActivateNextPendingItemOptions {
  paths: QueuePaths;
  repoRoot: string;
  /** Optional context pack dir override (used by legacy callers that resolve it externally). */
  contextPackDir?: string;
}

export interface ActivateNextPendingItemResult {
  activated: boolean;
  reason?: string;
}

/**
 * Activate the next pending item if the workspace is ready and the concurrency
 * cap has not been reached. One-shot per call: activates at most one item.
 *
 * Returns `{ activated: true }` on success.
 * Returns `{ activated: false, reason: 'concurrency-cap-reached' }` when the
 *   number of active tasks equals `max_parallel_tasks` from platform config.
 * Returns `{ activated: false }` when there are no pending items or the
 *   workspace is not ready.
 */
export async function activateNextPendingItemIfReady(
  options: ActivateNextPendingItemOptions,
): Promise<ActivateNextPendingItemResult> {
  const { paths, repoRoot, contextPackDir } = options;
  const { pendingDir, templatesDir } = paths;

  // §B7-sweep: detect merged task branches before scheduling new work.
  // Cheap (≤2 git plumbing calls per binding), bounded by # completed-not-yet-
  // merged tasks. Always best-effort — sweep failures must NEVER block queue
  // activation.
  try {
    const sweep = await runMergeDetectionSweep(repoRoot);
    if (sweep.tasksCleanedUp > 0) {
      process.stderr.write(
        `[mergeDetectionSweep] cleaned ${sweep.tasksCleanedUp} merged task(s); ` +
        `${sweep.bindingsMarked} bindings newly stamped\n`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mergeDetectionSweep] sweep failed (non-fatal): ${msg}\n`);
  }

  // §4.2 cap check: compare active task count against platform config limit.
  let cap = 1;
  try {
    const config = await getPlatformConfig(repoRoot);
    cap = config.max_parallel_tasks;
  } catch {
    // Platform config absent (e.g., bare tmpdir in tests) — default to 1.
    cap = 1;
  }

  const currentActive = getActiveTaskIds(paths);
  if (currentActive.length >= cap) {
    return { activated: false, reason: 'concurrency-cap-reached' };
  }

  // Skip already-active task IDs so parallel activations pick the next
  // unstarted pending item rather than re-selecting the already-active one.
  const activeSet = new Set(currentActive);
  const nextItem = await nextPendingItemPath(pendingDir, undefined, activeSet);
  if (!nextItem) return { activated: false };

  // Resolve per-task paths early so readiness check uses the task-specific dir.
  // Per-task handoffs live at AgentWorkSpace/tasks/<taskId>/handoffs/ (§4.2).
  // They are always "ready" (empty) for a new task since the directory won't exist yet.
  const taskId = path.basename(nextItem, '.md');
  const taskHandoffsDir = paths.taskHandoffs(taskId);
  const taskImplStepsDir = paths.taskImplementationSteps(taskId);

  const isReady = await handoffWorkspaceIsReady(
    taskHandoffsDir,
    templatesDir,
  );
  if (!isReady) return { activated: false };

  // Read the queue item and initialize handoffs from it
  const content = await readTextFile(nextItem);
  if (content === undefined) return { activated: false };

  const taskTitle = extractTaskTitle(content) || path.basename(nextItem, '.md');
  const queueName = path.basename(nextItem);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const taskKind = extractLineageValue(content, 'Task Kind') || 'standard';
  const parentTaskId = extractLineageValue(content, 'Parent Task ID');
  const rootTaskId = extractLineageValue(content, 'Root Task ID');
  const parentQmdRecordId = extractLineageValue(content, 'Parent QMD Record ID');
  const parentQmdScope = extractLineageValue(content, 'Parent QMD Scope');
  const followupReason = extractLineageValue(content, 'Follow-Up Reason');
  const contextPackBinding = extractContextPackBinding(content);

  const metadata: Record<string, string> = {
    'Task ID': taskId,
    'Task Title': taskTitle,
    'Initialized At (UTC)': now,
    'Active Branch': 'unknown',
    'Intake Source': `AgentWorkSpace/pendingitems/${queueName}`,
  };

  const lineage: Record<string, string> = {
    'Task Kind': taskKind,
    'Parent Task ID': parentTaskId,
    'Root Task ID': rootTaskId,
    'Parent QMD Record ID': parentQmdRecordId,
    'Parent QMD Scope': parentQmdScope,
    'Follow-Up Reason': followupReason,
  };

  const sections: Record<string, string> = {};

  // Claim first — write .active-item before populating handoffs
  const linkPath = activeItemPath(pendingDir);
  await writeFile(linkPath, queueName, 'utf-8');

  // Write the per-task active marker into .active-items/<taskId>
  await ensureDir(paths.activeItemsDir);
  const activeMarkerPath = path.join(paths.activeItemsDir, taskId);
  await writeFile(activeMarkerPath, queueName, 'utf-8');

  // Transition task from pending → active in the registry
  try {
    await transitionTask(repoRoot, taskId, 'pending', 'active');
  } catch { /* best-effort */ }

  // Write the task-bound context pack sidecar so the pipeline can read
  // the correct context pack without re-parsing the task markdown.
  const contextPackSidecarPath = deriveQueueStatePaths(pendingDir).activeContextPackPath;
  if (contextPackBinding) {
    await ensureDir(path.dirname(contextPackSidecarPath));
    await writeFile(
      contextPackSidecarPath,
      JSON.stringify(contextPackBinding, null, 2) + '\n',
      'utf-8',
    );
  }

  // Lock precedence: 1 (queue lock; sidecar write is part of activation critical section)
  // §4.14 — Worktree + dependency materialization.
  // For every visible repo root in the activating context pack: run `git worktree add`,
  // CoW-clone dependency directories, and write real worktreeRoot into .task.json.
  // MUST happen AFTER activation lock is acquired and BEFORE pipelineSupervisor.startPipeline.

  const perTaskSidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
  await ensureDir(path.dirname(perTaskSidecarPath));

  // Resolve the set of repo roots to materialize worktrees for.
  // If a context pack is present, iterate its visibleRepoRoots.
  // Otherwise fall back to a single-entry list using the platform repo root.
  let visibleRepoRoots: string[] = [];
  const cpDir = contextPackBinding?.contextPackDir ?? contextPackDir;
  if (cpDir) {
    try {
      const focused = await resolveFocusedRepoRoot(cpDir, repoRoot);
      visibleRepoRoots = focused?.visibleRepoRoots ?? [];
    } catch {
      // Context pack may not have a full manifest (e.g. bootstrap mode) — fall through.
    }
  }
  if (visibleRepoRoots.length === 0) {
    visibleRepoRoots = [repoRoot];
  }

  // Determine paths to clone from the context pack's taskMaterialization field.
  // Defaults to DEFAULT_TASK_MATERIALIZATION_PATHS when field is absent.
  const pathsToClone = resolveTaskMaterializationConfig(undefined).paths;

  // Compute per-repo slugs.  Slug = basename(realpath(root)); if two roots share a
  // basename, append `-<sha8>` suffix (sha8 = first 8 chars of git rev-parse HEAD).
  const basenames = visibleRepoRoots.map((r) => {
    try { return path.basename(realpathSync(r)); } catch { return path.basename(r); }
  });
  const basenameCount: Record<string, number> = {};
  for (const b of basenames) {
    basenameCount[b] = (basenameCount[b] ?? 0) + 1;
  }

  // Build per-repo binding entries (originalRoot, worktreeRoot, worktreeBranch, baseCommitSha).
  const repoBindings: Array<{
    originalRoot: string;
    worktreeRoot: string;
    worktreeBranch: string;
    baseCommitSha: string;
  }> = [];
  let combinedMat: { strategy: string; cloned: string[]; skipped: string[] } = {
    strategy: 'copy',
    cloned: [],
    skipped: [],
  };

  for (let i = 0; i < visibleRepoRoots.length; i++) {
    const originalRoot = visibleRepoRoots[i]!;
    const base = basenames[i]!;

    // Resolve base commit SHA.
    let baseCommitSha = '';
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: originalRoot });
      baseCommitSha = stdout.trim();
    } catch {
      // Non-git or bare tmpdir in tests — leave empty.
    }

    // Compute repoSlug: add sha8 suffix only when two origins share a basename.
    let repoSlug = base;
    if ((basenameCount[base] ?? 0) > 1) {
      const sha8 = baseCommitSha.length >= 8 ? baseCommitSha.slice(0, 8) : (baseCommitSha || 'unknown');
      repoSlug = `${base}-${sha8}`;
    }

    const worktreePath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', repoSlug);
    const worktreeBranch = `task/${taskId}`;

    // Check preconditions before git worktree add.
    // Skip worktree creation when repo has no commits (e.g. bare tmpdir in tests).
    const pre = await preconditionsPass(originalRoot, taskId, worktreePath);
    if (!pre.ok) {
      if (pre.reason === 'empty-origin-repo') {
        // Non-git root or empty repo — fall back to using originalRoot as the worktreeRoot
        // (L0 compatibility for contexts without git).
        repoBindings.push({
          originalRoot,
          worktreeRoot: originalRoot,
          worktreeBranch: worktreeBranch,
          baseCommitSha,
        });
        continue;
      }
      // branch-already-exists or worktree-already-bound — fail activation.
      throw new Error(`activation-precondition-failed: ${pre.reason}: ${pre.detail ?? ''}`);
    }

    // Run git worktree add + CoW clone inside the per-origin async lock.
    // CRITICAL: MUST be wrapped in withOriginLock to serialise concurrent activations
    // that share the same origin repo.
    const mat = await withOriginLock(originalRoot, async () => {
      await execFileAsync('git', [
        '-C', originalRoot,
        'worktree', 'add',
        '-b', worktreeBranch,
        worktreePath,
        baseCommitSha,
      ]);
      try {
        const result = await materializeWorktreeDeps(originalRoot, worktreePath, pathsToClone);
        return result;
      } catch (cloneErr) {
        // §4.14 atomic rollback — 5 steps, in order, each swallows its own errors.
        // Step 1: git worktree remove --force (detach admin record before branch delete)
        await execFileAsync('git', ['-C', originalRoot, 'worktree', 'remove', '--force', worktreePath]).catch(() => {});
        // Step 2: git branch -D (remove task/<taskId> from refs)
        await execFileAsync('git', ['-C', originalRoot, 'branch', '-D', worktreeBranch]).catch(() => {});
        // Step 3: fs.rm AgentWorkSpace/tasks/<taskId>/ (reclaim disk; critical on ENOSPC)
        await rm(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId), { recursive: true, force: true }).catch(() => {});
        // Step 4: portAllocator.release(taskId). Idempotent silent no-op if no
        // allocation exists (the rollback fires before allocate() runs, so this
        // is the expected case). repoRoot (NOT originalRoot) because the
        // allocation table lives under the platform-state dir.
        await releasePort(taskId, repoRoot);
        // Step 5: unlink .active-items/<taskId> — marker may not yet exist; swallow errors.
        await unlink(path.join(paths.activeItemsDir, taskId)).catch(() => {});
        throw cloneErr;
      }
    });

    combinedMat = {
      strategy: mat.strategy,
      cloned: [...combinedMat.cloned, ...mat.cloned],
      skipped: [...combinedMat.skipped, ...mat.skipped],
    };

    repoBindings.push({
      originalRoot,
      worktreeRoot: worktreePath,
      worktreeBranch: worktreeBranch,
      baseCommitSha,
    });
  }

  const perTaskSidecar = {
    schema_version: 1,
    taskId,
    contextPackBinding: {
      contextPackPath: contextPackBinding?.contextPackDir
        ? path.join(contextPackBinding.contextPackDir, 'context-pack.json')
        : null,
      dataHostDir: process.env['REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR'] ?? null,
      dataContainerDir: process.env['REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR'] ?? null,
      repoBindings,
    },
    materialization: {
      strategy: combinedMat.strategy,
      cloned: combinedMat.cloned,
      skipped: combinedMat.skipped,
      composeProjectName: composeProjectName(taskId),
    },
    frozenAt: new Date().toISOString(),
    finalizedAt: null,
    state: 'active',
  };

  await writeFile(
    perTaskSidecarPath,
    JSON.stringify(perTaskSidecar, null, 2) + '\n',
    'utf-8',
  );

  try {
    await initializeTaskArtifacts({
      handoffsDir: taskHandoffsDir,
      templatesDir,
      metadata,
      lineage,
      sections,
      implementationStepsDir: taskImplStepsDir,
    });
    await syncRetrospectiveRequiredMetadata({
      repoRoot: path.resolve(taskHandoffsDir, '..', '..', '..'),
      handoffsDir: taskHandoffsDir,
      contextPackDir: contextPackBinding?.contextPackDir ?? contextPackDir,
    });
    await clearRuntimeReceipts(repoRoot, taskId);
  } catch (err) {
    // Roll back the claim and sidecars so queue returns to idle
    try { await unlink(linkPath); } catch { /* best-effort */ }
    try { await unlink(activeMarkerPath); } catch { /* best-effort */ }
    try { await unlink(contextPackSidecarPath); } catch { /* best-effort */ }
    try { await unlink(perTaskSidecarPath); } catch { /* best-effort */ }
    throw err;
  }

  // Remove the pending item from the queue after successful activation.
  // In the parallel model each task has its own per-task workspace; the
  // pending file content is now captured in .task.json + per-task handoffs.
  try { await unlink(nextItem); } catch { /* best-effort if already absent */ }

  // §5.3 + §6.2 + §6.3: allocate port → MCP bootstrap → start pipeline supervisor.
  // composeProjectName(taskId) scopes the allocation record to this task's
  // F4-isolated compose project; §5.2 orphan-container sweep relies on that
  // record to correlate container → port → task.
  try {
    await allocatePort(taskId, composeProjectName(taskId), repoRoot);
  } catch (portErr) {
    console.warn(`[operations] allocatePort failed for ${taskId} (non-fatal):`, portErr);
  }

  // §5.3: pipelineSupervisor.startPipeline — MUST be the last write before returning.
  // On failure, roll back the active markers so the queue can re-activate.
  const pipelineResult = await startPipeline(taskId, repoRoot);
  if ('deferred' in pipelineResult && pipelineResult.deferred) {
    // Recovery is in progress — pipeline will be started after recoverOnStartup completes.
    // This is not an error; the supervisor will handle re-activation.
    return { activated: true };
  }

  return { activated: true };
}

export interface CompleteActiveItemOptions {
  pendingDir: string;
  handoffsDir: string;
  templatesDir: string;
  taskId: string;
  skipValidation?: boolean;
  implementationStepsDir?: string;
  activeContextPackPath?: string;
  queueOrderPath?: string;
}

/**
 * Discriminated result from completeActiveItem.
 *
 * - 'completed': marker was present, handoffs reset, manifest updated.
 * - 'no-active-marker': the per-task marker in .active-items/<taskId> was already
 *   absent (crash-recovery re-drive observed step-4 already done). Caller
 *   (§4.3 §5.2 recovery) interprets this as "skip to sentinel-delete only".
 *   Does NOT advance the queue — the caller decides whether to call
 *   activateNextPendingItemIfReady after observing this status.
 */
export type CompleteActiveItemResult =
  | { status: 'completed'; taskId: string }
  | { status: 'no-active-marker'; taskId: string };

/**
 * Complete the active pending item: reset handoffs, update queue-order manifest,
 * and optionally activate the next pending item.
 *
 * Uses the per-task `.active-items/<taskId>` marker introduced in §4.1.
 * Returns a discriminated result instead of throwing when the marker is absent
 * (F9 idempotency fix): callers treat 'no-active-marker' as crash-recovery
 * step-4 already executed and skip to sentinel-delete only.
 */
export async function completeActiveItem(
  options: CompleteActiveItemOptions,
): Promise<CompleteActiveItemResult> {
  const {
    pendingDir,
    taskId,
    handoffsDir,
    templatesDir: _templatesDir,
    implementationStepsDir,
    activeContextPackPath,
    queueOrderPath,
  } = options;
  const defaults = deriveQueueStatePaths(pendingDir);
  const resolvedActiveContextPackPath = activeContextPackPath ?? defaults.activeContextPackPath;
  const resolvedQueueOrderPath = queueOrderPath ?? defaults.queueOrderPath;

  // Per-task marker path in the .active-items/ directory (§4.1 parallel model).
  const activeItemsDir = path.join(pendingDir, '.active-items');
  const markerPath = path.join(activeItemsDir, taskId);

  if (!existsSync(markerPath)) {
    // F9 idempotency: marker already absent — step 4 already happened in a
    // prior (crashed) run. Return early without re-driving handoff reset or
    // manifest update, and without throwing. Caller handles sentinel-delete.
    return { status: 'no-active-marker', taskId };
  }

  // Read marker to verify it is not empty/corrupt. If it is, throw — this is a
  // genuine inconsistency, not a crash-recovery case.
  const markerContent = (await readFile(markerPath, 'utf-8')).trim();
  if (!markerContent) {
    throw new Error(`Active item marker for task '${taskId}' is present but empty or corrupt.`);
  }

  // 1. Reset handoffs first (repeatable; if it fails, marker is intact so retry succeeds).
  await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, {
    implementationStepsDir,
  });

  // 2. Clean up the context pack sidecar if it exists.
  try { await unlink(resolvedActiveContextPackPath); } catch { /* absent for legacy tasks */ }

  // 3. Remove completed item from the queue-order manifest; delete manifest when empty.
  const activeName = `${taskId}.md`;
  try {
    const order = await readQueueOrderManifest(resolvedQueueOrderPath);
    const filtered = order.filter((f) => f !== activeName);
    if (filtered.length > 0) {
      await writeQueueOrderManifest(resolvedQueueOrderPath, filtered);
    } else {
      try { await unlink(resolvedQueueOrderPath); } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }

  return { status: 'completed', taskId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
