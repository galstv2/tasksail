import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rmdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { moveFile, readTextFile, writeTextFile, ensureDir, findRepoRoot } from '../core/index.js';
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
  // Write the per-task .task.json sidecar. This is the authoritative context-pack binding
  // for this task. The singleton active-context-pack.json above is kept for back-compat.
  // Per §3.1: AgentWorkSpace/tasks/<taskId>/.task.json
  const perTaskSidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
  await ensureDir(path.dirname(perTaskSidecarPath));

  // Resolve the base commit SHA of the original repo root at activation time.
  // originalRoot at L0 is the TaskSail repo root (§4.14 will introduce per-repo worktrees).
  const originalRoot = repoRoot;
  let baseCommitSha = '';
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: originalRoot });
    baseCommitSha = stdout.trim();
  } catch {
    // Non-fatal: leave empty if git is unavailable (e.g., bare tmpdir in tests)
    baseCommitSha = '';
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
      repoBindings: [
        {
          originalRoot,
          worktreeRoot: originalRoot,
          worktreeBranch: `task/${taskId}`,
          baseCommitSha,
        },
      ],
    },
    materialization: {
      strategy: 'copy',
      cloned: [],
      skipped: [],
      composeProjectName: 'repo-context-mcp',
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

  return { activated: true };
}

export interface CompleteActiveItemOptions {
  pendingDir: string;
  handoffsDir: string;
  templatesDir: string;
  skipValidation?: boolean;
  implementationStepsDir?: string;
  activeContextPackPath?: string;
  queueOrderPath?: string;
}

/**
 * Complete the active pending item: remove it from the queue, reset handoffs,
 * and optionally activate the next pending item.
 */
export async function completeActiveItem(
  options: CompleteActiveItemOptions,
): Promise<void> {
  const {
    pendingDir,
    handoffsDir,
    templatesDir: _templatesDir,
    implementationStepsDir,
    activeContextPackPath,
    queueOrderPath,
  } = options;
  const defaults = deriveQueueStatePaths(pendingDir);
  const resolvedActiveContextPackPath = activeContextPackPath ?? defaults.activeContextPackPath;
  const resolvedQueueOrderPath = queueOrderPath ?? defaults.queueOrderPath;

  const linkPath = activeItemPath(pendingDir);
  if (!existsSync(linkPath)) {
    throw new Error('No active pending item is currently claimed.');
  }

  const activeName = (await readFile(linkPath, 'utf-8')).trim();
  if (!activeName) {
    throw new Error('Active item file is empty.');
  }

  const activeFilePath = path.join(pendingDir, activeName);

  // 1. Reset handoffs first (repeatable; if it fails, active item is intact)
  await resetHandoffArtifacts(handoffsDir, HANDOFF_FILES, {
    implementationStepsDir,
  });

  // 2. Release the claim (if this fails, workspace is clean, retry will succeed)
  await unlink(linkPath);

  // 2a. Clean up the context pack sidecar if it exists
  try { await unlink(resolvedActiveContextPackPath); } catch { /* absent for legacy tasks */ }

  // 2b. Remove completed item from the queue-order manifest; delete the file when empty
  try {
    const order = await readQueueOrderManifest(resolvedQueueOrderPath);
    const filtered = order.filter((f) => f !== activeName);
    if (filtered.length > 0) {
      await writeQueueOrderManifest(resolvedQueueOrderPath, filtered);
    } else {
      await unlink(resolvedQueueOrderPath);
    }
  } catch { /* best-effort */ }

  // 3. Delete the pending file last (the task's durable record)
  if (existsSync(activeFilePath)) {
    await unlink(activeFilePath);
  }

  // 4. Advance the queue — note: completePendingItem.ts (§4.3) is the primary
  // caller; this internal advance handles the completeActiveItem API path.
  const repoRoot = path.resolve(pendingDir, '..', '..');
  const queuePaths = resolveQueuePaths(repoRoot);
  await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
