import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TaskLifecycleFeed } from '../../shared/desktopContract';
import ActiveTaskLifecycleBlock from './ActiveTaskLifecycleBlock';

afterEach(() => {
  cleanup();
});

function makeTask(overrides: Partial<TaskLifecycleFeed> = {}): TaskLifecycleFeed {
  return {
    taskId: 'TASK-1',
    taskTitle: 'Build feature',
    taskKind: 'standard',
    workflowStage: 'active',
    activePath: 'standard',
    parallelizationEnabled: false,
    startedAt: '2026-03-12T09:00:00Z',
    lastUpdatedAt: '2026-03-12T10:00:00Z',
    sourceArtifact: null,
    ...overrides,
  };
}

describe('ActiveTaskLifecycleBlock', () => {
  it('displays task title', () => {
    render(<ActiveTaskLifecycleBlock activeTask={makeTask()} sessionCount={2} />);
    expect(screen.getByText('Build feature')).toBeInTheDocument();
  });

  it('shows "Unnamed task" when title is null', () => {
    render(<ActiveTaskLifecycleBlock activeTask={makeTask({ taskTitle: null })} sessionCount={0} />);
    expect(screen.getByText('Unnamed task')).toBeInTheDocument();
  });

  it('shows stage chip', () => {
    render(<ActiveTaskLifecycleBlock activeTask={makeTask()} sessionCount={1} />);
    expect(screen.getByText('Stage active')).toBeInTheDocument();
  });

  it('shows session count', () => {
    render(<ActiveTaskLifecycleBlock activeTask={makeTask()} sessionCount={3} />);
    expect(screen.getByText('3 sessions observed')).toBeInTheDocument();
  });

  it('renders health section when taskHealth is present', () => {
    const task = makeTask({
      taskHealth: {
        status: 'healthy',
        summary: 'All sessions ok',
        observedSessionCount: 2,
        runningCount: 1,
        completedCount: 1,
        failedCount: 0,
        suspectedStuckCount: 0,
        orphanedCount: 0,
        aliveCount: 2,
        missingPidCount: 0,
        unknownPidCount: 0,
      },
    });
    render(<ActiveTaskLifecycleBlock activeTask={task} sessionCount={2} />);
    expect(screen.getByText('Operator summary')).toBeInTheDocument();
    expect(screen.getByText('All sessions ok')).toBeInTheDocument();
    expect(screen.getByText('Health healthy')).toBeInTheDocument();
  });

  it('renders guardrail section when guardrailSummary is present', () => {
    const task = makeTask({
      guardrailSummary: {
        status: 'attention',
        summary: 'Warning issued',
        observedReceiptCount: 3,
        allowedCount: 2,
        deniedCount: 0,
        internalBypassCount: 1,
        malformedCount: 0,
        violationCount: 0,
      },
    });
    render(<ActiveTaskLifecycleBlock activeTask={task} sessionCount={1} />);
    expect(screen.getByText('Guardrail summary')).toBeInTheDocument();
    expect(screen.getByText('Warning issued')).toBeInTheDocument();
  });

  it('renders recovery section when recoveryState is present', () => {
    const task = makeTask({
      recoveryState: {
        kind: 'activation-timeout',
        status: 'pending-start',
        summary: 'Waiting for pipeline activity.',
        queueName: 'TASK-1.md',
        taskId: 'TASK-1',
        activationStartedAt: '2026-03-12T09:00:00Z',
        deadlineAt: '2026-03-12T09:05:00Z',
        detectedAt: '2026-03-12T09:00:00Z',
        updatedAt: '2026-03-12T09:00:00Z',
        errorItemPath: null,
      },
    });
    render(<ActiveTaskLifecycleBlock activeTask={task} sessionCount={1} />);
    expect(screen.getByText('Recovery status')).toBeInTheDocument();
    expect(screen.getByText('Waiting for pipeline activity.')).toBeInTheDocument();
    expect(screen.getByText('Recovery pending start')).toBeInTheDocument();
  });
});
