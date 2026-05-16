// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../activityStream';
import { installAppTestHarness } from '../../App.test-setup';
import ReinforcementModal from './ReinforcementModal';

installAppTestHarness();

afterEach(() => {
  cleanup();
});

function renderModal() {
  return render(
    <ReinforcementModal
      isOpen={true}
      onClose={vi.fn()}
      hasActiveContextPack={true}
      activeContextPackDir="/context-packs/test"
    />,
  );
}

function mockOpenSession(status = 'open'): void {
  vi.mocked(window.desktopShell.listReinforcementTasks).mockResolvedValue({
    ok: true,
    response: {
      action: 'reinforcement.listTasks',
      mode: 'read-only' as const,
      message: '1 task(s).',
      tasks: [
        {
          taskId: 'T-1',
          title: 'Trigger task',
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
      message: 'No active work. Corrective realignment is allowed.',
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
          realignmentId: 'RA-1',
          triggerTaskId: 'T-1',
          triggerFeedbackId: 'FB-1',
          participatingAgents: ['provider-builder', 'provider-qa'],
          failureAnalysis: 'Gap',
          rootCause: 'Cause',
          correctiveActions: ['Fix'],
          status,
          meetingNotes: '',
          createdAt: '2026-03-22T00:00:00Z',
        },
      ],
    },
  });
}

function mockGuardBlocked(): void {
  vi.mocked(window.desktopShell.checkActiveWorkGuard).mockResolvedValue({
    ok: false,
    action: 'reinforcement.checkActiveWorkGuard',
    error: 'Blocked by active work.',
    errorCode: 'active_work_blocked',
  });
  // Ensure sessions mock returns a proper sessions array to avoid undefined.filter()
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

describe('active-work isolation', () => {
  beforeEach(() => {
    mockGuardBlocked();
  });

  it('feedback tab renders when active work exists', async () => {
    renderModal();

    const feedbackTab = screen.getByTestId('tab-feedback');
    fireEvent.click(feedbackTab);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-panel')).toBeTruthy();
    });
  });

  it('document tab renders when active work exists', async () => {
    renderModal();

    const documentTab = screen.getByTestId('tab-document');
    fireEvent.click(documentTab);

    await waitFor(() => {
      expect(screen.getByTestId('document-editor')).toBeTruthy();
    });
  });

  it('sessions tab stays usable when active work exists', async () => {
    renderModal();

    const sessionsTab = screen.getByTestId('tab-sessions');
    fireEvent.click(sessionsTab);

    await waitFor(() => {
      expect(screen.getByTestId('realignment-panel')).toBeTruthy();
    });
  });
});

describe('realignment analysis actions', () => {
  beforeEach(() => {
    mockOpenSession();
  });

  it('runs analysis for an open session without blocking modal navigation', async () => {
    vi.mocked(window.desktopShell.runRealignmentAnalysis).mockReturnValue(
      new Promise(() => {}),
    );
    renderModal();

    fireEvent.click(screen.getByTestId('tab-sessions'));
    await waitFor(() => {
      expect(screen.getByTestId('session-item-RA-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-item-RA-1'));
    fireEvent.click(screen.getByTestId('realignment-start'));
    fireEvent.click(screen.getByText('Start realignment'));

    expect(window.desktopShell.runRealignmentAnalysis).toHaveBeenCalledWith({
      contextPackDir: '/context-packs/test',
      realignmentId: 'RA-1',
    });

    fireEvent.click(screen.getByTestId('tab-document'));

    await waitFor(() => {
      expect(screen.getByTestId('document-editor')).toBeTruthy();
    });
  });

  it('refreshes sessions and GRD when runtime stream reports completion', async () => {
    renderModal();

    fireEvent.click(screen.getByTestId('tab-sessions'));
    await waitFor(() => {
      expect(screen.getByTestId('session-item-RA-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-item-RA-1'));
    fireEvent.click(screen.getByTestId('realignment-start'));
    fireEvent.click(screen.getByText('Start realignment'));
    await waitFor(() => {
      expect(window.desktopShell.runRealignmentAnalysis).toHaveBeenCalledWith({
        contextPackDir: '/context-packs/test',
        realignmentId: 'RA-1',
      });
    });

    const streamHandler = vi.mocked(window.desktopShell.onStreamEvent).mock.calls[0][0];
    act(() => {
      streamHandler({
        id: 'realignment-complete-1',
        timestamp: '2026-03-22T00:01:00Z',
        role: 'workflow',
        source: 'runtime.realignment',
        taskId: 'N/A',
        taskGuid: null,
        taskShortGuid: null,
        taskTitle: null,
        severity: 'success',
        message: 'Realignment analysis archived.',
        actorName: 'Ron - Realignment',
      } satisfies StreamEvent);
    });

    await waitFor(() => {
      expect(window.desktopShell.listRealignmentSessions).toHaveBeenCalledTimes(3);
      expect(window.desktopShell.readRealignmentDoc).toHaveBeenCalledTimes(2);
    });
  });

  it('does not use the first task as manual session creation trigger', async () => {
    vi.mocked(window.desktopShell.listReinforcementTasks).mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.listTasks',
        mode: 'read-only' as const,
        message: '1 task(s).',
        tasks: [
          {
            taskId: 'T-FIRST',
            title: 'First task',
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
    vi.mocked(window.desktopShell.listRealignmentSessions).mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.listRealignmentSessions',
        mode: 'read-only' as const,
        message: '1 session(s).',
        sessions: [
          {
            realignmentId: 'RA-1',
            triggerTaskId: 'T-FIRST',
            triggerFeedbackId: 'FB-1',
            participatingAgents: ['provider-builder', 'provider-qa'],
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
    renderModal();

    fireEvent.click(screen.getByTestId('tab-sessions'));
    await waitFor(() => {
      expect(screen.getByTestId('session-item-RA-1')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('session-item-RA-1'));
    fireEvent.click(screen.getByTestId('realignment-start'));
    fireEvent.click(screen.getByText('Start realignment'));

    await waitFor(() => {
      expect(window.desktopShell.runRealignmentAnalysis).toHaveBeenCalledWith({
        contextPackDir: '/context-packs/test',
        realignmentId: 'RA-1',
      });
      expect(window.desktopShell.startRealignment).not.toHaveBeenCalled();
    });
  });
});
