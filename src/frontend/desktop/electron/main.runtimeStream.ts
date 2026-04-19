import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import type {
  AgentTerminalSession,
  GuardrailObservation,
  ObservabilitySnapshotResponse,
} from '../src/shared/desktopContract';
import type { ReadOnlyRepoFs } from './utils';
import { pathExists, repoFs } from './utils';
import { REPO_ROOT } from './paths';
import { readObservabilitySnapshot as readObservabilitySnapshotImpl } from './repoObservability';
import { emitStreamEvent, type StreamEventOptions } from './main.stream';
import { getNodeErrorCode } from './main.textUtils';

const PLATFORM_STATE_DIR = join(REPO_ROOT, '.platform-state');
const RUNTIME_DIR = join(PLATFORM_STATE_DIR, 'runtime');
// §5.4 F18: PARALLEL_RUNTIME_DIR and PARALLEL_RECEIPTS_DIR deleted.
// Singleton ROLE_RUNTIME_SESSIONS_DIR and GUARDRAIL_RECEIPTS_DIR retained as
// legacy fallback targets when no active taskIds are known.
const ROLE_RUNTIME_SESSIONS_DIR = join(RUNTIME_DIR, 'role-sessions');
const GUARDRAIL_RECEIPTS_DIR = join(RUNTIME_DIR, 'guardrails');
const TASKS_RUNTIME_DIR = join(RUNTIME_DIR, 'tasks');
const WATCH_DEBOUNCE_MS = 150;

const PIPELINE_PHASE_MESSAGES: Record<string, { message: string; severity: StreamEventOptions['severity'] }> = {
  'test-capture-started': { message: 'Capturing test evidence.', severity: 'info' },
  'test-capture-completed': { message: 'Test evidence captured.', severity: 'info' },
  'test-capture-skipped': { message: 'Test capture skipped — could not resolve target repo.', severity: 'warning' },
};

type RuntimeSnapshot = Pick<ObservabilitySnapshotResponse, 'agentTerminalSessions' | 'guardrails'>;

type RuntimeStreamState = {
  sessions: Map<string, AgentTerminalSession>;
  guardrails: Map<string, GuardrailObservation>;
};

type RuntimeWatcherOptions = {
  fsAdapter?: ReadOnlyRepoFs;
  readSnapshot?: (fsAdapter: ReadOnlyRepoFs) => Promise<RuntimeSnapshot>;
  watchFactory?: typeof watch;
};

/**
 * §5.4 F18: Compute watch targets dynamically from the set of active taskIds.
 * Per-task subtrees are watched for each active task.
 * Legacy singleton dirs (role-sessions, guardrails) are included as fallbacks
 * for backward-compat when no active tasks are tracked yet.
 */
function computeWatchTargets(activeTaskIds: string[]): string[] {
  const targets = new Set<string>([
    PLATFORM_STATE_DIR,
    RUNTIME_DIR,
    TASKS_RUNTIME_DIR,
  ]);

  if (activeTaskIds.length === 0) {
    // Legacy fallback: watch singleton dirs when no per-task context is active.
    targets.add(ROLE_RUNTIME_SESSIONS_DIR);
    targets.add(GUARDRAIL_RECEIPTS_DIR);
  }

  for (const taskId of activeTaskIds) {
    const taskRuntimeDir = join(TASKS_RUNTIME_DIR, taskId);
    targets.add(taskRuntimeDir);
    targets.add(join(taskRuntimeDir, 'role-sessions'));
    targets.add(join(taskRuntimeDir, 'guardrails'));
  }

  return [...targets];
}

/** §5.4: Currently subscribed task IDs for per-task watch targets. */
const subscribedTaskIds = new Set<string>();

/**
 * §5.4: Subscribe a taskId so its per-task runtime subtree is watched.
 * Call this when a pipeline is started for the task.
 */
export function subscribeTask(taskId: string): void {
  subscribedTaskIds.add(taskId);
}

