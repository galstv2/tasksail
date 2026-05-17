import path from 'node:path';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { readdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RuntimeTerminalEvents, createLogger, moveFile, readTextFile, writeTextFile, ensureDir, findRepoRoot, slugify, copyFileSafe, resolvePath } from '../core/index.js';
import {
  cleanupActivePlannerFocusSnapshot,
  moveStagedPlannerFocusSnapshot,
  transferStagedSnapshotToActiveTask,
} from './plannerFocusSnapshotStaging.js';
import { withOriginLock, materializeWorktreeDeps, preconditionsPass } from '../core/worktreeMaterialization.js';
import { readContextPackManifest, resolveFocusedRepoRoot } from '../context-pack/focusedRepo.js';
import {
  resolveExistingManifestGitRoot,
  resolveExistingManifestLocalPath,
} from '../context-pack/localPaths.js';
import { readReseedMarker } from '../context-pack/reseedMarker.js';
import { resolveTaskMaterializationConfig } from '../context-pack/types.js';
import { deriveQueueStatePaths, resolveQueuePaths, HANDOFF_FILES } from './paths.js';
import type { QueuePaths } from './paths.js';
import {
  handoffWorkspaceIsReady,
  resetHandoffArtifacts,
  initializeTaskArtifacts,
  clearRuntimeReceipts,
} from './lifecycle.js';
import {
  stampRetrospectiveRequiredMetadata,
  syncRetrospectiveRequiredMetadata,
} from './retrospectiveFlag.js';
import {
  buildImplementationSpecSectionsFromIntake,
  buildProfessionalTaskSectionsFromIntake,
  extractTaskTitle,
  extractLineageValue,
  extractContextPackBinding,
  type TaskContextPackBinding,
} from './markdown.js';
import { registerTask, removeTask, transitionTask } from './taskRegistry.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { seedPlatformConfig } from '../platform-config/seed.js';
import { startPipeline } from '../agent-runner/pipelineSupervisor.js';
import { ensureSharedMcpRunning } from '../container/sharedMcp.js';
import { createRuntimeFromConfig } from '../container/runtime.js';
import { resolveDefaultComposeFile } from '../container/types.js';
import { resumeCloseoutFromSentinel } from './resumeCloseout.js';
import {
  deferredRetrospectiveMarkerPath,
  mergeCompletingSentinelPayload,
  type DeferredRetrospectiveMarker,
} from './completePendingItem.js';
import type { TaskRepoBinding } from './taskJson.js';
import { acquireDirLockOrThrow, withDirLock } from './dirLock.js';
import { writeTaskPackSnapshot } from './packSnapshot.js';
import { resolveTaskPackSnapshotPath } from '../context-pack/taskPackSnapshot.js';

const execFileAsync = promisify(execFile);
const log = createLogger('platform/queue/operations');

export { acquireDirLock, acquireDirLockOrThrow, withDirLock } from './dirLock.js';


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

function extractBindingOrWarn(content: string | undefined, taskId?: string): TaskContextPackBinding | null {
  if (!content) {
    return null;
  }
  const result = extractContextPackBinding(content);
  if (result.kind === 'binding') {
    return result.binding;
  }
  if (result.kind === 'invalid') {
    log.warn('context_pack_binding.invalid.ignored', { taskId, reason: result.reason });
  }
  return null;
}

export { cleanupStagedPlannerFocusSnapshot } from './plannerFocusSnapshotStaging.js';

function resolveExistingRepoRootForActivation(
  input: string,
): string {
  try {
    return realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}

async function probeGitToplevel(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    return resolveExistingRepoRootForActivation(stdout.trim());
  } catch {
    return null;
  }
}

async function resolveMaterializationOrigins(
  roots: readonly string[],
  persistedGitRoots: ReadonlyMap<string, string> = new Map(),
): Promise<Array<{ contextRoot: string; gitRoot: string }>> {
  const resolvedGitRoots = await Promise.all(roots.map(async (contextRoot) => {
    const persistedGitRoot = persistedGitRoots.get(contextRoot);
    if (persistedGitRoot) {
      const verified = await probeGitToplevel(persistedGitRoot);
      if (verified) {
        return verified;
      }
    }
    return (await probeGitToplevel(contextRoot)) ?? contextRoot;
  }));

  const origins: Array<{ contextRoot: string; gitRoot: string }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < roots.length; i++) {
    const gitRoot = resolvedGitRoots[i]!;
    if (seen.has(gitRoot)) {
      continue;
    }
    seen.add(gitRoot);
    origins.push({ contextRoot: roots[i]!, gitRoot });
  }
  return origins;
}

