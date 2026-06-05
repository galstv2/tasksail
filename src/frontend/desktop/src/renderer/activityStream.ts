export type StreamRole =
  | 'planner'
  | 'queue'
  | 'agent'
  | 'pipeline'
  | 'workflow'
  | 'operator'
  | 'system';
export type StreamSeverity = 'info' | 'success' | 'warning' | 'error';

export type TerminalTaskScopeOption = {
  taskGuid: string;
  taskShortGuid: string;
  taskId: string;
  title: string | null;
};

export type StreamEvent = {
  id: string;
  timestamp: string;
  role: StreamRole;
  actorName?: string;
  source: string;
  taskId: string;
  taskGuid: string | null;
  taskShortGuid: string | null;
  taskTitle: string | null;
  severity: StreamSeverity;
  message: string;
  /** Optional: realignment job ID. Present only on runtime.realignment events. */
  realignmentId?: string;
  sessionContext?: {
    sessionId: string;
    instanceId: string | null;
    sliceId: string | null;
    launchState: string;
    terminalState: string;
    liveness: string;
    stuckState: string;
    guardrailStatus?: string;
  };
};

function humanizeSessionState(value: string): string {
  return value.replace(/-/g, ' ');
}

export const streamRoleAppearance: Record<
  StreamRole,
  { label: string; accentClass: string }
> = {
  planner: { label: 'Planner', accentClass: 'planner' },
  queue: { label: 'Queue', accentClass: 'queue' },
  agent: { label: 'Agent', accentClass: 'agent' },
  pipeline: { label: 'Pipeline', accentClass: 'pipeline' },
  workflow: { label: 'Workflow', accentClass: 'workflow' },
  operator: { label: 'Operator', accentClass: 'operator' },
  system: { label: 'System', accentClass: 'system' },
};

export function formatStreamMetadata(event: StreamEvent): string {
  const metadataParts = [event.timestamp, event.source, event.taskId || 'N/A', event.severity];
  if (event.taskGuid) {
    metadataParts.push(`guid ${event.taskGuid}`);
  }

  if (event.sessionContext?.instanceId) {
    metadataParts.push(`instance ${event.sessionContext.instanceId}`);
  }

  if (event.sessionContext?.sliceId) {
    metadataParts.push(`slice ${event.sessionContext.sliceId}`);
  }

  if (event.sessionContext) {
    metadataParts.push(`launch ${event.sessionContext.launchState}`);
    metadataParts.push(`terminal ${event.sessionContext.terminalState}`);
    if (event.sessionContext.liveness !== 'unknown') {
      metadataParts.push(`pid ${humanizeSessionState(event.sessionContext.liveness)}`);
    }
    if (event.sessionContext.stuckState !== 'none') {
      metadataParts.push(`stuck ${humanizeSessionState(event.sessionContext.stuckState)}`);
    }
    if (event.sessionContext.guardrailStatus) {
      metadataParts.push(
        `guardrail ${humanizeSessionState(event.sessionContext.guardrailStatus)}`,
      );
    }
  }

  return metadataParts.join(' · ');
}

export function messageEmbedsActorName(event: Pick<StreamEvent, 'actorName' | 'message'>): boolean {
  const actorName = event.actorName?.trim();
  if (!actorName) {
    return false;
  }
  return event.message.startsWith(`Task [`) && (
    event.message.includes(`] - ${actorName}:`) ||
    event.message.includes(`] ${actorName}:`)
  );
}

export function formatStreamMessage(event: StreamEvent): string {
  if (!event.actorName || messageEmbedsActorName(event)) {
    return event.message;
  }
  return `${event.actorName}: ${event.message}`;
}

export function filterActivityStream(
  events: StreamEvent[],
  roleFilter: StreamRole | 'all',
): StreamEvent[] {
  return events.filter((event) => {
    return roleFilter === 'all' || event.role === roleFilter;
  });
}
