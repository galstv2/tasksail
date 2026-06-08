import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createLogger,
  emitTaskProgressEvent,
  ensureDir,
  getErrorMessage,
  moveFile,
  writeTextFileAtomic,
} from '../core/index.js';
import { listActivePipelines, stopPipeline } from '../agent-runner/pipelineSupervisor.js';
import { pipelineKillSwitchExists, requestPipelineKill } from '../agent-runner/pipeline/runtimeControl.js';
import type { ActivationRollbackBinding } from './branchChainActivation.js';
import { clearActivationProgress, readActivationProgressRecord } from './activationProgress.js';
import { withDirLock } from './dirLock.js';
import { moveFailedItemToErrorItems } from './errorItems.js';
import { assertValidTaskId, resolveQueuePaths, type QueuePaths } from './paths.js';
import { removeFromQueueOrderManifest } from './queueOrderManifest.js';
import { transitionTask } from './taskRegistry.js';

const execFileAsync = promisify(execFile);
const log = createLogger('platform/queue/killTask');

export type TaskKillRequest = {
  schemaVersion: 1;
  taskId: string;
  requestedAt: string;
  requestedBy: 'taskboard';
  reason: 'operator-kill-switch';
  cleanupStatus?: TaskKillCleanupStatus;
  cleanupAttemptCount?: number;
  cleanupLastAttemptAt?: string;
  cleanupLastFailedAt?: string;
  cleanupLastErrorCode?: TaskKillCleanupFailureCode;
  cleanupLastErrorMessage?: string;
};

export type TaskKillCleanupStatus = 'requested' | 'running' | 'failed';

export type TaskKillCleanupFailureCode =
  | 'unproven-stopped'
  | 'failed-item-cleanup-failed'
  | 'activation-cleanup-failed'
  | 'unexpected-cleanup-error';

export type TaskKillRequestAccepted = {
  mode: 'kill-requested';
  message: string;
  taskId: string;
  requestedAt: string;
  state: 'active' | 'activating';
};

type ActivationKillPhase =
  | 'pre-worktree'
  | 'post-materialization'
  | 'post-sidecar'
  | 'post-artifacts'
  | 'pre-pipeline';

function killMarkerPath(killRequestsDir: string, taskId: string): string {
  assertValidTaskId(taskId);
  return path.join(killRequestsDir, `${taskId}.json`);
}

function parseKillRequest(value: unknown, taskId: string): TaskKillRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1
    || record.taskId !== taskId
    || typeof record.requestedAt !== 'string'
    || record.requestedBy !== 'taskboard'
    || record.reason !== 'operator-kill-switch'
  ) {
    return null;
  }
  if (
    record.cleanupStatus !== undefined
    && record.cleanupStatus !== 'requested'
    && record.cleanupStatus !== 'running'
    && record.cleanupStatus !== 'failed'
  ) {
    return null;
  }
  if (record.cleanupAttemptCount !== undefined && typeof record.cleanupAttemptCount !== 'number') return null;
  if (record.cleanupLastAttemptAt !== undefined && typeof record.cleanupLastAttemptAt !== 'string') return null;
  if (record.cleanupLastFailedAt !== undefined && typeof record.cleanupLastFailedAt !== 'string') return null;
  if (
    record.cleanupLastErrorCode !== undefined
    && record.cleanupLastErrorCode !== 'unproven-stopped'
    && record.cleanupLastErrorCode !== 'failed-item-cleanup-failed'
    && record.cleanupLastErrorCode !== 'activation-cleanup-failed'
    && record.cleanupLastErrorCode !== 'unexpected-cleanup-error'
  ) {
    return null;
  }
  if (record.cleanupLastErrorMessage !== undefined && typeof record.cleanupLastErrorMessage !== 'string') return null;
  return record as TaskKillRequest;
}

