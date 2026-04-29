import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { TaskHealthRollup, TaskRecoveryKind, TaskRecoveryState } from '../src/shared/desktopContract';
import {
  acquireDirLockOrThrow,
  activateNextPendingItemIfReady,
  moveFailedItemToErrorItems,
  repairQueue,
  resolveQueuePaths,
} from '../../../backend/platform/queue';
import type { QueueRepairIssue } from '../../../backend/platform/queue/repairQueue.js';
import { REPO_ROOT } from './paths';
import { readObservabilitySnapshot } from './repoObservability';
import {
  clearTaskRecoveryState,
  writeTaskRecoveryState,
  readTaskRecoveryState,
} from './main.recoveryState';
import { emitStreamEvent } from './main.stream';
import { pathExists, repoFs } from './utils';

// §5.3B: Per-task runtime paths. Singleton constants deleted.
// Active markers live in ACTIVE_ITEMS_DIR (one file per taskId, §4.1 parallel model).
const ACTIVE_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');

const DEFAULT_ACTIVATION_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;
/** Grace period before auto-failing on runtime failure after fresh activation. */
const RUNTIME_FAILURE_GRACE_MS = 30_000;

type TaskRecoveryController = {
  noteActivatedPendingItem: (queueName: string) => void;
  reconcileNow: () => void;
  stop: () => void;
};

function queueNameToTaskId(queueName: string | null): string | null {
  if (!queueName || !queueName.endsWith('.md')) {
    return null;
  }
  return queueName.replace(/\.md$/u, '');
}

function buildRecoveryState(args: {
  kind: TaskRecoveryKind;
  status: TaskRecoveryState['status'];
  summary: string;
  queueName: string | null;
  activationStartedAt: string | null;
  deadlineAt: string | null;
  errorItemPath?: string | null;
}): TaskRecoveryState {
  const now = new Date().toISOString();
  return {
    kind: args.kind,
    status: args.status,
    summary: args.summary,
    queueName: args.queueName,
    taskId: queueNameToTaskId(args.queueName),
    activationStartedAt: args.activationStartedAt,
    deadlineAt: args.deadlineAt,
    detectedAt: now,
    updatedAt: now,
    errorItemPath: args.errorItemPath ?? null,
  };
}

function refreshRecoveryState(
  previous: TaskRecoveryState | null,
  next: TaskRecoveryState,
): TaskRecoveryState {
  return {
    ...next,
    detectedAt:
      previous &&
      previous.kind === next.kind &&
      previous.status === next.status &&
      previous.queueName === next.queueName
        ? previous.detectedAt
        : next.detectedAt,
    updatedAt: new Date().toISOString(),
  };
}

function recoveryStatesMatch(
  left: TaskRecoveryState | null,
  right: TaskRecoveryState | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.kind === right.kind
    && left.status === right.status
    && left.summary === right.summary
    && left.queueName === right.queueName
    && left.taskId === right.taskId
    && left.activationStartedAt === right.activationStartedAt
    && left.deadlineAt === right.deadlineAt
    && left.errorItemPath === right.errorItemPath;
}

