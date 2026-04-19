import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { TaskHealthRollup, TaskRecoveryKind, TaskRecoveryState } from '../src/shared/desktopContract';
import {
  acquireDirLockOrThrow,
  activateNextPendingItemIfReady,
  moveFailedItemToErrorItems,
  repairQueue,
  resolveQueuePaths,
} from '../../../backend/platform/queue';
import { REPO_ROOT } from './paths';
import { readObservabilitySnapshot } from './repoObservability';
import {
  clearTaskRecoveryState,
  writeTaskRecoveryState,
  readTaskRecoveryState,
} from './main.recoveryState';
import { emitStreamEvent } from './main.stream';
import { pathExists, repoFs } from './utils';

const ACTIVE_ITEM_PATH = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-item');
const PIPELINE_LOCK_DIR = join(REPO_ROOT, '.platform-state', 'runtime', 'pipeline.lock');
const PIPELINE_RECEIPT_PATH = join(REPO_ROOT, '.platform-state', 'runtime', 'pipeline-receipt.json');
const ROLE_SESSIONS_DIR = join(REPO_ROOT, '.platform-state', 'runtime', 'role-sessions');
const GUARDRAILS_DIR = join(REPO_ROOT, '.platform-state', 'runtime', 'guardrails');

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

async function readActiveQueueName(): Promise<string | null> {
  if (!(await pathExists(ACTIVE_ITEM_PATH, repoFs))) {
    return null;
  }

  try {
    const content = (await readFile(ACTIVE_ITEM_PATH, 'utf-8')).trim();
    return content && content.endsWith('.md') ? content : null;
  } catch {
    return null;
  }
}

async function readActiveItemMtimeIso(): Promise<string | null> {
  if (!(await pathExists(ACTIVE_ITEM_PATH, repoFs))) {
    return null;
  }

  try {
    const details = await stat(ACTIVE_ITEM_PATH);
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

async function hasPipelineStartEvidence(
  activationStartedAt: string | null,
): Promise<boolean> {
  if (await pathExists(PIPELINE_LOCK_DIR, repoFs)) {
    return true;
  }

  const sinceMs = activationStartedAt ? Date.parse(activationStartedAt) : Number.NaN;
  if (!Number.isFinite(sinceMs)) {
    return false;
  }

  const evidence = await Promise.all([
    fileHasRecentArtifact(PIPELINE_RECEIPT_PATH, sinceMs),
    directoryHasRecentJsonArtifact(ROLE_SESSIONS_DIR, sinceMs),
    directoryHasRecentJsonArtifact(GUARDRAILS_DIR, sinceMs),
  ]);

  return evidence.some(Boolean);
}

function hasCriticalRuntimeFailure(taskHealth: TaskHealthRollup | undefined): boolean {
  if (!taskHealth) {
    return false;
  }

  return taskHealth.failedCount > 0 || taskHealth.orphanedCount > 0;
}

function isFixableRepairIssue(issue: string): boolean {
  return issue.includes('.active-item references')
    || issue.includes('handoffs/ is in reset state')
    || issue.includes('Partial handoff publish detected');
}

function isQueueDivergenceIssue(issue: string): boolean {
  return issue.includes('No .active-item but handoffs/ has task data');
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

    // Guard: don't schedule a pipeline launch if one is already running.
    // Without this, the task gets activated (claimed) but the pipeline launch
    // fails on the lock, leaving the task stranded.
    if (await pathExists(PIPELINE_LOCK_DIR)) {
      return;
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
      const [activeQueueName, activeItemMtime, recoveryState, observability, repairProbe, pipelineLocked] =
        await Promise.all([
          readActiveQueueName(),
          readActiveItemMtimeIso(),
          readTaskRecoveryState(),
          readObservabilitySnapshot(),
          repairQueue({ repoRoot: REPO_ROOT, dryRun: true }),
          pathExists(PIPELINE_LOCK_DIR, repoFs),
        ]);

      if (!activeQueueName) {
        const divergenceIssue = repairProbe.issues.find(isQueueDivergenceIssue) ?? null;
        if (divergenceIssue) {
          await persistRecoveryState(buildRecoveryState({
            kind: 'queue-divergence',
            status: 'recovery-needed',
            summary: divergenceIssue,
            queueName: null,
            activationStartedAt: null,
            deadlineAt: null,
          }));
        } else if (recoveryState?.status !== 'auto-failed') {
          await persistRecoveryState(null);
        }
        return;
      }

      const fixableIssues = repairProbe.issues.filter(isFixableRepairIssue);
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
      const hasRuntimeEvidence = await hasPipelineStartEvidence(activationStartedAt);
      const runtimeHealth = observability.activeTask?.taskHealth;

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