export async function observeKillRequest(args: {
  killRequestsDir: string;
  taskId: string;
}): Promise<TaskKillRequest | null> {
  let markerPath: string;
  try {
    markerPath = killMarkerPath(args.killRequestsDir, args.taskId);
  } catch {
    return null;
  }
  try {
    return parseKillRequest(JSON.parse(await readFile(markerPath, 'utf-8')), args.taskId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('task_kill.marker.read_ignored', {
        taskId: args.taskId,
        markerPath,
        error: getErrorMessage(err),
      });
    }
    return null;
  }
}

export async function writeKillRequest(args: {
  killRequestsDir: string;
  taskId: string;
  now?: Date;
}): Promise<{ markerPath: string; created: boolean; record: TaskKillRequest }> {
  const markerPath = killMarkerPath(args.killRequestsDir, args.taskId);
  const existing = await observeKillRequest(args);
  if (existing) return { markerPath, created: false, record: existing };
  const record: TaskKillRequest = {
    schemaVersion: 1,
    taskId: args.taskId,
    requestedAt: (args.now ?? new Date()).toISOString(),
    requestedBy: 'taskboard',
    reason: 'operator-kill-switch',
  };
  await writeKillRequestRecord(args.killRequestsDir, record);
  return { markerPath, created: true, record };
}

export async function clearKillRequest(args: {
  killRequestsDir: string;
  taskId: string;
}): Promise<void> {
  await rm(killMarkerPath(args.killRequestsDir, args.taskId), { force: true });
}

function sanitizeCleanupErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (message || 'Cleanup failed.').slice(0, 240);
}

async function writeKillRequestRecord(killRequestsDir: string, record: TaskKillRequest): Promise<void> {
  await writeTextFileAtomic(killMarkerPath(killRequestsDir, record.taskId), JSON.stringify(record, null, 2) + '\n');
}

export async function markKillCleanupAttemptStarted(args: {
  killRequestsDir: string;
  taskId: string;
  now?: Date;
}): Promise<TaskKillRequest | null> {
  const existing = await observeKillRequest(args);
  if (!existing) return null;
  const record: TaskKillRequest = {
    ...existing,
    cleanupStatus: 'running',
    cleanupAttemptCount: (existing.cleanupAttemptCount ?? 0) + 1,
    cleanupLastAttemptAt: (args.now ?? new Date()).toISOString(),
  };
  delete record.cleanupLastFailedAt;
  delete record.cleanupLastErrorCode;
  delete record.cleanupLastErrorMessage;
  await writeKillRequestRecord(args.killRequestsDir, record);
  log.info('task_kill.cleanup_attempt_started', {
    taskId: args.taskId,
    cleanupAttemptCount: record.cleanupAttemptCount,
  });
  return record;
}

export async function markKillCleanupAttemptFailed(args: {
  killRequestsDir: string;
  taskId: string;
  errorCode: TaskKillCleanupFailureCode;
  error: unknown;
  now?: Date;
}): Promise<TaskKillRequest | null> {
  const existing = await observeKillRequest(args);
  if (!existing) {
    log.warn('task_kill.cleanup_marker_update_failed', {
      taskId: args.taskId,
      cleanupLastErrorCode: args.errorCode,
      error: 'No valid kill marker exists.',
    });
    return null;
  }
  const failedAt = (args.now ?? new Date()).toISOString();
  const record: TaskKillRequest = {
    ...existing,
    cleanupStatus: 'failed',
    cleanupAttemptCount: Math.max(existing.cleanupAttemptCount ?? 1, 1),
    cleanupLastAttemptAt: existing.cleanupLastAttemptAt ?? failedAt,
    cleanupLastFailedAt: failedAt,
    cleanupLastErrorCode: args.errorCode,
    cleanupLastErrorMessage: sanitizeCleanupErrorMessage(args.error),
  };
  await writeKillRequestRecord(args.killRequestsDir, record);
  log.error('task_kill.cleanup_attempt_failed', new Error(record.cleanupLastErrorMessage ?? 'Cleanup failed.'), {
    taskId: args.taskId,
    cleanupAttemptCount: record.cleanupAttemptCount,
    cleanupLastErrorCode: record.cleanupLastErrorCode,
    error: record.cleanupLastErrorMessage,
  });
  return record;
}

