import { watch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

import type {
  AgentTerminalSession,
  GuardrailObservation,
  ObservabilitySnapshotResponse,
} from '../src/shared/desktopContract';
import { loadTaskRegistry } from '../../../backend/platform/queue/taskRegistry.js';
import type { ReadOnlyRepoFs } from './utils';
import type { WritableRepoFs } from './utils';
import { pathExists, repoReadWriteFs } from './utils';
import { REPO_ROOT } from './paths';
import { readObservabilitySnapshot as readObservabilitySnapshotImpl } from './repoObservability';
import {
  emitStreamEvent,
  refreshStreamTaskMetadataForScope,
  type StreamEventOptions,
} from './main.stream';
import { getNodeErrorCode } from './main.textUtils';
import { createLogger } from './log/logger';
import { appendTaskTerminalTranscriptEvent } from './main.taskTerminalTranscript';
import {
  activeContextPackTaskScopesEqual,
  defaultActiveScopeProvider,
  filterActiveTaskIdsForScope,
  readVisibleTaskMarkdownItemsByTaskId,
  resolveActiveContextPackTaskScope,
  type ActiveScopeProvider,
  type ActiveContextPackTaskScope,
  type ContextPackLister,
} from './main.contextPackTaskVisibility';

const log = createLogger('electron/main.runtimeStream');

const PLATFORM_STATE_DIR = join(REPO_ROOT, '.platform-state');
const RUNTIME_DIR = join(PLATFORM_STATE_DIR, 'runtime');
const TASKS_RUNTIME_DIR = join(RUNTIME_DIR, 'tasks');
const REALIGNMENT_RUNTIME_DIR = join(RUNTIME_DIR, 'realignment');
const PENDING_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const ACTIVE_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems', '.active-items');
const ERROR_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'error-items');
const WATCH_DEBOUNCE_MS = 150;
const FINAL_DRAIN_REFRESH_COUNT = 2;

const PIPELINE_PHASE_MESSAGES: Record<string, { message: string; severity: StreamEventOptions['severity'] }> = {
  // Code capture has canonical task terminal events from the backend. The
  // legacy pipeline-phase fallback stays empty so it cannot duplicate them.
};

type RealignmentJobObservation = {
  jobId: string;
  realignmentId: string;
  status: 'running' | 'archived' | 'error' | 'skipped' | 'partial';
  reason?: string;
  globalRealignmentVersion?: number;
};

type RuntimeTerminalEventObservation = {
  taskId: string;
  eventId: string;
  source: string;
  role: StreamEventOptions['role'];
  severity: NonNullable<StreamEventOptions['severity']>;
  visible: boolean;
  message: string;
  extra?: Record<string, unknown>;
  actorName?: string;
  sessionContext?: StreamEventOptions['sessionContext'];
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
  fsAdapter?: WritableRepoFs;
  readSnapshot?: (fsAdapter: ReadOnlyRepoFs, runtimeTaskIds?: string[]) => Promise<RuntimeSnapshot>;
  watchFactory?: typeof watch;
  scopeProvider?: ActiveScopeProvider;
  listContextPacks?: ContextPackLister;
};

type RuntimeStreamDiffEntry = {
  event: StreamEventOptions;
  transcriptEventId?: string;
};

let resetRuntimeStreamStateImpl: (() => void) | null = null;
let refreshRuntimeStreamStateImpl: (() => Promise<void>) | null = null;

export function resetRuntimeStreamState(): void {
  resetRuntimeStreamStateImpl?.();
}

export async function refreshRuntimeStreamState(): Promise<void> {
  await refreshRuntimeStreamStateImpl?.();
}

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
    ERROR_ITEMS_DIR,
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
    role: 'agent',
    severity,
    taskId: session.taskId ?? undefined,
    actorName: session.agentLabel,
    sessionContext: toSessionContext(session),
  };
}

