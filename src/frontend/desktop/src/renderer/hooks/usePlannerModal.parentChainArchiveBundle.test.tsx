// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createArchivedTask,
  createClient,
  createChildTaskHistoryRecord,
  createFocusSnapshot,
  renderPlannerModalHook,
} from './usePlannerModal.testSetup';
import type { ContextPackCatalogEntry } from '../../shared/desktopContract';

const contextPack: ContextPackCatalogEntry = {
  contextPackId: 'test-pack',
  displayName: 'Test Pack',
  contextPackDir: '/tmp/test-context-pack',
  manifestPath: null,
  bootstrapReady: true,
  source: 'configured-path',
  isActive: true,
  estateType: 'distributed-platform',
  defaultScopeMode: null,
  repoCount: 2,
  primaryWorkingRepoIds: [],
  focusTargets: ['platform', 'support'].map((id, index) => ({
    focusId: id,
    displayName: id,
    kind: 'repository',
    repoId: id,
    repoLocalPath: `/repo/${id}`,
    serviceName: null,
    systemLayer: null,
    repoRole: null,
    repositoryType: null,
    relativePath: null,
    focusType: null,
    group: null,
    defaultFocusable: true,
    activationPriority: index,
    adjacentRepoIds: [],
    adjacentFocusIds: [],
  })),
};

function loadedChainBundle(status: 'available' | 'no-chain-state' = 'available') {
  return {
    ok: true,
    response: {
      action: 'planner.readParentChainArchiveBundle',
      mode: 'loaded',
      accepted: true,
      message: 'Loaded.',
      bundle: {
        schemaVersion: 1,
        parentTaskId: 'TASK-007',
        rootTaskId: 'ROOT-007',
        currentTipTaskId: status === 'no-chain-state' ? null : 'TASK-007',
        status,
        tasks: status === 'no-chain-state'
          ? []
          : [{
            taskId: 'ROOT-007',
            title: 'Root task',
            depth: 0,
            role: 'root',
            state: 'completed',
            archivedAt: '2026-05-17T08:42:11.000Z',
            archivePath: '/archive/ROOT-007/archive.md',
            sizeBytes: 12,
            content: 'root archive',
            truncated: false,
          }],
        missingTaskIds: [],
        totalBytes: status === 'no-chain-state' ? 0 : 12,
        truncated: false,
      },
    },
  };
}