export async function sweepStaleKillRequests(args: {
  repoRoot: string;
  paths: QueuePaths;
  reason: 'startup-recovery';
}): Promise<{ removed: string[] }> {
  let entries: string[];
  try {
    entries = (await readdir(args.paths.killRequestsDir)).filter((entry) => entry.endsWith('.json') && !entry.startsWith('.')).sort();
  } catch {
    return { removed: [] };
  }
  const removed: string[] = [];
  for (const entry of entries) {
    const taskId = entry.replace(/\.json$/, '');
    const markerPath = path.join(args.paths.killRequestsDir, entry);
    const marker = await observeKillRequest({ killRequestsDir: args.paths.killRequestsDir, taskId });
    const hasPending = existsSync(path.join(args.paths.pendingDir, `${taskId}.md`));
    const hasActive = existsSync(path.join(args.paths.activeItemsDir, taskId));
    const activatingMarkerPath = path.join(args.paths.activatingItemsDir, `${taskId}.json`);
    const hasActivating = existsSync(activatingMarkerPath);
    if (hasActive) continue;
    if (marker && hasPending && !hasActivating) continue;
    if (!marker || !hasPending || hasActivating) {
      await rm(markerPath, { force: true });
      if (hasActivating) await rm(activatingMarkerPath, { force: true });
      removed.push(taskId);
      log.warn('task_kill.marker.swept', {
        taskId,
        markerPath,
        reason: args.reason,
        malformed: marker === null,
        state: hasActivating ? 'activating' : hasPending ? 'pending' : 'missing-pending',
      });
    }
  }
  return { removed };
}

async function rollbackBindings(bindings: ActivationRollbackBinding[]): Promise<void> {
  for (const rollbackBinding of bindings) {
    const binding = rollbackBinding.repoBinding;
    if (binding.worktreeRoot && binding.worktreeRoot !== binding.originalRoot) {
      await execFileAsync('git', ['-C', binding.originalRoot, 'worktree', 'remove', '--force', binding.worktreeRoot]).catch(() => {});
      await execFileAsync('git', ['-C', binding.originalRoot, 'worktree', 'prune']).catch(() => {});
    }
    if (rollbackBinding.createdBranch && binding.worktreeBranch) {
      // '--' guards against an agent-authored branch name starting with '-'.
      await execFileAsync('git', ['-C', binding.originalRoot, 'branch', '-D', '--', binding.worktreeBranch]).catch(() => {});
    }
  }
}

export async function handleActivationKillCheckpoint(args: {
  repoRoot: string;
  paths: QueuePaths;
  taskId: string;
  pendingItemPath: string;
  phase: ActivationKillPhase;
  rollbackBindings: ActivationRollbackBinding[];
  activeMarkerPath?: string;
  sidecarPath?: string;
  packSnapshotPath?: string;
}): Promise<void> {
  const start = Date.now();
  log.warn('task_kill.activation_checkpoint_observed', {
    taskId: args.taskId,
    phase: args.phase,
  });
  try {
    if (args.phase === 'pre-pipeline') {
      await moveFailedItemToErrorItems({ repoRoot: args.repoRoot, taskId: args.taskId });
    } else {
      await rollbackBindings(args.rollbackBindings);
      await rm(args.paths.taskWorktree(args.taskId), { recursive: true, force: true }).catch(() => {});
      if (args.sidecarPath) await unlink(args.sidecarPath).catch(() => {});
      if (args.packSnapshotPath) await unlink(args.packSnapshotPath).catch(() => {});
      await ensureDir(args.paths.errorItemsDir);
      const fileName = `${args.taskId}.md`;
      await moveFile(args.pendingItemPath, path.join(args.paths.errorItemsDir, fileName));
      await removeFromQueueOrderManifest(args.paths.queueOrderPath, fileName);
      try {
        await transitionTask(args.repoRoot, args.taskId, 'pending', 'failed');
      } catch (err) {
        log.warn('task_kill.activation_registry_transition_failed', {
          taskId: args.taskId,
          error: getErrorMessage(err),
        });
      }
    }
  } catch (err) {
    try {
      await withTaskKillLock(args.paths, args.taskId, async () => {
        await markKillCleanupAttemptFailed({
          killRequestsDir: args.paths.killRequestsDir,
          taskId: args.taskId,
          errorCode: 'activation-cleanup-failed',
          error: err,
        });
      });
    } catch (markerErr) {
      log.warn('task_kill.cleanup_marker_update_failed', {
        taskId: args.taskId,
        cleanupLastErrorCode: 'activation-cleanup-failed',
        error: getErrorMessage(markerErr),
      });
    }
    throw err;
  }
  await clearActivationProgress(args.paths, args.taskId).catch(() => {});
  try {
    await clearKillRequest({ killRequestsDir: args.paths.killRequestsDir, taskId: args.taskId });
  } catch (err) {
    log.warn('task_kill.activation_cleanup_completed', {
      taskId: args.taskId,
      phase: args.phase,
      elapsedMs: Date.now() - start,
      markerClearWarning: getErrorMessage(err),
    });
    return;
  }
  log.info('task_kill.activation_cleanup_completed', {
    taskId: args.taskId,
    phase: args.phase,
    elapsedMs: Date.now() - start,
  });
}

