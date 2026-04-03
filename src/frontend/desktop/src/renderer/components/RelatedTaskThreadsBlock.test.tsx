import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RelatedTaskThread } from '../selectors/taskObservationModel';
import RelatedTaskThreadsBlock from './RelatedTaskThreadsBlock';

afterEach(() => {
  cleanup();
});

function makeThread(overrides: Partial<RelatedTaskThread> = {}): RelatedTaskThread {
  return {
    key: 'thread-1',
    heading: 'Related task thread · TASK-2',
    taskId: 'TASK-2',
    summary: '2 sessions observed',
    chips: [{ label: 'Running 1', tone: 'active' }],
    sessions: [],
    events: [],
    ...overrides,
  };
}

describe('RelatedTaskThreadsBlock', () => {
  it('shows empty message when no threads', () => {
    render(<RelatedTaskThreadsBlock relatedThreads={[]} />);
    expect(screen.getByText(/No related task threads/)).toBeInTheDocument();
  });

  it('renders thread heading and summary', () => {
    render(<RelatedTaskThreadsBlock relatedThreads={[makeThread()]} />);
    expect(screen.getByText('Related task thread · TASK-2')).toBeInTheDocument();
    expect(screen.getByText('2 sessions observed')).toBeInTheDocument();
  });

  it('renders thread chips', () => {
    render(<RelatedTaskThreadsBlock relatedThreads={[makeThread()]} />);
    expect(screen.getByText('Running 1')).toBeInTheDocument();
  });

  it('renders session list when sessions exist', () => {
    const thread = makeThread({
      sessions: [
        {
          taskId: 'TASK-2',
          agentId: 'qa',
          agentLabel: 'Ron (QA and Closeout)',
          sessionId: 's1',
          instanceId: null,
          launchPid: null,
          liveness: 'alive',
          stuckState: 'none',
          stuckReason: null,
          sliceId: null,
          slicePath: null,
          launchState: 'started',
          terminalState: 'running',
          lastUpdatedAt: null,
          latestOutputLines: ['Test output'],
          stdoutLogPath: null,
          stderrLogPath: null,
          severity: 'info',
        },
      ],
    });
    render(<RelatedTaskThreadsBlock relatedThreads={[thread]} />);
    expect(screen.getByText('Ron (QA and Closeout)')).toBeInTheDocument();
    expect(screen.getByText('Test output')).toBeInTheDocument();
  });
});
