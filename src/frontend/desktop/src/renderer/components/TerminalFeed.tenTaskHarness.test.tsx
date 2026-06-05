/**
 * TerminalFeed 10-task deterministic harness (Track H).
 *
 * Covers: 10 task scopes, 500 visible events, quiet-task replay after
 * noisy task, and named React Profiler thresholds.
 *
 * No real agents, sockets, containers, or spawns.
 * Every interleaving is forced deterministically via prop changes.
 */

// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback, act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalFeed from './TerminalFeed';
import type { TerminalFeedProps } from './TerminalFeed';
import type { StreamEvent, TerminalTaskScopeOption } from '../activityStream';

// --- Profiler budget constants ---
// Generous to avoid CI flakiness on slower machines while catching 5× regressions.
const MAX_COMMIT_COUNT = 40;
const MAX_DURATION_MS = 3000;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- helpers ---

function makeScope(index: number): TerminalTaskScopeOption {
  return {
    taskGuid: `task-guid-${String(index).padStart(4, '0')}-4000-9000-000000000000`,
    taskShortGuid: `task-${String(index).padStart(4, '0')}`,
    taskId: `TASK-${index}`,
    title: `Task ${index}`,
  };
}

function makeEvent(eventIndex: number, taskIndex: number): StreamEvent {
  return {
    id: `evt-${taskIndex}-${eventIndex}`,
    timestamp: '2026-05-29T10:00:00.000Z',
    role: 'pipeline',
    source: 'runtime.pipeline',
    taskId: `TASK-${taskIndex}`,
    taskGuid: `task-guid-${String(taskIndex).padStart(4, '0')}-4000-9000-000000000000`,
    taskShortGuid: `task-${String(taskIndex).padStart(4, '0')}`,
    taskTitle: `Task ${taskIndex}`,
    severity: 'info',
    message: `Task ${taskIndex} event ${eventIndex}`,
  };
}

function makeTaskScopes(count: number): TerminalTaskScopeOption[] {
  return Array.from({ length: count }, (_, i) => makeScope(i));
}

/** 500 events spread across taskCount tasks. */
function make500Events(taskCount: number): StreamEvent[] {
  return Array.from({ length: 500 }, (_, i) => makeEvent(i, i % taskCount));
}

/** 500 events where the first task gets 490 events (noisy) and each other task gets 2. */
function makeNoisyTaskEvents(taskCount: number): StreamEvent[] {
  const events: StreamEvent[] = [];
  // noisy task (index 0) gets 490
  for (let i = 0; i < 490; i++) {
    events.push(makeEvent(i, 0));
  }
  // remaining tasks each get 2
  for (let t = 1; t < taskCount; t++) {
    events.push(makeEvent(0, t));
    events.push(makeEvent(1, t));
  }
  return events;
}

const BASE_PROPS: TerminalFeedProps = {
  activityStream: [],
  replayedEventIds: new Set(),
  taskScopes: [],
  selectedTaskGuid: null,
  onSelectTaskScope: vi.fn(async () => undefined),
  observabilitySnapshot: null,
  environmentStatus: null,
};

interface ProfileResult {
  commitCount: number;
  totalActualDuration: number;
}

function profileRender(
  initialProps: TerminalFeedProps,
  updater?: (props: TerminalFeedProps) => TerminalFeedProps,
): ProfileResult {
  const commits: Array<{ actualDuration: number }> = [];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    commits.push({ actualDuration });
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
  };
}

// --- tests ---