async function nextActiveAfterKill(repoRoot: string, killedTaskId: string): Promise<string | null> {
  const running = listActivePipelines().find((entry) => entry.taskId !== killedTaskId);
  if (running) return running.taskId;
  const paths = resolveQueuePaths(repoRoot);
  try {
    const marker = (await readdir(paths.activeItemsDir))
      .filter((entry) => !entry.endsWith('.completing') && entry !== killedTaskId)
      .sort()[0];
    if (marker) return marker;
  } catch {}
  try {
    return (await readdir(paths.pendingDir)).filter((entry) => entry.endsWith('.md') && !entry.startsWith('.')).sort()[0]?.replace(/\.md$/, '') ?? null;
  } catch {
    return null;
  }
}

async function withTaskKillLock<T>(
  paths: QueuePaths,
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  assertValidTaskId(taskId);
  const lockDir = path.join(paths.killRequestsDir, '.locks', taskId);
  await ensureDir(path.dirname(lockDir));
  return withDirLock(lockDir, 'Kill task', fn);
}

export async function killTask(args: {
  repoRoot: string;
  taskId: string;
}): Promise<
  | { mode: 'failed'; message: string; taskId: string; movedItem?: string; nextActiveItem?: string | null }
  | TaskKillRequestAccepted
> {
  const accepted = await requestTaskKill(args);
  const cleanup = await executeRequestedTaskKill(args);
  if (cleanup.mode === 'kill-requested') {
    return accepted;
  }
  return {
    mode: 'failed',
    message: `Task stopped by operator and moved to Failed: ${args.taskId}.`,
    taskId: args.taskId,
    movedItem: cleanup.movedItem,
    nextActiveItem: cleanup.nextActiveItem,
  };
}

export async function requestTaskKill(args: {
  repoRoot: string;
  taskId: string;
}): Promise<TaskKillRequestAccepted> {
  const paths = resolveQueuePaths(args.repoRoot);
  return withTaskKillLock(paths, args.taskId, async () => {
    const activeMarkerPath = path.join(paths.activeItemsDir, args.taskId);
    const hasActiveMarker = existsSync(activeMarkerPath);
    const hasPipeline = listActivePipelines().some((entry) => entry.taskId === args.taskId);
    const hasActivationProgress = await readActivationProgressRecord(paths, args.taskId) !== null;
    if (!hasActiveMarker && !hasPipeline && !hasActivationProgress) {
      throw new Error(`Task "${args.taskId}" is not active or activating.`);
    }

    const marker = await writeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: args.taskId });
    const state = hasActiveMarker || hasPipeline ? 'active' : 'activating';
    if (marker.created) {
      log.warn('task_kill.requested', {
        taskId: args.taskId,
        markerPath: marker.markerPath,
        state,
        requestedAt: marker.record.requestedAt,
      });
      await emitTaskProgressEvent({
        logger: log.child({ taskId: args.taskId }),
        repoRoot: args.repoRoot,
        taskId: args.taskId,
        event: { type: 'kill.requested', input: { state, requestedAt: marker.record.requestedAt } },
      });
    }

    return {
      mode: 'kill-requested',
      message: state === 'active'
        ? `Stop requested for active task: ${args.taskId}.`
        : `Stop requested for activating task: ${args.taskId}.`,
      taskId: args.taskId,
      requestedAt: marker.record.requestedAt,
      state,
    };
  });
}