async function resolvePersistedGitRootsForActivation(
  contextPackDir: string | undefined,
  repoRoot: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!contextPackDir) {
    return result;
  }

  const resolvedPackDir = resolvePath(repoRoot, contextPackDir);
  const manifest = await readContextPackManifest(resolvedPackDir, repoRoot);
  if (!manifest) {
    return result;
  }

  const repos = [
    ...(manifest.repository ? [manifest.repository] : []),
    ...(Array.isArray(manifest.repositories) ? manifest.repositories : []),
  ];

  for (const repo of repos) {
    if (!Array.isArray(repo.local_paths)) {
      continue;
    }
    for (const rawPath of repo.local_paths) {
      const localRoot = resolveExistingManifestLocalPath(rawPath, resolvedPackDir);
      const gitRoot = resolveExistingManifestGitRoot(rawPath, resolvedPackDir);
      if (localRoot && gitRoot) {
        result.set(localRoot, gitRoot);
      }
    }
  }

  return result;
}

function materializationRootsFromBinding(options: {
  visibleRepoRoots: readonly string[];
  binding: TaskContextPackBinding | null;
  taskId: string;
}): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const append = (root: string): void => {
    const resolved = resolveExistingRepoRootForActivation(root);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    roots.push(resolved);
  };

  for (const root of options.visibleRepoRoots) {
    append(root);
  }

  for (const [index, target] of (options.binding?.selectedFocusTargets ?? []).entries()) {
    const selectedRoot = target.repoLocalPath?.trim();
    if (!selectedRoot) {
      continue;
    }
    if (!existsSync(selectedRoot)) {
      throw new Error(
        `activation-selected-repo-missing: selectedFocusTargets[${index}].repoLocalPath "${selectedRoot}" does not exist for task "${options.taskId}"`,
      );
    }
    append(selectedRoot);
  }

  return roots;
}

function isDeferredRetrospectiveMarker(value: unknown): value is DeferredRetrospectiveMarker {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Partial<DeferredRetrospectiveMarker>;
  return typeof marker.taskId === 'string'
    && typeof marker.contextPackDir === 'string'
    && typeof marker.handoffsDir === 'string'
    && typeof marker.deferredAt === 'string';
}

async function readDeferredRetrospectiveMarkers(
  repoRoot: string,
): Promise<Array<DeferredRetrospectiveMarker & { markerPath: string }>> {
  const tasksRuntimeDir = path.join(repoRoot, '.platform-state', 'runtime', 'tasks');
  let taskIds: string[];
  try {
    taskIds = await readdir(tasksRuntimeDir);
  } catch {
    return [];
  }

  const markers: Array<DeferredRetrospectiveMarker & { markerPath: string }> = [];
  for (const taskId of taskIds) {
    const markerPath = deferredRetrospectiveMarkerPath(repoRoot, taskId);
    try {
      const parsed = JSON.parse(await readFile(markerPath, 'utf-8')) as unknown;
      if (isDeferredRetrospectiveMarker(parsed)) {
        markers.push({ ...parsed, markerPath });
      }
    } catch {
      // Missing or corrupt markers are ignored; closeout-health reports filesystem state.
    }
  }
  return markers.sort((a, b) => a.deferredAt.localeCompare(b.deferredAt));
}

