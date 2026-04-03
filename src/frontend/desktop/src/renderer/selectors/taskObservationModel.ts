import type { AgentTerminalSession, TaskLifecycleFeed } from '../../shared/desktopContract';
import type { StreamEvent } from '../activityStream';

export type ObservationChipTone = 'idle' | 'active' | 'blocked' | 'completed';

export type ObservationChip = {
  label: string;
  tone: ObservationChipTone;
};

export type RelatedTaskThread = {
  key: string;
  heading: string;
  taskId: string | null;
  summary: string;
  chips: ObservationChip[];
  sessions: AgentTerminalSession[];
  events: StreamEvent[];
};

export type TaskObservationModel = {
  postureChips: ObservationChip[];
  plannerContextEvent: StreamEvent | null;
  primarySessions: AgentTerminalSession[];
  relatedThreads: RelatedTaskThread[];
};

function mapStageTone(stage: TaskLifecycleFeed['workflowStage']): ObservationChipTone {
  switch (stage) {
    case 'active':
      return 'active';
    case 'blocked':
      return 'blocked';
    case 'complete':
      return 'completed';
    default:
      return 'idle';
  }
}

function mapHealthTone(status: NonNullable<TaskLifecycleFeed['taskHealth']>['status']): ObservationChipTone {
  switch (status) {
    case 'healthy':
      return 'completed';
    case 'attention':
      return 'active';
    case 'critical':
      return 'blocked';
    default:
      return 'idle';
  }
}

function compareIsoDatesDesc(left: string | null, right: string | null): number {
  return (right ?? '').localeCompare(left ?? '');
}

function rankSession(session: AgentTerminalSession, activeTaskId: string | null): number {
  let score = 0;

  if (session.agentId === 'planning-agent') {
    score += 100;
  }

  if (session.taskId && session.taskId === activeTaskId) {
    score += 80;
  } else if (activeTaskId && session.taskId && session.taskId !== activeTaskId) {
    score -= 12;
  }

  if (session.terminalState === 'running') {
    score += 28;
  } else if (session.terminalState === 'completed') {
    score += 14;
  } else if (session.terminalState === 'failed') {
    score += 18;
  }

  if (session.launchState === 'started') {
    score += 22;
  }

  if (session.severity === 'error') {
    score += 18;
  } else if (session.severity === 'warning') {
    score += 14;
  } else if (session.severity === 'success') {
    score += 8;
  }

  if (session.stuckState === 'orphaned') {
    score += 20;
  } else if (session.stuckState === 'suspected-stuck') {
    score += 12;
  }

  if (session.liveness === 'alive') {
    score += 6;
  }

  return score;
}

function buildPostureChips(args: {
  activeTask: TaskLifecycleFeed | null;
  taskLocked: boolean;
  closedTask: boolean;
  sessionCount: number;
}): ObservationChip[] {
  const { activeTask, taskLocked, closedTask, sessionCount } = args;
  const chips: ObservationChip[] = [];

  if (activeTask) {
    chips.push({
      label: `Stage ${activeTask.workflowStage}`,
      tone: mapStageTone(activeTask.workflowStage),
    });

    if (activeTask.taskHealth) {
      chips.push({
        label: `Health ${activeTask.taskHealth.status}`,
        tone: mapHealthTone(activeTask.taskHealth.status),
      });
    }

    if (activeTask.guardrailSummary) {
      chips.push({
        label: `Guardrails ${activeTask.guardrailSummary.status}`,
        tone: mapHealthTone(activeTask.guardrailSummary.status),
      });
    }
  }

  chips.push({
    label: taskLocked ? 'Execution observed only' : closedTask ? 'Closed task thread' : 'Planner intake open',
    tone: taskLocked ? 'blocked' : closedTask ? 'completed' : 'active',
  });
  chips.push({
    label: `${sessionCount} session${sessionCount === 1 ? '' : 's'} observed`,
    tone: sessionCount > 0 ? 'active' : 'idle',
  });

  return chips;
}