function sessionSummaryCode(session: AgentTerminalSession): string {
  if (session.stuckState === 'orphaned') {
    return 'orphaned';
  }
  if (session.stuckState === 'suspected-stuck') {
    return 'suspected-stuck';
  }
  if (session.terminalState === 'failed') {
    return 'failed';
  }
  if (session.terminalState === 'completed') {
    return 'completed';
  }
  if (session.terminalState === 'running') {
    return 'running';
  }
  if (session.launchState === 'queued') {
    return 'queued';
  }
  if (session.launchState === 'started') {
    return 'started';
  }
  if (session.launchState === 'failed') {
    return 'launch-failed';
  }
  if (session.launchState === 'completed') {
    return 'launch-completed';
  }
  if (session.launchState === 'skipped') {
    return 'skipped';
  }
  if (session.launchState === 'dry-run') {
    return 'dry-run';
  }
  return 'observed';
}

function summarizeNewSession(session: AgentTerminalSession): StreamEventOptions {
  const code = sessionSummaryCode(session);
  if (code === 'orphaned') {
    return buildSessionEvent(session, 'Appears orphaned.', 'warning');
  }
  if (code === 'suspected-stuck') {
    return buildSessionEvent(session, 'May be stuck.', 'warning');
  }
  if (code === 'failed') {
    return buildSessionEvent(session, 'Failed.', 'error');
  }
  if (code === 'completed') {
    return buildSessionEvent(session, 'Completed.', 'success');
  }
  if (code === 'running') {
    return buildSessionEvent(session, 'Is running.');
  }
  if (code === 'queued') {
    return buildSessionEvent(session, 'Queued for launch.');
  }
  if (code === 'started') {
    return buildSessionEvent(session, 'Launch started.');
  }
  if (code === 'launch-failed') {
    return buildSessionEvent(session, 'Launch failed.', 'error');
  }
  if (code === 'launch-completed') {
    return buildSessionEvent(session, 'Launch completed.');
  }
  if (code === 'skipped') {
    return buildSessionEvent(session, 'Launch skipped.', 'warning');
  }
  if (code === 'dry-run') {
    return buildSessionEvent(session, 'Dry run recorded.');
  }
  return buildSessionEvent(session, 'Runtime session observed.');
}

type CanonicalLaunchState = 'running' | 'completed' | 'failure';

function canonicalLaunchKeyFromTerminalEvent(event: RuntimeTerminalEventObservation): string | null {
  if (!event.visible) return null;
  const parts = event.eventId.split(':');
  if (parts.length < 4) return null;
  const [eventName, agentId, _displayPhase, ...launchParts] = parts;
  if (!agentId || launchParts.length === 0) return null;
  const launchId = launchParts.join(':');
  if (eventName === 'agent.launch.started') {
    return `${event.taskId}:${agentId}:${launchId}:running`;
  }
  if (eventName === 'agent.launch.terminal') {
    return `${event.taskId}:${agentId}:${launchId}:completed|failure`;
  }
  return null;
}

function shouldSuppressGenericSessionFallback(
  event: StreamEventOptions,
  canonicalLaunchEvents: Set<string>,
): boolean {
  const sessionContext = event.sessionContext;
  if (!sessionContext || !event.taskId || !event.actorName) return false;
  const session = sessionContext as { sessionId?: unknown };
  if (typeof session.sessionId !== 'string') return false;
  const match = /^role:([^:]+):(.+)$/.exec(session.sessionId);
  if (!match) return false;
  const [, agentId, launchId] = match;
  const state: CanonicalLaunchState | null = event.message === 'Is running.'
    ? 'running'
    : event.message === 'Completed.'
      ? 'completed'
      : event.message === 'Failed.'
        ? 'failure'
        : null;
  return state !== null && (
    canonicalLaunchEvents.has(`${event.taskId}:${agentId}:${launchId}:${state}`) ||
    (state !== 'running' && canonicalLaunchEvents.has(`${event.taskId}:${agentId}:${launchId}:completed|failure`))
  );
}

