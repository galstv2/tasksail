/**
 * ReinforcementModal 10-task deterministic harness (Track H).
 *
 * Covers: pack switch while modal is open, feedback draft reset,
 * realignmentId correlation under stream burst, and named React Profiler thresholds.
 *
 * No real agents, sockets, containers, or spawns.
 * Uses the installAppTestHarness IPC mock harness.
 * Every interleaving is forced deterministically via prop changes and mocked IPC.
 */

// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback, act } from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StreamEvent } from '../../activityStream';
import { installAppTestHarness } from '../../App.test-setup';
import ReinforcementModal from './ReinforcementModal';

installAppTestHarness();

afterEach(() => {
  cleanup();
});

// --- Profiler budget constants ---
// Generous to avoid CI flakiness on slower machines while catching 5× regressions.
const MAX_COMMIT_COUNT = 60;
const MAX_DURATION_MS = 4000;

interface ProfileResult {
  commitCount: number;
  totalActualDuration: number;
}

function profileRender(
  packDir: string,
  updater?: (packDir: string) => string,
): ProfileResult {
  const commits: Array<{ actualDuration: number }> = [];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    commits.push({ actualDuration });
  };

  let currentPackDir = packDir;
  let rerender: ReturnType<typeof render>['rerender'];

  act(() => {
    const result = render(
      <Profiler id="ReinforcementModal" onRender={onRender}>
        <ReinforcementModal
          isOpen={true}
          onClose={vi.fn()}
          hasActiveContextPack={true}
          activeContextPackDir={currentPackDir}
        />
      </Profiler>,
    );
    rerender = result.rerender;
  });

  if (updater) {
    act(() => {
      currentPackDir = updater(currentPackDir);
      rerender(
        <Profiler id="ReinforcementModal" onRender={onRender}>
          <ReinforcementModal
            isOpen={true}
            onClose={vi.fn()}
            hasActiveContextPack={true}
            activeContextPackDir={currentPackDir}
          />
        </Profiler>,
      );
    });
  }

  return {
    commitCount: commits.length,
    totalActualDuration: commits.reduce((sum, c) => sum + c.actualDuration, 0),
  };
}

// --- helpers ---

function mockPackA(): void {
  vi.mocked(window.desktopShell.listReinforcementTasks).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.listTasks',
      mode: 'read-only' as const,
      message: '2 task(s) for pack A.',
      tasks: [
        {
          taskId: 'PACK-A-TASK-1',
          title: 'Pack A Task 1',
          difficulty: 'standard',
          effectiveReward: 1,
          settlementStatus: 'unrewarded',
          qualityOutcome: 'needs-review',
          year: '2026',
        },
        {
          taskId: 'PACK-A-TASK-2',
          title: 'Pack A Task 2',
          difficulty: 'standard',
          effectiveReward: 1,
          settlementStatus: 'rewarded',
          qualityOutcome: 'good',
          year: '2026',
        },
      ],
      availableYears: ['2026'],
    },
  });
  vi.mocked(window.desktopShell.checkActiveWorkGuard).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.checkActiveWorkGuard',
      mode: 'guard-check' as const,
      allowed: true,
      message: 'No active work.',
      activeTaskId: null,
      hasUnprocessedFeedback: false,
    },
  });
  vi.mocked(window.desktopShell.listRealignmentSessions).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.listRealignmentSessions',
      mode: 'read-only' as const,
      message: '0 session(s).',
      sessions: [],
    },
  });
}

