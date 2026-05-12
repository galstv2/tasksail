import { watch, type FSWatcher } from 'node:fs';
import { join, relative } from 'node:path';

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
const TASKS_RUNTIME_DIR = join(RUNTIME_DIR, 'tasks');
const REALIGNMENT_RUNTIME_DIR = join(RUNTIME_DIR, 'realignment');
const PENDING_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const ACTIVE_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
const WATCH_DEBOUNCE_MS = 150;
const FINAL_DRAIN_REFRESH_COUNT = 2;

const PIPELINE_PHASE_MESSAGES: Record<string, { message: string; severity: StreamEventOptions['severity'] }> = {
  'test-capture-started': { message: 'Capturing test evidence.', severity: 'info' },
  'test-capture-completed': { message: 'Test evidence captured.', severity: 'info' },
  'test-capture-skipped': { message: 'Test capture skipped — could not resolve target repo.', severity: 'warning' },
};

type RealignmentJobObservation = {
  jobId: string;
  realignmentId: string;
  status: 'running' | 'archived' | 'error' | 'skipped' | 'partial';
  reason?: string;
  globalRealignmentVersion?: number;
};

type RuntimeSnapshot = Pick<ObservabilitySnapshotResponse, 'agentTerminalSessions' | 'guardrails'> & {
  realignmentJobs?: RealignmentJobObservation[];
};

type RuntimeStreamState = {
  sessions: Map<string, AgentTerminalSession>;
  guardrails: Map<string, GuardrailObservation>;
  realignmentJobs: Map<string, RealignmentJobObservation>;
};

type RuntimeWatcherOptions = {
  fsAdapter?: ReadOnlyRepoFs;
  readSnapshot?: (fsAdapter: ReadOnlyRepoFs, runtimeTaskIds?: string[]) => Promise<RuntimeSnapshot>;
  watchFactory?: typeof watch;
};

/**
 * Per-task runtime subtrees are watched dynamically from taskIds discovered
 * under AgentWorkSpace/pendingitems/.active-items. Snapshot reads and watcher
 * targets both treat that directory as the canonical active taskId source.
 */
function computeWatchTargets(
  runtimeTaskIds: string[],
  realignmentIds: string[] = [],
): string[] {
  const targets = new Set<string>([
    PLATFORM_STATE_DIR,
    RUNTIME_DIR,
    TASKS_RUNTIME_DIR,
    REALIGNMENT_RUNTIME_DIR,
    PENDING_ITEMS_DIR,
    ACTIVE_ITEMS_DIR,
  ]);

  for (const taskId of runtimeTaskIds) {
    const taskRuntimeDir = join(TASKS_RUNTIME_DIR, taskId);
    targets.add(taskRuntimeDir);
    targets.add(join(taskRuntimeDir, 'role-sessions'));
    targets.add(join(taskRuntimeDir, 'guardrails'));
  }

  for (const realignmentId of realignmentIds) {
    targets.add(join(REALIGNMENT_RUNTIME_DIR, realignmentId));
  }

  return [...targets];
}

