export type StreamRole = 'planner' | 'queue' | 'workflow' | 'operator' | 'system';
export type StreamSeverity = 'info' | 'success' | 'warning' | 'error';

export type StreamEvent = {
  id: string;
  timestamp: string;
  role: StreamRole;
  actorName?: string;
  source: string;
  taskId: string;
  severity: StreamSeverity;
  message: string;
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
  workflow: { label: 'Workflow', accentClass: 'workflow' },
  operator: { label: 'Operator', accentClass: 'operator' },
  system: { label: 'System', accentClass: 'system' },
};

export function formatStreamMetadata(event: StreamEvent): string {
  const metadataParts = [event.timestamp, event.source, event.taskId || 'N/A', event.severity];

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

export function formatStreamMessage(event: StreamEvent): string {
  return event.actorName ? `${event.actorName}: ${event.message}` : event.message;
}

export function filterActivityStream(
  events: StreamEvent[],
  roleFilter: StreamRole | 'all',
  highPriorityOnly: boolean,
): StreamEvent[] {
  return events.filter((event) => {
    const roleMatches = roleFilter === 'all' || event.role === roleFilter;
    const priorityMatches = !highPriorityOnly || event.severity === 'warning' || event.severity === 'error';
    return roleMatches && priorityMatches;
  });
}