async function runActiveKillCleanup(args: {
  repoRoot: string;
  taskId: string;
  paths: QueuePaths;
  start: number;
}): Promise<{ mode: 'failed'; taskId: string; movedItem: string; nextActiveItem?: string | null }> {
  log.warn('task_kill.active_cleanup_started', { taskId: args.taskId });
  await emitTaskProgressEvent({
    logger: log.child({ taskId: args.taskId }),
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: { type: 'kill.cleanup.started' },
  });
  const moved = await moveFailedItemToErrorItems({ repoRoot: args.repoRoot, taskId: args.taskId });
  await clearKillRequest({ killRequestsDir: args.paths.killRequestsDir, taskId: args.taskId });
  const nextActiveItem = moved.nextActiveItem ?? await nextActiveAfterKill(args.repoRoot, args.taskId);
  await emitTaskProgressEvent({
    logger: log.child({ taskId: args.taskId }),
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: { type: 'queue.task.failed' },
  });
  log.info('task_kill.active_cleanup_completed', {
    taskId: args.taskId,
    movedItem: moved.movedItem,
    nextActiveItem,
    elapsedMs: Date.now() - args.start,
  });
  await emitTaskProgressEvent({
    logger: log.child({ taskId: args.taskId }),
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: { type: 'kill.cleanup.completed' },
  });
  return {
    mode: 'failed',
    taskId: args.taskId,
    movedItem: moved.movedItem,
    nextActiveItem,
  };
}

// Bounded window (ms) given to the owning process to acknowledge the durable kill switch.
const CROSS_PROCESS_KILL_ACK_WINDOW_MS = 5000;
// Poll interval for kill-switch acknowledgment.
const CROSS_PROCESS_KILL_POLL_INTERVAL_MS = 250;

/**
 * Poll until the owning process acknowledges the durable kill switch (by clearing
 * the switch file or removing the active marker), or the window expires.
 *
 * Injectable for tests via `_sleepMs` (replaces real setTimeout delay).
 */
async function pollForCrossProcessKillAck(args: {
  repoRoot: string;
  taskId: string;
  activeMarkerPath: string;
  windowMs: number;
  _sleepMs?: (ms: number) => Promise<void>;
}): Promise<'acked' | 'timeout'> {
  const sleepMs = args._sleepMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + args.windowMs;
  while (Date.now() < deadline) {
    const switchGone = !pipelineKillSwitchExists(args.repoRoot, args.taskId);
    const markerGone = !existsSync(args.activeMarkerPath);
    if (switchGone || markerGone) return 'acked';
    await sleepMs(CROSS_PROCESS_KILL_POLL_INTERVAL_MS);
  }
  // Final check after deadline.
  if (!pipelineKillSwitchExists(args.repoRoot, args.taskId) || !existsSync(args.activeMarkerPath)) {
    return 'acked';
  }
  return 'timeout';
}

export async function executeRequestedTaskKill(args: {
  repoRoot: string;
  taskId: string;
  /** Injectable for tests: replaces real setTimeout in the cross-process kill-ack poll. */
  _sleepMs?: (ms: number) => Promise<void>;
  /** Injectable for tests: overrides the cross-process kill-ack window duration. */
  _crossProcessKillWindowMs?: number;
}): Promise<
  | { mode: 'failed'; taskId: string; movedItem: string; nextActiveItem?: string | null }
  | { mode: 'kill-requested'; taskId: string }