/**
 * §5.4: Unsubscribe a taskId and clear its mtime cache entry.
 * Call this when a pipeline completes or is stopped for the task.
 */
export function unsubscribeTask(taskId: string): void {
  subscribedTaskIds.delete(taskId);
}

function createRuntimeStreamState(snapshot: RuntimeSnapshot): RuntimeStreamState {
  return {
    sessions: new Map(
      (snapshot.agentTerminalSessions ?? []).map((session) => [session.sessionId, session]),
    ),
    guardrails: new Map(
      (snapshot.guardrails ?? []).map((guardrail) => [guardrail.receiptPath, guardrail]),
    ),
  };
}

function toSessionContext(session: AgentTerminalSession): StreamEventOptions['sessionContext'] {
  return {
    sessionId: session.sessionId,
    instanceId: session.instanceId,
    sliceId: session.sliceId,
    launchState: session.launchState,
    terminalState: session.terminalState,
    liveness: session.liveness,
    stuckState: session.stuckState,
    guardrailStatus: session.guardrailStatus,
  };
}

function buildSessionEvent(
  session: AgentTerminalSession,
  message: string,
  severity: StreamEventOptions['severity'] = session.severity,
): StreamEventOptions {
  return {
    message,
    source: 'runtime.agentSession',
    role: 'workflow',
    severity,
    taskId: session.taskId ?? undefined,
    actorName: session.agentLabel,
    sessionContext: toSessionContext(session),
  };
}

function summarizeNewSession(session: AgentTerminalSession): StreamEventOptions {
  if (session.stuckState === 'orphaned') {
    return buildSessionEvent(session, 'Appears orphaned.', 'warning');
  }
  if (session.stuckState === 'suspected-stuck') {
    return buildSessionEvent(session, 'May be stuck.', 'warning');
  }
  if (session.terminalState === 'failed') {
    return buildSessionEvent(session, 'Failed.', 'error');
  }
  if (session.terminalState === 'completed') {
    return buildSessionEvent(session, 'Completed.', 'success');
  }
  if (session.terminalState === 'running') {
    return buildSessionEvent(session, 'Is running.');
  }
  if (session.launchState === 'queued') {
    return buildSessionEvent(session, 'Queued for launch.');
  }
  if (session.launchState === 'started') {
    return buildSessionEvent(session, 'Launch started.');
  }
  if (session.launchState === 'failed') {
    return buildSessionEvent(session, 'Launch failed.', 'error');
  }
  if (session.launchState === 'completed') {
    return buildSessionEvent(session, 'Launch completed.');
  }
  if (session.launchState === 'skipped') {
    return buildSessionEvent(session, 'Launch skipped.', 'warning');
  }
  if (session.launchState === 'dry-run') {
    return buildSessionEvent(session, 'Dry run recorded.');
  }
  return buildSessionEvent(session, 'Runtime session observed.');
}