function diffSessionEntries(
  previous: AgentTerminalSession | undefined,
  next: AgentTerminalSession,
): RuntimeStreamDiffEntry[] {
  if (!previous) {
    return [{
      event: summarizeNewSession(next),
      transcriptEventId: `runtime.agentSession:${next.sessionId}:summary:${sessionSummaryCode(next)}`,
    }];
  }

  const entries: RuntimeStreamDiffEntry[] = [];

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
    entries.push({
      event: buildSessionEvent(next, launchMessages[next.launchState], launchSeverity[next.launchState]),
      transcriptEventId: `runtime.agentSession:${next.sessionId}:launch:${next.launchState}`,
    });
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
    entries.push({
      event: buildSessionEvent(next, terminalMessages[next.terminalState], terminalSeverity[next.terminalState]),
      transcriptEventId: `runtime.agentSession:${next.sessionId}:terminal:${next.terminalState}`,
    });
  }

  if (previous.stuckState !== next.stuckState) {
    if (next.stuckState === 'suspected-stuck') {
      entries.push({
        event: buildSessionEvent(next, 'May be stuck.', 'warning'),
        transcriptEventId: `runtime.agentSession:${next.sessionId}:stuck:${next.stuckState}`,
      });
    } else if (next.stuckState === 'orphaned') {
      entries.push({
        event: buildSessionEvent(next, 'Appears orphaned.', 'warning'),
        transcriptEventId: `runtime.agentSession:${next.sessionId}:stuck:${next.stuckState}`,
      });
    }
  }

  return entries;
}

