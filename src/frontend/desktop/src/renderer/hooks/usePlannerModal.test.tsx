// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopShellClient } from '../services/desktopShellClient';
import type { PlannerStartSessionDeepFocusSelection } from '../../shared/desktopContract';
import {
  createClient,
  createHistoryRecord,
  createHistorySummary,
  deferred,
  makeWrapper,
  plannerEvent,
  renderPlannerModalHook,
  subscribedPlannerEvent,
} from './usePlannerModal.testSetup';
import { usePlannerModal } from './usePlannerModal';

describe('usePlannerModal', () => {
  it('starts with modal closed', () => {
    const { result } = renderPlannerModalHook();
    expect(result.current.plannerModalProps.isOpen).toBe(false);
  });

  it('opens the modal', async () => {
    const { result } = renderPlannerModalHook();

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(true);
  });

  it('starts planner sessions with the live Deep Focus payload when enabled', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession' },
    });
    const client = createClient({ startPlannerSession });
    const deepFocusSelection: PlannerStartSessionDeepFocusSelection = {
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: 'libs/Acme.Models',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'libs/Acme.Models',
          kind: 'directory',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
          role: 'anchor',
          testTarget: { path: 'libs/Acme.Models.Tests', kind: 'directory' },
        },
        {
          path: 'Acme.Seed',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'primary',
        },
      ],
      selectedTestTarget: null,
      selectedSupportTargets: [],
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    };
    const { result } = renderPlannerModalHook(client, { deepFocusSelection });

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(startPlannerSession).toHaveBeenCalledWith({
      contextPackDir: '/tmp/test-context-pack',
      deepFocusSelection,
    });
  });

  it('omits Deep Focus payload when no enabled selection is supplied', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(startPlannerSession).toHaveBeenCalledWith({
      contextPackDir: '/tmp/test-context-pack',
    });
  });

  it('logs planner session start failures', async () => {
    const startPlannerSession = vi.fn().mockRejectedValue(new Error('Planner broker unavailable.'));
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.sessionStatus).toBe('failed');
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'planner.session.start.failed',
        level: 'error',
        extra: { contextPackDir: '/tmp/test-context-pack' },
      }));
    });
  });

  it('logs planner session cleanup failures on close', async () => {
    const endPlannerSession = vi.fn().mockRejectedValue(new Error('Planner cleanup failed.'));
    const client = createClient({ endPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onClose();
    });

    await waitFor(() => {
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'planner.session.end.failed',
        level: 'warn',
        extra: { reason: 'Planner cleanup failed.' },
      }));
    });
  });

  it('modal status follows explicit broker lifecycle', async () => {
    const { result } = renderPlannerModalHook();

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('active');

    act(() => {
      subscribedPlannerEvent?.(plannerEvent({ eventType: 'planner.turn.started', brokerStatus: 'running', turnId: 'turn-1', done: false }));
    });
    expect(result.current.plannerModalProps.sessionStatus).toBe('busy');

    act(() => {
      subscribedPlannerEvent?.(plannerEvent({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-1', done: true }));
    });
    expect(result.current.plannerModalProps.sessionStatus).toBe('active');
  });

  it('failed planner events set failed status without marking idle completion as disconnect', async () => {
    const { result } = renderPlannerModalHook();

    await act(async () => {
      result.current.openPlannerModal();
    });

    act(() => {
      subscribedPlannerEvent?.(plannerEvent({
        eventType: 'planner.turn.failed',
        brokerStatus: 'failed',
        turnId: 'turn-1',
        done: true,
        error: 'Planner turn failed.',
      }));
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('failed');
    expect(result.current.plannerModalProps.draftError).toBe('Planner turn failed.');

    act(() => {
      subscribedPlannerEvent?.(plannerEvent({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-2', done: true }));
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('active');
  });

  it('closes the modal', () => {
    const { result } = renderPlannerModalHook();

    act(() => {
      result.current.openPlannerModal();
    });

    act(() => {
      result.current.plannerModalProps.onClose();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(false);
  });

  it('exposes the draft model used for planning actions', () => {
    const { result } = renderPlannerModalHook();

    act(() => {
      result.current.openPlannerModal();
    });

    expect(result.current.plannerModalProps.draft).toBeDefined();
    expect(result.current.plannerModalProps.draft.title).toBe('');
  });

  it('exposes planning state from appViewModel', () => {
    const { result } = renderPlannerModalHook();
    expect(result.current.plannerModalProps.planningEnabled).toBe(true);
    expect(result.current.plannerModalProps.composerStage).toBe('compose');
    expect(result.current.plannerModalProps.isFollowUpDraft).toBe(false);
  });

  it('exposes preview and confirm handlers', () => {
    const { result } = renderPlannerModalHook();
    expect(typeof result.current.plannerModalProps.onPreview).toBe('function');
    expect(typeof result.current.plannerModalProps.onConfirm).toBe('function');
  });

  it('exposes conversation message interface', () => {
    const { result } = renderPlannerModalHook();
    expect(result.current.plannerModalProps.messages).toEqual([]);
    expect(result.current.plannerModalProps.isStreaming).toBe(false);
    expect(typeof result.current.plannerModalProps.onSendMessage).toBe('function');
  });

  it('fetches an empty recent conversations list on modal open', async () => {
    const listPlannerConversationHistory = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listConversationHistory',
        mode: 'empty',
        message: 'No planner conversation history.',
        conversations: [],
      },
    });
    const client = createClient({ listPlannerConversationHistory });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await waitFor(() => {
      expect(listPlannerConversationHistory).toHaveBeenCalledTimes(1);
    });
    expect(result.current.plannerModalProps.recentConversations).toEqual([]);
    expect(result.current.plannerModalProps.recentConversationsMessage).toBe('No planner conversation history.');
  });

  it('surfaces no-context-pack recent conversations state without fetching', async () => {
    const listPlannerConversationHistory = vi.fn();
    const client = createClient({ listPlannerConversationHistory });
    const { result } = renderPlannerModalHook(client, {
      hasActiveContextPack: true,
      activeContextPackDir: null,
    });

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(listPlannerConversationHistory).not.toHaveBeenCalled();
    expect(result.current.plannerModalProps.recentConversations).toEqual([]);
    expect(result.current.plannerModalProps.recentConversationsMessage).toBe('Select a context pack to view recent conversations.');
  });

  it('replays a selected conversation after ending the live session and hydrates transcript before replay start resolves', async () => {
    const replayStart = deferred<Awaited<ReturnType<DesktopShellClient['startPlannerSession']>>>();
    const startPlannerSession = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner session started.', sessionId: 'live-session', brokerStatus: 'idle' },
      })
      .mockReturnValueOnce(replayStart.promise);
    const endPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Planner session ended.' },
    });
    const hydratePlannerConversation = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.hydrateConversation',
        mode: 'found',
        message: 'Found planner conversation.',
        record: createHistoryRecord(),
      },
    });
    const client = createClient({
      startPlannerSession,
      endPlannerSession,
      listPlannerConversationHistory: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listConversationHistory',
          mode: 'found',
          message: 'Found 1 planner conversation.',
          conversations: [createHistorySummary()],
        },
      }),
      hydratePlannerConversation,
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.recentConversations).toHaveLength(1);
    });

    act(() => {
      result.current.plannerModalProps.onSendMessage('Live operator message');
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.messages[0].text).toBe('Live operator message');
    });

    act(() => {
      result.current.plannerModalProps.onSelectConversation?.('conversation-1');
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.messages.map((message) => message.text)).toEqual([
        'Historical operator question',
        'Historical planner answer',
      ]);
    });
    expect(result.current.plannerModalProps.sessionStatus).toBe('connecting');
    expect(startPlannerSession).toHaveBeenLastCalledWith({
      contextPackDir: '/tmp/test-context-pack',
      replayConversationId: 'conversation-1',
    });
    expect(endPlannerSession.mock.invocationCallOrder[0]).toBeLessThan(startPlannerSession.mock.invocationCallOrder[1]);

    act(() => {
      subscribedPlannerEvent?.({
        sessionId: 'live-session',
        eventType: 'planner.turn.message',
        brokerStatus: 'running',
        turnId: 'stale-turn',
        done: false,
        content: 'stale live session message',
        messageKind: 'delta',
      });
    });
    expect(result.current.plannerModalProps.messages.map((message) => message.text)).toEqual([
      'Historical operator question',
      'Historical planner answer',
    ]);

    await act(async () => {
      replayStart.resolve({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner replay session started.', sessionId: 'replay-session', brokerStatus: 'idle' },
      });
      await replayStart.promise;
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('active');
    expect(result.current.plannerModalProps.replayInFlight).toBe(false);

    act(() => {
      subscribedPlannerEvent?.({
        sessionId: 'replay-session',
        eventType: 'planner.turn.message',
        brokerStatus: 'running',
        turnId: 'fresh-turn',
        done: false,
        content: 'fresh replay response',
        messageKind: 'delta',
      });
    });

    expect(result.current.plannerModalProps.messages.map((message) => message.text)).toEqual([
      'Historical operator question',
      'Historical planner answer',
      'fresh replay response',
    ]);
  });

  it('does not auto-replay when the modal is reopened', async () => {
    const hydratePlannerConversation = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.hydrateConversation',
        mode: 'found',
        message: 'Found planner conversation.',
        record: createHistoryRecord(),
      },
    });
    const client = createClient({
      listPlannerConversationHistory: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listConversationHistory',
          mode: 'found',
          message: 'Found 1 planner conversation.',
          conversations: [createHistorySummary()],
        },
      }),
      hydratePlannerConversation,
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.recentConversations).toHaveLength(1);
    });

    await act(async () => {
      result.current.plannerModalProps.onSelectConversation?.('conversation-1');
    });
    await waitFor(() => {
      expect(hydratePlannerConversation).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.plannerModalProps.onClose();
    });
    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(hydratePlannerConversation).toHaveBeenCalledTimes(1);
  });

  it('sets replaySourceRecordId on successful replay', async () => {
    const client = createClient({
      hydratePlannerConversation: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.hydrateConversation',
          mode: 'found',
          message: 'Found planner conversation.',
          record: createHistoryRecord({ id: 'rec-1' }),
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectConversation?.('rec-1');
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.replaySourceRecordId).toBe('rec-1');
    });
  });

  it('uploads regular bypass specs without requiring planner sidecar authority', async () => {
    const uploadSpec = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.uploadSpec', mode: 'submitted', accepted: true, message: 'Uploaded.' },
    });
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: intake.md',
          filename: 'intake.md',
          path: '/tmp/intake.md',
          content: '## Request Summary\n\nRegular upload.',
        },
      }),
      uploadSpec,
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      await result.current.plannerModalProps.onUploadSpec?.();
    });

    expect(uploadSpec).toHaveBeenCalledWith('## Request Summary\n\nRegular upload.', undefined);
  });

  it('uploads child-task bypass specs with child sidecar authority required', async () => {
    const uploadSpec = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.uploadSpec', mode: 'submitted', accepted: true, message: 'Uploaded.' },
    });
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: child.md',
          filename: 'child.md',
          path: '/tmp/child.md',
          content: '## Request Summary\n\nChild upload.',
        },
      }),
      uploadSpec,
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await act(async () => {
      await result.current.plannerModalProps.onUploadSpec?.();
    });

    expect(uploadSpec).toHaveBeenCalledWith('## Request Summary\n\nChild upload.', {
      requirePlannerSidecar: true,
      expectedTaskKind: 'child-task',
    });
  });

  it('uploads recent-task replay bypass specs with replay sidecar authority required', async () => {
    const uploadSpec = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.uploadSpec', mode: 'submitted', accepted: true, message: 'Uploaded.' },
    });
    const client = createClient({
      hydratePlannerConversation: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.hydrateConversation',
          mode: 'found',
          message: 'Found planner conversation.',
          record: createHistoryRecord({ id: 'rec-1' }),
        },
      }),
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: recent.md',
          filename: 'recent.md',
          path: '/tmp/recent.md',
          content: '## Request Summary\n\nRecent upload.',
        },
      }),
      uploadSpec,
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectConversation?.('rec-1');
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.replaySourceRecordId).toBe('rec-1');
    });
    await act(async () => {
      await result.current.plannerModalProps.onUploadSpec?.();
    });

    expect(uploadSpec).toHaveBeenCalledWith('## Request Summary\n\nRecent upload.', {
      requirePlannerSidecar: true,
      expectedTaskKind: 'standard',
    });
  });

  it('onReturnToBlank clears replay context', async () => {
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
      hydratePlannerConversation: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.hydrateConversation',
          mode: 'found',
          message: 'Found planner conversation.',
          record: createHistoryRecord({ id: 'rec-1' }),
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.plannerModalProps.onSelectConversation?.('rec-1');
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.replaySourceRecordId).toBe('rec-1');
    });

    act(() => {
      result.current.plannerModalProps.onReturnToBlank?.();
    });

    expect(result.current.plannerModalProps.replaySourceRecordId).toBeNull();
    expect(endPlannerSession).toHaveBeenCalled();
    expect(startPlannerSession).toHaveBeenLastCalledWith({ contextPackDir: '/tmp/test-context-pack' });
  });

  it('onReturnToBlank is a no-op while replayInFlight is true', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Planner session started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const endPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Planner session ended.' },
    });
    const hydratePlannerConversation = vi.fn().mockReturnValue(new Promise(() => {}));
    const client = createClient({ startPlannerSession, endPlannerSession, hydratePlannerConversation });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.plannerModalProps.onSelectConversation?.('rec-3');
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.replayInFlight).toBe(true);
    });
    const startCalls = startPlannerSession.mock.calls.length;
    const endCalls = endPlannerSession.mock.calls.length;

    act(() => {
      result.current.plannerModalProps.onReturnToBlank?.();
    });

    expect(startPlannerSession).toHaveBeenCalledTimes(startCalls);
    expect(endPlannerSession).toHaveBeenCalledTimes(endCalls);
  });

  it('onReturnToBlank refetches recents', async () => {
    const listPlannerConversationHistory = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listConversationHistory',
        mode: 'empty',
        message: 'No planner conversation history.',
        conversations: [],
      },
    });
    const client = createClient({ listPlannerConversationHistory });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await waitFor(() => {
      expect(listPlannerConversationHistory).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    const postOpenCalls = listPlannerConversationHistory.mock.calls.length;

    act(() => {
      result.current.plannerModalProps.onReturnToBlank?.();
    });

    await waitFor(() => {
      expect(listPlannerConversationHistory).toHaveBeenCalledTimes(postOpenCalls + 1);
    });
  });

  it('clears previous recent conversations when active pack changes and refetches on the next open', async () => {
    const listPlannerConversationHistory = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.listConversationHistory',
          mode: 'found',
          message: 'Found 1 planner conversation.',
          conversations: [createHistorySummary({ id: 'conversation-a', title: 'Pack A conversation' })],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.listConversationHistory',
          mode: 'found',
          message: 'Found 1 planner conversation.',
          conversations: [createHistorySummary({ id: 'conversation-b', title: 'Pack B conversation' })],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.listConversationHistory',
          mode: 'found',
          message: 'Found 1 planner conversation.',
          conversations: [createHistorySummary({ id: 'conversation-b', title: 'Pack B conversation' })],
        },
      });
    const client = createClient({ listPlannerConversationHistory });
    const contextPackDirRef = { current: '/tmp/pack-a' };
    const { result, rerender } = renderHook(
      () => {
        const [contractError, setContractError] = useState('');
        return usePlannerModal(client, 'idle', true, contractError, setContractError, contextPackDirRef.current);
      },
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      result.current.openPlannerModal();
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.recentConversations?.[0]?.id).toBe('conversation-a');
    });

    contextPackDirRef.current = '/tmp/pack-b';
    await act(async () => {
      rerender();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(false);
    expect(result.current.plannerModalProps.recentConversations).toEqual([]);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.recentConversations?.[0]?.id).toBe('conversation-b');
    });
    expect(listPlannerConversationHistory).toHaveBeenCalledTimes(3);
  });

  it('clears conversation messages when modal is closed', async () => {
    const { result } = renderPlannerModalHook();

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Test message');
    });
    expect(result.current.plannerModalProps.messages.length).toBeGreaterThan(0);

    act(() => {
      result.current.plannerModalProps.onClose();
    });
    expect(result.current.plannerModalProps.messages).toHaveLength(0);
  });

  it('readStagedDraft resets awaitingDraft on throw', async () => {
    const client = createClient({
      savePlannerDraft: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.saveDraft',
          mode: 'instructed',
          accepted: true,
          message: 'Save-draft instruction sent.',
          brokerStatus: 'completed',
        },
      }),
      readStagedDraft: vi.fn().mockRejectedValue(new Error('IPC dead')),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    act(() => {
      result.current.plannerModalProps.onViewDraft!();
    });

    expect(result.current.plannerModalProps.awaitingDraft).toBe(true);

    await waitFor(() => {
      expect(result.current.plannerModalProps.awaitingDraft).toBe(false);
    });

    expect(result.current.plannerModalProps.draftError).toBe('IPC dead');
  });

  it('handleFinalizeSpec sets draftError on throw', async () => {
    const client = createClient({
      finalizeSpec: vi.fn().mockRejectedValue(new Error('Finalize boom')),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onFinalizeSpec!();
    });

    expect(result.current.plannerModalProps.draftError).toBe('Finalize boom');
  });

  it('View Draft polls until the staged draft becomes available', async () => {
    vi.useFakeTimers();
    const readStagedDraft = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.readStagedDraft',
          mode: 'empty',
          message: 'No staged draft yet.',
          draft: null,
          brokerStatus: 'running',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.readStagedDraft',
          mode: 'found',
          message: 'Staged draft found: 20260320T003500Z-spec.md',
          draft: {
            filename: '20260320T003500Z-spec.md',
            content: '# Draft',
            modifiedAt: '2026-03-20T00:35:00.000Z',
          },
          brokerStatus: 'completed',
        },
      });
    const client = createClient({
      savePlannerDraft: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.saveDraft',
          mode: 'instructed',
          accepted: true,
          message: 'Save-draft instruction sent.',
          brokerStatus: 'completed',
        },
      }),
      readStagedDraft,
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    act(() => {
      result.current.plannerModalProps.onViewDraft!();
    });

    expect(result.current.plannerModalProps.awaitingDraft).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(client.savePlannerDraft).toHaveBeenCalledTimes(1);
    expect(client.readStagedDraft).toHaveBeenCalledTimes(2);
    expect(result.current.plannerModalProps.awaitingDraft).toBe(false);
    expect(result.current.plannerModalProps.stagedDraft?.filename).toBe('20260320T003500Z-spec.md');

    vi.useRealTimers();
  });

  it('finalize success resets the modal session back to idle', async () => {
    const client = createClient({
      finalizeSpec: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.finalizeSpec',
          mode: 'finalized',
          accepted: true,
          message: 'Spec promoted.',
          destinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
          brokerStatus: 'idle',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      await result.current.plannerModalProps.onFinalizeSpec!();
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('idle');
    expect(result.current.plannerModalProps.stagedDraft).toBeNull();
  });

});
