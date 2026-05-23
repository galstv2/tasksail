// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createArchivedTask,
  createClient,
  renderPlannerModalHook,
} from './usePlannerModal.testSetup';

describe('usePlannerModal parent branch view payload', () => {
  it('sends parentTaskBranchView with branch handoffs for child parent selection', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    act(() => result.current.plannerModalProps.onToggleChildTaskMode?.());
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({
        branchChainAvailability: { status: 'ready', message: 'ready' },
        branchHandoffs: [{
          repoRoot: '/repo/platform',
          repoLabel: 'platform',
          branch: 'task/root',
          baseCommitSha: 'abc',
          headCommitSha: 'def',
          commitsAhead: 1,
          status: 'committed',
        }],
      }));
    });

    expect(startPlannerSession).toHaveBeenLastCalledWith(expect.objectContaining({
      parentTaskBranchView: expect.objectContaining({
        schemaVersion: 1,
        parentTaskId: 'TASK-001',
        branchChainAvailability: { status: 'ready', message: 'ready' },
        branchHandoffs: [expect.objectContaining({ headCommitSha: 'def' })],
      }),
    }));
  });

  it('preserves legacy parent starts and emits the missing-handoffs status message', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.startSession',
        mode: 'started',
        accepted: true,
        message: 'Started.',
        sessionId: 'session-1',
        brokerStatus: 'idle',
        parentBranchViewStatus: { mode: 'skipped-missing-handoffs', message: 'missing', warning: 'missing', worktreeCount: 0 },
      },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    act(() => result.current.plannerModalProps.onToggleChildTaskMode?.());
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    expect(startPlannerSession).toHaveBeenLastCalledWith(expect.objectContaining({
      parentTaskBranchView: expect.objectContaining({
        branchChainAvailability: expect.objectContaining({ status: 'missing-branch-handoffs' }),
      }),
    }));
    expect(result.current.plannerModalProps.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'operator',
        text: 'Parent branch view unavailable: archived parent has no branch handoffs. Lily will use archived parent archive context only.',
      }),
    ]));
  });

  it('surfaces missing source branch start failures without sending deferred starter prompt', async () => {
    const error = 'Parent branch view failed: source branch task/root no longer exists in platform. Restore the branch or choose another parent task.';
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: false,
      error,
    });
    const sendPlannerMessage = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage', accepted: true } });
    const client = createClient({ startPlannerSession, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client);

    act(() => result.current.plannerModalProps.onToggleChildTaskMode?.());
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({
        branchChainAvailability: { status: 'ready', message: 'ready' },
        branchHandoffs: [{
          repoRoot: '/repo/platform',
          repoLabel: 'platform',
          branch: 'task/root',
          baseCommitSha: 'abc',
          headCommitSha: 'def',
          commitsAhead: 1,
          status: 'committed',
        }],
      }));
    });

    await waitFor(() => expect(result.current.plannerModalProps.sessionStatus).toBe('failed'));
    expect(result.current.plannerModalProps.draftError).toBe(error);
    act(() => result.current.plannerModalProps.onSendMessage('continue'));
    expect(sendPlannerMessage).not.toHaveBeenCalledWith(expect.stringContaining('Full Chain Archive Timeline'), expect.anything());
    expect(sendPlannerMessage).not.toHaveBeenCalledWith(expect.stringContaining('Parent Task Context'), expect.anything());
  });
});
