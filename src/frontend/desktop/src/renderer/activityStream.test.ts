import { describe, expect, it } from 'vitest';

import {
  filterActivityStream,
  formatStreamMetadata,
  formatStreamMessage,
  streamRoleAppearance,
  type StreamEvent,
} from './activityStream';

describe('activityStream helpers', () => {
  it('keeps a stable color identity for each workflow role', () => {
    expect(streamRoleAppearance).toEqual({
      planner: { label: 'Planner', accentClass: 'planner' },
      queue: { label: 'Queue', accentClass: 'queue' },
      agent: { label: 'Agent', accentClass: 'agent' },
      pipeline: { label: 'Pipeline', accentClass: 'pipeline' },
      workflow: { label: 'Workflow', accentClass: 'workflow' },
      operator: { label: 'Operator', accentClass: 'operator' },
      system: { label: 'System', accentClass: 'system' },
    });
  });

  it('formats event metadata and supports role filtering across all severities', () => {
    const events: StreamEvent[] = [
      {
        id: 'planner-1',
        timestamp: '09:14:02',
        role: 'planner',
        actorName: 'Lily',
        source: 'planner-chat',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'info',
        message: 'Accepted the slice brief and opened the draft composer.',
      },
      {
        id: 'session-parallel:dalton-1',
        timestamp: '2026-03-07T21:09:00Z',
        role: 'agent',
        actorName: 'Dalton · dalton-1',
        source: 'agent-session',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
        taskShortGuid: 'feedbeef',
        taskTitle: 'Terminal gate',
        severity: 'warning',
        message: 'Completed slice wiring.',
        sessionContext: {
          sessionId: 'parallel:dalton-1',
          instanceId: 'dalton-1',
          sliceId: 'slice-07',
          launchState: 'completed',
          terminalState: 'completed',
          liveness: 'alive',
          stuckState: 'suspected-stuck',
          guardrailStatus: 'internal-bypass',
        },
      },
      {
        id: 'session-role:qa',
        timestamp: '2026-03-07T21:10:00Z',
        role: 'agent',
        actorName: 'Ron (QA and Closeout)',
        source: 'agent-session',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'info',
        message: 'QA and Closeout exited completed (exit_code=0).',
        sessionContext: {
          sessionId: 'role:qa',
          instanceId: null,
          sliceId: null,
          launchState: 'started',
          terminalState: 'completed',
          liveness: 'unknown',
          stuckState: 'none',
        },
      },
      {
        id: 'pipeline-info',
        timestamp: '10:18:00',
        role: 'pipeline',
        source: 'runtime.pipeline',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'info',
        message: 'Code capture started.',
      },
      {
        id: 'pipeline-success',
        timestamp: '10:18:30',
        role: 'pipeline',
        source: 'runtime.pipeline',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'success',
        message: 'Code capture completed.',
      },
      {
        id: 'pipeline-warning',
        timestamp: '10:19:00',
        role: 'pipeline',
        source: 'runtime.pipeline',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'warning',
        message: 'Code capture skipped.',
      },
      {
        id: 'workflow-warning',
        timestamp: '10:20:00',
        role: 'workflow',
        source: 'repo-observer',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'warning',
        message: 'Lifecycle blocked state observed.',
      },
      {
        id: 'queue-error',
        timestamp: '10:21:00',
        role: 'queue',
        source: 'queue',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'error',
        message: 'Queue activation failed.',
      },
      {
        id: 'system-info',
        timestamp: '10:22:00',
        role: 'pipeline',
        source: 'runtime.guardrail',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'info',
        message: 'Guardrail allowed launch.',
      },
    ];

    expect(formatStreamMetadata(events[0])).toMatch(/09:14:02 · planner-chat · CAP-CUSTOM-TERMINAL-04 · info/);

    const sessionEvent = events.find((event) => event.id === 'session-parallel:dalton-1');
    expect(sessionEvent?.sessionContext).toEqual({
      sessionId: 'parallel:dalton-1',
      instanceId: 'dalton-1',
      sliceId: 'slice-07',
      launchState: 'completed',
      terminalState: 'completed',
      liveness: 'alive',
      stuckState: 'suspected-stuck',
      guardrailStatus: 'internal-bypass',
    });
    expect(formatStreamMetadata(sessionEvent!)).toContain('instance dalton-1');
    expect(formatStreamMetadata(sessionEvent!)).toContain('guid feedbeef-1234-4234-9234-123456789abc');
    expect(formatStreamMetadata(events[0])).not.toContain('guid ');
    expect(formatStreamMetadata(sessionEvent!)).toContain('slice slice-07');
    expect(formatStreamMetadata(sessionEvent!)).toContain('launch completed');
    expect(formatStreamMetadata(sessionEvent!)).toContain('terminal completed');
    expect(formatStreamMetadata(sessionEvent!)).toContain('pid alive');
    expect(formatStreamMetadata(sessionEvent!)).toContain('stuck suspected stuck');
    expect(formatStreamMetadata(sessionEvent!)).toContain(
      'guardrail internal bypass',
    );

    const roleSessionEvent = events.find((event) => event.id === 'session-role:qa');
    expect(roleSessionEvent?.sessionContext?.instanceId).toBeNull();
    expect(roleSessionEvent?.sessionContext?.sliceId).toBeNull();
    expect(formatStreamMetadata(roleSessionEvent!)).toContain('launch started');
    expect(formatStreamMetadata(roleSessionEvent!)).toContain('terminal completed');
    expect(formatStreamMetadata(roleSessionEvent!)).not.toContain('instance ');

    const allEvents = filterActivityStream(events, 'all');
    expect(allEvents.map((event) => event.severity)).toEqual([
      'info',
      'warning',
      'info',
      'info',
      'success',
      'warning',
      'warning',
      'error',
      'info',
    ]);

    const workflowOnly = filterActivityStream(events, 'workflow');
    expect(workflowOnly.every((event) => event.role === 'workflow')).toBe(true);

    const agentOnly = filterActivityStream(events, 'agent');
    expect(agentOnly.every((event) => event.role === 'agent')).toBe(true);

    const pipelineOnly = filterActivityStream(events, 'pipeline');
    expect(pipelineOnly.every((event) => event.role === 'pipeline')).toBe(true);
    expect(filterActivityStream(events, 'all')).toHaveLength(events.length);
    expect(streamRoleAppearance.workflow).toEqual({ label: 'Workflow', accentClass: 'workflow' });
    expect(formatStreamMessage(events[0])).toBe('Lily: Accepted the slice brief and opened the draft composer.');
    expect(formatStreamMessage({
      ...events[0],
      actorName: 'Alice (Product Manager)',
      message: 'Task [feedbeef] - Alice (Product Manager): Is running.',
    })).toBe('Task [feedbeef] - Alice (Product Manager): Is running.');
  });
});
