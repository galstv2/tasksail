import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentTerminalSession, ArtifactReference, TaskLifecycleFeed } from '../../../shared/desktopContract';
import ActiveTasksSection from './ActiveTasksSection';

afterEach(() => {
  cleanup();
});

function makeTask(overrides: Partial<TaskLifecycleFeed> = {}): TaskLifecycleFeed {
  return {
    taskId: 'TASK-001',
    taskTitle: 'Build feature A',
    taskKind: 'standard',
    workflowStage: 'active',
    activePath: null,
    parallelizationEnabled: false,
    startedAt: '2026-04-01T10:00:00Z',
    lastUpdatedAt: '2026-04-01T11:00:00Z',
    sourceArtifact: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<AgentTerminalSession> = {}): AgentTerminalSession {
  return {
    taskId: 'TASK-001',
    agentId: 'dalton',
    agentLabel: 'Dalton (Software Engineer)',
    sessionId: 'role:dalton:launch-1',
    instanceId: null,
    launchPid: null,
    liveness: 'alive',
    stuckState: 'none',
    stuckReason: null,
    sliceId: null,
    slicePath: null,
    launchState: 'started',
    terminalState: 'running',
    lastUpdatedAt: '2026-04-01T11:00:00Z',
    latestOutputLines: [],
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: 'info',
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<ArtifactReference> & { taskId?: string | null } = {}): ArtifactReference & { taskId?: string | null } {
  return {
    label: 'professional-task.md',
    path: 'AgentWorkSpace/tasks/TASK-001/handoffs/professional-task.md',
    kind: 'file',
    status: 'present',
    detail: 'Main task workspace',
    taskId: 'TASK-001',
    ...overrides,
  };
}

describe('ActiveTasksSection', () => {
  it('shows empty state when no active tasks', () => {
    render(<ActiveTasksSection activeTasks={[]} />);
    expect(screen.getByText('No tasks are currently active.')).toBeInTheDocument();
  });

  it('renders a single active task with title and taskId', () => {
    render(<ActiveTasksSection activeTasks={[makeTask()]} />);
    expect(screen.getByText('Build feature A')).toBeInTheDocument();
    expect(screen.getByText('TASK-001')).toBeInTheDocument();
  });

  it('renders lifecycle stage chip', () => {
    render(<ActiveTasksSection activeTasks={[makeTask({ workflowStage: 'active' })]} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders session count chip', () => {
    const sessions = [
      makeSession({ taskId: 'TASK-001', sessionId: 'role:dalton:a' }),
      makeSession({ taskId: 'TASK-001', sessionId: 'role:alice:a', agentId: 'alice' }),
    ];
    render(<ActiveTasksSection activeTasks={[makeTask()]} agentTerminalSessions={sessions} />);
    expect(screen.getByText('2 sessions')).toBeInTheDocument();
  });

  it('shows singular session count when exactly one session', () => {
    render(<ActiveTasksSection activeTasks={[makeTask()]} agentTerminalSessions={[makeSession()]} />);
    expect(screen.getByText('1 session')).toBeInTheDocument();
  });

  it('renders 10 active tasks with each title and taskId visible and grouped', () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ taskId: `TASK-${String(i + 1).padStart(3, '0')}`, taskTitle: `Task ${i + 1}` }),
    );
    render(<ActiveTasksSection activeTasks={tasks} />);
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByText(`Task ${i}`)).toBeInTheDocument();
      expect(screen.getByText(`TASK-${String(i).padStart(3, '0')}`)).toBeInTheDocument();
    }
  });

  it('scopes sessions to their own task — sessions for task A do not render under task B', () => {
    const taskA = makeTask({ taskId: 'TASK-A', taskTitle: 'Task A' });
    const taskB = makeTask({ taskId: 'TASK-B', taskTitle: 'Task B' });
    const sessionA = makeSession({ taskId: 'TASK-A', sessionId: 'role:dalton:a' });

    render(
      <ActiveTasksSection
        activeTasks={[taskA, taskB]}
        agentTerminalSessions={[sessionA]}
      />,
    );

    const taskAEl = screen.getByLabelText('Active task TASK-A');
    const taskBEl = screen.getByLabelText('Active task TASK-B');

    expect(within(taskAEl).getByText('1 session')).toBeInTheDocument();
    expect(within(taskBEl).getByText('0 sessions')).toBeInTheDocument();
  });

  it('renders health chip when taskHealth is present', () => {
    const task = makeTask({
      taskHealth: {
        status: 'healthy',
        summary: 'All ok',
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
    });
    render(<ActiveTasksSection activeTasks={[task]} />);
    expect(screen.getByText('Health healthy')).toBeInTheDocument();
  });

  it('renders recovery state chip when recoveryState is present', () => {
    const task = makeTask({
      recoveryState: {
        kind: 'activation-timeout',
        status: 'pending-start',
        summary: 'Waiting.',
        queueName: 'TASK-001.md',
        taskId: 'TASK-001',
        activationStartedAt: '2026-04-01T10:00:00Z',
        deadlineAt: '2026-04-01T10:05:00Z',
        detectedAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-01T10:00:00Z',
        errorItemPath: null,
      },
    });
    render(<ActiveTasksSection activeTasks={[task]} />);
    expect(screen.getByText('Recovery pending start')).toBeInTheDocument();
  });

  it('renders per-task guardrail posture chip', () => {
    const task = makeTask({
      guardrailSummary: {
        status: 'healthy',
        summary: 'All checks passed.',
        observedReceiptCount: 2,
        allowedCount: 2,
        deniedCount: 0,
        internalBypassCount: 0,
        malformedCount: 0,
        violationCount: 0,
      },
    });
    render(<ActiveTasksSection activeTasks={[task]} />);
    expect(screen.getByText('Guardrails Healthy')).toBeInTheDocument();
  });

  it('guardrail summary for task A does not appear under task B when task-scoped', () => {
    const taskA = makeTask({
      taskId: 'TASK-A',
      taskTitle: 'Task A',
      guardrailSummary: {
        status: 'critical',
        summary: 'Denied.',
        observedReceiptCount: 1,
        allowedCount: 0,
        deniedCount: 1,
        internalBypassCount: 0,
        malformedCount: 0,
        violationCount: 0,
      },
    });
    const taskB = makeTask({ taskId: 'TASK-B', taskTitle: 'Task B', guardrailSummary: undefined });

    render(<ActiveTasksSection activeTasks={[taskA, taskB]} />);

    const taskAEl = screen.getByLabelText('Active task TASK-A');
    const taskBEl = screen.getByLabelText('Active task TASK-B');

    expect(within(taskAEl).getByLabelText('Task TASK-A guardrail posture')).toBeInTheDocument();
    expect(within(taskBEl).queryByLabelText('Task TASK-B guardrail posture')).not.toBeInTheDocument();
  });

  it('scopes artifacts to their own task', () => {
    const taskA = makeTask({ taskId: 'TASK-A', taskTitle: 'Task A' });
    const taskB = makeTask({ taskId: 'TASK-B', taskTitle: 'Task B' });
    const artA = makeArtifact({ taskId: 'TASK-A', label: 'task-a-handoff.md', path: 'a/handoff.md' });
    const artB = makeArtifact({ taskId: 'TASK-B', label: 'task-b-handoff.md', path: 'b/handoff.md' });

    render(
      <ActiveTasksSection
        activeTasks={[taskA, taskB]}
        artifactReferences={[artA, artB]}
      />,
    );

    const taskAEl = screen.getByLabelText('Active task TASK-A');
    const taskBEl = screen.getByLabelText('Active task TASK-B');

    expect(within(taskAEl).getByText('task-a-handoff.md')).toBeInTheDocument();
    expect(within(taskAEl).queryByText('task-b-handoff.md')).not.toBeInTheDocument();
    expect(within(taskBEl).getByText('task-b-handoff.md')).toBeInTheDocument();
    expect(within(taskBEl).queryByText('task-a-handoff.md')).not.toBeInTheDocument();
  });

  it('renders Unnamed task when taskTitle is null', () => {
    render(<ActiveTasksSection activeTasks={[makeTask({ taskTitle: null })]} />);
    expect(screen.getByText('Unnamed task')).toBeInTheDocument();
  });

  it('unscoped sessions (null taskId) do not appear under any specific task', () => {
    const taskA = makeTask({ taskId: 'TASK-A', taskTitle: 'Task A' });
    const unscopedSession = makeSession({ taskId: null, sessionId: 'role:dalton:x' });

    render(
      <ActiveTasksSection
        activeTasks={[taskA]}
        agentTerminalSessions={[unscopedSession]}
      />,
    );

    // Unscoped session should not contribute to TASK-A's session count
    const taskAEl = screen.getByLabelText('Active task TASK-A');
    expect(within(taskAEl).getByText('0 sessions')).toBeInTheDocument();
  });
});
