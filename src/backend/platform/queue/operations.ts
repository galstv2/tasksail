import path from 'node:path';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { readdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger, emitTaskProgressEvent, moveFile, readTextFile, ensureDir, findRepoRoot, copyFileSafe, resolvePath } from '../core/index.js';
import {
  cleanupActivePlannerFocusSnapshot,
  moveStagedPlannerFocusSnapshot,
  transferStagedSnapshotToActiveTask,
} from './plannerFocusSnapshotStaging.js';
import { withOriginLock, materializeWorktreeDeps } from '../core/worktreeMaterialization.js';
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
import { loadPlatformConfig } from '../platform-config/load.js';
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
import { acquireDirLockOrThrow, withDirLock } from './dirLock.js';
import { writeTaskPackSnapshot } from './packSnapshot.js';
import { resolveTaskPackSnapshotPath } from '../context-pack/taskPackSnapshot.js';
import {
  assertTaskWorktreeBindingsCoverSnapshot,
  resolveSelectedMaterializationRoots,
  type SelectedMaterializationRoot,
} from '../context-pack/taskWorktreeSelection.js';
import {
  findDirtyTargetRepos,
  failPendingActivationForDirtyRepos,
  resolveRepoLabels,
} from './activationDirtyGuard.js';
import {
  ACTIVATION_BRANCH_CHAIN_BASE_UNRESOLVED_REASON,
  failPendingActivationForBranchChainBaseUnresolved,
  isBranchChainBaseUnresolvedActivationError,
} from './activationFailure.js';
import {
  insertIntoQueueManifest,
  readQueueOrderManifest,
  writeQueueOrderManifest,
} from './queueOrderManifest.js';
import { buildReadableTaskFileName, isGeneratedTaskFileName, stripGeneratedTaskPrefix } from './taskNames.js';
import {
  buildActivationBranchCandidatePlans,
  finalizeActivationBranchPlans,
  resolveTaskBranchChainForActivation,
  type ActivationRollbackBinding,
} from './branchChainActivation.js';
import { findActivationBranchConflicts } from './activeBranchConflictGuard.js';
import { partitionSelectedMaterializationRoots } from './activationBranchAuthorityPartition.js';
import {
  materializeReadonlyContextWorktree,
  removeReadonlyContextWorktree,
  type ReadonlyContextMaterializationPlan,
  type ReadonlyContextSource,
} from './supportContextMaterialization.js';
import { toTaskContextPackSelection, type TaskReadonlyContextBinding } from './taskJson.js';
import { returnPendingTaskToOpenForBranchConflict } from './branchConflictReturnToOpen.js';
import {
  clearActivationProgress,
  writeActivationProgress,
  type ActivationProgressPhase,
} from './activationProgress.js';
import { emitActivationTerminalProgress } from './activationTerminalProgress.js';
import {
  handleActivationKillCheckpoint,
  observeKillRequest,
} from './killTask.js';
import { normalizeSelectedRepoPathsInText } from './taskVisiblePathNormalization.js';

const execFileAsync = promisify(execFile);
const log = createLogger('platform/queue/operations');

type ReadonlyContextRollbackBinding = {
  binding: TaskReadonlyContextBinding;
  source: ReadonlyContextSource;
  repoLabel: string;
};

export { acquireDirLock, acquireDirLockOrThrow, withDirLock } from './dirLock.js';
export {
  insertIntoQueueManifest,
  readQueueOrderManifest,
  removeFromQueueOrderManifest,
  writeQueueOrderManifest,
} from './queueOrderManifest.js';


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
    if (result.reason === 'malformed-repository-types') {
      throw new Error(`Invalid Context Pack Binding${taskId ? ` for task "${taskId}"` : ''}: malformed-repository-types`);
    }
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
      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: { type: 'closeout.stranded.resumed', input: { drove: result.drove } },
      });
    }
  }
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
 * Generate a readable queue name for a source file. Strips generated prefixes
 * first so round-tripping between open and pending does not accumulate them.
 */
