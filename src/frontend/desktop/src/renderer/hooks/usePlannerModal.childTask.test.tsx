// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createArchivedTask,
  createChildTaskHistoryRecord,
  createClient,
  createFocusSnapshot,
  deferred,
  renderPlannerModalHook,
} from './usePlannerModal.testSetup';

describe('usePlannerModal child-task flows', () => {
  it('onReturnToBlank clears child-task state', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner session started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const endPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Planner session ended.' },
    });
    const client = createClient({
      startPlannerSession,
      endPlannerSession,
      sendPlannerMessage: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Sent.', brokerStatus: 'running' },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    expect(result.current.plannerModalProps.childTaskMode).toBe(true);
    expect(result.current.plannerModalProps.selectedParentTask?.taskId).toBe('TASK-001');

    act(() => {
      result.current.plannerModalProps.onReturnToBlank?.();
    });

    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(result.current.plannerModalProps.selectedParentTask).toBeNull();
    expect(result.current.plannerModalProps.draft.title).toBe('');
    expect(endPlannerSession).toHaveBeenCalled();
    expect(startPlannerSession).toHaveBeenLastCalledWith({ contextPackDir: '/tmp/test-context-pack' });
  });

  it('validates a snapshot-backed parent against the active context pack before child-task start', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.validateChildTaskFocus',
        mode: 'valid',
        message: 'Parent task focus is still valid.',
        issues: [],
      },
    });
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner session started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const parent = createArchivedTask({
      plannerFocusSnapshot: createFocusSnapshot({ contextPackDir: '/tmp/snapshot-context-pack' }),
    });
    const client = createClient({ validateChildTaskFocus, startPlannerSession });
    const { result } = renderPlannerModalHook(client, { activeContextPackDir: '/tmp/live-context-pack' });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(parent);
    });

    expect(validateChildTaskFocus).toHaveBeenCalledWith({
      contextPackDir: '/tmp/live-context-pack',
      snapshot: parent.plannerFocusSnapshot,
    });
    expect(startPlannerSession).toHaveBeenLastCalledWith({
      contextPackDir: '/tmp/snapshot-context-pack',
      childTaskFocusSnapshot: parent.plannerFocusSnapshot,
      childTaskLineage: expect.objectContaining({ parentTaskId: 'TASK-001' }),
    });
  });

  it('falls back to regular planner mode when parent focus validation fails', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.validateChildTaskFocus',
        mode: 'fallback',
        message: "The parent task's saved focus no longer matches the current context pack or filesystem. Starting regular mode with the current live context instead.",
        issues: [{ code: 'selected-focus-id-missing', label: 'Selected focus ID', id: 'legacy-focus' }],
      },
    });
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner session started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const sendPlannerMessage = vi.fn();
    const client = createClient({ validateChildTaskFocus, startPlannerSession, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client, {
      activeContextPackDir: '/tmp/live-context-pack',
      deepFocusSelection: {
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'platform',
        deepFocusPrimaryFocusId: 'planner',
        selectedFocusPath: 'src/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
        selectedRepoIds: ['platform'],
        selectedFocusIds: ['planner'],
      },
    });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    expect(startPlannerSession).toHaveBeenLastCalledWith({
      contextPackDir: '/tmp/live-context-pack',
      deepFocusSelection: expect.objectContaining({ deepFocusEnabled: true }),
    });
    expect(startPlannerSession).not.toHaveBeenCalledWith(expect.objectContaining({
      childTaskFocusSnapshot: expect.anything(),
    }));
    expect(sendPlannerMessage).not.toHaveBeenCalled();
    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(result.current.plannerModalProps.draftError).toBe("The parent task's saved focus no longer matches the current context pack or filesystem. Starting regular mode with the current live context instead.");
    expect(result.current.plannerModalProps.plannerFocusValidationIssues).toEqual([
      { code: 'selected-focus-id-missing', label: 'Selected focus ID', id: 'legacy-focus' },
    ]);
  });

  it('auto-dismisses the parent-focus fallback notice after the dismiss delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const validateChildTaskFocus = vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.validateChildTaskFocus',
          mode: 'fallback',
          message: "The parent task's saved focus no longer matches the current context pack or filesystem. Starting regular mode with the current live context instead.",
          issues: [{ code: 'selected-focus-id-missing', label: 'Selected focus ID', id: 'legacy-focus' }],
        },
      });
      const startPlannerSession = vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
      });
      const client = createClient({ validateChildTaskFocus, startPlannerSession });
      const { result } = renderPlannerModalHook(client, {
        activeContextPackDir: '/tmp/live-context-pack',
      });

      await act(async () => {
        result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
      });

      // Notice is visible immediately after the fallback fires.
      expect(result.current.plannerModalProps.draftError).toContain('saved focus no longer matches');
      expect(result.current.plannerModalProps.plannerFocusValidationIssues).toHaveLength(1);

      // After the auto-dismiss delay, the notice clears itself.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(result.current.plannerModalProps.draftError).toBe('');
      expect(result.current.plannerModalProps.plannerFocusValidationIssues).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not end the current session when parent focus validation returns a system error', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Validation backend failed.',
    });
    const endPlannerSession = vi.fn();
    const startPlannerSession = vi.fn();
    const client = createClient({ validateChildTaskFocus, endPlannerSession, startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    expect(endPlannerSession).not.toHaveBeenCalled();
    expect(startPlannerSession).not.toHaveBeenCalled();
    expect(result.current.plannerModalProps.draftError).toBe('Validation backend failed.');
  });

  it('renders Loading parent task while parent focus validation is in flight', async () => {
    const pending = deferred<{ ok: true; response: { action: 'planner.validateChildTaskFocus'; mode: 'valid'; message: string; issues: [] } }>();
    const validateChildTaskFocus = vi.fn().mockReturnValue(pending.promise);
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ validateChildTaskFocus, startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      void result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(true);
    });

    await act(async () => {
      pending.resolve({
        ok: true,
        response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Parent task focus is still valid.', issues: [] },
      });
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(false);
    });
  });

  it('a thrown validation IPC surfaces an error and starts no planner session', async () => {
    const validateChildTaskFocus = vi.fn().mockRejectedValue(new Error('thrown from preload'));
    const endPlannerSession = vi.fn();
    const startPlannerSession = vi.fn();
    const client = createClient({ validateChildTaskFocus, endPlannerSession, startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    expect(endPlannerSession).not.toHaveBeenCalled();
    expect(startPlannerSession).not.toHaveBeenCalled();
    expect(result.current.plannerModalProps.draftError).toBe('thrown from preload');
  });

  it('re-runs validation on each parent selection and does not reuse a prior result', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Parent task focus is still valid.', issues: [] },
    });
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ validateChildTaskFocus, startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    const firstParent = createArchivedTask({ taskId: 'TASK-001' });
    const secondParent = createArchivedTask({ taskId: 'TASK-002' });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(firstParent);
    });
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(secondParent);
    });

    expect(validateChildTaskFocus).toHaveBeenCalledTimes(2);
    expect(validateChildTaskFocus).toHaveBeenNthCalledWith(1, expect.objectContaining({ snapshot: firstParent.plannerFocusSnapshot }));
    expect(validateChildTaskFocus).toHaveBeenNthCalledWith(2, expect.objectContaining({ snapshot: secondParent.plannerFocusSnapshot }));
  });

  it('selecting an entry without plannerFocusSnapshot through stale UI state surfaces the exact stale-state error', async () => {
    const validateChildTaskFocus = vi.fn();
    const startPlannerSession = vi.fn();
    const client = createClient({ validateChildTaskFocus, startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({ plannerFocusSnapshot: undefined }));
    });

    expect(validateChildTaskFocus).not.toHaveBeenCalled();
    expect(startPlannerSession).not.toHaveBeenCalled();
    expect(result.current.plannerModalProps.draftError).toBe(
      'This archived parent task has no saved planner focus and cannot be used as a parent. Refresh the parent list and try again.',
    );
  });

  it('defers the child-task starter prompt until the operator sends their first message', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Parent task focus is still valid.', issues: [] },
    });
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Sent.' },
    });
    const client = createClient({ validateChildTaskFocus, startPlannerSession, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client);

    const parent = createArchivedTask({
      taskId: 'TASK-007',
      title: 'Original parent',
      rootTaskId: 'ROOT-007',
      contextPackName: 'orders-pack',
    });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(parent);
    });

    // Selecting a parent must not start a Lily turn — that would put the
    // modal into "thinking" before the operator has had a chance to speak.
    await waitFor(() => {
      expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(false);
    });
    expect(sendPlannerMessage).not.toHaveBeenCalled();

    // First operator message carries both the deferred starter prompt and
    // the operator's text in the same broker turn.
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Tighten the search heuristic.');
    });

    await waitFor(() => {
      expect(sendPlannerMessage).toHaveBeenCalledTimes(1);
    });
    const [prompt] = sendPlannerMessage.mock.calls[0];
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('Parent Task ID: TASK-007');
    expect(prompt).toContain('Parent task title: Original parent');
    expect(prompt).toContain('Root Task ID: ROOT-007');
    expect(prompt).toContain('Operator message:');
    expect(prompt).toContain('Tighten the search heuristic.');
  });

  it('valid child-task parent selection never includes deepFocusSelection alongside childTaskFocusSnapshot', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Parent task focus is still valid.', issues: [] },
    });
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ validateChildTaskFocus, startPlannerSession });
    const { result } = renderPlannerModalHook(client, {
      deepFocusSelection: {
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'platform',
        deepFocusPrimaryFocusId: 'planner',
        selectedFocusPath: 'src/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
        selectedRepoIds: ['platform'],
        selectedFocusIds: ['planner'],
      },
    });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    const lastCall = startPlannerSession.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    expect(lastCall).toHaveProperty('childTaskFocusSnapshot');
    expect(lastCall).not.toHaveProperty('deepFocusSelection');
  });

  it('filters archived entries without plannerFocusSnapshot out of the parent dropdown', async () => {
    const listArchivedTasks = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'observed',
        message: 'Observed.',
        tasks: [
          { ...createArchivedTask({ taskId: 'TASK-A' }) },
          { ...createArchivedTask({ taskId: 'TASK-B', plannerFocusSnapshot: undefined }) },
          { ...createArchivedTask({ taskId: 'TASK-C' }) },
        ],
      },
    });
    const client = createClient({ listArchivedTasks });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.archivedTasks).toEqual([
        expect.objectContaining({ taskId: 'TASK-A' }),
        expect.objectContaining({ taskId: 'TASK-C' }),
      ]);
    });
    expect(result.current.plannerModalProps.archivedTaskTotalCount).toBe(3);
  });

  it('logs and surfaces archived task load failures', async () => {
    const listArchivedTasks = vi.fn().mockRejectedValue(new Error('Archive read failed.'));
    const client = createClient({ listArchivedTasks });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.archivedTasks).toEqual([]);
      expect(result.current.plannerModalProps.draftError).toBe('Archive read failed.');
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'planner.archived-tasks.load.failed',
        level: 'warn',
        extra: { reason: 'Archive read failed.' },
      }));
    });
  });

  it('child-task parent selection never calls transcript hydration', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Parent task focus is still valid.', issues: [] },
    });
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const hydratePlannerConversation = vi.fn();
    const client = createClient({ validateChildTaskFocus, startPlannerSession, hydratePlannerConversation });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    expect(hydratePlannerConversation).not.toHaveBeenCalled();
  });

  it('onReturnToBlank clears child-task replay context', async () => {
    const client = createClient({
      hydratePlannerConversation: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.hydrateConversation',
          mode: 'found',
          message: 'Found planner conversation.',
          record: createChildTaskHistoryRecord({ id: 'rec-2' }),
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectConversation?.('rec-2');
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.childTaskMode).toBe(true);
      expect(result.current.plannerModalProps.replaySourceRecordId).toBe('rec-2');
    });

    act(() => {
      result.current.plannerModalProps.onReturnToBlank?.();
    });

    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(result.current.plannerModalProps.replaySourceRecordId).toBeNull();
    expect(result.current.plannerModalProps.selectedParentTask).toBeNull();
  });
});