function buildThreadHeading(taskId: string | null, activeTaskId: string | null): string {
  if (!taskId) {
    return 'Task-scoped runtime thread';
  }

  if (taskId === activeTaskId) {
    return `Current task overflow · ${taskId}`;
  }

  return `Related task thread · ${taskId}`;
}

function buildThreadSummary(sessions: AgentTerminalSession[], events: StreamEvent[]): string {
  const sessionCount = sessions.length;
  const eventCount = events.length;
  const mostRecentSession = [...sessions].sort((left, right) => compareIsoDatesDesc(left.lastUpdatedAt, right.lastUpdatedAt))[0];

  return [
    `${sessionCount} session${sessionCount === 1 ? '' : 's'} observed`,
    eventCount > 0 ? `${eventCount} related activit${eventCount === 1 ? 'y' : 'ies'}` : null,
    mostRecentSession?.lastUpdatedAt ? `updated ${mostRecentSession.lastUpdatedAt}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

function buildThreadChips(sessions: AgentTerminalSession[]): ObservationChip[] {
  const runningCount = sessions.filter((session) => session.terminalState === 'running').length;
  const warningCount = sessions.filter(
    (session) => session.severity === 'warning' || session.severity === 'error',
  ).length;

  return [
    {
      label: runningCount > 0 ? `Running ${runningCount}` : 'No running terminals',
      tone: runningCount > 0 ? 'active' : 'idle',
    },
    {
      label: warningCount > 0 ? `Needs review ${warningCount}` : 'Stable thread',
      tone: warningCount > 0 ? 'blocked' : 'completed',
    },
  ];
}

export function buildTaskObservationModel(args: {
  activeTask: TaskLifecycleFeed | null;
  agentTerminalSessions: AgentTerminalSession[];
  visibleActivityStream: StreamEvent[];
  taskLocked: boolean;
  closedTask: boolean;
}): TaskObservationModel {
  const { activeTask, agentTerminalSessions, visibleActivityStream, taskLocked, closedTask } = args;
  const activeTaskId = activeTask?.taskId ?? null;
  const plannerContextEvent =
    [...visibleActivityStream]
      .filter((event) => event.role === 'planner')
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0] ?? null;

  const prioritizedSessions = [...agentTerminalSessions].sort((left, right) => {
    const scoreDelta = rankSession(right, activeTaskId) - rankSession(left, activeTaskId);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return compareIsoDatesDesc(left.lastUpdatedAt, right.lastUpdatedAt);
  });

  const primarySessions = prioritizedSessions.slice(0, 2);
  const primarySessionIds = new Set(primarySessions.map((session) => session.sessionId));
  const remainingSessions = prioritizedSessions.filter((session) => !primarySessionIds.has(session.sessionId));

  const threadMap = new Map<string, RelatedTaskThread>();

  for (const session of remainingSessions) {
    const key = session.taskId ?? session.sessionId;
    const existing = threadMap.get(key);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }

    threadMap.set(key, {
      key,
      heading: buildThreadHeading(session.taskId, activeTaskId),
      taskId: session.taskId,
      summary: '',
      chips: [],
      sessions: [session],
      events: [],
    });
  }

  for (const event of visibleActivityStream) {
    if (event.role === 'planner') {
      continue;
    }

    if (!event.taskId || event.taskId === 'N/A' || event.taskId === 'NONE') {
      continue;
    }

    if (event.taskId === activeTaskId) {
      continue;
    }

    const existing = threadMap.get(event.taskId);
    if (existing) {
      existing.events.push(event);
      continue;
    }

    threadMap.set(event.taskId, {
      key: event.taskId,
      heading: buildThreadHeading(event.taskId, activeTaskId),
      taskId: event.taskId,
      summary: '',
      chips: [],
      sessions: [],
      events: [event],
    });
  }

  const relatedThreads = [...threadMap.values()].map((thread) => ({
    ...thread,
    summary: buildThreadSummary(thread.sessions, thread.events),
    chips: buildThreadChips(thread.sessions),
  }));

  return {
    postureChips: buildPostureChips({
      activeTask,
      taskLocked,
      closedTask,
      sessionCount: agentTerminalSessions.length,
    }),
    plannerContextEvent,
    primarySessions,
    relatedThreads,
  };
}