export function queueNameForSource(sourceFile: string): string {
  const baseName = path.basename(sourceFile).replace(/\.md$/i, '');
  return buildReadableTaskFileName({ rawTitle: stripGeneratedTaskPrefix(baseName) });
}

function pendingNameForDropboxSource(sourcePath: string): string {
  const baseName = path.basename(sourcePath);
  return isGeneratedTaskFileName(baseName) ? baseName : queueNameForSource(sourcePath);
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

    let targetName = pendingNameForDropboxSource(sourcePath);
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
  const targetName = pendingNameForDropboxSource(sourcePath);
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
  ACTIVATION_BLOCKED_DIRTY_REPOS: 'activation-blocked-dirty-repos',
  BRANCH_CHAIN_BASE_UNRESOLVED: ACTIVATION_BRANCH_CHAIN_BASE_UNRESOLVED_REASON,
  BRANCH_CONFLICT_RETURNED_OPEN: 'branch-conflict-returned-open',
  SHARED_MCP_BOOTSTRAP_FAILED: 'shared-mcp-bootstrap-failed',
  PIPELINE_SPAWN_FAILED: 'pipeline-spawn-failed',
  OPERATOR_KILL_REQUESTED: 'operator-kill-requested',
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
  let activationQueueName = '';
  let activationTaskTitle: string | null = null;
  let activationStartedAt = '';
  let repoBindings: Array<{
    originalRoot: string;
    worktreeRoot: string;
    worktreeBranch: string;
    baseCommitSha: string;
    branchOwnership: 'task-owned' | 'chain-owned';
    branchChainRootTaskId?: string;
    branchChainTaskId?: string;
  }> = [];
  let readonlyContextBindings: TaskReadonlyContextBinding[] = [];
  let rollbackReadonlyContextBindings: ReadonlyContextRollbackBinding[] = [];
  let rollbackBindings: ActivationRollbackBinding[] = [];
  let packSnapshotPath = '';
  const writeProgress = async (
    phase: ActivationProgressPhase,
    metadata: {
      repoLabel?: string;
      originalRoot?: string;
      branch?: string;
      worktreeRoot?: string;
    } = {},
  ): Promise<void> => {
    if (!taskId || !activationQueueName || !activationStartedAt) return;
    try {
      await writeActivationProgress(paths, {
        taskId,
        queueName: activationQueueName,
        title: activationTaskTitle,
        phase,
        startedAt: activationStartedAt,
        ...metadata,
      });
    } catch (err: unknown) {
      log.warn('activation_progress.write_failed', {
        taskId,
        queueName: activationQueueName,
        phase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const clearProgress = async (reason: string): Promise<void> => {
    if (!taskId) return;
    try {
      await clearActivationProgress(paths, taskId);
    } catch (err: unknown) {
      log.warn('activation_progress.clear_failed', {
        taskId,
        queueName: activationQueueName,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const checkpointKill = async (
    phase: 'pre-worktree' | 'post-materialization' | 'post-sidecar' | 'post-artifacts' | 'pre-pipeline',
  ): Promise<boolean> => {
    if (!taskId || !nextItem) return false;
    if (!await observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId })) return false;
    const includeSidecar = phase === 'post-sidecar' || phase === 'post-artifacts' || phase === 'pre-pipeline';
    await handleActivationKillCheckpoint({
      repoRoot, paths, taskId,
      pendingItemPath: nextItem,
      phase, rollbackBindings,
      ...(phase === 'pre-pipeline' ? { activeMarkerPath } : {}),
      ...(includeSidecar
        ? { sidecarPath: perTaskSidecarPathForKill(), packSnapshotPath: packSnapshotPath || undefined }
        : {}),
    });
    return true;
  };
  const perTaskSidecarPathForKill = (): string | undefined =>
    taskId ? path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json') : undefined;

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

    const activeSet = new Set(currentActive);
    let returnedOpenCount = 0;
    while (true) {
      nextItem = null;
      taskId = '';
      taskHandoffsDir = '';
      taskImplStepsDir = '';
      content = undefined;
      activeMarkerPath = '';
      activationQueueName = '';
      activationTaskTitle = null;
      activationStartedAt = '';
      repoBindings = [];
      readonlyContextBindings = [];
      rollbackReadonlyContextBindings = [];
      rollbackBindings = [];
      packSnapshotPath = '';

      // Skip already-active task IDs so parallel activations pick the next
      // unstarted pending item rather than re-selecting the already-active one.
      nextItem = await nextPendingItemPath(pendingDir, undefined, activeSet);
      if (!nextItem) {
        return returnedOpenCount > 0
          ? { activated: false, reason: ACTIVATION_GATE_REASON.BRANCH_CONFLICT_RETURNED_OPEN }
          : { activated: false };
      }

      // Resolve per-task paths early so readiness check uses the task-specific dir.
      // Per-task handoffs live at AgentWorkSpace/tasks/<taskId>/handoffs/ (§4.2).
      // They are always "ready" (empty) for a new task since the directory won't exist yet.
      taskId = path.basename(nextItem, '.md');
      taskHandoffsDir = paths.taskHandoffs(taskId);
      taskImplStepsDir = paths.taskImplementationSteps(taskId);
      if (await checkpointKill('pre-worktree')) {
        await emitActivationTerminalProgress({
          repoRoot,
          taskId,
          event: { type: 'activation.skipped', input: { reason: 'operator-kill-requested' } },
        });
        return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
      }

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
      activationQueueName = queueName;
      activationTaskTitle = taskTitle;
      activationStartedAt = now;
      await writeProgress('claimed');
      await emitActivationTerminalProgress({
        repoRoot,
        taskId,
        event: { type: 'activation.started' },
      });

      const taskKind = extractLineageValue(content, 'Task Kind') || 'standard';
      const parentTaskId = extractLineageValue(content, 'Parent Task ID');
      const rootTaskId = extractLineageValue(content, 'Root Task ID');
      const branchChainBinding = resolveTaskBranchChainForActivation(
        content,
        taskId,
        taskKind,
        { parentTaskId, rootTaskId },
      );
      const parentQmdRecordId = extractLineageValue(content, 'Parent QMD Record ID');
      const parentQmdScope = extractLineageValue(content, 'Parent QMD Scope');
      const followupReason = extractLineageValue(content, 'Follow-Up Reason');
      const contextPackBinding = extractBindingOrWarn(content, taskId);
      const selection = contextPackBinding ? toTaskContextPackSelection(contextPackBinding) : undefined;

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

      let sections = {
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
      await writeProgress('validating');
      await emitActivationTerminalProgress({
        repoRoot,
        taskId,
        event: { type: 'activation.validating' },
      });

      // Resolve the set of repo roots to materialize worktrees for.
      // Bound context-pack tasks use task binding authority. Unbound context-pack
      // tasks keep the legacy manifest-primary behavior.
      let visibleRepoRoots: string[] = [];
      let selectedRoots: SelectedMaterializationRoot[] = [];
      const selectedGitRoots = new Map<string, string>();
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
        if (contextPackBinding) {
          selectedRoots = await resolveSelectedMaterializationRoots({
            repoRoot,
            contextPackDir: cpDir,
            binding: contextPackBinding,
            taskId,
          });
          visibleRepoRoots = selectedRoots.map((root) => root.originalRoot);
          for (const root of selectedRoots) {
            selectedGitRoots.set(root.originalRoot, root.gitRoot);
          }
        } else {
          const focused = await resolveFocusedRepoRoot(cpDir, repoRoot, undefined);
          visibleRepoRoots = focused?.visibleRepoRoots ?? [];
        }
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

      // Determine paths to clone from the context pack's taskMaterialization field.
      // Defaults to DEFAULT_TASK_MATERIALIZATION_PATHS when field is absent.
      const pathsToClone = resolveTaskMaterializationConfig(undefined).paths;

      const persistedGitRoots = await resolvePersistedGitRootsForActivation(cpDir, repoRoot);
      for (const [root, gitRoot] of selectedGitRoots) {
        persistedGitRoots.set(root, gitRoot);
      }
      const materializationOrigins = await resolveMaterializationOrigins(visibleRepoRoots, persistedGitRoots);
      const dirtyRepos = await findDirtyTargetRepos(materializationOrigins);
      if (dirtyRepos.length > 0) {
        await failPendingActivationForDirtyRepos({
          repoRoot,
          paths,
          taskId,
          pendingItemPath: nextItem,
          content,
          dirtyRepos,
        });
        await clearProgress('dirty-repos');
        return { activated: false, reason: ACTIVATION_GATE_REASON.ACTIVATION_BLOCKED_DIRTY_REPOS };
      }

      let taskPackSnapshot: Awaited<ReturnType<typeof writeTaskPackSnapshot>> | undefined;
      if (contextPackBinding && selection) {
        await ensureDir(path.dirname(perTaskSidecarPath));
        taskPackSnapshot = await writeTaskPackSnapshot({
          repoRoot,
          taskId,
          contextPackDir: contextPackBinding.contextPackDir,
          contextPackId: contextPackBinding.contextPackId,
          binding: contextPackBinding,
          selection,
        });
        packSnapshotPath = resolveTaskPackSnapshotPath(repoRoot, taskId);
      }

      const branchAuthorityPartition = contextPackBinding && selection && taskPackSnapshot
        ? partitionSelectedMaterializationRoots({
            taskId,
            selection,
            selectedRoots,
            snapshot: taskPackSnapshot,
          })
        : undefined;
      const branchOwnedMaterializationOrigins = branchAuthorityPartition
        ? branchAuthorityPartition.branchOwnedRoots.map((root) => ({
            contextRoot: root.originalRoot,
            gitRoot: root.gitRoot,
          }))
        : materializationOrigins;

      const readonlyContextMaterializationOrigins = branchAuthorityPartition
        ? branchAuthorityPartition.readonlyContextRoots.map((root) => ({
            contextRoot: root.originalRoot,
            gitRoot: root.gitRoot,
          }))
        : [];

      // Compute per-repo slugs.  Slug = basename(realpath(root)); if two roots share a
      // basename, append `-<sha8>` suffix (sha8 = first 8 chars of git rev-parse HEAD).
      const allActivationMaterializationOrigins = [
        ...branchOwnedMaterializationOrigins,
        ...readonlyContextMaterializationOrigins,
      ];
      const allRepoLabels = await resolveRepoLabels(allActivationMaterializationOrigins);
      const repoLabels = allRepoLabels.slice(0, branchOwnedMaterializationOrigins.length);
      const readonlyContextRepoLabels = allRepoLabels.slice(branchOwnedMaterializationOrigins.length);
      if (branchAuthorityPartition) {
        log.info('activation.branch_authority_partition.resolved', {
          taskId,
          branchOwnedCount: branchAuthorityPartition.branchOwnedRoots.length,
          readonlyContextCount: branchAuthorityPartition.readonlyContextRoots.length,
          branchOwnedRepoLabels: repoLabels,
          readonlyContextRepoLabels,
        });
      }

      const activationBranchCandidatePlans = await buildActivationBranchCandidatePlans({
        taskId,
        branchChainBinding,
        materializationOrigins: branchOwnedMaterializationOrigins,
        repoLabels,
        repoRoot,
      });
      const branchConflicts = findActivationBranchConflicts({
        repoRoot,
        candidateTaskId: taskId,
        activeTaskIds: currentActive,
        activationBranchCandidatePlans,
      });
      if (branchConflicts.blocked) {
        const firstConflict = branchConflicts.conflicts[0]!;
        const returned = await returnPendingTaskToOpenForBranchConflict({
          repoRoot,
          queuePaths: paths,
          taskId,
          queueName,
          pendingItemPath: nextItem,
          conflict: firstConflict,
        });
        await emitTaskProgressEvent({
          logger: log.child({ taskId }),
          repoRoot,
          taskId,
          event: {
            type: 'queue.active.skipped',
            input: { reason: ACTIVATION_GATE_REASON.BRANCH_CONFLICT_RETURNED_OPEN },
          },
        });
        await emitTaskProgressEvent({
          logger: log.child({ taskId }),
          repoRoot,
          taskId,
          event: {
            type: 'activation.returned-open.branch-conflict',
            input: {
              conflictingTaskId: firstConflict.conflictingTaskId,
              repoLabel: firstConflict.repoLabel,
              repoRoot: firstConflict.originalRoot,
              branch: firstConflict.worktreeBranch,
              openItemPath: returned.openItemPath,
            },
          },
        });
        returnedOpenCount += 1;
        continue;
      }

      const activationBranchPlans = await finalizeActivationBranchPlans({
        taskId,
        branchChainBinding,
        materializationOrigins: branchOwnedMaterializationOrigins,
        repoLabels,
        repoRoot,
        candidatePlans: activationBranchCandidatePlans,
      });

      await ensureDir(path.dirname(perTaskSidecarPath));
      if (await checkpointKill('pre-worktree')) {
        return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
      }

      // Build per-repo binding entries (originalRoot, worktreeRoot, worktreeBranch, baseCommitSha).
      repoBindings = [];
      rollbackBindings = [];
      let combinedMat: { strategy: string; cloned: string[]; skipped: string[] } = {
        strategy: 'copy',
        cloned: [],
        skipped: [],
      };

  try {
    await emitActivationTerminalProgress({
      repoRoot,
      taskId,
      event: { type: 'activation.materializing_worktrees', input: { repoCount: activationBranchPlans.length } },
    });
    for (const plan of activationBranchPlans) {
      const isChainOwnedBranch = plan.mode === 'chained-existing';
      const repoBinding = {
        originalRoot: plan.originalRoot,
        worktreeRoot: plan.worktreeRootForBinding,
        worktreeBranch: plan.worktreeBranch,
        baseCommitSha: plan.baseCommitSha,
        branchOwnership: isChainOwnedBranch ? 'chain-owned' as const : 'task-owned' as const,
        ...(isChainOwnedBranch && branchChainBinding
          ? {
              branchChainRootTaskId: branchChainBinding.rootTaskId,
              branchChainTaskId: taskId,
            }
          : {}),
      };

      if (!plan.addWorktree) {
        repoBindings.push(repoBinding);
        continue;
      }
      if (await checkpointKill(rollbackBindings.length > 0 ? 'post-materialization' : 'pre-worktree')) {
        return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
      }

      const mat = await withOriginLock(plan.originalRoot, async () => {
        await writeProgress('preparing-worktree', {
          repoLabel: plan.repoLabel,
          originalRoot: plan.originalRoot,
          branch: plan.worktreeBranch,
          worktreeRoot: plan.worktreePath,
        });
        if (plan.createBranch) {
          await execFileAsync('git', [
            '-C', plan.originalRoot,
            'worktree', 'add',
            '-b', plan.worktreeBranch,
            plan.worktreePath,
            plan.baseCommitSha,
          ]);
        } else {
          await execFileAsync('git', [
            '-C', plan.originalRoot,
            'worktree', 'add',
            plan.worktreePath,
            plan.worktreeBranch,
          ]);
        }
        rollbackBindings.push({ repoBinding, createdBranch: plan.createBranch });
        repoBindings.push(repoBinding);
        await writeProgress('materializing-worktree', {
          repoLabel: plan.repoLabel,
          originalRoot: plan.originalRoot,
          branch: plan.worktreeBranch,
          worktreeRoot: plan.worktreePath,
        });
        return materializeWorktreeDeps(plan.originalRoot, plan.worktreePath, pathsToClone, {
          taskId,
          repoLabel: plan.repoLabel,
        });
      });
      if (await checkpointKill('post-materialization')) {
        return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
      }

      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: {
          type: 'queue.branch.created',
          input: {
            repo: plan.repoLabel,
            branch: plan.worktreeBranch,
            worktreeRoot: plan.worktreePath,
            materializationStrategy: mat.strategy,
          },
        },
      });

      combinedMat = {
        strategy: mat.strategy,
        cloned: [...combinedMat.cloned, ...mat.cloned],
        skipped: [...combinedMat.skipped, ...mat.skipped],
      };
    }
    if (branchAuthorityPartition) {
      for (let index = 0; index < branchAuthorityPartition.readonlyContextRoots.length; index += 1) {
        const root = branchAuthorityPartition.readonlyContextRoots[index]!;
        const repoLabel = readonlyContextRepoLabels[index]!;
        const worktreeRoot = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, 'worktrees', repoLabel);
        const plan: ReadonlyContextMaterializationPlan = {
          taskId,
          repoId: root.repoId,
          repoLabel,
          originalRoot: root.originalRoot,
          gitRoot: root.gitRoot,
          worktreeRoot,
          source: readonlyContextSourceForReason(root.reason),
        };
        if (await checkpointKill(rollbackBindings.length > 0 ? 'post-materialization' : 'pre-worktree')) {
          return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
        }
        await writeProgress('materializing-worktree', {
          repoLabel,
          originalRoot: root.originalRoot,
          worktreeRoot,
        });
        const result = await materializeReadonlyContextWorktree({
          repoRoot,
          plan,
          pathsToClone,
        });
        rollbackReadonlyContextBindings.push({
          binding: result.binding,
          source: plan.source,
          repoLabel,
        });
        readonlyContextBindings.push(result.binding);
        combinedMat = {
          strategy: combinedMat.strategy,
          cloned: [...combinedMat.cloned, ...result.materialization.cloned],
          skipped: [...combinedMat.skipped, ...result.materialization.skipped],
        };
        await emitTaskProgressEvent({
          logger: log.child({ taskId }),
          repoRoot,
          taskId,
          event: {
            type: 'activation.readonly_context.materialized',
            input: {
              repo: repoLabel,
              worktreeRoot,
              materializationStrategy: 'detached-readonly-context',
            },
          },
        });
      }
    }
  } catch (err) {
    await rollbackActivationClaim({
      repoRoot,
      paths,
      taskId,
      activeMarkerPath,
      repoBindings: rollbackBindings,
      readonlyContextBindings: rollbackReadonlyContextBindings,
    });
    await clearProgress('materialization-rollback');
    throw err;
  }
  if (await checkpointKill(rollbackBindings.length > 0 ? 'post-materialization' : 'pre-worktree')) {
    return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
  }

  await writeProgress('initializing-task');
  await emitActivationTerminalProgress({
    repoRoot,
    taskId,
    event: { type: 'activation.initializing_task' },
  });
  const selectedRepoAliases = [
    ...repoBindings,
    ...readonlyContextBindings,
  ].map((binding) => ({
    repoId: path.basename(binding.worktreeRoot),
    originalRoot: binding.originalRoot,
    worktreeRoot: binding.worktreeRoot,
  }));
  const sanitizedActivationIntake = contextPackBinding
    ? normalizeSelectedRepoPathsInText({
        text: content,
        aliases: selectedRepoAliases,
        mode: 'agent-executable',
      })
    : content;
  sections = {
    ...buildProfessionalTaskSectionsFromIntake(sanitizedActivationIntake),
    ...buildImplementationSpecSectionsFromIntake(sanitizedActivationIntake),
  };
  if (taskPackSnapshot) {
    assertTaskWorktreeBindingsCoverSnapshot({
      taskId,
      snapshot: taskPackSnapshot,
      repoBindings,
      phase: 'activation',
    });
  }

  // Resolve slice artifact format from platform config. Call loadPlatformConfig directly
  // (not getPlatformConfig) so we can distinguish absent-file (=> markdown default) from
  // invalid-field (=> fail closed). Absence of .platform-state/platform.json is allowed
  // in isolated test environments; any other validation error blocks activation.
  let sliceArtifactFormat: import('../platform-config/types.js').SliceArtifactFormat = 'markdown';
  {
    const platformConfigPath = path.join(repoRoot, '.platform-state', 'platform.json');
    const platformConfigResult = await loadPlatformConfig(platformConfigPath);
    if (platformConfigResult.valid) {
      sliceArtifactFormat = platformConfigResult.config.slice_artifact_format;
    } else {
      const isFileMissing = platformConfigResult.errors.every((e) => e.field === '(file)');
      if (!isFileMissing) {
        const details = platformConfigResult.errors
          .map((e) => `${e.field}: ${e.message} (${e.fix})`)
          .join('; ');
        throw new Error(`Invalid platform config; cannot activate task "${taskId}": ${details}`);
      }
      // File absent: default to markdown for compatibility.
    }
  }

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
      readonlyContextBindings,
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
    sliceArtifactFormat,
  };

  await writeFile(
    perTaskSidecarPath,
    JSON.stringify(perTaskSidecar, null, 2) + '\n',
    'utf-8',
  );
  await transferStagedSnapshotToActiveTask(repoRoot, taskId);
  if (await checkpointKill('post-sidecar')) {
    return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
  }

  try {
    await initializeTaskArtifacts({
      handoffsDir: taskHandoffsDir,
      templatesDir,
      metadata,
      lineage,
      sections,
      implementationStepsDir: taskImplStepsDir,
      sliceArtifactFormat,
    });
    // Stage the intake markdown into the per-task handoffs dir so agents
    // (notably Alice) can read their own task's intake without being granted
    // access to the shared pendingitems/ directory, which holds other tasks'
    // files in parallel mode. The canonical copy stays in pendingitems/ —
    // queue lifecycle code is the only authorized writer there.
    if (contextPackBinding) {
      await writeFile(path.join(taskHandoffsDir, 'intake.md'), sanitizedActivationIntake, 'utf-8');
    } else {
      await copyFileSafe(nextItem, path.join(taskHandoffsDir, 'intake.md'));
    }
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
      await emitActivationTerminalProgress({
        repoRoot,
        taskId,
        event: { type: 'activation.failed', input: { reason: 'artifact-initialization-failed' } },
      });
      throw err;
    }
  if (await checkpointKill('post-artifacts')) {
    return { activated: false, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
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
      break;
    }
  } catch (err: unknown) {
    if (isBranchChainBaseUnresolvedActivationError(err) && taskId && nextItem && content !== undefined) {
      await failPendingActivationForBranchChainBaseUnresolved({
        repoRoot,
        paths,
        taskId,
        pendingItemPath: nextItem,
        content,
        error: err,
      });
      return { activated: false, reason: ACTIVATION_GATE_REASON.BRANCH_CHAIN_BASE_UNRESOLVED };
    }
    await clearProgress('activation-exception');
    throw err;
  } finally {
    await releaseActivation();
  }

  if (await checkpointKill('pre-pipeline')) {
    return { activated: true, activatedTaskId: taskId, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
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
        repoBindings: rollbackBindings,
        readonlyContextBindings: rollbackReadonlyContextBindings,
      });
      await clearProgress('shared-mcp-bootstrap-failed');
      const reason = 'shared-mcp-bootstrap-failed';
      await emitTaskProgressEvent({
        logger: log.child({ taskId }),
        repoRoot,
        taskId,
        event: { type: 'queue.active.skipped', input: { reason } },
      });
      return { activated: false, reason: ACTIVATION_GATE_REASON.SHARED_MCP_BOOTSTRAP_FAILED };
    }
  } else {
    log.warn('shared_mcp.bootstrap.skipped', { taskId, reason: 'compose-file-missing' });
  }

  await emitTaskProgressEvent({
    logger: log.child({ taskId }),
    repoRoot,
    taskId,
    event: {
      type: 'queue.active.activated',
      input: {
        repoCount: repoBindings.length,
        branches: repoBindings.map((binding) => binding.worktreeBranch),
      },
    },
  });

  const disablePipelineAutostart = (
    process.env['TASKSAIL_DISABLE_PIPELINE_AUTOSTART'] ?? ''
  ).trim().toLowerCase() === 'true';
  if (disablePipelineAutostart) {
    log.warn('pipeline.autostart.disabled', { taskId });
    try { await unlink(nextItem); } catch { /* best-effort if already absent */ }
    await clearProgress('pipeline-autostart-disabled');
    return { activated: true, activatedTaskId: taskId };
  }
  if (await checkpointKill('pre-pipeline')) {
    return { activated: true, activatedTaskId: taskId, reason: ACTIVATION_GATE_REASON.OPERATOR_KILL_REQUESTED };
  }

  // §5.3: pipelineSupervisor.startPipeline — MUST be the last write before returning.
  // On failure, roll back the active markers so the queue can re-activate.
  let pipelineResult: Awaited<ReturnType<typeof startPipeline>>;
  try {
    await writeProgress('starting-pipeline');
    pipelineResult = await startPipeline(taskId, repoRoot);
  } catch (err) {
    await rollbackActivationClaim({
      repoRoot,
      paths,
      taskId,
      activeMarkerPath,
      repoBindings: rollbackBindings,
      readonlyContextBindings: rollbackReadonlyContextBindings,
    });
    await clearProgress('pipeline-spawn-failed');
    log.error('pipeline.spawn.failed', err, { taskId });
    const reason = 'pipeline-spawn-failed';
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'queue.active.skipped', input: { reason } },
    });
    await emitActivationTerminalProgress({
      repoRoot,
      taskId,
      event: { type: 'activation.skipped', input: { reason } },
    });
    return { activated: false, reason: ACTIVATION_GATE_REASON.PIPELINE_SPAWN_FAILED };
  }
  if ('deferred' in pipelineResult && pipelineResult.deferred) {
    await emitTaskProgressEvent({
      logger: log.child({ taskId }),
      repoRoot,
      taskId,
      event: { type: 'pipeline.deferred' },
    });
    try { await unlink(nextItem); } catch { /* best-effort if already absent */ }
    await clearProgress('pipeline-deferred');
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

  await clearProgress('pipeline-started');
  await emitTaskProgressEvent({
    logger: log.child({ taskId }),
    repoRoot,
    taskId,
    event: { type: 'pipeline.started' },
  });
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

const READONLY_CONTEXT_SOURCE_BY_REASON: Record<string, ReadonlyContextSource> = {
  'deep-focus-readonly': 'deep-focus-readonly-context',
  'monolith-readonly': 'monolith-readonly-context',
};

function readonlyContextSourceForReason(reason: string): ReadonlyContextSource {
  return READONLY_CONTEXT_SOURCE_BY_REASON[reason] ?? 'standard-support';
}

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
  repoBindings: ActivationRollbackBinding[];
  readonlyContextBindings?: readonly ReadonlyContextRollbackBinding[];
}): Promise<void> {
  const {
    repoRoot,
    paths,
    taskId,
    activeMarkerPath,
    repoBindings,
    readonlyContextBindings = [],
  } = options;

  for (const readonlyContextBinding of readonlyContextBindings) {
    const { binding } = readonlyContextBinding;
    await removeReadonlyContextWorktree({
      repoRoot,
      taskId,
      binding,
      source: readonlyContextBinding.source,
      repoLabel: readonlyContextBinding.repoLabel,
    }).catch((err: unknown) => {
      log.warn('readonly_context.worktree.rollback_cleanup.failed', {
        taskId,
        repoId: binding.repoId,
        worktreeRoot: binding.worktreeRoot,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  for (const rollbackBinding of repoBindings) {
    const binding = rollbackBinding.repoBinding;
    if (binding.worktreeRoot && binding.worktreeRoot !== binding.originalRoot) {
      await execFileAsync('git', [
        '-C', binding.originalRoot,
        'worktree', 'remove', '--force', binding.worktreeRoot,
      ]).catch(() => {});
      await execFileAsync('git', ['-C', binding.originalRoot, 'worktree', 'prune']).catch(() => {});
    }
    if (rollbackBinding.createdBranch && binding.worktreeBranch) {
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
