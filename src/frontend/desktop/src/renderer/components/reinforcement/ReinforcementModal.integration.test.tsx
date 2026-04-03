// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      activeContextPackDir="/tmp/context-packs/test"
    />,
  );
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

describe('blocked-realignment isolation', () => {
  beforeEach(() => {
    mockGuardBlocked();
  });

  it('feedback tab renders when guard is blocked', async () => {
    renderModal();

    const feedbackTab = screen.getByTestId('tab-feedback');
    fireEvent.click(feedbackTab);

    await waitFor(() => {
      expect(screen.getByTestId('feedback-panel')).toBeTruthy();
    });
  });

  it('document tab renders when guard is blocked', async () => {
    renderModal();

    const documentTab = screen.getByTestId('tab-document');
    fireEvent.click(documentTab);

    await waitFor(() => {
      expect(screen.getByTestId('document-editor')).toBeTruthy();
    });
  });

  it('sessions tab shows blocked message', async () => {
    renderModal();

    const sessionsTab = screen.getByTestId('tab-sessions');
    fireEvent.click(sessionsTab);

    await waitFor(() => {
      expect(screen.getByTestId('realignment-guard-blocked')).toBeTruthy();
    });
  });
});