function diffSessionEvents(
  previous: AgentTerminalSession | undefined,
  next: AgentTerminalSession,
): StreamEventOptions[] {
  if (!previous) {
    return [summarizeNewSession(next)];
  }

  const events: StreamEventOptions[] = [];

  if (previous.launchState !== next.launchState) {
    const launchMessages: Record<AgentTerminalSession['launchState'], string> = {
      queued: 'Queued for launch.',
      started: 'Launch started.',
      completed: 'Launch completed.',
      failed: 'Launch failed.',
      'dry-run': 'Dry run recorded.',
      skipped: 'Launch skipped.',
      unknown: 'Launch state is unknown.',
    };
    const launchSeverity: Record<AgentTerminalSession['launchState'], StreamEventOptions['severity']> = {
      queued: 'info',
      started: 'info',
      completed: 'success',
      failed: 'error',
      'dry-run': 'info',
      skipped: 'warning',
      unknown: 'warning',
    };
    events.push(buildSessionEvent(next, launchMessages[next.launchState], launchSeverity[next.launchState]));
  }

  if (previous.terminalState !== next.terminalState) {
    const terminalMessages: Record<AgentTerminalSession['terminalState'], string> = {
      pending: 'Pending terminal output.',
      running: 'Is running.',
      completed: 'Completed.',
      failed: 'Failed.',
      unknown: 'Terminal state is unknown.',
    };
    const terminalSeverity: Record<AgentTerminalSession['terminalState'], StreamEventOptions['severity']> = {
      pending: 'info',
      running: 'info',
      completed: 'success',
      failed: 'error',
      unknown: 'warning',
    };
    events.push(buildSessionEvent(next, terminalMessages[next.terminalState], terminalSeverity[next.terminalState]));
  }

  if (previous.stuckState !== next.stuckState) {
    if (next.stuckState === 'suspected-stuck') {
      events.push(buildSessionEvent(next, 'May be stuck.', 'warning'));
    } else if (next.stuckState === 'orphaned') {
      events.push(buildSessionEvent(next, 'Appears orphaned.', 'warning'));
    }
  }

  return events;
}

function buildGuardrailEvent(
  observation: GuardrailObservation,
  session: AgentTerminalSession | undefined,
): StreamEventOptions {
  const statusMessages: Record<GuardrailObservation['status'], string> = {
    allowed: 'Guardrail receipt recorded an allowed launch.',
    denied: 'Guardrail receipt denied the runtime launch.',
    'internal-bypass': 'Used an internal guardrail bypass.',
    malformed: 'Produced a malformed guardrail receipt.',
  };

  return {
    message:
      observation.summary.trim().length > 0
        ? observation.summary
        : statusMessages[observation.status],
    source: 'runtime.guardrail',
    role: 'system',
    severity: observation.severity,
    taskId: session?.taskId ?? undefined,
    actorName: observation.severity === 'error' ? observation.agentLabel : undefined,
    sessionContext: session ? toSessionContext(session) : undefined,
  };
}

function diffGuardrailEvents(
  previous: GuardrailObservation | undefined,
  next: GuardrailObservation,
  sessions: Map<string, AgentTerminalSession>,
): StreamEventOptions[] {
  if (
    previous &&
    previous.status === next.status &&
    previous.severity === next.severity &&
    previous.violationCount === next.violationCount &&
    previous.summary === next.summary
  ) {
    return [];
  }

  const session =
    next.sessionId ? sessions.get(next.sessionId) : undefined;
  return [buildGuardrailEvent(next, session)];
}

export function diffRuntimeStreamEvents(
  previous: RuntimeSnapshot,
  next: RuntimeSnapshot,
): StreamEventOptions[] {
  const previousState = createRuntimeStreamState(previous);
  const nextState = createRuntimeStreamState(next);
  const events: StreamEventOptions[] = [];

  for (const [sessionId, session] of nextState.sessions) {
    events.push(...diffSessionEvents(previousState.sessions.get(sessionId), session));
  }

  for (const [receiptPath, observation] of nextState.guardrails) {
    events.push(
      ...diffGuardrailEvents(
        previousState.guardrails.get(receiptPath),
        observation,
        nextState.sessions,
      ),
    );
  }

  return events;
}

