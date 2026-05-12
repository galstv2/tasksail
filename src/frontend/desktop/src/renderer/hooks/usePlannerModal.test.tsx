// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import type {
  ArchivedTaskEntry,
  PlannerFocusSnapshot,
  PlannerListConversationHistorySummary,
  PlannerStartSessionDeepFocusSelection,
  PlannerStreamEvent,
} from '../../shared/desktopContract';
import type { PlannerConversationRecord } from '../../../../../backend/platform/planner-history/types.js';
import {
  createMockClient,
  createPlannerSubmitResponse,
} from '../../test';
import { usePlannerModal } from './usePlannerModal';

afterEach(() => {
  cleanup();
});

let subscribedPlannerEvent: ((plannerEvent: PlannerStreamEvent) => void) | null = null;

function plannerEvent(event: Omit<PlannerStreamEvent, 'sessionId'>): PlannerStreamEvent {
  return { sessionId: 'planner-mock-1', ...event };
}

function createHistorySummary(overrides: Partial<PlannerListConversationHistorySummary> = {}): PlannerListConversationHistorySummary {
  return {
    id: 'conversation-1',
    title: 'Historical planning session',
    createdAt: '2026-03-20T00:00:00.000Z',
    finalizedDestinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
    messageCount: 2,
    taskKind: 'standard',
    scopeMode: 'selected',
    primaryRepoId: 'platform',
    primaryFocusRelativePath: 'src/features/planner',
    ...overrides,
  };
}

function createHistoryRecord(overrides: Partial<PlannerConversationRecord> = {}): PlannerConversationRecord {
  const taskKind = overrides.sidecarSnapshot?.lineage.taskKind ?? 'standard';
  return {
    id: 'conversation-1',
    contextPackDir: '/tmp/test-context-pack',
    contextPackId: 'test-pack',
    createdAt: '2026-03-20T00:00:00.000Z',
    title: 'Historical planning session',
    finalizedDestinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
    sidecarSnapshot: {
      version: 1,
      ownership: 'planner-session',
      sessionId: 'historical-session',
      draftFilename: 'spec.md',
      draftPath: '/repo/.staging/spec.md',
      createdAt: '2026-03-20T00:00:00.000Z',
      title: 'Historical planning session',
      primaryRepoId: 'platform',
      primaryRepoRoot: '/repo',
      primaryFocusRelativePath: 'src/features/planner',
      deepFocusEnabled: true,
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      lineage: {
        taskKind,
        parentTaskId: taskKind === 'child-task' ? 'TASK-001' : '',
        rootTaskId: taskKind === 'child-task' ? 'TASK-ROOT' : '',
        parentQmdRecordId: taskKind === 'child-task' ? 'qmd-1' : '',
        parentQmdScope: taskKind === 'child-task' ? 'qmd/context-packs/test-pack' : '',
        followUpReason: taskKind === 'child-task' ? 'Follow up' : '',
      },
      contextPackBinding: {
        contextPackDir: '/tmp/test-context-pack',
        contextPackId: 'test-pack',
        scopeMode: 'selected',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        selectedFocusPath: 'src/features/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    },
    transcript: [
      { id: 'history-message-1', role: 'operator', text: 'Historical operator question', timestamp: '2026-03-20T00:01:00.000Z' },
      { id: 'history-message-2', role: 'planner', text: 'Historical planner answer', timestamp: '2026-03-20T00:02:00.000Z' },
    ],
    ...overrides,
  };
}

function createChildTaskHistoryRecord(overrides: Partial<PlannerConversationRecord> = {}): PlannerConversationRecord {
  const base = createHistoryRecord();
  return createHistoryRecord({
    ...overrides,
    sidecarSnapshot: {
      ...base.sidecarSnapshot,
      lineage: {
        ...base.sidecarSnapshot.lineage,
        taskKind: 'child-task',
        parentTaskId: 'TASK-001',
        rootTaskId: 'TASK-ROOT',
        parentQmdRecordId: 'qmd-1',
        parentQmdScope: 'qmd/context-packs/test-pack',
        followUpReason: 'Follow-up',
      },
      ...overrides.sidecarSnapshot,
    },
  });
}

function createFocusSnapshot(overrides: Partial<PlannerFocusSnapshot> = {}): PlannerFocusSnapshot {
  const record = createHistoryRecord();
  return {
    version: 1,
    contextPackDir: record.contextPackDir,
    contextPackId: record.contextPackId,
    title: record.title,
    primaryRepoId: record.sidecarSnapshot.primaryRepoId,
    primaryRepoRoot: record.sidecarSnapshot.primaryRepoRoot,
    primaryFocusRelativePath: record.sidecarSnapshot.primaryFocusRelativePath,
    primaryFocusTargetKind: record.sidecarSnapshot.primaryFocusTargetKind,
    primaryFocusTargets: record.sidecarSnapshot.primaryFocusTargets,
    selectedTestTarget: record.sidecarSnapshot.selectedTestTarget,
    supportTargets: record.sidecarSnapshot.supportTargets,
    deepFocusEnabled: record.sidecarSnapshot.deepFocusEnabled,
    contextPackBinding: record.sidecarSnapshot.contextPackBinding,
    ...overrides,
  };
}

function createArchivedTask(overrides: Partial<ArchivedTaskEntry> = {}): ArchivedTaskEntry {
  return {
    taskId: 'TASK-001',
    title: 'Parent task',
    summary: 'Carry forward this work.',
    rootTaskId: 'TASK-ROOT',
    qmdRecordId: 'qmd-1',
    followupReason: 'Follow-up',
    year: '2026',
    archivePath: '/repo/archive/task.md',
    contextPackName: 'test-pack',
    plannerFocusSnapshot: createFocusSnapshot(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  subscribedPlannerEvent = null;
  window.desktopShell = {
    ...window.desktopShell,
    onPlannerEvent: vi.fn((callback) => {
      subscribedPlannerEvent = callback;
      return vi.fn();
    }),
  } as typeof window.desktopShell;
});

function createClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    submitPlannerDraft: vi.fn().mockResolvedValue({
      ok: true,
      response: createPlannerSubmitResponse({
        message: 'Draft accepted.',
        draftTitle: 'Test',
      }),
    }),
    ...overrides,
  });
}

function makeWrapper(client: DesktopShellClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <ObservabilityProvider client={client}>{children}</ObservabilityProvider>
      </ToastProvider>
    );
  };
}

function renderPlannerModalHook(
  client?: DesktopShellClient,
  options?: {
    hasActiveContextPack?: boolean;
    activeContextPackDir?: string | null;
    deepFocusSelection?: PlannerStartSessionDeepFocusSelection;
  },
) {
  const c = client ?? createClient();
  const hasActive = options?.hasActiveContextPack ?? true;
  const activeDir = options && 'activeContextPackDir' in options
    ? options.activeContextPackDir ?? null
    : hasActive ? '/tmp/test-context-pack' : null;
  return renderHook(
    () => {
      const [contractError, setContractError] = useState('');
      return usePlannerModal(
        c,
        'idle',
        hasActive,
        contractError,
        setContractError,
        activeDir,
        options?.deepFocusSelection,
      );
    },
    { wrapper: makeWrapper(c) },
  );
}

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