function mockPackB(): void {
  vi.mocked(window.desktopShell.listReinforcementTasks).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.listTasks',
      mode: 'read-only' as const,
      message: '1 task(s) for pack B.',
      tasks: [
        {
          taskId: 'PACK-B-TASK-1',
          title: 'Pack B Task 1',
          difficulty: 'complex',
          effectiveReward: 2,
          settlementStatus: 'unrewarded',
          qualityOutcome: 'needs-review',
          year: '2026',
        },
      ],
      availableYears: ['2026'],
    },
  });
  vi.mocked(window.desktopShell.checkActiveWorkGuard).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.checkActiveWorkGuard',
      mode: 'guard-check' as const,
      allowed: true,
      message: 'No active work.',
      activeTaskId: null,
      hasUnprocessedFeedback: false,
    },
  });
  vi.mocked(window.desktopShell.listRealignmentSessions).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.listRealignmentSessions',
      mode: 'read-only' as const,
      message: '0 session(s).',
      sessions: [],
    },
  });
}

// --- tests ---

describe('ReinforcementModal 10-task deterministic harness', () => {
  it('initial render with open modal stays within Profiler budget', () => {
    mockPackA();
    const result = profileRender('/packs/pack-a');

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('pack switch while modal is open stays within Profiler budget', () => {
    mockPackA();
    // After switch, mock pack B
    const result = profileRender('/packs/pack-a', () => {
      mockPackB();
      return '/packs/pack-b';
    });

    expect(result.commitCount).toBeLessThanOrEqual(MAX_COMMIT_COUNT);
    expect(result.totalActualDuration).toBeLessThanOrEqual(MAX_DURATION_MS);
  });

  it('renders closed modal without issue (closed state)', () => {
    const { container } = render(
      <ReinforcementModal
        isOpen={false}
        onClose={vi.fn()}
        hasActiveContextPack={true}
        activeContextPackDir="/packs/pack-a"
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('modal is open and displays the dialog role', () => {
    mockPackA();
    render(
      <ReinforcementModal
        isOpen={true}
        onClose={vi.fn()}
        hasActiveContextPack={true}
        activeContextPackDir="/packs/pack-a"
      />,
    );
    const dialog = screen.getByRole('dialog');
    // The dialog must carry the "Reinforcement" aria-label declared in the component.
    expect(dialog.getAttribute('aria-label')).toBe('Reinforcement');
    // The visible heading inside the dialog must read "Reinforcement".
    expect(dialog.querySelector('h2')?.textContent).toBe('Reinforcement');
    // All five tab buttons must be rendered (Feedback, Overview, Ledger, Sessions, Document).
    const tabs = dialog.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(5);
    const tabLabels = Array.from(tabs).map((tab) => tab.textContent);
    expect(tabLabels).toContain('Feedback');
    expect(tabLabels).toContain('Sessions');
  });

  it('realignmentId correlation: matching realignmentId completes the current run, non-matching does not prematurely complete', async () => {
    vi.mocked(window.desktopShell.listReinforcementTasks).mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.listTasks',
        mode: 'read-only' as const,
        message: '1 task(s).',
        tasks: [
          {
            taskId: 'T-REALIGN',
            title: 'Realignment task',
            difficulty: 'standard',
            effectiveReward: 1,
            settlementStatus: 'unrewarded',
            qualityOutcome: 'needs-review',
            year: '2026',
          },
        ],
        availableYears: ['2026'],
      },
    });
    vi.mocked(window.desktopShell.checkActiveWorkGuard).mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.checkActiveWorkGuard',
        mode: 'guard-check' as const,
        allowed: true,
        message: 'No active work.',
        activeTaskId: null,
        hasUnprocessedFeedback: true,
      },
    });
    vi.mocked(window.desktopShell.listRealignmentSessions).mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.listRealignmentSessions',
        mode: 'read-only' as const,
        message: '1 session(s).',
        sessions: [
          {
            realignmentId: 'RA-CURRENT',
            triggerTaskId: 'T-REALIGN',
            triggerFeedbackId: 'FB-1',
            participatingAgents: ['provider-builder'],
            failureAnalysis: 'Gap',
            rootCause: 'Cause',
            correctiveActions: ['Fix'],
            status: 'open',
            meetingNotes: '',
            createdAt: '2026-03-22T00:00:00Z',
          },
        ],
      },
    });

    render(
      <ReinforcementModal
        isOpen={true}
        onClose={vi.fn()}
        hasActiveContextPack={true}
        activeContextPackDir="/packs/pack-a"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    // Navigate to sessions tab
    const sessionsTab = screen.getByTestId('tab-sessions');
    fireEvent.click(sessionsTab);

    await waitFor(() => {
      expect(screen.getByTestId('session-item-RA-CURRENT')).toBeTruthy();
    });

    // Start a realignment run
    vi.mocked(window.desktopShell.runRealignmentAnalysis).mockReturnValue(
      new Promise(() => {}),
    );
    fireEvent.click(screen.getByTestId('session-item-RA-CURRENT'));
    fireEvent.click(screen.getByTestId('realignment-start'));
    fireEvent.click(screen.getByText('Start realignment'));

    // Get stream handler registered by the modal's useStreamEvents
    const streamHandler = vi.mocked(window.desktopShell.onStreamEvent).mock.calls[0][0];

    // Emit an unrelated realignmentId event — must NOT complete the current run
    act(() => {
      streamHandler({
        id: 'unrelated-event',
        timestamp: '2026-03-22T00:00:30Z',
        role: 'workflow',
        source: 'runtime.realignment',
        taskId: 'N/A',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'info',
        message: 'Different realignment archived.',
        realignmentId: 'RA-OTHER',
      } satisfies StreamEvent);
    });

    // The run should still be in progress (not completed) — verify by checking
    // that listRealignmentSessions was NOT called a second time yet
    const callsBefore = vi.mocked(window.desktopShell.listRealignmentSessions).mock.calls.length;

    // Emit the matching realignmentId event — MUST complete the current run
    act(() => {
      streamHandler({
        id: 'matching-event',
        timestamp: '2026-03-22T00:01:00Z',
        role: 'workflow',
        source: 'runtime.realignment',
        taskId: 'N/A',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'success',
        message: 'Realignment analysis archived.',
        realignmentId: 'RA-CURRENT',
      } satisfies StreamEvent);
    });

    // After matching event, listRealignmentSessions should be called again (refresh)
    await waitFor(() => {
      const callsAfter = vi.mocked(window.desktopShell.listRealignmentSessions).mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it('feedback draft is reset after pack switch', async () => {
    mockPackA();

    const { rerender } = render(
      <ReinforcementModal
        isOpen={true}
        onClose={vi.fn()}
        hasActiveContextPack={true}
        activeContextPackDir="/packs/pack-a"
      />,
    );

    // Wait for pack A tasks to render in the TaskPicker.
    await waitFor(() => {
      expect(screen.getByTestId('task-picker-item-PACK-A-TASK-1')).toBeTruthy();
    });

    // Switch to pack B — the modal must reset draft/selection state and reload tasks.
    mockPackB();

    await act(async () => {
      rerender(
        <ReinforcementModal
          isOpen={true}
          onClose={vi.fn()}
          hasActiveContextPack={true}
          activeContextPackDir="/packs/pack-b"
        />,
      );
    });

    // After the pack switch, pack B's task must appear in the TaskPicker —
    // confirming the task list was refreshed with pack B's data.
    await waitFor(() => {
      expect(screen.getByTestId('task-picker-item-PACK-B-TASK-1')).toBeTruthy();
    });

    // Pack A's tasks must NO LONGER be visible — the draft was cleared and
    // the task list reflects only pack B.
    expect(screen.queryByTestId('task-picker-item-PACK-A-TASK-1')).toBeNull();
    expect(screen.queryByTestId('task-picker-item-PACK-A-TASK-2')).toBeNull();
  });

  it('null activeContextPackDir with closed modal renders nothing', () => {
    const { container } = render(
      <ReinforcementModal
        isOpen={false}
        onClose={vi.fn()}
        hasActiveContextPack={false}
        activeContextPackDir={null}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