export function startRuntimeStreamWatcher(
  options: RuntimeWatcherOptions = {},
): () => void {
  const fsAdapter = options.fsAdapter ?? repoFs;
  const readSnapshot = options.readSnapshot ?? readObservabilitySnapshotImpl;
  const watchFactory = options.watchFactory ?? watch;
  const activeWatchers = new Map<string, FSWatcher>();
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshInFlight = false;
  let refreshQueued = false;
  let previousSnapshot: RuntimeSnapshot | null = null;
  let previousPipelinePhase: string | null = null;

  /**
   * §5.4: Read pipeline-phase.json from per-task runtime dirs.
   * Checks all subscribed task runtime dirs; returns the first phase found.
   */
  const readPipelinePhase = async (): Promise<string | null> => {
    const taskIds = [...subscribedTaskIds];
    const dirs = taskIds.length > 0
      ? taskIds.map((id) => join(TASKS_RUNTIME_DIR, id))
      : [RUNTIME_DIR]; // legacy fallback

    for (const dir of dirs) {
      try {
        const phaseFile = join(dir, 'pipeline-phase.json');
        const raw = await fsAdapter.readFile(phaseFile, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const phase = typeof parsed.phase === 'string' ? parsed.phase : null;
        if (phase) return phase;
      } catch {
        // Phase file may not exist for this task dir.
      }
    }
    return null;
  };

  const checkPipelinePhase = async (): Promise<void> => {
    if (stopped) return;
    try {
      const currentPhase = await readPipelinePhase();
      if (currentPhase && currentPhase !== previousPipelinePhase) {
        const phaseEvent = PIPELINE_PHASE_MESSAGES[currentPhase];
        if (phaseEvent) {
          emitStreamEvent({
            message: phaseEvent.message,
            source: 'runtime.pipeline',
            role: 'system',
            severity: phaseEvent.severity,
          });
        }
        previousPipelinePhase = currentPhase;
      }
    } catch {
      // Best effort — phase file may not exist.
    }
  };

  const PIPELINE_PHASE_WATCH_KEY = '__pipeline-phase-watcher__';

  const ensureWatchers = async (): Promise<void> => {
    // §5.4 F18: compute watch targets dynamically from subscribed task IDs.
    const watchTargets = computeWatchTargets([...subscribedTaskIds]);

    for (const target of watchTargets) {
      if (activeWatchers.has(target) || !(await pathExists(target, fsAdapter))) {
        continue;
      }
      try {
        const watcher = watchFactory(target, { persistent: false }, () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(() => {
            void refreshFromArtifacts();
          }, WATCH_DEBOUNCE_MS);
        });
        activeWatchers.set(target, watcher);
      } catch {
        // Best effort: runtime folders may not exist yet or may not be watchable.
      }
    }

    // Watch for pipeline-phase.json changes across all task runtime dirs.
    // §5.4: watch per-task dirs; filename filter checks 'pipeline-phase.json'.
    if (!activeWatchers.has(PIPELINE_PHASE_WATCH_KEY)) {
      try {
        if (await pathExists(RUNTIME_DIR, fsAdapter)) {
          const phaseWatcher = watchFactory(RUNTIME_DIR, { persistent: false }, (_eventType, filename) => {
            if (filename === 'pipeline-phase.json') {
              void checkPipelinePhase();
            }
          });
          activeWatchers.set(PIPELINE_PHASE_WATCH_KEY, phaseWatcher);
        }
      } catch {
        // Best effort.
      }
    }
  };

  const refreshFromArtifacts = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }

    refreshInFlight = true;
    try {
      await ensureWatchers();
      const snapshot = await readSnapshot(fsAdapter);
      const runtimeSnapshot: RuntimeSnapshot = {
        agentTerminalSessions: snapshot.agentTerminalSessions ?? [],
        guardrails: snapshot.guardrails ?? [],
      };

      if (stopped) return;

      if (previousSnapshot) {
        for (const event of diffRuntimeStreamEvents(previousSnapshot, runtimeSnapshot)) {
          emitStreamEvent(event);
        }
      }

      previousSnapshot = runtimeSnapshot;
    } catch (err) {
      if (getNodeErrorCode(err) !== 'ENOENT') {
        console.warn('[runtimeStream] refresh failed:', err instanceof Error ? err.message : err);
      }
    } finally {
      refreshInFlight = false;
      if (refreshQueued && !stopped) {
        refreshQueued = false;
        void refreshFromArtifacts();
      }
    }
  };

  void refreshFromArtifacts();

  return () => {
    stopped = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    for (const watcher of activeWatchers.values()) {
      watcher.close();
    }
    activeWatchers.clear();
  };
}