> {
  const paths = resolveQueuePaths(args.repoRoot);
  return withTaskKillLock(paths, args.taskId, async () => {
    const marker = await observeKillRequest({ killRequestsDir: paths.killRequestsDir, taskId: args.taskId });
    if (!marker) return { mode: 'kill-requested', taskId: args.taskId };

    const start = Date.now();
    const recordFailure = async (errorCode: TaskKillCleanupFailureCode, err: unknown) => {
      const failedRecord = await markKillCleanupAttemptFailed({
        killRequestsDir: paths.killRequestsDir,
        taskId: args.taskId,
        errorCode,
        error: err,
      }).catch((markerErr) => {
        log.warn('task_kill.cleanup_marker_update_failed', {
          taskId: args.taskId,
          cleanupLastErrorCode: errorCode,
          error: getErrorMessage(markerErr),
        });
        return null;
      });
      await emitTaskProgressEvent({
        logger: log.child({ taskId: args.taskId }),
        repoRoot: args.repoRoot,
        taskId: args.taskId,
        event: { type: 'kill.cleanup.failed', input: { errorCode, cleanupAttemptCount: failedRecord?.cleanupAttemptCount ?? 1 } },
      });
    };
    const markStarted = () => markKillCleanupAttemptStarted({ killRequestsDir: paths.killRequestsDir, taskId: args.taskId });

    let outcome: Awaited<ReturnType<typeof stopPipeline>>;
    try {
      outcome = await stopPipeline(args.taskId, undefined, { cleanupOwner: 'caller' });
    } catch (err) {
      await markStarted();
      await recordFailure('unexpected-cleanup-error', err);
      throw err;
    }
    if (outcome.status === 'not-running') {
      const activeMarkerPath = path.join(paths.activeItemsDir, args.taskId);
      const hasActiveMarker = existsSync(activeMarkerPath);
      const hasActivationProgress = await readActivationProgressRecord(paths, args.taskId) !== null;
      if (hasActivationProgress || !hasActiveMarker) {
        return { mode: 'kill-requested', taskId: args.taskId };
      }
      // Cross-process kill path: write the durable kill switch and give the owning process
      // a bounded window to acknowledge before we proceed to terminal cleanup ourselves.
      await requestPipelineKill(args.repoRoot, args.taskId, 'cross-process-operator-kill');
      const ackResult = await pollForCrossProcessKillAck({
        repoRoot: args.repoRoot,
        taskId: args.taskId,
        activeMarkerPath,
        windowMs: args._crossProcessKillWindowMs ?? CROSS_PROCESS_KILL_ACK_WINDOW_MS,
        _sleepMs: args._sleepMs,
      });
      if (ackResult === 'timeout' && existsSync(activeMarkerPath)) {
        log.warn('task_kill.cross_process_ownership_unconfirmed', {
          taskId: args.taskId,
          windowMs: args._crossProcessKillWindowMs ?? CROSS_PROCESS_KILL_ACK_WINDOW_MS,
        });
      }
      await markStarted();
      try {
        return await runActiveKillCleanup({ ...args, paths, start });
      } catch (err) {
        await recordFailure('failed-item-cleanup-failed', err);
        throw err;
      }
    }
    if (outcome.status === 'unproven-stopped') {
      await markStarted();
      const error = new Error(`Unable to prove pipeline stopped for task "${args.taskId}".`);
      await recordFailure('unproven-stopped', error);
      log.error('task_kill.failed', new Error('Pipeline stop could not be proven.'), {
        taskId: args.taskId,
        outcome: outcome.status,
      });
      throw error;
    }
    await emitTaskProgressEvent({
      logger: log.child({ taskId: args.taskId }),
      repoRoot: args.repoRoot,
      taskId: args.taskId,
      event: { type: 'pipeline.killed', input: { reason: 'killed' } },
    });
    await markStarted();
    try {
      return await runActiveKillCleanup({ ...args, paths, start });
    } catch (err) {
      await recordFailure('failed-item-cleanup-failed', err);
      throw err;
    }
  });
}