async function unlinkDeferredMarker(markerPath: string): Promise<boolean> {
  try {
    await unlink(markerPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    log.warn('deferred_retrospective.marker_remove.failed', { markerPath, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function retryDeferredRetrospectiveSyncs(repoRoot: string): Promise<{
  attempted: boolean;
  taskId?: string;
  synced?: boolean;
}> {
  const marker = (await readDeferredRetrospectiveMarkers(repoRoot))[0];
  if (!marker) {
    return { attempted: false };
  }

  try {
    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir: marker.handoffsDir,
      contextPackDir: marker.contextPackDir,
      taskId: marker.taskId,
    });
    const queuePaths = resolveQueuePaths(repoRoot);
    const sentinelPath = path.join(queuePaths.activeItemsDir, `${marker.taskId}.completing`);
    if (existsSync(sentinelPath)) {
      mergeCompletingSentinelPayload(sentinelPath, {
        retrospectiveSynced: true,
        retrospectiveSyncError: undefined,
      });
    }
    await unlinkDeferredMarker(marker.markerPath);
    return { attempted: true, taskId: marker.taskId, synced: true };
  } catch (err) {
    log.warn('deferred_retrospective.sync.failed', { taskId: marker.taskId, error: err instanceof Error ? err.message : String(err) });
    return { attempted: true, taskId: marker.taskId, synced: false };
  }
}

async function resumeOrphanCompletingSentinels(
  repoRoot: string,
  paths: QueuePaths,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(paths.activeItemsDir);
  } catch {
    return;
  }
  for (const entry of entries.filter((name) => name.endsWith('.completing'))) {
    const taskId = entry.replace(/\.completing$/, '');
    const result = await resumeCloseoutFromSentinel(taskId, repoRoot);
    if (result.status === 'completed') {
      log.child({ taskId }).progress({
        level: 'warn',
        event: 'closeout.stranded.resumed',
        extra: { drove: result.drove },
        text: `[pipeline] resumed stranded closeout for ${taskId}`,
      });
      await RuntimeTerminalEvents.forTask(repoRoot, taskId).strandedCloseoutResumed({
        drove: result.drove,
      });
    }
  }
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
 * Remove a file name from queue-order.json. Deletes the manifest when the
 * resulting list is empty. Best-effort: swallows read/write/unlink errors so
 * callers can use it as a cleanup step in failure paths.
 */
export async function removeFromQueueOrderManifest(
  queueOrderPath: string,
  fileName: string,
): Promise<void> {
  try {
    const order = await readQueueOrderManifest(queueOrderPath);
    const filtered = order.filter((f) => f !== fileName);
    if (filtered.length > 0) {
      await writeQueueOrderManifest(queueOrderPath, filtered);
    } else {
      await unlink(queueOrderPath);
    }
  } catch { /* best-effort */ }
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
const QUEUE_TIMESTAMP_PREFIX_RE = /^\d{8}[tT]\d{6}[zZ][-_]/;

/**
 * Generate a timestamped queue name for a source file.
 * Strips any existing timestamp prefix first so round-tripping between
 * dropbox and pending doesn't accumulate multiple prefixes.
 */
export function queueNameForSource(sourceFile: string): string {
  const baseName = path.basename(sourceFile)
    .replace(/\.md$/i, '')
    .replace(QUEUE_TIMESTAMP_PREFIX_RE, '');
  const slug = slugify(baseName).slice(0, 47).replace(/[-_]+$/g, '') || 'task';
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', 't')
    .replace(/\.\d+Z$/, 'z');
  return `${ts}_${slug}.md`;
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
    await moveStagedPlannerFocusSnapshot({
      repoRoot,
      oldTaskId: path.basename(sourcePath, '.md'),
      newTaskId: finalFileName.replace(/\.md$/, ''),
      newMarkdownDestination: path.relative(repoRoot, targetPath),
    });
    try {
      const head = await readTextFile(targetPath);
      const title = head ? extractTaskTitle(head) || null : null;
      const binding = extractBindingOrWarn(head, finalFileName.replace(/\.md$/, ''));
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
        selectedFocusTargets: binding?.selectedFocusTargets,
        selectedTestTarget: binding?.selectedTestTarget,
        selectedSupportTargets: binding?.selectedSupportTargets,
        createdAt: new Date().toISOString(),
        completedAt: null,
        archivePath: null,
      });
    } catch {
      // Registry update is best-effort — file move is the authoritative operation
    }

    const movedTaskId = finalFileName.replace(/\.md$/, '');
    log.child({ taskId: movedTaskId }).progress({
      level: 'info',
      event: 'queue.pending.promoted',
      text: `[queue] promoted to pending ${movedTaskId}`,
    });
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

  const finalFileName = await withDirLock(
    queuePaths.queueLockDir,
    'Move dropbox item to pending',
    async () => {
      await moveFile(sourcePath, targetPath);

      const movedFileName = path.basename(targetPath);
      const oldTaskId = base.replace(/\.md$/, '');
      await moveStagedPlannerFocusSnapshot({
        repoRoot: root,
        oldTaskId,
        newTaskId: movedFileName.replace(/\.md$/, ''),
        newMarkdownDestination: path.relative(root, targetPath),
      });

      // Clear stale registry entry from prior repair (may not exist)
      await removeTask(root, oldTaskId).catch(() => {});

      try {
        const head = await readTextFile(targetPath);
        const title = head ? extractTaskTitle(head) || null : null;
        const binding = extractBindingOrWarn(head, movedFileName.replace(/\.md$/, ''));
        await registerTask(root, {
          taskId: movedFileName.replace(/\.md$/, ''),
          fileName: movedFileName,
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
          selectedFocusTargets: binding?.selectedFocusTargets,
          selectedTestTarget: binding?.selectedTestTarget,
          selectedSupportTargets: binding?.selectedSupportTargets,
          createdAt: new Date().toISOString(),
          completedAt: null,
          archivePath: null,
        });
      } catch {
        // Registry update is best-effort — file move is authoritative
      }

      await insertIntoQueueManifest(queuePaths.pendingDir, movedFileName, options.insertAtIndex);
      return movedFileName;
    },
  );

  const result = await activateNextPendingItemIfReady({ paths: queuePaths, repoRoot: root });
  const activatedItem = result.activated ? result.activatedTaskId ?? null : null;

  return { movedItem: finalFileName, activatedItem };
}

export interface ActivateNextPendingItemOptions {
  paths: QueuePaths;
  repoRoot: string;
  /** Optional context pack dir override (used by legacy callers that resolve it externally). */
  contextPackDir?: string;
}

export const ACTIVATION_GATE_REASON = {
  CONCURRENCY_CAP_REACHED: 'concurrency-cap-reached',
  SHARED_MCP_BOOTSTRAP_FAILED: 'shared-mcp-bootstrap-failed',
  PIPELINE_SPAWN_FAILED: 'pipeline-spawn-failed',
} as const;

export type ActivationGateReason =
  (typeof ACTIVATION_GATE_REASON)[keyof typeof ACTIVATION_GATE_REASON];

export interface ActivateNextPendingItemResult {
  activated: boolean;
  activatedTaskId?: string;
  // Stable gate-condition codes use ActivationGateReason. Orchestrators
  // (e.g. publishPendingItem) may also surface dynamic strings such as
  // 'activation-error: <msg>' here.
  reason?: ActivationGateReason | string;
}

async function readActiveWorkspaceContextPackDir(repoRoot: string): Promise<string | undefined> {
  const statePath = path.join(repoRoot, '.platform-state', 'workspace-context-sync.json');
  const content = await readTextFile(statePath);
  if (content === undefined) {
    return undefined;
  }

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    throw new Error(
      `Unable to parse workspace context sync state at ${statePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const rawDir = typeof state.active_context_pack_dir === 'string'
    ? state.active_context_pack_dir.trim()
    : '';
  if (!rawDir) {
    return undefined;
  }
  return path.isAbsolute(rawDir) ? rawDir : path.resolve(repoRoot, rawDir);
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

  await Promise.all([
    retryDeferredRetrospectiveSyncs(repoRoot),
    resumeOrphanCompletingSentinels(repoRoot, paths),
  ]);

  let nextItem: string | null = null;
  let taskId = '';
  let taskHandoffsDir = '';
  let taskImplStepsDir = '';
  let content: string | undefined;
  let activeMarkerPath = '';
  let repoBindings: Array<{
    originalRoot: string;
    worktreeRoot: string;
    worktreeBranch: string;
    baseCommitSha: string;
  }> = [];
  let packSnapshotPath = '';

  const releaseActivation = await acquireDirLockOrThrow(paths.queueLockDir, 'Activation');
  try {
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
      const reason = 'concurrency-cap-reached';
      log.progress({
        level: 'info',
        event: 'queue.active.skipped',
        extra: { reason },
        text: `[queue] activation skipped - ${reason}`,
      });
      return { activated: false, reason: ACTIVATION_GATE_REASON.CONCURRENCY_CAP_REACHED };
    }

    // Skip already-active task IDs so parallel activations pick the next
    // unstarted pending item rather than re-selecting the already-active one.
    const activeSet = new Set(currentActive);
    nextItem = await nextPendingItemPath(pendingDir, undefined, activeSet);
    if (!nextItem) return { activated: false };

    // Resolve per-task paths early so readiness check uses the task-specific dir.
    // Per-task handoffs live at AgentWorkSpace/tasks/<taskId>/handoffs/ (§4.2).
    // They are always "ready" (empty) for a new task since the directory won't exist yet.
    taskId = path.basename(nextItem, '.md');
    taskHandoffsDir = paths.taskHandoffs(taskId);
    taskImplStepsDir = paths.taskImplementationSteps(taskId);

    const isReady = await handoffWorkspaceIsReady(
      taskHandoffsDir,
      templatesDir,
    );
    if (!isReady) return { activated: false };

    // Read the queue item and initialize handoffs from it
    content = await readTextFile(nextItem);
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
  const contextPackBinding = extractBindingOrWarn(content, taskId);

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

  const sections = {
    ...buildProfessionalTaskSectionsFromIntake(content),
    ...buildImplementationSpecSectionsFromIntake(content),
  };

  // The per-task active marker is written only after the task sidecar and
  // handoff workspace have been materialized. If materialization fails, the
  // pending item remains pending and no active marker is leaked.
  await ensureDir(paths.activeItemsDir);
  activeMarkerPath = path.join(paths.activeItemsDir, taskId);

  // Lock precedence: 1 (queue lock; task sidecar write is part of activation critical section)
  // §4.14 — Worktree + dependency materialization.
  // For every visible repo root in the activating context pack: run `git worktree add`,
  // CoW-clone dependency directories, and write real worktreeRoot into .task.json.
  // MUST happen AFTER activation lock is acquired and BEFORE pipelineSupervisor.startPipeline.

  const perTaskSidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');

  // Resolve the set of repo roots to materialize worktrees for.
  // If a context pack is present, iterate its visibleRepoRoots.
  // Otherwise fall back to the platform repo root only when there is no active
  // context-pack workspace selection. This prevents recovered/unbound external
  // tasks from silently materializing TaskSail itself as the worktree.
  let visibleRepoRoots: string[] = [];
  const cpDir = contextPackBinding?.contextPackDir ?? contextPackDir;
  if (cpDir) {
    const reseed = await readReseedMarker(cpDir);
    if (reseed) {
      throw new Error(
        `Refusing to activate task "${taskId}" against context pack "${cpDir}": ` +
        `a reseed is in progress (started ${reseed.startedAt}, pid ${reseed.pid} on ${reseed.host}, ` +
        `age ${Math.round(reseed.ageMs / 1000)}s). Retry once the reseed completes.`,
      );
    }
    const focused = await resolveFocusedRepoRoot(cpDir, repoRoot);
    visibleRepoRoots = materializationRootsFromBinding({
      visibleRepoRoots: focused?.visibleRepoRoots ?? [],
      binding: contextPackBinding,
      taskId,
    });
    if (visibleRepoRoots.length === 0) {
      throw new Error(
        `Unable to resolve visible repo roots for context pack "${cpDir}" while activating task "${taskId}". ` +
        'Refusing to fall back to the platform repo root.',
      );
    }
  }
  if (visibleRepoRoots.length === 0) {
    const activeWorkspaceContextPackDir = await readActiveWorkspaceContextPackDir(repoRoot);
    if (activeWorkspaceContextPackDir) {
      throw new Error(
        `Refusing to activate unbound task "${taskId}" against the platform repo root because ` +
        `the active workspace context pack is "${activeWorkspaceContextPackDir}". ` +
        'Requeue the task with a Context Pack Binding or clear the active context pack before running a platform-local task.',
      );
    }
    visibleRepoRoots = [repoRoot];
  }

  await ensureDir(path.dirname(perTaskSidecarPath));

  // Determine paths to clone from the context pack's taskMaterialization field.
  // Defaults to DEFAULT_TASK_MATERIALIZATION_PATHS when field is absent.
  const pathsToClone = resolveTaskMaterializationConfig(undefined).paths;

  const persistedGitRoots = await resolvePersistedGitRootsForActivation(cpDir, repoRoot);
  const materializationOrigins = await resolveMaterializationOrigins(visibleRepoRoots, persistedGitRoots);

  // Compute per-repo slugs.  Slug = basename(realpath(root)); if two roots share a
  // basename, append `-<sha8>` suffix (sha8 = first 8 chars of git rev-parse HEAD).
  const basenames = materializationOrigins.map((origin) => {
    try { return path.basename(realpathSync(origin.contextRoot)); } catch { return path.basename(origin.contextRoot); }
  });
  const basenameCount: Record<string, number> = {};
  for (const b of basenames) {
    basenameCount[b] = (basenameCount[b] ?? 0) + 1;
  }

  // Build per-repo binding entries (originalRoot, worktreeRoot, worktreeBranch, baseCommitSha).
  repoBindings = [];
  let combinedMat: { strategy: string; cloned: string[]; skipped: string[] } = {
    strategy: 'copy',
    cloned: [],
    skipped: [],
  };

  for (let i = 0; i < materializationOrigins.length; i++) {
    const origin = materializationOrigins[i]!;
    const originalRoot = origin.gitRoot;
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
        // Step 4: unlink .active-items/<taskId> — marker may not yet exist; swallow errors.
        await unlink(path.join(paths.activeItemsDir, taskId)).catch(() => {});
        throw cloneErr;
      }
    });

    log.child({ taskId }).progress({
      level: 'info',
      event: 'queue.branch.created',
      extra: {
        branch: worktreeBranch,
        repo: repoSlug,
        worktree_root: worktreePath,
        materialization_strategy: mat.strategy,
      },
      text: `[pipeline] worktree ${repoSlug} on ${worktreeBranch}`,
    });
    await RuntimeTerminalEvents.forTask(repoRoot, taskId).branchCreated({
      repo: repoSlug,
      branch: worktreeBranch,
      worktreeRoot: worktreePath,
      materializationStrategy: mat.strategy,
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

  const selection = contextPackBinding
    ? {
        contextPackDir: contextPackBinding.contextPackDir,
        contextPackId: contextPackBinding.contextPackId,
        scopeMode: contextPackBinding.scopeMode,
        selectedRepoIds: contextPackBinding.selectedRepoIds,
        selectedFocusIds: contextPackBinding.selectedFocusIds,
        deepFocusEnabled: contextPackBinding.deepFocusEnabled,
        ...(contextPackBinding.deepFocusEnabled === true
          ? {
              deepFocusPrimaryRepoId: contextPackBinding.deepFocusPrimaryRepoId,
              deepFocusPrimaryFocusId: contextPackBinding.deepFocusPrimaryFocusId,
            }
          : {
              primaryRepoId: contextPackBinding.primaryRepoId,
              primaryFocusId: contextPackBinding.primaryFocusId,
            }),
        selectedFocusPath: contextPackBinding.selectedFocusPath ?? null,
        selectedFocusTargetKind: contextPackBinding.selectedFocusTargetKind ?? null,
        selectedFocusTargets: contextPackBinding.selectedFocusTargets,
        selectedTestTarget: contextPackBinding.selectedTestTarget ?? null,
        selectedSupportTargets: contextPackBinding.selectedSupportTargets ?? [],
      }
    : undefined;

  const perTaskSidecar = {
    schema_version: 1,
    taskId,
    contextPackBinding: {
      contextPackPath: cpDir
        ? path.join(cpDir, 'context-pack.json')
        : null,
      dataHostDir: process.env['REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR'] ?? null,
      dataContainerDir: process.env['REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR'] ?? null,
      repoBindings,
      selection,
    },
    materialization: {
      strategy: combinedMat.strategy,
      cloned: combinedMat.cloned,
      skipped: combinedMat.skipped,
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
  if (contextPackBinding && selection) {
    // writeTaskPackSnapshot validates primary.repoRoot before writing and
    // throws on any unresolvable identity, so we only need to record the path
    // here for rollback.
    await writeTaskPackSnapshot({
      repoRoot,
      taskId,
      contextPackDir: contextPackBinding.contextPackDir,
      contextPackId: contextPackBinding.contextPackId,
      binding: contextPackBinding,
      selection,
    });
    packSnapshotPath = resolveTaskPackSnapshotPath(repoRoot, taskId);
  }
  await transferStagedSnapshotToActiveTask(repoRoot, taskId);

  try {
    await initializeTaskArtifacts({
      handoffsDir: taskHandoffsDir,
      templatesDir,
      metadata,
      lineage,
      sections,
      implementationStepsDir: taskImplStepsDir,
    });
    // Stage the intake markdown into the per-task handoffs dir so agents
    // (notably Alice) can read their own task's intake without being granted
    // access to the shared pendingitems/ directory, which holds other tasks'
    // files in parallel mode. The canonical copy stays in pendingitems/ —
    // queue lifecycle code is the only authorized writer there.
    await copyFileSafe(nextItem, path.join(taskHandoffsDir, 'intake.md'));
    await stampRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir: taskHandoffsDir,
      contextPackDir: contextPackBinding?.contextPackDir ?? contextPackDir,
    });
    await clearRuntimeReceipts(repoRoot, taskId);
  } catch (err) {
    // Roll back the claim and sidecar so queue returns to idle.
    try { await unlink(activeMarkerPath); } catch { /* best-effort */ }
    try { await unlink(perTaskSidecarPath); } catch { /* best-effort */ }
    if (packSnapshotPath) {
      try { await unlink(packSnapshotPath); } catch { /* best-effort */ }
    }
    await cleanupActivePlannerFocusSnapshot(repoRoot, taskId);
    throw err;
  }

  // Claim after materialization succeeds. The pending markdown intentionally
  // remains in pendingitems/ while active: terminal paths move/delete that file
  // so failed tasks can still be relocated to error-items/ and completed tasks
  // can be removed idempotently.
  await writeFile(activeMarkerPath, queueName, 'utf-8');

  // Transition task from pending → active in the registry.
  try {
    await transitionTask(repoRoot, taskId, 'pending', 'active');
  } catch { /* best-effort */ }
  } finally {
    await releaseActivation();
  }

  if (await shouldBootstrapSharedMcp(repoRoot)) {
    try {
      const seedResult = await seedPlatformConfig(repoRoot);
      if (seedResult.action === 'failed') {
        throw new Error(`platform-config-seed-failed: ${seedResult.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
      }
      await ensureSharedMcpRunning(repoRoot);
    } catch (bootstrapErr) {
      log.error('shared_mcp.bootstrap.failed', bootstrapErr, { taskId });
      await rollbackActivationClaim({
        repoRoot,
        paths,
        taskId,
        activeMarkerPath,
        repoBindings,
      });
      const reason = 'shared-mcp-bootstrap-failed';
      log.child({ taskId }).progress({
        level: 'info',
        event: 'queue.active.skipped',
        extra: { reason },
        text: `[queue] activation skipped - ${reason}`,
      });
      return { activated: false, reason: ACTIVATION_GATE_REASON.SHARED_MCP_BOOTSTRAP_FAILED };
    }
  } else {
    log.warn('shared_mcp.bootstrap.skipped', { taskId, reason: 'compose-file-missing' });
  }

  log.child({ taskId }).progress({
    level: 'info',
    event: 'queue.active.activated',
    extra: {
      repo_count: repoBindings.length,
      branches: repoBindings.map((binding) => binding.worktreeBranch),
    },
    text: `[queue] activated ${taskId}  repos=${repoBindings.length}`,
  });
  await RuntimeTerminalEvents.forTask(repoRoot, taskId).taskActivated();

  const disablePipelineAutostart = (
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] ?? ''
  ).trim().toLowerCase() === 'true';
  if (disablePipelineAutostart) {
    log.warn('pipeline.autostart.disabled', { taskId });
    try { await unlink(nextItem); } catch { /* best-effort if already absent */ }
    return { activated: true, activatedTaskId: taskId };
  }

  // §5.3: pipelineSupervisor.startPipeline — MUST be the last write before returning.
  // On failure, roll back the active markers so the queue can re-activate.
  let pipelineResult: Awaited<ReturnType<typeof startPipeline>>;
  try {
    pipelineResult = await startPipeline(taskId, repoRoot);
  } catch (err) {
    await rollbackActivationClaim({
      repoRoot,
      paths,
      taskId,
      activeMarkerPath,
      repoBindings,
    });
    log.error('pipeline.spawn.failed', err, { taskId });
    const reason = 'pipeline-spawn-failed';
    log.child({ taskId }).progress({
      level: 'info',
      event: 'queue.active.skipped',
      extra: { reason },
      text: `[queue] activation skipped - ${reason}`,
    });
    return { activated: false, reason: ACTIVATION_GATE_REASON.PIPELINE_SPAWN_FAILED };
  }
  if ('deferred' in pipelineResult && pipelineResult.deferred) {
    try { await unlink(nextItem); } catch { /* best-effort if already absent */ }
    // Recovery is in progress — pipeline will be started after recoverOnStartup completes.
    // This is not an error; the supervisor will handle re-activation.
    return { activated: true, activatedTaskId: taskId };
  }

  // Intentionally do NOT unlink the pending markdown here. Per the contract
  // documented above (search "while active"), the file remains in pendingitems/
  // for the duration of the run so the terminal paths own its disposition:
  //   - completion: completePendingItem unlinks it after archival.
  //   - failure:    moveFailedItemToErrorItems renames it into error-items/.
  // Unlinking here races the failure path: if the pipeline child crashes after
  // this point, the rename in errorItems.ts hits ENOENT and falls back to a
  // blank-template recovery that loses the original task content.

  return { activated: true, activatedTaskId: taskId };
}