/** Returns sorted active marker taskIds (excluding `.completing` sentinels and dotfiles). */
async function readSortedActiveMarkers(): Promise<string[]> {
  if (!(await pathExists(ACTIVE_ITEMS_DIR, repoFs))) {
    return [];
  }
  try {
    return (await readdir(ACTIVE_ITEMS_DIR))
      .filter((f) => !f.endsWith('.completing') && !f.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

/** §5.3B: queueName of the first active marker, or null. */
async function readActiveQueueName(): Promise<string | null> {
  const entries = await readSortedActiveMarkers();
  return entries.length > 0 ? entries[0]! + '.md' : null;
}

/** §5.3B: mtime of the first active marker file, or null. */
async function readActiveItemMtimeIso(): Promise<string | null> {
  const entries = await readSortedActiveMarkers();
  if (entries.length === 0) {
    return null;
  }
  try {
    const details = await stat(join(ACTIVE_ITEMS_DIR, entries[0]!));
    return details.mtime.toISOString();
  } catch {
    return null;
  }
}

async function directoryHasRecentJsonArtifact(
  directoryPath: string,
  sinceMs: number,
): Promise<boolean> {
  if (!(await pathExists(directoryPath, repoFs))) {
    return false;
  }

  const entries = await readdir(directoryPath);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    try {
      const details = await stat(join(directoryPath, entry));
      if (details.mtimeMs >= sinceMs) {
        return true;
      }
    } catch {
      // Ignore vanished files between readdir and stat.
    }
  }

  return false;
}

async function fileHasRecentArtifact(
  filePath: string,
  sinceMs: number,
): Promise<boolean> {
  if (!(await pathExists(filePath, repoFs))) {
    return false;
  }

  try {
    const details = await stat(filePath);
    return details.mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

/**
 * §5.3B: hasPipelineStartEvidence is now per-task.
 * Checks per-task runtime dir at .platform-state/runtime/tasks/<taskId>/.
 * taskId is derived from activeQueueName (queueName without .md extension).
 */
async function hasPipelineStartEvidence(
  taskId: string | null,
  activationStartedAt: string | null,
): Promise<boolean> {
  if (!taskId) return false;

  const taskRuntimeDir = join(REPO_ROOT, '.platform-state', 'runtime', 'tasks', taskId);
  const roleSessionsDir = join(taskRuntimeDir, 'role-sessions');
  const guardrailsDir = join(taskRuntimeDir, 'guardrails');
  const pipelineReceiptPath = join(taskRuntimeDir, 'pipeline-receipt.json');
  // §5.3B: per-task pipeline lock (no singleton PIPELINE_LOCK_DIR).
  const pipelineLockDir = join(taskRuntimeDir, 'pipeline.lock');

  if (await pathExists(pipelineLockDir, repoFs)) {
    return true;
  }

  const sinceMs = activationStartedAt ? Date.parse(activationStartedAt) : Number.NaN;
  if (!Number.isFinite(sinceMs)) {
    return false;
  }

  const evidence = await Promise.all([
    fileHasRecentArtifact(pipelineReceiptPath, sinceMs),
    directoryHasRecentJsonArtifact(roleSessionsDir, sinceMs),
    directoryHasRecentJsonArtifact(guardrailsDir, sinceMs),
  ]);

  return evidence.some(Boolean);
}

function hasCriticalRuntimeFailure(taskHealth: TaskHealthRollup | undefined): boolean {
  if (!taskHealth) {
    return false;
  }

  return taskHealth.failedCount > 0 || taskHealth.orphanedCount > 0;
}

/**
 * §5.3B: Switch on .kind (structured) instead of matching rendered strings.
 * Fixable issues are those where autoFix can restore queue consistency.
 */
function isFixableRepairIssue(issue: QueueRepairIssue): boolean {
  return issue.kind === 'marker-without-pending'
    || issue.kind === 'sentinel-without-completed-marker';
}

/**
 * §5.3B: Queue divergence = pending items without active markers,
 * indicating an orphaned handoffs workspace with no task claim.
 */
function isQueueDivergenceIssue(issue: QueueRepairIssue): boolean {
  return issue.kind === 'pending-without-marker';
}

async function activateNextPendingItemAfterRepair(
  queuePaths: ReturnType<typeof resolveQueuePaths>,
): Promise<string | null> {
  const result = await activateNextPendingItemIfReady({
    paths: queuePaths,
    repoRoot: REPO_ROOT,
  });
  if (!result.activated) {
    return null;
  }

  return readActiveQueueName();
}

export function startTaskRecoveryController(options: {
  activationGraceMs?: number;
  pollIntervalMs?: number;
  schedulePipelineAutoStart: () => void;
}): TaskRecoveryController {
  const activationGraceMs = options.activationGraceMs ?? DEFAULT_ACTIVATION_GRACE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const queuePaths = resolveQueuePaths(REPO_ROOT);

  let stopped = false;
  let reconcileInFlight = false;
  let reconcileQueued = false;
  let interval: NodeJS.Timeout | null = null;

  const persistRecoveryState = async (
    nextState: TaskRecoveryState | null,
  ): Promise<void> => {
    const previous = await readTaskRecoveryState();
    if (recoveryStatesMatch(previous, nextState)) {
      return;
    }

    if (!nextState) {
      await clearTaskRecoveryState();
      return;
    }

    await writeTaskRecoveryState(refreshRecoveryState(previous, nextState));
  };

  const scheduleAutoStartForNext = async (queueName: string | null): Promise<void> => {
    if (!queueName) {
      return;
    }

    // §5.3B: Guard per-task lock instead of singleton PIPELINE_LOCK_DIR.
    // Check if any pipeline is already active via pipelineSupervisor state.
    // The simplest check: if the activeQueueName still has evidence, skip.
    const taskId = queueNameToTaskId(queueName);
    if (taskId) {
      const taskPipelineLockDir = join(REPO_ROOT, '.platform-state', 'runtime', 'tasks', taskId, 'pipeline.lock');
      if (await pathExists(taskPipelineLockDir)) {
        return;
      }
    }

    const activationStartedAt = await readActiveItemMtimeIso();
    await persistRecoveryState(buildRecoveryState({
      kind: 'activation-timeout',
      status: 'pending-start',
      summary: `Waiting for pipeline activity for ${queueName}.`,
      queueName,
      activationStartedAt,
      deadlineAt: activationStartedAt
        ? new Date(Date.parse(activationStartedAt) + activationGraceMs).toISOString()
        : null,
    }));
    options.schedulePipelineAutoStart();
  };

  const withQueueLockIfAvailable = async (
    operationName: string,
    work: () => Promise<void>,
  ): Promise<void> => {
    let release: (() => Promise<void>) | null = null;
    try {
      release = await acquireDirLockOrThrow(queuePaths.queueLockDir, operationName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('could not acquire queue lock')) {
        return;
      }
      throw error;
    }

    try {
      await work();
    } finally {
      await release();
    }
  };

  const reconcile = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (reconcileInFlight) {
      reconcileQueued = true;
      return;
    }

    reconcileInFlight = true;
    try {
      const [activeQueueName, activeItemMtime, recoveryState, observability, repairProbe] =
        await Promise.all([
          readActiveQueueName(),
          readActiveItemMtimeIso(),
          readTaskRecoveryState(),
          readObservabilitySnapshot(),
          repairQueue({ repoRoot: REPO_ROOT, dryRun: true }),
        ]);

      if (!activeQueueName) {
        // §5.3B: use structuredIssues instead of string-matched issues array.
        const divergenceIssue = repairProbe.structuredIssues?.find(isQueueDivergenceIssue) ?? null;
        if (divergenceIssue) {
          await persistRecoveryState(buildRecoveryState({
            kind: 'queue-divergence',
            status: 'recovery-needed',
            summary: divergenceIssue.detail ?? `Queue divergence detected: ${divergenceIssue.kind}`,
            queueName: null,
            activationStartedAt: null,
            deadlineAt: null,
          }));
        } else if (recoveryState?.status !== 'auto-failed') {
          await persistRecoveryState(null);
        }
        return;
      }

      // §5.3B: use structuredIssues for fixable issue detection.
      const fixableIssues = repairProbe.structuredIssues?.filter(isFixableRepairIssue) ?? [];
      if (fixableIssues.length > 0) {
        await withQueueLockIfAvailable('desktop.repairRecoveryState', async () => {
          const fixed = await repairQueue({ repoRoot: REPO_ROOT, autoFix: true });
          if (fixed.fixed.length === 0) {
            return;
          }

          emitStreamEvent({
            message: `Recovered stranded workspace state: ${fixed.fixed.join('; ')}`,
            source: 'recovery.controller',
            role: 'system',
            severity: 'warning',
          });

          const reactivatedQueueName = await activateNextPendingItemAfterRepair(queuePaths);
          if (reactivatedQueueName) {
            await scheduleAutoStartForNext(reactivatedQueueName);
            return;
          }

          await persistRecoveryState(buildRecoveryState({
            kind: 'queue-repair',
            status: 'repaired',
            summary: fixed.fixed.join('; '),
            queueName: activeQueueName,
            activationStartedAt: activeItemMtime,
            deadlineAt: null,
          }));
        });
        return;
      }

      const activationStartedAt =
        recoveryState?.queueName === activeQueueName
          ? recoveryState.activationStartedAt ?? activeItemMtime
          : activeItemMtime;
      const deadlineAt = activationStartedAt
        ? new Date(Date.parse(activationStartedAt) + activationGraceMs).toISOString()
        : null;

      // §5.3B: hasPipelineStartEvidence is now per-task.
      const activeTaskId = queueNameToTaskId(activeQueueName);
      const hasRuntimeEvidence = await hasPipelineStartEvidence(activeTaskId, activationStartedAt);
      const runtimeHealth = observability.activeTasks?.[0]?.taskHealth;

      if (hasRuntimeEvidence) {
        if (recoveryState?.status === 'pending-start' || recoveryState?.status === 'repaired') {
          await persistRecoveryState(null);
        }

        // Grace period: don't auto-fail on stale runtime evidence if the task
        // was activated very recently — the new pipeline may not have acquired
        // the lock yet, and the failed sessions may be from a previous run.
        const activationAgeMs = activationStartedAt
          ? Date.now() - Date.parse(activationStartedAt)
          : Infinity;

        // §5.3B: check per-task lock instead of singleton PIPELINE_LOCK_DIR.
        const taskPipelineLockDir = activeTaskId
          ? join(REPO_ROOT, '.platform-state', 'runtime', 'tasks', activeTaskId, 'pipeline.lock')
          : null;
        const pipelineLocked = taskPipelineLockDir
          ? await pathExists(taskPipelineLockDir, repoFs)
          : false;

        if (!pipelineLocked && activationAgeMs > RUNTIME_FAILURE_GRACE_MS && hasCriticalRuntimeFailure(runtimeHealth)) {
          await withQueueLockIfAvailable('desktop.failStrandedActiveTask', async () => {
            const result = await moveFailedItemToErrorItems({
              repoRoot: REPO_ROOT,
              taskId: activeQueueName.replace(/\.md$/, ''),
            });
            emitStreamEvent({
              message: `Auto-failed stranded task ${result.movedItem}: ${runtimeHealth?.summary ?? 'runtime failure observed.'}`,
              source: 'recovery.controller',
              role: 'system',
              severity: 'error',
            });
            await persistRecoveryState(buildRecoveryState({
              kind: 'runtime-failure',
              status: 'auto-failed',
              summary: runtimeHealth?.summary ?? 'Runtime failure observed after pipeline activity.',
              queueName: result.movedItem,
              activationStartedAt,
              deadlineAt: null,
              errorItemPath: result.errorItemPath,
            }));
            await scheduleAutoStartForNext(result.nextActiveItem);
          });
        }
        return;
      }

      const nowMs = Date.now();
      const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : Number.NaN;
      if (!Number.isFinite(deadlineMs) || nowMs < deadlineMs) {
        await persistRecoveryState(buildRecoveryState({
          kind: 'activation-timeout',
          status: 'pending-start',
          summary: `Waiting for pipeline activity for ${activeQueueName}.`,
          queueName: activeQueueName,
          activationStartedAt,
          deadlineAt,
        }));
        return;
      }

      await withQueueLockIfAvailable('desktop.failInactiveActivation', async () => {
        const result = await moveFailedItemToErrorItems({
          repoRoot: REPO_ROOT,
          taskId: activeQueueName.replace(/\.md$/, ''),
        });
        const summary = `No pipeline activity was observed within ${Math.round(activationGraceMs / 60000)} minutes of activation.`;
        emitStreamEvent({
          message: `Auto-failed stranded task ${result.movedItem}: ${summary}`,
          source: 'recovery.controller',
          role: 'system',
          severity: 'error',
        });
        await persistRecoveryState(buildRecoveryState({
          kind: 'activation-timeout',
          status: 'auto-failed',
          summary,
          queueName: result.movedItem,
          activationStartedAt,
          deadlineAt,
          errorItemPath: result.errorItemPath,
        }));
        await scheduleAutoStartForNext(result.nextActiveItem);
      });
    } catch (error) {
      emitStreamEvent({
        message: `Recovery reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        source: 'recovery.controller',
        role: 'system',
        severity: 'error',
      });
    } finally {
      reconcileInFlight = false;
      if (reconcileQueued && !stopped) {
        reconcileQueued = false;
        void reconcile();
      }
    }
  };

  const reconcileNow = (): void => {
    void reconcile();
  };

  const noteActivatedPendingItem = (queueName: string): void => {
    const activationStartedAt = new Date().toISOString();
    void persistRecoveryState(buildRecoveryState({
      kind: 'activation-timeout',
      status: 'pending-start',
      summary: `Waiting for pipeline activity for ${queueName}.`,
      queueName,
      activationStartedAt,
      deadlineAt: new Date(Date.parse(activationStartedAt) + activationGraceMs).toISOString(),
    }));
    reconcileNow();
  };

  interval = setInterval(reconcileNow, pollIntervalMs);
  interval.unref?.();
  reconcileNow();

  return {
    noteActivatedPendingItem,
    reconcileNow,
    stop: () => {
      stopped = true;
      if (interval) {
        clearInterval(interval);
      }
    },
  };
}