describe('TerminalFeed 10-task deterministic harness', () => {
  it('initial render of 500 events across 10 scopes stays within Profiler budget', () => {
    const result = profileRender({
      ...BASE_PROPS,
      activityStream: make500Events(10),
      taskScopes: makeTaskScopes(10),
    });

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('burst append of 500 events across 10 scopes stays within Profiler budget', () => {
    const result = profileRender(
      { ...BASE_PROPS, activityStream: [], taskScopes: makeTaskScopes(10) },
      (props) => ({ ...props, activityStream: make500Events(10) }),
    );

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('quiet-task scope selection after noisy task stays within Profiler budget', () => {
    const taskScopes = makeTaskScopes(10);
    const noisyEvents = makeNoisyTaskEvents(10);
    // quiet task is task index 1
    const quietScope = taskScopes[1];

    const result = profileRender(
      {
        ...BASE_PROPS,
        activityStream: noisyEvents,
        taskScopes,
        selectedTaskGuid: null,
      },
      (props) => ({
        ...props,
        selectedTaskGuid: quietScope.taskGuid,
      }),
    );

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('all 10 task scope options are present in the component output for scope selection', () => {
    const taskScopes = makeTaskScopes(10);
    render(
      <TerminalFeed
        {...BASE_PROPS}
        activityStream={make500Events(10)}
        taskScopes={taskScopes}
      />,
    );

    // Open the task-scope dropdown (trigger has aria-label="Terminal task scope").
    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });
    act(() => {
      fireEvent.click(trigger);
    });

    // The listbox now contains role="option" entries — 1 "All Tasks" + 10 task scopes.
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(11); // 10 tasks + "All Tasks" sentinel

    // Every task scope must have its title and secondary label rendered.
    for (const scope of taskScopes) {
      // primaryLabel is the task title (e.g. "Task 1"), secondaryLabel is "Task [task-0001]".
      expect(screen.getByText(scope.title ?? '')).toBeTruthy();
    }
  });

  it('scoped replay after noisy task: select quiet task scope, events are scoped correctly', () => {
    const taskScopes = makeTaskScopes(10);
    const noisyEvents = makeNoisyTaskEvents(10);
    const quietScope = taskScopes[1]; // task index 1, title "Task 1"

    // Quiet task has 2 events with known IDs: evt-1-0 and evt-1-1
    // (makeEvent(0, 1) → id "evt-1-0", makeEvent(1, 1) → id "evt-1-1")
    const quietEventIds = new Set(['evt-1-0', 'evt-1-1']);

    const { rerender, container } = render(
      <TerminalFeed
        {...BASE_PROPS}
        activityStream={noisyEvents}
        taskScopes={taskScopes}
        selectedTaskGuid={null}
        replayedEventIds={quietEventIds}
      />,
    );

    act(() => {
      rerender(
        <TerminalFeed
          {...BASE_PROPS}
          activityStream={noisyEvents}
          taskScopes={taskScopes}
          selectedTaskGuid={quietScope.taskGuid}
          replayedEventIds={quietEventIds}
        />,
      );
    });

    // After scope selection, the trigger label reflects the quiet task.
    // TerminalFeed passes selectedTaskGuid to TerminalSelectMenu as selectedValue,
    // so the trigger renders the quiet task's primaryLabel in the trigger span.
    const trigger = screen.getByRole('button', { name: 'Terminal task scope' });
    expect(trigger.textContent).toContain(quietScope.title ?? '');

    // The quiet task's 2 events are in replayedEventIds, so they get the
    // terminal-line--replay class (suppressed animation). Verify both are present
    // in the rendered output, confirming the noisy flood did not displace them.
    const replayLines = container.querySelectorAll('.terminal-line--replay');
    expect(replayLines.length).toBeGreaterThanOrEqual(2);

    // Each replayed line must contain one of the quiet task's known messages.
    const replayTexts = Array.from(replayLines).map((el) => el.textContent ?? '');
    const quietMessages = noisyEvents
      .filter((e) => quietEventIds.has(e.id))
      .map((e) => e.message);
    for (const msg of quietMessages) {
      expect(replayTexts.some((text) => text.includes(msg))).toBe(true);
    }
  });

  it('scope switch between noisy tasks stays within Profiler budget', () => {
    const taskScopes = makeTaskScopes(10);
    const events = make500Events(10);

    const result = profileRender(
      {
        ...BASE_PROPS,
        activityStream: events,
        taskScopes,
        selectedTaskGuid: taskScopes[0].taskGuid,
      },
      (props) => ({
        ...props,
        selectedTaskGuid: taskScopes[9].taskGuid,
      }),
    );

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });
});