function buildGuardrailEvent(
  observation: GuardrailObservation,
  session: AgentTerminalSession | undefined,
): StreamEventOptions {
  const statusMessages: Record<GuardrailObservation['status'], string> = {
    allowed: 'Guardrail receipt recorded an allowed launch.',
    denied: 'Guardrail receipt denied the runtime launch.',
    'internal-bypass': 'Used an internal guardrail bypass.',
    malformed: 'Guardrail receipt is malformed.',
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

function diffGuardrailEntries(
  previous: GuardrailObservation | undefined,
  next: GuardrailObservation,
  sessions: Map<string, AgentTerminalSession>,
): RuntimeStreamDiffEntry[] {
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
  const event = buildGuardrailEvent(next, session);
  return [{
    event,
    transcriptEventId: guardrailTranscriptEventId(next, event.message),
  }];
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

function diffRealignmentEntries(
  previous: RealignmentJobObservation | undefined,
  next: RealignmentJobObservation,
): RuntimeStreamDiffEntry[] {
  if (previous?.status === next.status) {
    return [];
  }
  return [{ event: buildRealignmentEvent(next) }];
}

function guardrailTranscriptEventId(
  observation: GuardrailObservation,
  summary: string,
): string {
  const identity = observation.receiptPath || observation.agentId;
  const summaryHash = createHash('sha1').update(summary, 'utf8').digest('hex').slice(0, 12);
  return [
    'runtime.guardrail',
    identity,
    observation.status,
    observation.severity,
    String(observation.violationCount),
    summaryHash,
  ].join(':');
}

function hasRealTaskId(taskId: unknown): taskId is string {
  return typeof taskId === 'string' && taskId.trim() !== '' && taskId !== 'N/A';
}

function isValidTranscriptRole(role: unknown): role is StreamEventOptions['role'] {
  return (
    role === 'planner' ||
    role === 'queue' ||
    role === 'agent' ||
    role === 'pipeline' ||
    role === 'workflow' ||
    role === 'operator' ||
    role === 'system'
  );
}

function isValidTranscriptSeverity(severity: unknown): severity is NonNullable<StreamEventOptions['severity']> {
  return severity === 'info' || severity === 'success' || severity === 'warning' || severity === 'error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function diffRuntimeStreamEvents(
  previous: RuntimeSnapshot,
  next: RuntimeSnapshot,
): StreamEventOptions[] {
  return diffRuntimeStreamEntries(previous, next).map((entry) => entry.event);
}

function diffRuntimeStreamEntries(
  previous: RuntimeSnapshot,
  next: RuntimeSnapshot,
): RuntimeStreamDiffEntry[] {
  const previousState = createRuntimeStreamState(previous);
  const nextState = createRuntimeStreamState(next);
  const entries: RuntimeStreamDiffEntry[] = [];

  for (const [sessionId, session] of nextState.sessions) {
    entries.push(...diffSessionEntries(previousState.sessions.get(sessionId), session));
  }

  for (const [receiptPath, observation] of nextState.guardrails) {
    entries.push(
      ...diffGuardrailEntries(
        previousState.guardrails.get(receiptPath),
        observation,
        nextState.sessions,
      ),
    );
  }

  for (const [realignmentId, job] of nextState.realignmentJobs) {
    entries.push(
      ...diffRealignmentEntries(
        previousState.realignmentJobs.get(realignmentId),
        job,
      ),
    );
  }

  return entries;
}

export function startRuntimeStreamWatcher(
  options: RuntimeWatcherOptions = {},
): () => void {
  const fsAdapter = options.fsAdapter ?? repoReadWriteFs;
  const defaultReadSnapshot = (
    currentFsAdapter: ReadOnlyRepoFs,
    runtimeTaskIds?: string[],
  ): Promise<RuntimeSnapshot> => readObservabilitySnapshotImpl(
    currentFsAdapter,
    runtimeTaskIds,
  ) as Promise<RuntimeSnapshot>;
  const readSnapshot = options.readSnapshot ?? defaultReadSnapshot;
  const watchFactory = options.watchFactory ?? watch;
  const scopeProvider = options.scopeProvider ?? defaultActiveScopeProvider;
  const activeWatchers = new Map<string, FSWatcher>();
  const drainingTaskRefreshes = new Map<string, number>();
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshInFlight = false;
  let refreshQueued = false;
  let previousSnapshot: RuntimeSnapshot | null = null;
  const previousPipelinePhaseByTask = new Map<string, string>();
  const previousTerminalEventKeysByTask = new Map<string, Set<string>>();
  const visibleCanonicalLaunchEvents = new Set<string>();
  const seenFailedTaskIds = new Set<string>();
  let currentRuntimeTaskIds: string[] = [];
  let currentRealignmentIds: string[] = [];
  let currentScope: ActiveContextPackTaskScope | null = scopeProvider();
  let shouldBaselineFailedTaskIds = true;

  const resolveCurrentScope = async (): Promise<ActiveContextPackTaskScope | null> => {
    if (!options.listContextPacks) {
      return scopeProvider();
    }
    try {
      return await resolveActiveContextPackTaskScope(options.listContextPacks);
    } catch (error: unknown) {
      log.warn('runtime-stream.scope-refresh.failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return scopeProvider();
    }
  };

  const clearRuntimeState = (): void => {
    previousSnapshot = null;
    drainingTaskRefreshes.clear();
    previousPipelinePhaseByTask.clear();
    previousTerminalEventKeysByTask.clear();
    visibleCanonicalLaunchEvents.clear();
    seenFailedTaskIds.clear();
    shouldBaselineFailedTaskIds = true;
    currentRuntimeTaskIds = [];
    closeStaleRuntimeWatchers(new Set<string>());
  };

  resetRuntimeStreamStateImpl = (): void => {
    clearRuntimeState();
  };

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

  const readVisibleActiveTaskIdsFromFs = async (
    scope: ActiveContextPackTaskScope | null,
  ): Promise<string[]> => {
    const activeTaskIds = await readActiveTaskIdsFromFs();
    if (!scope || activeTaskIds.length === 0) {
      return [];
    }
    const registry = await loadTaskRegistry(REPO_ROOT);
    return filterActiveTaskIdsForScope(activeTaskIds, {
      registry,
      scope,
      pendingDir: PENDING_ITEMS_DIR,
      fsAdapter,
    });
  };

  const readVisibleFailedTaskIdsFromFs = async (
    scope: ActiveContextPackTaskScope | null,
  ): Promise<string[]> => {
    if (!scope) {
      return [];
    }
    return [...(await readVisibleTaskMarkdownItemsByTaskId(
      ERROR_ITEMS_DIR,
      scope,
      fsAdapter,
    )).keys()].sort();
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

    for (const taskId of previousTerminalEventKeysByTask.keys()) {
      if (!runtimeTaskIds.has(taskId)) {
        previousTerminalEventKeysByTask.delete(taskId);
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

  const readRuntimeTerminalEvents = async (): Promise<RuntimeTerminalEventObservation[]> => {
    const events: RuntimeTerminalEventObservation[] = [];

    for (const taskId of currentRuntimeTaskIds) {
      try {
        const raw = await fsAdapter.readFile(
          join(TASKS_RUNTIME_DIR, taskId, 'terminal-events.json'),
          'utf-8',
        );
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!Array.isArray(parsed.events)) {
          continue;
        }
        for (const item of parsed.events) {
          if (!isRecord(item)) {
            continue;
          }
          const eventId = typeof item.eventId === 'string' ? item.eventId : null;
          const source = typeof item.source === 'string' ? item.source : null;
          const role = source === 'runtime.guardrail' ? 'system' : item.role;
          const severity = item.severity;
          const visible = item.visible !== false;
          const extra = isRecord(item.extra) ? item.extra : undefined;
          const message = typeof item.message === 'string' ? item.message : null;
          const actorName = typeof item.actorName === 'string' ? item.actorName : undefined;
          const sessionContext = isRecord(item.sessionContext)
            ? item.sessionContext as StreamEventOptions['sessionContext']
            : undefined;
          if (
            !eventId ||
            !source ||
            !message ||
            !isValidTranscriptRole(role) ||
            !isValidTranscriptSeverity(severity)
          ) {
            continue;
          }
          events.push({
            taskId,
            eventId,
            source,
            role,
            severity,
            visible,
            message,
            ...(extra ? { extra } : {}),
            ...(actorName ? { actorName } : {}),
            ...(sessionContext ? { sessionContext } : {}),
          });
        }
      } catch (err) {
        if (getNodeErrorCode(err) !== 'ENOENT') {
          throw err;
        }
      }
    }

    return events;
  };

  const checkRuntimeTerminalEvents = async (): Promise<void> => {
    if (stopped) return;
    try {
      const terminalEvents = await readRuntimeTerminalEvents();
      for (const event of terminalEvents) {
        if (!event.visible) {
          continue;
        }
        const previousKeys = previousTerminalEventKeysByTask.get(event.taskId) ?? new Set<string>();
        if (previousKeys.has(event.eventId)) {
          continue;
        }
        emitStreamEvent({
          message: event.message,
          source: event.source,
          role: event.role,
          severity: event.severity,
          taskId: event.taskId,
          actorName: event.actorName,
          sessionContext: event.sessionContext,
        });
        const canonicalLaunchKey = canonicalLaunchKeyFromTerminalEvent(event);
        if (canonicalLaunchKey) {
          visibleCanonicalLaunchEvents.add(canonicalLaunchKey);
        }
        previousKeys.add(event.eventId);
        previousTerminalEventKeysByTask.set(event.taskId, previousKeys);
      }
    } catch {
      // Best effort — terminal events are observability only.
    }
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
          await appendTaskTerminalTranscriptEvent(fsAdapter, REPO_ROOT, {
            taskId,
            eventId: `runtime.pipeline.phase:${phase}`,
            message: phaseEvent.message,
            source: 'runtime.pipeline',
            role: 'pipeline',
            severity: phaseEvent.severity,
          });
        }
        previousPipelinePhaseByTask.set(taskId, phase);
      }
      await checkRuntimeTerminalEvents();
    } catch {
      // Best effort — phase file may not exist.
    }
  };

  const ensureWatchers = async (): Promise<void> => {
    const nextScope = await resolveCurrentScope();
    if (!activeContextPackTaskScopesEqual(currentScope, nextScope)) {
      currentScope = nextScope;
      clearRuntimeState();
    }
    const activeTaskIds = await readVisibleActiveTaskIdsFromFs(currentScope);
    const failedTaskIds = await readVisibleFailedTaskIdsFromFs(currentScope);
    if (shouldBaselineFailedTaskIds) {
      seenFailedTaskIds.clear();
      for (const taskId of failedTaskIds) {
        seenFailedTaskIds.add(taskId);
      }
      shouldBaselineFailedTaskIds = false;
    } else {
      const currentFailedTaskIds = new Set(failedTaskIds);
      for (const taskId of [...seenFailedTaskIds]) {
        if (!currentFailedTaskIds.has(taskId)) {
          seenFailedTaskIds.delete(taskId);
        }
      }
      for (const taskId of failedTaskIds) {
        if (!seenFailedTaskIds.has(taskId)) {
          drainingTaskRefreshes.set(taskId, FINAL_DRAIN_REFRESH_COUNT);
          seenFailedTaskIds.add(taskId);
        }
      }
    }
    currentRuntimeTaskIds = resolveRuntimeTaskIds(activeTaskIds);
    try {
      await refreshStreamTaskMetadataForScope(currentScope);
    } catch (error: unknown) {
      log.warn('runtime-stream.task-metadata-refresh.failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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
          } else if (filename === 'terminal-events.json') {
            void checkRuntimeTerminalEvents();
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
      await checkRuntimeTerminalEvents();
      const snapshot = await readSnapshot(fsAdapter, currentRuntimeTaskIds);
      const runtimeSnapshot: RuntimeSnapshot = {
        agentTerminalSessions: snapshot.agentTerminalSessions ?? [],
        guardrails: snapshot.guardrails ?? [],
        realignmentJobs: await readRealignmentJobs(),
      };

      if (stopped) return;

      if (previousSnapshot) {
        const canonicalLaunchEvents = new Set<string>(visibleCanonicalLaunchEvents);
        try {
          for (const terminalEvent of await readRuntimeTerminalEvents()) {
            const key = canonicalLaunchKeyFromTerminalEvent(terminalEvent);
            if (key) {
              canonicalLaunchEvents.add(key);
              visibleCanonicalLaunchEvents.add(key);
            }
          }
        } catch {
          // Fail open to existing generic fallback.
        }
        let appendedTranscriptEvent = false;
        const appendedTaskIds = new Set<string>();
        for (const { event, transcriptEventId } of diffRuntimeStreamEntries(previousSnapshot, runtimeSnapshot)) {
          if (shouldSuppressGenericSessionFallback(event, canonicalLaunchEvents)) {
            continue;
          }
          if (hasRealTaskId(event.taskId)) {
            if (!transcriptEventId) {
              continue;
            }
            await appendTaskTerminalTranscriptEvent(fsAdapter, REPO_ROOT, {
              taskId: event.taskId,
              eventId: transcriptEventId,
              source: event.source,
              role: event.role,
              severity: event.severity ?? 'info',
              message: event.message,
              ...(event.actorName ? { actorName: event.actorName } : {}),
              ...(event.sessionContext ? { sessionContext: event.sessionContext } : {}),
            });
            appendedTranscriptEvent = true;
            appendedTaskIds.add(event.taskId);
          } else {
            emitStreamEvent(event);
          }
        }
        if (appendedTranscriptEvent) {
          currentRuntimeTaskIds = [...new Set([...currentRuntimeTaskIds, ...appendedTaskIds])].sort();
          await checkRuntimeTerminalEvents();
        }
      }

      previousSnapshot = runtimeSnapshot;
    } catch (err) {
      if (getNodeErrorCode(err) !== 'ENOENT') {
        log.warn('runtime-stream.refresh.failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      refreshInFlight = false;
      if (refreshQueued && !stopped) {
        refreshQueued = false;
        void refreshFromArtifacts();
      }
    }
  };

  refreshRuntimeStreamStateImpl = refreshFromArtifacts;
  void refreshFromArtifacts();

  return () => {
    stopped = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (resetRuntimeStreamStateImpl) {
      resetRuntimeStreamStateImpl = null;
    }
    if (refreshRuntimeStreamStateImpl === refreshFromArtifacts) {
      refreshRuntimeStreamStateImpl = null;
    }
    for (const watcher of activeWatchers.values()) {
      watcher.close();
    }
    activeWatchers.clear();
  };
}