export interface CompleteActiveItemOptions {
  pendingDir: string;
  handoffsDir: string;
  templatesDir: string;
  taskId: string;
  skipValidation?: boolean;
  implementationStepsDir?: string;
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
    queueOrderPath,
  } = options;
  const defaults = deriveQueueStatePaths(pendingDir);
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

  // 2. Remove completed item from pendingitems/ if it still exists. Activation
  // deliberately leaves the file in place while active so failure can move it
  // to error-items/.
  const activeName = `${taskId}.md`;
  try { await unlink(path.join(pendingDir, activeName)); } catch { /* idempotent */ }

  // 3. Remove completed item from the queue-order manifest; delete manifest when empty.
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

async function rollbackActivationClaim(options: {
  repoRoot: string;
  paths: QueuePaths;
  taskId: string;
  activeMarkerPath: string;
  repoBindings: TaskRepoBinding[];
}): Promise<void> {
  const {
    repoRoot,
    paths,
    taskId,
    activeMarkerPath,
    repoBindings,
  } = options;

  for (const binding of repoBindings) {
    if (binding.worktreeRoot && binding.worktreeRoot !== binding.originalRoot) {
      await execFileAsync('git', [
        '-C', binding.originalRoot,
        'worktree', 'remove', '--force', binding.worktreeRoot,
      ]).catch(() => {});
      await execFileAsync('git', ['-C', binding.originalRoot, 'worktree', 'prune']).catch(() => {});
    }
    if (binding.worktreeBranch) {
      await execFileAsync('git', [
        '-C', binding.originalRoot,
        'branch', '-D', binding.worktreeBranch,
      ]).catch(() => {});
    }
  }

  await rm(path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId), {
    recursive: true,
    force: true,
  }).catch(() => {});

  await unlink(activeMarkerPath).catch(() => {});

  try { await transitionTask(repoRoot, taskId, 'active', 'pending'); } catch { /* best-effort */ }
  await ensureDir(paths.activeItemsDir).catch(() => {});
}

async function shouldBootstrapSharedMcp(repoRoot: string): Promise<boolean> {
  let runtime;
  try {
    runtime = await createRuntimeFromConfig(repoRoot);
  } catch {
    return hasContainerComposeFile(repoRoot);
  }
  if (!runtime.requiresComposeFile) {
    return true;
  }
  return hasContainerComposeFile(repoRoot);
}

function hasContainerComposeFile(repoRoot: string): boolean {
  const dockerCompose = resolveDefaultComposeFile('docker');
  const podmanCompose = resolveDefaultComposeFile('podman');
  return (dockerCompose !== undefined && existsSync(path.join(repoRoot, dockerCompose)))
    || (podmanCompose !== undefined && existsSync(path.join(repoRoot, podmanCompose)));
}
