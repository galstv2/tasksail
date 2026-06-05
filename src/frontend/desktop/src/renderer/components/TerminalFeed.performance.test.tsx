/**
 * React Profiler budget tests for TerminalFeed under 10-task load.
 * Covers: R16 (capped render path under noisy 10-task load).
 *
 * These tests assert:
 *  1. MAX_COMMIT_COUNT — maximum number of React commit phases allowed
 *  2. MAX_DURATION_MS — maximum cumulative actualDuration across all commits
 *
 * The Profiler runs in dev mode (jsdom) and measures React's own reconciler
 * timings. Durations are generous to avoid CI flakiness on slower machines
 * while still catching pathological regressions.
 */

import { Profiler, type ProfilerOnRenderCallback, act } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalFeed from './TerminalFeed';
import type { TerminalFeedProps } from './TerminalFeed';
import type { StreamEvent } from '../activityStream';
import { createObservabilitySnapshot } from '../../test';

// Profiler budget constants — intentionally generous to avoid CI flakiness
// while still catching regressions that would be 2-5× worse.
const MAX_COMMIT_COUNT = 30;
const MAX_DURATION_MS = 2000;

afterEach(() => {
  cleanup();
});

function makeEvent(index: number, taskIndex: number): StreamEvent {
  const taskGuid = `task-guid-${taskIndex.toString().padStart(4, '0')}-4000-9000-000000000000`;
  const taskShortGuid = `task-${taskIndex.toString().padStart(4, '0')}`;
  return {
    id: `evt-${taskIndex}-${index}`,
    timestamp: '2026-05-23T10:00:00.000Z',
    role: 'pipeline',
    source: 'runtime.pipeline',
    taskId: `TASK-${taskIndex}`,
    taskGuid,
    taskShortGuid,
    taskTitle: `Task ${taskIndex}`,
    severity: 'info',
    message: `Task ${taskIndex} event ${index}`,
  };
}

function makeTaskScopes(count: number): TerminalFeedProps['taskScopes'] {
  return Array.from({ length: count }, (_, i) => ({
    taskGuid: `task-guid-${i.toString().padStart(4, '0')}-4000-9000-000000000000`,
    taskShortGuid: `task-${i.toString().padStart(4, '0')}`,
    taskId: `TASK-${i}`,
    title: `Task ${i}`,
  }));
}

/** Build 500 events spread across `taskCount` tasks. */
function make500Events(taskCount: number): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (let i = 0; i < 500; i++) {
    events.push(makeEvent(i, i % taskCount));
  }
  return events;
}

interface ProfileResult {
  commitCount: number;
  totalActualDuration: number;
  totalBaseDuration: number;
}

/** Render inside a Profiler, apply state updates via `updater`, and collect results. */
function renderWithProfiler(
  initialProps: TerminalFeedProps,
  updater?: (props: TerminalFeedProps) => TerminalFeedProps,
): ProfileResult {
  const commits: Array<{ actualDuration: number; baseDuration: number }> = [];

  const onRender: ProfilerOnRenderCallback = (
    _id,
    _phase,
    actualDuration,
    baseDuration,
  ) => {
    commits.push({ actualDuration, baseDuration });
  };

  let currentProps = initialProps;
  let rerender: ReturnType<typeof render>['rerender'];

  act(() => {
    const result = render(
      <Profiler id="TerminalFeed" onRender={onRender}>
        <TerminalFeed {...currentProps} />
      </Profiler>,
    );
    rerender = result.rerender;
  });

  if (updater) {
    act(() => {
      currentProps = updater(currentProps);
      rerender(
        <Profiler id="TerminalFeed" onRender={onRender}>
          <TerminalFeed {...currentProps} />
        </Profiler>,
      );
    });
  }

  return {
    commitCount: commits.length,
    totalActualDuration: commits.reduce((sum, c) => sum + c.actualDuration, 0),
    totalBaseDuration: commits.reduce((sum, c) => sum + c.baseDuration, 0),
  };
}

const baseProps: TerminalFeedProps = {
  activityStream: [],
  replayedEventIds: new Set(),
  taskScopes: [],
  selectedTaskGuid: null,
  onSelectTaskScope: vi.fn(async () => undefined),
  observabilitySnapshot: null,
  environmentStatus: null,
};

describe('TerminalFeed render performance', () => {
  it('initial render of 500 visible events across 10 task scopes stays within Profiler budget', () => {
    const events = make500Events(10);
    const taskScopes = makeTaskScopes(10);

    const result = renderWithProfiler({
      ...baseProps,
      activityStream: events,
      replayedEventIds: new Set(),
      taskScopes,
    });

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
    expect(result.totalBaseDuration).toBeGreaterThan(0);
  });

  it('burst append of 500 events stays within Profiler budget', () => {
    const taskScopes = makeTaskScopes(10);

    const result = renderWithProfiler(
      {
        ...baseProps,
        activityStream: [],
        taskScopes,
      },
      (props) => ({
        ...props,
        activityStream: make500Events(10),
      }),
    );

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('scoped task update (switching selected scope) stays within Profiler budget', () => {
    const events = make500Events(10);
    const taskScopes = makeTaskScopes(10);

    const result = renderWithProfiler(
      {
        ...baseProps,
        activityStream: events,
        taskScopes,
        selectedTaskGuid: null,
      },
      (props) => ({
        ...props,
        selectedTaskGuid: taskScopes[3].taskGuid,
      }),
    );

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('observability snapshot update stays within Profiler budget', () => {
    const events = make500Events(10);
    const taskScopes = makeTaskScopes(10);
    const snapshot = createObservabilitySnapshot({
      activeTasks: Array.from({ length: 10 }, (_, i) => ({
        taskId: `TASK-${i}`,
        taskTitle: `Task ${i}`,
        taskKind: null,
        workflowStage: 'active' as const,
        activePath: null,
        parallelizationEnabled: false,
        startedAt: null,
        lastUpdatedAt: null,
        sourceArtifact: null,
      })),
    });

    const result = renderWithProfiler(
      {
        ...baseProps,
        activityStream: events,
        taskScopes,
        observabilitySnapshot: null,
      },
      (props) => ({
        ...props,
        observabilitySnapshot: snapshot,
      }),
    );

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });
});
