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
      workflow: { label: 'Workflow', accentClass: 'workflow' },
      operator: { label: 'Operator', accentClass: 'operator' },
      system: { label: 'System', accentClass: 'system' },
    });
  });

  it('formats event metadata and supports role plus severity filtering', () => {
    const events: StreamEvent[] = [
      {
        id: 'planner-1',
        timestamp: '09:14:02',
        role: 'planner',
        actorName: 'Lily',
        source: 'planner-chat',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        severity: 'info',
        message: 'Accepted the slice brief and opened the draft composer.',
      },
      {
        id: 'session-parallel:dalton-1',
        timestamp: '2026-03-07T21:09:00Z',
        role: 'workflow',
        actorName: 'Dalton · dalton-1',
        source: 'agent-session',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        severity: 'success',
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
        role: 'workflow',
        actorName: 'Ron (QA and Closeout)',
        source: 'agent-session',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        severity: 'success',
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
        id: 'workflow-warning',
        timestamp: '10:20:00',
        role: 'workflow',
        source: 'repo-observer',
        taskId: 'CAP-CUSTOM-TERMINAL-04',
        severity: 'warning',
        message: 'Lifecycle blocked state observed.',
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

    const workflowOnly = filterActivityStream(events, 'workflow', false);
    expect(workflowOnly.every((event) => event.role === 'workflow')).toBe(true);

    const highPriority = filterActivityStream(events, 'all', true);
    expect(highPriority.every((event) => event.severity === 'warning' || event.severity === 'error')).toBe(true);
    expect(formatStreamMessage(events[0])).toBe('Lily: Accepted the slice brief and opened the draft composer.');
  });
});