describe('usePlannerModal parent chain archive bundle flow', () => {
  it('reads the chain bundle between parent context and session restart', async () => {
    const validateChildTaskFocus = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.validateChildTaskFocus', mode: 'valid', message: 'Valid.', issues: [] },
    });
    const readParentContextBundle = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.readParentContextBundle', mode: 'loaded', accepted: true, message: 'Loaded.', bundle: { schemaVersion: 1, parentTaskId: 'TASK-007', rootTaskId: 'ROOT-007', parentTaskTitle: 'Parent', archivePath: '/archive/TASK-007/archive.md', archiveArtifactDir: null, status: 'legacy-flat-archive', missing: [], files: [], totalBytes: 0, truncated: false, fallbackSummary: null } },
    });
    const readParentChainArchiveBundle = vi.fn().mockResolvedValue(loadedChainBundle());
    const endPlannerSession = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Ended.' } });
    const startPlannerSession = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' } });
    const client = createClient({ validateChildTaskFocus, readParentContextBundle, readParentChainArchiveBundle, endPlannerSession, startPlannerSession });
    const { result } = renderPlannerModalHook(client, { activeContextPackDir: '/tmp/live-context-pack' });
    const parent = createArchivedTask({ taskId: 'TASK-007', rootTaskId: 'ROOT-007' });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(parent);
    });

    await waitFor(() => expect(startPlannerSession).toHaveBeenCalled());
    expect(validateChildTaskFocus.mock.invocationCallOrder[0]).toBeLessThan(readParentContextBundle.mock.invocationCallOrder[0]);
    expect(readParentContextBundle.mock.invocationCallOrder[0]).toBeLessThan(readParentChainArchiveBundle.mock.invocationCallOrder[0]);
    expect(readParentChainArchiveBundle.mock.invocationCallOrder[0]).toBeLessThan(endPlannerSession.mock.invocationCallOrder[0]);
    expect(endPlannerSession.mock.invocationCallOrder[0]).toBeLessThan(startPlannerSession.mock.invocationCallOrder[0]);
    expect(startPlannerSession).toHaveBeenCalledWith(expect.not.objectContaining({ parentChainArchiveBundle: expect.anything() }));
  });

  it('blocks start and immediate messages when the chain bundle read fails', async () => {
    const readParentChainArchiveBundle = vi.fn().mockResolvedValue({ ok: false, action: 'planner.readParentChainArchiveBundle', error: 'Invalid child-task chain state.' });
    const startPlannerSession = vi.fn();
    const sendPlannerMessage = vi.fn();
    const client = createClient({ readParentChainArchiveBundle, startPlannerSession, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask());
    });

    await waitFor(() => expect(result.current.plannerModalProps.draftError).toBe('Invalid child-task chain state.'));
    expect(startPlannerSession).not.toHaveBeenCalled();
    expect(sendPlannerMessage).not.toHaveBeenCalled();
  });

  it('prepends the chain timeline only to the first operator message', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Sent.' } });
    const readParentChainArchiveBundle = vi.fn().mockResolvedValue(loadedChainBundle());
    const client = createClient({ readParentChainArchiveBundle, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({ taskId: 'TASK-007', rootTaskId: 'ROOT-007' }));
    });
    await waitFor(() => expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(false));
    expect(sendPlannerMessage).not.toHaveBeenCalled();

    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Continue the chain.');
    });

    await waitFor(() => expect(sendPlannerMessage).toHaveBeenCalledTimes(1));
    expect(sendPlannerMessage.mock.calls[0][0]).toContain('Full Chain Archive Timeline (Read-Only Planning Memory)');
    expect(sendPlannerMessage.mock.calls[0][0]).toContain('root archive');
  });

  it('starts Lily for no-chain-state and includes the first-child note', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Sent.' } });
    const readParentChainArchiveBundle = vi.fn().mockResolvedValue(loadedChainBundle('no-chain-state'));
    const client = createClient({ readParentChainArchiveBundle, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({ taskId: 'TASK-007', rootTaskId: 'ROOT-007' }));
    });
    await waitFor(() => expect(result.current.plannerModalProps.sessionStatus).toBe('active'));
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Start first child.');
    });

    await waitFor(() => expect(sendPlannerMessage).toHaveBeenCalledTimes(1));
    expect(sendPlannerMessage.mock.calls[0][0]).toContain('No prior child-chain archive timeline exists yet. This child starts the chain.');
  });

  it('reloads child scope with chain timeline and preserves the current session on read failure', async () => {
    const readParentChainArchiveBundle = vi.fn()
      .mockResolvedValueOnce(loadedChainBundle())
      .mockResolvedValueOnce(loadedChainBundle())
      .mockResolvedValueOnce({ ok: false, action: 'planner.readParentChainArchiveBundle', error: 'Chain read failed.' });
    const sendPlannerMessage = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Sent.' } });
    const endPlannerSession = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Ended.' } });
    const startPlannerSession = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' } });
    const client = createClient({ readParentChainArchiveBundle, endPlannerSession, startPlannerSession, sendPlannerMessage });
    const { result } = renderPlannerModalHook(client, { childScopeContextPacks: [contextPack] });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childTaskMode).toBe(true));
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({
        plannerFocusSnapshot: createFocusSnapshot({
          contextPackBinding: {
            contextPackDir: '/tmp/test-context-pack',
            contextPackId: 'test-pack',
            scopeMode: 'selected',
            selectedRepoIds: ['platform'],
            selectedFocusIds: [],
            deepFocusEnabled: false,
            selectedFocusPath: null,
            selectedFocusTargetKind: null,
            selectedFocusTargets: [],
            selectedTestTarget: null,
            selectedSupportTargets: [],
          },
        }),
      }));
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopeStatusLabel).toBe('Using parent scope'));
    act(() => {
      result.current.plannerModalProps.onOpenChildScopePanel?.();
    });
    const scope = result.current.plannerModalProps.childScopePanelProps!.childScope;
    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave({
        ...scope,
        selectedRepoIds: ['support'],
        repositoryTypes: { support: 'primary' },
      });
    });
    await waitFor(() => expect(result.current.plannerModalProps.childScopeStatusLabel).toBe('Child scope adjusted'));
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Continue after scope change.');
    });
    await waitFor(() => expect(sendPlannerMessage).toHaveBeenCalledTimes(1));
    expect(sendPlannerMessage.mock.calls[0][0]).toContain('Full Chain Archive Timeline (Read-Only Planning Memory)');

    const endCount = endPlannerSession.mock.calls.length;
    const startCount = startPlannerSession.mock.calls.length;
    await act(async () => {
      result.current.plannerModalProps.childScopePanelProps?.onSave({
        ...scope,
        selectedRepoIds: ['platform', 'support'],
        repositoryTypes: { platform: 'primary', support: 'support' },
      });
    });
    await waitFor(() => expect(result.current.plannerModalProps.draftError).toBe('Chain read failed.'));
    expect(endPlannerSession).toHaveBeenCalledTimes(endCount);
    expect(startPlannerSession).toHaveBeenCalledTimes(startCount);
  });

  it('clears stale child starter memory before replay sends a new operator message', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({ ok: true, response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Sent.' } });
    const readParentContextBundle = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.readParentContextBundle',
        mode: 'loaded',
        accepted: true,
        message: 'Loaded.',
        bundle: {
          schemaVersion: 1,
          parentTaskId: 'TASK-007',
          rootTaskId: 'ROOT-007',
          parentTaskTitle: 'Parent',
          archivePath: '/archive/TASK-007/archive.md',
          archiveArtifactDir: '/archive/TASK-007',
          status: 'available',
          missing: [],
          files: [{ kind: 'handoff', fileName: 'intake.md', relativePath: 'handoffs/intake.md', sizeBytes: 14, content: 'parent archive content', truncated: false }],
          totalBytes: 14,
          truncated: false,
          fallbackSummary: null,
        },
      },
    });
    const client = createClient({
      readParentContextBundle,
      readParentChainArchiveBundle: vi.fn().mockResolvedValue(loadedChainBundle()),
      sendPlannerMessage,
      hydratePlannerConversation: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.hydrateConversation',
          mode: 'found',
          message: 'Found planner conversation.',
          record: createChildTaskHistoryRecord({ id: 'replay-1' }),
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(createArchivedTask({ taskId: 'TASK-007', rootTaskId: 'ROOT-007' }));
    });
    await waitFor(() => expect(result.current.plannerModalProps.sessionStatus).toBe('active'));
    expect(sendPlannerMessage).not.toHaveBeenCalled();

    await act(async () => {
      result.current.plannerModalProps.onSelectConversation?.('replay-1');
    });
    await waitFor(() => expect(result.current.plannerModalProps.replaySourceRecordId).toBe('replay-1'));
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Replay follow-up only.');
    });

    await waitFor(() => expect(sendPlannerMessage).toHaveBeenCalledTimes(1));
    const [sent] = sendPlannerMessage.mock.calls[0];
    expect(sent).toBe('Replay follow-up only.');
    expect(sent).not.toContain('Full Chain Archive Timeline');
    expect(sent).not.toContain('root archive');
    expect(sent).not.toContain('parent archive content');
    expect(sent).not.toContain('Parent Task ID: TASK-007');
  });
});