function createRuntimeStreamState(snapshot: RuntimeSnapshot): RuntimeStreamState {
  return {
    sessions: new Map(
      (snapshot.agentTerminalSessions ?? []).map((session) => [session.sessionId, session]),
    ),
    guardrails: new Map(
      (snapshot.guardrails ?? []).map((guardrail) => [guardrail.receiptPath, guardrail]),
    ),
    realignmentJobs: new Map(
      (snapshot.realignmentJobs ?? []).map((job) => [job.realignmentId, job]),
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

function buildRealignmentEvent(
  job: RealignmentJobObservation,
): StreamEventOptions {
  const messages: Record<RealignmentJobObservation['status'], string> = {
    running: 'Realignment analysis is running.',
    archived: 'Realignment analysis archived.',
    skipped: 'Realignment analysis skipped.',
    error: 'Realignment analysis failed.',
    partial: 'Realignment analysis partially completed.',
  };
  const severities: Record<RealignmentJobObservation['status'], StreamEventOptions['severity']> = {
    running: 'info',
    archived: 'success',
    skipped: 'warning',
    error: 'error',
    partial: 'warning',
  };

  return {
    message: job.reason ? `${messages[job.status]} ${job.reason}` : messages[job.status],
    source: 'runtime.realignment',
    role: 'workflow',
    severity: severities[job.status],
    taskId: 'N/A',
    actorName: 'Ron - Realignment',
  };
}

function diffRealignmentEvents(
  previous: RealignmentJobObservation | undefined,
  next: RealignmentJobObservation,
): StreamEventOptions[] {
  if (previous?.status === next.status) {
    return [];
  }
  return [buildRealignmentEvent(next)];
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

  for (const [realignmentId, job] of nextState.realignmentJobs) {
    events.push(
      ...diffRealignmentEvents(
        previousState.realignmentJobs.get(realignmentId),
        job,
      ),
    );
  }

  return events;
}

export function startRuntimeStreamWatcher(
  options: RuntimeWatcherOptions = {},
): () => void {
  const fsAdapter = options.fsAdapter ?? repoFs;
  const defaultReadSnapshot = readObservabilitySnapshotImpl as (
    fsAdapter: ReadOnlyRepoFs,
    runtimeTaskIds?: string[],
  ) => Promise<RuntimeSnapshot>;
  const readSnapshot = options.readSnapshot ?? defaultReadSnapshot;
  const watchFactory = options.watchFactory ?? watch;
  const activeWatchers = new Map<string, FSWatcher>();
  const drainingTaskRefreshes = new Map<string, number>();
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshInFlight = false;
  let refreshQueued = false;
  let previousSnapshot: RuntimeSnapshot | null = null;
  const previousPipelinePhaseByTask = new Map<string, string>();
  let currentRuntimeTaskIds: string[] = [];
  let currentRealignmentIds: string[] = [];

  const readActiveTaskIdsFromFs = async (): Promise<string[]> => {
    try {
      const entries = await fsAdapter.readdir(ACTIVE_ITEMS_DIR);
      return entries
        .filter((entry) => !entry.endsWith('.completing') && !entry.startsWith('.'))
        .sort();
    } catch (err) {
      if (getNodeErrorCode(err) === 'ENOENT') {
        return [];
      }
      throw err;
    }
  };

  const readRealignmentIdsFromFs = async (): Promise<string[]> => {
    try {
      const entries = await fsAdapter.readdir(REALIGNMENT_RUNTIME_DIR);
      return entries
        .filter((entry) => typeof entry === 'string' && entry.length > 0)
        .sort();
    } catch (err) {
      if (getNodeErrorCode(err) === 'ENOENT') {
        return [];
      }
      throw err;
    }
  };

  const resolveRuntimeTaskIds = (activeTaskIds: string[]): string[] => {
    const activeTaskIdSet = new Set(activeTaskIds);
    const runtimeTaskIds = new Set(activeTaskIds);

    for (const taskId of activeTaskIds) {
      drainingTaskRefreshes.set(taskId, FINAL_DRAIN_REFRESH_COUNT);
    }

    for (const [taskId, refreshesRemaining] of drainingTaskRefreshes) {
      if (activeTaskIdSet.has(taskId)) {
        continue;
      }

      if (refreshesRemaining <= 0) {
        drainingTaskRefreshes.delete(taskId);
        continue;
      }

      runtimeTaskIds.add(taskId);
      const nextRefreshesRemaining = refreshesRemaining - 1;
      if (nextRefreshesRemaining <= 0) {
        drainingTaskRefreshes.delete(taskId);
      } else {
        drainingTaskRefreshes.set(taskId, nextRefreshesRemaining);
      }
    }

    return [...runtimeTaskIds].sort();
  };

  const taskIdForWatcherKey = (watcherKey: string): string | null => {
    const pipelinePhasePrefix = 'pipeline-phase:';
    if (watcherKey.startsWith(pipelinePhasePrefix)) {
      const taskId = watcherKey.slice(pipelinePhasePrefix.length);
      return taskId.length > 0 ? taskId : null;
    }

    const relativeTaskPath = relative(TASKS_RUNTIME_DIR, watcherKey);
    if (
      relativeTaskPath.length === 0 ||
      relativeTaskPath.startsWith('..') ||
      relativeTaskPath.includes(':')
    ) {
      return null;
    }

    const taskId = relativeTaskPath.split(/[\\/]/)[0];
    return taskId.length > 0 ? taskId : null;
  };

  const closeStaleRuntimeWatchers = (runtimeTaskIds: Set<string>): void => {
    for (const [watcherKey, watcher] of activeWatchers) {
      const taskId = taskIdForWatcherKey(watcherKey);
      if (taskId && !runtimeTaskIds.has(taskId)) {
        watcher.close();
        activeWatchers.delete(watcherKey);
      }
    }

    for (const taskId of previousPipelinePhaseByTask.keys()) {
      if (!runtimeTaskIds.has(taskId)) {
        previousPipelinePhaseByTask.delete(taskId);
      }
    }
  };

  const readRealignmentJobs = async (): Promise<RealignmentJobObservation[]> => {
    const jobs: RealignmentJobObservation[] = [];
    for (const realignmentId of currentRealignmentIds) {
      try {
        const raw = await fsAdapter.readFile(
          join(REALIGNMENT_RUNTIME_DIR, realignmentId, 'job.json'),
          'utf-8',
        );
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const status = parsed.status;
        if (
          status !== 'running' &&
          status !== 'archived' &&
          status !== 'error' &&
          status !== 'skipped' &&
          status !== 'partial'
        ) {
          continue;
        }
        jobs.push({
          jobId: typeof parsed.jobId === 'string' ? parsed.jobId : realignmentId,
          realignmentId: typeof parsed.realignmentId === 'string'
            ? parsed.realignmentId
            : realignmentId,
          status,
          ...(typeof parsed.reason === 'string' ? { reason: parsed.reason } : {}),
          ...(typeof parsed.globalRealignmentVersion === 'number'
            ? { globalRealignmentVersion: parsed.globalRealignmentVersion }
            : {}),
        });
      } catch (err) {
        if (getNodeErrorCode(err) !== 'ENOENT') {
          throw err;
        }
      }
    }
    return jobs;
  };

  /**
   * Read pipeline-phase.json from per-task runtime dirs of currently active or final-draining tasks.
   */
  const readPipelinePhase = async (): Promise<Array<{ taskId: string; phase: string }>> => {
    const phases: Array<{ taskId: string; phase: string }> = [];

    for (const taskId of currentRuntimeTaskIds) {
      try {
        const phaseFile = join(TASKS_RUNTIME_DIR, taskId, 'pipeline-phase.json');
        const raw = await fsAdapter.readFile(phaseFile, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const phase = typeof parsed.phase === 'string' ? parsed.phase : null;
        if (phase) {
          phases.push({ taskId, phase });
        }
      } catch (err) {
        if (getNodeErrorCode(err) !== 'ENOENT') {
          throw err;
        }
      }
    }

    return phases;
  };

  const checkPipelinePhase = async (): Promise<void> => {
    if (stopped) return;
    try {
      const currentPhases = await readPipelinePhase();
      for (const { taskId, phase } of currentPhases) {
        if (previousPipelinePhaseByTask.get(taskId) === phase) {
          continue;
        }

        const phaseEvent = PIPELINE_PHASE_MESSAGES[phase];
        if (phaseEvent) {
          emitStreamEvent({
            message: phaseEvent.message,
            source: 'runtime.pipeline',
            role: 'system',
            severity: phaseEvent.severity,
            taskId,
          });
        }
        previousPipelinePhaseByTask.set(taskId, phase);
      }
    } catch {
      // Best effort — phase file may not exist.
    }
  };

  const ensureWatchers = async (): Promise<void> => {
    const activeTaskIds = await readActiveTaskIdsFromFs();
    currentRuntimeTaskIds = resolveRuntimeTaskIds(activeTaskIds);
    currentRealignmentIds = await readRealignmentIdsFromFs();
    const runtimeTaskIdSet = new Set(currentRuntimeTaskIds);
    closeStaleRuntimeWatchers(runtimeTaskIdSet);

    const watchTargets = computeWatchTargets(currentRuntimeTaskIds, currentRealignmentIds);

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

    for (const taskId of currentRuntimeTaskIds) {
      const phaseWatcherKey = `pipeline-phase:${taskId}`;
      const taskRuntimeDir = join(TASKS_RUNTIME_DIR, taskId);
      if (activeWatchers.has(phaseWatcherKey) || !(await pathExists(taskRuntimeDir, fsAdapter))) {
        continue;
      }
      try {
        const phaseWatcher = watchFactory(taskRuntimeDir, { persistent: false }, (_eventType, filename) => {
          if (filename === 'pipeline-phase.json') {
            void checkPipelinePhase();
          }
        });
        activeWatchers.set(phaseWatcherKey, phaseWatcher);
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
      const snapshot = await readSnapshot(fsAdapter, currentRuntimeTaskIds);
      const runtimeSnapshot: RuntimeSnapshot = {
        agentTerminalSessions: snapshot.agentTerminalSessions ?? [],
        guardrails: snapshot.guardrails ?? [],
        realignmentJobs: await readRealignmentJobs(),
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
