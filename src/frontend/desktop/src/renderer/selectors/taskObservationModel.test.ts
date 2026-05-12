import { describe, expect, it } from 'vitest';

import type { AgentTerminalSession, TaskLifecycleFeed } from '../../shared/desktopContract';
import type { StreamEvent } from '../activityStream';
import { buildTaskObservationModel } from './taskObservationModel';

function makeSession(overrides: Partial<AgentTerminalSession> = {}): AgentTerminalSession {
  return {
    taskId: 'TASK-1',
    agentId: 'provider-builder',
    agentLabel: 'Dalton (Software Engineer)',
    sessionId: 'sess-1',
    instanceId: null,
    launchPid: null,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    sliceId: null,
    slicePath: null,
    launchState: 'started',
    terminalState: 'running',
    lastUpdatedAt: '2026-03-12T10:00:00Z',
    latestOutputLines: [],
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: 'info',
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskLifecycleFeed> = {}): TaskLifecycleFeed {
  return {
    taskId: 'TASK-1',
    taskTitle: 'Test task',
    taskKind: 'standard',
    workflowStage: 'active',
    activePath: null,
    parallelizationEnabled: false,
    startedAt: '2026-03-12T09:00:00Z',
    lastUpdatedAt: '2026-03-12T10:00:00Z',
    sourceArtifact: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    id: 'evt-1',
    timestamp: '10:05:30',
    role: 'workflow',
    source: 'test',
    taskId: 'TASK-1',
    severity: 'info',
    message: 'Test event',
    ...overrides,
  };
}

const defaultArgs = {
  activeTask: null as TaskLifecycleFeed | null,
  agentTerminalSessions: [] as AgentTerminalSession[],
  visibleActivityStream: [] as StreamEvent[],
  taskLocked: false,
  closedTask: false,
  plannerAgentId: 'provider-planner',
};

describe('buildTaskObservationModel', () => {
  it('returns default posture chips when no active task exists', () => {
    const model = buildTaskObservationModel(defaultArgs);
    expect(model.postureChips).toHaveLength(2);
    expect(model.postureChips[0].label).toBe('Planner intake open');
    expect(model.postureChips[0].tone).toBe('active');
    expect(model.postureChips[1].label).toBe('0 sessions observed');
    expect(model.postureChips[1].tone).toBe('idle');
  });

  it('maps workflow stage to posture chip tone', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      activeTask: makeTask({ workflowStage: 'blocked' }),
    });
    const stageChip = model.postureChips.find((c) => c.label.startsWith('Stage'));
    expect(stageChip?.tone).toBe('blocked');
  });

  it('includes health and guardrail chips when present on active task', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      activeTask: makeTask({
        taskHealth: {
          status: 'healthy',
          summary: 'All good',
          observedSessionCount: 1,
          runningCount: 1,
          completedCount: 0,
          failedCount: 0,
          suspectedStuckCount: 0,
          orphanedCount: 0,
          aliveCount: 1,
          missingPidCount: 0,
          unknownPidCount: 0,
        },
        guardrailSummary: {
          status: 'attention',
          summary: 'Warning issued',
          observedReceiptCount: 1,
          allowedCount: 0,
          deniedCount: 0,
          internalBypassCount: 0,
          malformedCount: 0,
          violationCount: 1,
        },
      }),
    });
    const healthChip = model.postureChips.find((c) => c.label.startsWith('Health'));
    const guardrailChip = model.postureChips.find((c) => c.label.startsWith('Guardrails'));
    expect(healthChip?.tone).toBe('completed');
    expect(guardrailChip?.tone).toBe('active');
  });

  it('shows "Execution observed only" when task is locked', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      taskLocked: true,
    });
    expect(model.postureChips[0].label).toBe('Execution observed only');
    expect(model.postureChips[0].tone).toBe('blocked');
  });

  it('shows "Closed task thread" for closed tasks', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      closedTask: true,
    });
    expect(model.postureChips[0].label).toBe('Closed task thread');
    expect(model.postureChips[0].tone).toBe('completed');
  });

  it('selects the most recent planner event as plannerContextEvent', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      visibleActivityStream: [
        makeEvent({ id: 'e1', role: 'planner', timestamp: '09:00:00' }),
        makeEvent({ id: 'e2', role: 'planner', timestamp: '11:00:00' }),
        makeEvent({ id: 'e3', role: 'workflow', timestamp: '12:00:00' }),
      ],
    });
    expect(model.plannerContextEvent?.id).toBe('e2');
  });

  it('returns null plannerContextEvent when no planner events exist', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      visibleActivityStream: [makeEvent({ role: 'workflow' })],
    });
    expect(model.plannerContextEvent).toBeNull();
  });

  it('selects top 2 sessions as primarySessions by ranking score', () => {
    const sessions = [
      makeSession({ sessionId: 's1', agentId: 'provider-builder', terminalState: 'completed' }),
      makeSession({ sessionId: 's2', agentId: 'provider-planner', terminalState: 'running' }),
      makeSession({ sessionId: 's3', agentId: 'provider-qa', terminalState: 'pending' }),
    ];
    const model = buildTaskObservationModel({
      ...defaultArgs,
      activeTask: makeTask(),
      agentTerminalSessions: sessions,
    });
    expect(model.primarySessions).toHaveLength(2);
    expect(model.primarySessions[0].agentId).toBe('provider-planner');
  });

  it('groups remaining sessions into relatedThreads by taskId', () => {
    const sessions = [
      makeSession({ sessionId: 's1', taskId: 'TASK-1', agentId: 'provider-planner' }),
      makeSession({ sessionId: 's2', taskId: 'TASK-1', agentId: 'provider-builder' }),
      makeSession({ sessionId: 's3', taskId: 'TASK-2', agentId: 'provider-qa', terminalState: 'pending', launchState: 'queued', liveness: 'unknown', stuckState: 'none', severity: 'info' }),
      makeSession({ sessionId: 's4', taskId: 'TASK-2', agentId: 'provider-qa', terminalState: 'pending', launchState: 'queued', liveness: 'unknown', stuckState: 'none', severity: 'info' }),
      makeSession({ sessionId: 's5', taskId: 'TASK-2', agentId: 'provider-pm', terminalState: 'pending', launchState: 'queued', liveness: 'unknown', stuckState: 'none', severity: 'info' }),
    ];
    const model = buildTaskObservationModel({
      ...defaultArgs,
      activeTask: makeTask({ taskId: 'TASK-1' }),
      agentTerminalSessions: sessions,
    });
    const task2Thread = model.relatedThreads.find((t) => t.taskId === 'TASK-2');
    expect(task2Thread).toBeDefined();
    expect(task2Thread!.sessions.length).toBeGreaterThanOrEqual(1);
    expect(task2Thread!.heading).toBe('Related task thread · TASK-2');
  });

  it('builds thread chips with running and warning counts', () => {
    const sessions = [
      makeSession({ sessionId: 's1', agentId: 'provider-planner' }),
      makeSession({ sessionId: 's2', agentId: 'provider-builder' }),
      makeSession({ sessionId: 's3', taskId: 'TASK-2', terminalState: 'running', severity: 'warning', agentId: 'provider-qa', launchState: 'queued', liveness: 'unknown', stuckState: 'none' }),
    ];
    const model = buildTaskObservationModel({
      ...defaultArgs,
      activeTask: makeTask({ taskId: 'TASK-1' }),
      agentTerminalSessions: sessions,
    });
    const thread = model.relatedThreads.find((t) => t.taskId === 'TASK-2');
    expect(thread).toBeDefined();
    const runningChip = thread!.chips.find((c) => c.label.startsWith('Running'));
    const reviewChip = thread!.chips.find((c) => c.label.startsWith('Needs review'));
    expect(runningChip?.tone).toBe('active');
    expect(reviewChip?.tone).toBe('blocked');
  });

  it('creates event-only threads for non-active task events', () => {
    const model = buildTaskObservationModel({
      ...defaultArgs,
      activeTask: makeTask({ taskId: 'TASK-1' }),
      visibleActivityStream: [
        makeEvent({ id: 'e1', taskId: 'TASK-2', role: 'workflow' }),
        makeEvent({ id: 'e2', taskId: 'TASK-2', role: 'system' }),
      ],
    });
    const thread = model.relatedThreads.find((t) => t.taskId === 'TASK-2');
    expect(thread).toBeDefined();
    expect(thread!.events).toHaveLength(2);
    expect(thread!.sessions).toHaveLength(0);
  });

  it('handles empty inputs gracefully', () => {
    const model = buildTaskObservationModel(defaultArgs);
    expect(model.plannerContextEvent).toBeNull();
    expect(model.primarySessions).toHaveLength(0);
    expect(model.relatedThreads).toHaveLength(0);
  });
});
