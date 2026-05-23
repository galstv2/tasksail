// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import type { ArchivedTaskEntry, PlannerFocusSnapshot, PlannerStartSessionDeepFocusSelection } from '../../shared/desktopContract';
import {
  createMockClient,
  createPlannerSubmitResponse,
} from '../../test';
import { buildChildTaskMarkdownReviewPrompt, buildChildTaskStarterPrompt, buildMarkdownReviewPrompt } from '../../shared/plannerWorkflow';
import { usePlannerModal } from './usePlannerModal';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.desktopShell = {
    ...window.desktopShell,
    onPlannerEvent: vi.fn(() => vi.fn()),
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

function makeFocusSnapshot(overrides: Partial<PlannerFocusSnapshot> = {}): PlannerFocusSnapshot {
  return {
    version: 1,
    contextPackDir: '/tmp/test-context-pack',
    contextPackId: 'test-pack',
    title: 'Parent task',
    primaryRepoId: 'platform',
    primaryRepoRoot: '/repo',
    primaryFocusRelativePath: 'src/features/planner',
    primaryFocusTargetKind: 'directory',
    primaryFocusTargets: [],
    selectedTestTarget: null,
    supportTargets: [],
    deepFocusEnabled: true,
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
    ...overrides,
  };
}

function makeArchivedTask(overrides: Partial<ArchivedTaskEntry> = {}): ArchivedTaskEntry {
  return {
    taskId: 'TASK-001',
    title: 'Add search module',
    summary: '',
    rootTaskId: '',
    qmdRecordId: 'qmd-1',
    followupReason: '',
    year: '2026',
    archivePath: '/archive/2026/task.md',
    archivedAt: null,
    contextPackName: 'test-pack',
    plannerFocusSnapshot: makeFocusSnapshot(),
    childParentEligibility: {
      eligible: true,
      reason: 'standalone-root',
      message: '',
      rootTaskId: 'TASK-001',
      currentTipTaskId: null,
      currentTipState: null,
    },
    ...overrides,
  };
}


describe('usePlannerModal file and child-task workflows', () => {
  it('appends sent message to draft summary', async () => {
    const { result } = renderPlannerModalHook();

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Hello world');
    });

    expect(result.current.plannerModalProps.draft.summary).toContain('Hello world');
  });

  it('sends review prompt through regular message path when file is attached', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent.' },
    });
    const client = createClient({
      sendPlannerMessage,
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: intake.md',
          filename: 'intake.md',
          path: '/home/user/intake.md',
          content: '# My Intake\n\n## Request Summary\n\nBuild a feature.',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();

    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Please review this.');
    });

    expect(sendPlannerMessage).toHaveBeenCalledTimes(1);
    const sentText = sendPlannerMessage.mock.calls[0][0] as string;
    expect(sentText).toContain('intake.md');
    expect(sentText).toContain('AgentWorkSpace/templates/planning-intake.md');
    expect(sentText).toContain('# My Intake');
    expect(sentText).toContain('Please review this.');
    expect(sentText).toContain('Do NOT edit the staged draft');
    expect(sendPlannerMessage.mock.calls[0]?.[1]).toBe('[Attached intake.md for review]\nPlease review this.');

    // File should be cleared after send
    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();

    // Conversation shows a display-friendly message, not the full prompt
    expect(result.current.plannerModalProps.messages.length).toBeGreaterThan(0);
    const lastOperatorMsg = result.current.plannerModalProps.messages.find(
      (m) => m.role === 'operator' && m.text.includes('Attached intake.md'),
    );
    expect(lastOperatorMsg).toBeDefined();
  });

  it('retains selected file when send fails', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: false,
      action: 'planner.sendMessage',
      error: 'No active planner session.',
    });
    const client = createClient({
      sendPlannerMessage,
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();

    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this.');
    });

    // File should still be selected since send failed
    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();
    expect(result.current.plannerModalProps.selectedMarkdownFile?.filename).toBe('spec.md');
  });

  it('sends review prompt without extra text when operator sends empty message with file attached', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent.' },
    });
    const client = createClient({
      sendPlannerMessage,
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    await act(async () => {
      result.current.plannerModalProps.onSendMessage('');
    });

    const sentText = sendPlannerMessage.mock.calls[0][0] as string;
    expect(sentText).toContain('spec.md');
    expect(sentText).toContain('AgentWorkSpace/templates/planning-intake.md');
    expect(sentText).not.toContain('Additional context from the operator');
  });

  it('upload-review run without staged draft surfaces draftError on View Draft', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: intake.md',
          filename: 'intake.md',
          path: '/home/user/intake.md',
          content: '# Intake',
        },
      }),
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
      readStagedDraft: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.readStagedDraft',
          mode: 'empty',
          message: 'No staged draft.',
          draft: null,
          brokerStatus: 'completed',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    // Attach and send review
    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this.');
    });

    // Attempt to view draft — Lily hasn't written one
    await act(async () => {
      result.current.plannerModalProps.onViewDraft!();
      await Promise.resolve();
    });

    expect(result.current.plannerModalProps.awaitingDraft).toBe(false);
    expect(result.current.plannerModalProps.draftError).toBe('Lily has not written a draft yet. Try again shortly.');
  });

  it('upload-review finalize surfaces intake validation errors as draftError', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: intake.md',
          filename: 'intake.md',
          path: '/home/user/intake.md',
          content: '# Intake',
        },
      }),
      finalizeSpec: vi.fn().mockResolvedValue({
        ok: false,
        action: 'planner.finalizeSpec',
        error: 'Staged draft is missing required section content: Desired Outcome. Ask Lily to complete the planning intake before finalizing.',
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    // Attach and send
    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this.');
    });

    // Attempt to finalize — validation fails
    await act(async () => {
      await result.current.plannerModalProps.onFinalizeSpec!();
    });

    expect(result.current.plannerModalProps.draftError).toContain('missing required section content');
    expect(result.current.plannerModalProps.draftError).toContain('Desired Outcome');
  });

  it('upload-review finalize succeeds when staged draft passes intake validation', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: intake.md',
          filename: 'intake.md',
          path: '/home/user/intake.md',
          content: '# Intake',
        },
      }),
      finalizeSpec: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.finalizeSpec',
          mode: 'finalized',
          accepted: true,
          message: 'Spec promoted to dropbox: intake.md',
          destinationPath: '/repo/AgentWorkSpace/dropbox/intake.md',
          brokerStatus: 'idle',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this.');
    });

    await act(async () => {
      await result.current.plannerModalProps.onFinalizeSpec!();
    });

    expect(result.current.plannerModalProps.draftError).toBeFalsy();
    expect(result.current.plannerModalProps.sessionStatus).toBe('idle');
    expect(result.current.plannerModalProps.stagedDraft).toBeNull();
  });

  it('follow-up messages after file review use regular chat path without file context', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent.' },
    });
    const client = createClient({
      sendPlannerMessage,
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    // First: pick and send with file
    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this.');
    });

    // Second: follow-up without file
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('The desired outcome is X.');
    });

    expect(sendPlannerMessage).toHaveBeenCalledTimes(2);
    const followUpText = sendPlannerMessage.mock.calls[1][0] as string;
    expect(followUpText).toBe('The desired outcome is X.');
    expect(followUpText).not.toContain('planning-intake.md');
  });

  it('does not open modal when no context pack is active', async () => {
    const { result } = renderPlannerModalHook(undefined, { hasActiveContextPack: false });

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(false);
  });

  it('exposes child-task mode state defaulting to standard', () => {
    const { result } = renderPlannerModalHook();
    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(result.current.plannerModalProps.selectedParentTask).toBeNull();
    expect(result.current.plannerModalProps.archivedTasks).toEqual([]);
    expect(result.current.plannerModalProps.childTaskBlocked).toBe(false);
  });

  it('toggles child-task mode and fetches archived tasks', async () => {
    const client = createClient({
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 archived task(s).',
          tasks: [
            makeArchivedTask(),
          ],
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    expect(result.current.plannerModalProps.childTaskMode).toBe(true);
    expect(result.current.plannerModalProps.childTaskBlocked).toBe(true);
    expect(result.current.plannerModalProps.archivedTasks).toHaveLength(1);
    expect(result.current.plannerModalProps.archivedTasks![0].taskId).toBe('TASK-001');
  });

  it('child-task mode blocks chat until parent is selected', async () => {
    const client = createClient({
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 task.',
          tasks: [
            makeArchivedTask(),
          ],
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    expect(result.current.plannerModalProps.childTaskBlocked).toBe(true);

    act(() => {
      result.current.plannerModalProps.onSelectParentTask!(
        makeArchivedTask(),
      );
    });

    expect(result.current.plannerModalProps.childTaskBlocked).toBe(false);
    expect(result.current.plannerModalProps.selectedParentTask?.taskId).toBe('TASK-001');
  });

  it('closing modal resets child-task mode', async () => {
    const client = createClient({
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 task.',
          tasks: [
            makeArchivedTask({ title: 'Test', archivePath: '/path', contextPackName: 'pack' }),
          ],
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    expect(result.current.plannerModalProps.childTaskMode).toBe(true);

    act(() => {
      result.current.plannerModalProps.onClose();
    });

    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(result.current.plannerModalProps.selectedParentTask).toBeNull();
    expect(result.current.plannerModalProps.archivedTasks).toEqual([]);
  });

  it('resets all planner state when active context pack changes', async () => {
    const endPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Session ended.' },
    });
    const client = createClient({
      endPlannerSession,
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 task.',
          tasks: [
            makeArchivedTask({ title: 'Test', archivePath: '/path', contextPackName: 'pack' }),
          ],
        },
      }),
    });

    const contextPackDirRef = { current: '/tmp/pack-a' };
    const { result, rerender } = renderHook(
      () => {
        const [contractError, setContractError] = useState('');
        return usePlannerModal(client, 'idle', true, contractError, setContractError, contextPackDirRef.current);
      },
      { wrapper: makeWrapper(client) },
    );

    // Open modal, toggle child-task mode
    await act(async () => {
      result.current.openPlannerModal();
    });
    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(true);
    expect(result.current.plannerModalProps.childTaskMode).toBe(true);

    // Switch context pack
    contextPackDirRef.current = '/tmp/pack-b';
    await act(async () => {
      rerender();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(false);
    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(result.current.plannerModalProps.selectedParentTask).toBeNull();
    expect(result.current.plannerModalProps.archivedTasks).toEqual([]);
    expect(result.current.plannerModalProps.stagedDraft).toBeNull();
    expect(endPlannerSession).toHaveBeenCalled();
  });

  it('resets planner state when context pack is cleared', async () => {
    const endPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.endSession', mode: 'ended', accepted: true, message: 'Session ended.' },
    });
    const client = createClient({ endPlannerSession });

    const contextPackDirRef = { current: '/tmp/pack-a' as string | null };
    const hasActiveRef = { current: true };
    const { result, rerender } = renderHook(
      () => {
        const [contractError, setContractError] = useState('');
        return usePlannerModal(client, 'idle', hasActiveRef.current, contractError, setContractError, contextPackDirRef.current);
      },
      { wrapper: makeWrapper(client) },
    );

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(true);

    // Clear context pack
    contextPackDirRef.current = null;
    hasActiveRef.current = false;
    await act(async () => {
      rerender();
    });

    expect(result.current.plannerModalProps.isOpen).toBe(false);
    expect(result.current.plannerModalProps.childTaskMode).toBe(false);
    expect(endPlannerSession).toHaveBeenCalled();
  });

  it('selecting a parent task seeds a child-task draft with platform lineage', async () => {
    const client = createClient({
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 task.',
          tasks: [
            makeArchivedTask(),
          ],
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    act(() => {
      result.current.plannerModalProps.onSelectParentTask!(
        makeArchivedTask(),
      );
    });

    expect(result.current.plannerModalProps.draft.taskKind).toBe('child-task');
    expect(result.current.plannerModalProps.draft.parentTaskId).toBe('TASK-001');
    expect(result.current.plannerModalProps.draft.rootTaskId).toBe('TASK-001');
    expect(result.current.plannerModalProps.draft.parentQmdScope).toBe('qmd/context-packs/test-pack');
  });

  it('selecting a stale parent without a focus snapshot surfaces an error and does not start a session', async () => {
    const startPlannerSession = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'session-1', brokerStatus: 'idle' },
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    const startCalls = startPlannerSession.mock.calls.length;

    act(() => {
      result.current.plannerModalProps.onSelectParentTask?.({
        ...makeArchivedTask(),
        plannerFocusSnapshot: undefined,
      });
    });

    expect(result.current.plannerModalProps.draftError).toContain('no saved planner focus');
    expect(startPlannerSession).toHaveBeenCalledTimes(startCalls);
  });

  it('child-task parent selection never hydrates transcript history', async () => {
    const hydratePlannerConversation = vi.fn();
    const client = createClient({ hydratePlannerConversation });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(makeArchivedTask());
    });

    expect(hydratePlannerConversation).not.toHaveBeenCalled();
  });

  it('starts child-task parent sessions with lineage and focus snapshot payloads', async () => {
    const startPlannerSession = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'initial', brokerStatus: 'idle' },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'child', brokerStatus: 'idle' },
      });
    const parent = makeArchivedTask({
      qmdRecordId: 'qmd-parent-1',
      rootTaskId: 'ROOT-1',
      followupReason: 'Operator correction.',
    });
    const client = createClient({ startPlannerSession });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(parent);
    });

    expect(startPlannerSession).toHaveBeenLastCalledWith({
      contextPackDir: parent.plannerFocusSnapshot!.contextPackDir,
      childTaskFocusSnapshot: parent.plannerFocusSnapshot,
      childTaskLineage: {
        parentTaskId: parent.taskId,
        parentQmdRecordId: 'qmd-parent-1',
        parentQmdScope: 'qmd/context-packs/test-pack',
        rootTaskId: 'ROOT-1',
        followUpReason: 'Operator correction.',
      },
      lilyPersonalityId: 'balanced',
      parentTaskBranchView: {
        schemaVersion: 1,
        parentTaskId: parent.taskId,
        contextPackDir: parent.plannerFocusSnapshot!.contextPackDir,
        contextPackId: parent.plannerFocusSnapshot!.contextPackId,
        branchChainAvailability: {
          status: 'missing-branch-handoffs',
          message: 'Parent branch view unavailable: archived parent has no branch handoffs. Lily will use archived parent archive context only.',
        },
      },
    });
  });

  it('surfaces restart failure during child-task parent selection', async () => {
    const client = createClient({
      startPlannerSession: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'initial', brokerStatus: 'idle' },
        })
        .mockResolvedValueOnce({
          ok: false,
          action: 'planner.startSession',
          error: 'restart failed',
        }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask?.(makeArchivedTask());
    });

    await waitFor(() => {
      expect(result.current.plannerModalProps.draftError).toBe('restart failed');
    });
    expect(result.current.plannerModalProps.sessionStatus).toBe('failed');
  });

  it('exposes loading state while child-task parent restart is in flight', async () => {
    let resolveStart!: (value: Awaited<ReturnType<DesktopShellClient['startPlannerSession']>>) => void;
    const startPromise = new Promise<Awaited<ReturnType<DesktopShellClient['startPlannerSession']>>>((resolve) => {
      resolveStart = resolve;
    });
    const client = createClient({
      startPlannerSession: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'initial', brokerStatus: 'idle' },
        })
        .mockReturnValueOnce(startPromise),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });
    act(() => {
      result.current.plannerModalProps.onSelectParentTask?.(makeArchivedTask());
    });

    expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(true);

    await act(async () => {
      resolveStart({
        ok: true,
        response: { action: 'planner.startSession', mode: 'started', accepted: true, message: 'Started.', sessionId: 'child', brokerStatus: 'idle' },
      });
      await startPromise;
    });
    await waitFor(() => {
      expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(false);
    });
  });

  it('selecting a different parent task re-seeds the draft', async () => {
    const client = createClient({
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 2 tasks.',
          tasks: [
            makeArchivedTask({ title: 'First task', archivePath: '/path/1', contextPackName: 'pack' }),
            makeArchivedTask({ taskId: 'TASK-002', title: 'Second task', archivePath: '/path/2', contextPackName: 'pack' }),
          ],
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    act(() => {
      result.current.plannerModalProps.onSelectParentTask!(
        makeArchivedTask({ title: 'First task', archivePath: '/path/1', contextPackName: 'pack' }),
      );
    });

    expect(result.current.plannerModalProps.draft.parentTaskId).toBe('TASK-001');
    await waitFor(() => {
      expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(false);
    });

    act(() => {
      result.current.plannerModalProps.onSelectParentTask!(
        makeArchivedTask({ taskId: 'TASK-002', title: 'Second task', archivePath: '/path/2', contextPackName: 'pack' }),
      );
    });

    expect(result.current.plannerModalProps.draft.parentTaskId).toBe('TASK-002');
    expect(result.current.plannerModalProps.draft.taskKind).toBe('child-task');
  });

  it('defers the child-task starter prompt until the operator sends their first message', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent.' },
    });
    const client = createClient({
      sendPlannerMessage,
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 task.',
          tasks: [
            makeArchivedTask({ archivePath: '/path' }),
          ],
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });

    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask!(
        makeArchivedTask({ archivePath: '/path' }),
      );
    });

    // Selecting a parent task must NOT send anything to Lily — otherwise the
    // broker spins up a CLI turn and the modal shows "thinking" before the
    // operator has had a chance to provide direction.
    await waitFor(() => {
      expect(result.current.plannerModalProps.loadingChildTaskParent).toBe(false);
    });
    expect(sendPlannerMessage).not.toHaveBeenCalled();

    // First operator message should carry both the deferred starter prompt
    // and the operator's text in a single broker turn.
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Adjust the search algorithm.');
    });

    await waitFor(() => {
      expect(sendPlannerMessage).toHaveBeenCalledTimes(1);
    });
    const firstCall = sendPlannerMessage.mock.calls[0]!;
    const sentText = firstCall[0] as string;
    expect(sentText).toContain('child-task continuation workflow');
    expect(sentText).toContain('Add search module');
    expect(sentText).toContain('Do NOT change Task Lineage, Context Pack Binding, Branch Chain, or Source metadata.');
    expect(sentText).toContain('Operator message:');
    expect(sentText).toContain('Adjust the search algorithm.');

    // Second operator message must NOT re-prepend the starter prompt.
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Follow-up question.');
    });
    await waitFor(() => {
      expect(sendPlannerMessage).toHaveBeenCalledTimes(2);
    });
    const secondCall = sendPlannerMessage.mock.calls[1]!;
    const secondText = secondCall[0] as string;
    expect(secondText).not.toContain('child-task continuation workflow');
    expect(secondText).toContain('Follow-up question.');
  });

  it('uses child-task review prompt when attaching a file in child-task mode', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent.' },
    });
    const client = createClient({
      sendPlannerMessage,
      listArchivedTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'found',
          message: 'Found 1 task.',
          tasks: [
            makeArchivedTask({ title: 'Parent task', archivePath: '/path' }),
          ],
        },
      }),
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'File selected.',
          filename: 'child-draft.md',
          path: '/home/user/child-draft.md',
          content: '# Child Draft\n\n## Request Summary\n\nBuild on parent work.',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    // Toggle child-task mode and select parent
    await act(async () => {
      result.current.plannerModalProps.onToggleChildTaskMode!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSelectParentTask!(
        makeArchivedTask({ title: 'Parent task', archivePath: '/path' }),
      );
    });

    // Attach a file and send
    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this child-task draft.');
    });

    // Find the call that contains the child-task review prompt
    const reviewCall = sendPlannerMessage.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('supporting context'),
    );
    expect(reviewCall).toBeDefined();
    const reviewText = reviewCall![0] as string;
    expect(reviewText).toContain('child-task workflow');
    expect(reviewText).toContain('existing staged shell');
    expect(reviewText).toContain('Do NOT validate or rewrite platform-owned lineage, context-pack binding, or source sections.');
    expect(reviewText).toContain('child-draft.md');
    expect(reviewText).toContain('Build on parent work.');
    expect(reviewText).toContain('Review this child-task draft.');
    expect(reviewCall![1]).toBe('[Attached child-draft.md for review]\nReview this child-task draft.');
  });

  it('uses standard review prompt when attaching a file in standard mode', async () => {
    const sendPlannerMessage = vi.fn().mockResolvedValue({
      ok: true,
      response: { action: 'planner.sendMessage', mode: 'sent', accepted: true, message: 'Message sent.' },
    });
    const client = createClient({
      sendPlannerMessage,
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'File selected.',
          filename: 'standard.md',
          path: '/home/user/standard.md',
          content: '# Standard Draft',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    await act(async () => {
      result.current.openPlannerModal();
    });

    // Standard mode — no child-task toggle
    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });
    await act(async () => {
      result.current.plannerModalProps.onSendMessage('Review this.');
    });

    const reviewCall = sendPlannerMessage.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('planning-intake.md'),
    );
    expect(reviewCall).toBeDefined();
    const reviewText = reviewCall![0] as string;
    expect(reviewText).not.toContain('platform-controlled');
    expect(reviewText).not.toContain('must NOT be overridden');
    expect(reviewText).toContain('standard.md');
    expect(reviewCall![1]).toBe('[Attached standard.md for review]\nReview this.');
  });
});

describe('buildMarkdownReviewPrompt', () => {
  it('includes template comparison instructions', () => {
    const prompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('AgentWorkSpace/templates/planning-intake.md');
    expect(prompt).toContain('Request Summary');
    expect(prompt).toContain('Desired Outcome');
    expect(prompt).toContain('Acceptance Signals');
  });

  it('wraps file content with delimiters', () => {
    const content = '# My Spec\n\nSome content here.';
    const prompt = buildMarkdownReviewPrompt('spec.md', content);
    expect(prompt).toContain('--- BEGIN ATTACHED FILE ---');
    expect(prompt).toContain(content);
    expect(prompt).toContain('--- END ATTACHED FILE ---');
  });

  it('includes filename in the prompt', () => {
    const prompt = buildMarkdownReviewPrompt('my-intake.md', '# Content');
    expect(prompt).toContain('my-intake.md');
  });

  it('instructs Lily not to write staged draft prematurely', () => {
    const prompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('Do NOT edit the staged draft');
    expect(prompt).toContain('Wait until I confirm');
  });

  it('instructs Lily to ask follow-up questions for missing sections', () => {
    const prompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('ask me follow-up questions');
    expect(prompt).toContain('Do not guess or fabricate');
  });

  it('keeps child-task review focused on editable sections', () => {
    const prompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('Parent Task Carry-Forward Summary');
    expect(prompt).toContain('Do not validate or rewrite platform-owned lineage, context-pack binding, or source sections.');
  });
});

describe('buildChildTaskStarterPrompt', () => {
  it('includes workflow mode and staged-shell ownership guidance', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Add search module',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'qmd/context-packs/test-pack',
    });
    expect(prompt).toContain('child-task continuation workflow');
    expect(prompt).toContain('staged planning document already contains the editable H1 title plus the platform-owned lineage, context, and source shell');
    expect(prompt).toContain('Parent task title: Add search module');
    expect(prompt).toContain("The parent task's planner focus snapshot has been restored for this session.");
  });

  it('includes populated parent archive fields', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Add search module',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'qmd/context-packs/test-pack',
      parentTaskContent: {
        completedWorkSummary: 'Preserve read-only console behavior.',
        keyDecisions: ['Keep planner-owned lineage immutable.'],
      },
    });
    expect(prompt).toContain('Preserve read-only console behavior.');
    expect(prompt).toContain('Keep planner-owned lineage immutable.');
  });

  it('omits empty parent archive sections', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
      parentTaskContent: {
        completedWorkSummary: '',
        keyDecisions: [],
      },
    });
    expect(prompt).not.toContain('Completed work summary:');
    expect(prompt).not.toContain('Key decisions:');
  });

  it('omits all empty parent archive section headings', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
      parentTaskContent: {
        taskTitle: '   ',
        taskSummary: '',
        completedWorkSummary: '   ',
        keyDecisions: ['  '],
        knownLimitations: [],
        constraints: [''],
        implementationSummary: '\t',
      },
    });

    expect(prompt).not.toContain('Parent archive task title:');
    expect(prompt).not.toContain('Parent archive task summary:');
    expect(prompt).not.toContain('Completed work summary:');
    expect(prompt).not.toContain('Key decisions:');
    expect(prompt).not.toContain('Known limitations:');
    expect(prompt).not.toContain('Parent constraints:');
    expect(prompt).not.toContain('Implementation summary:');
  });

  it('tells Lily not to change platform-owned sections', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
    });
    expect(prompt).toContain('Fill or refine only the H1 task title and editable sections in the staged document.');
    expect(prompt).toContain('Do NOT change Task Lineage, Context Pack Binding, Branch Chain, or Source metadata.');
  });

  it('differs from standard planning mode — contains child-task specifics', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
    });
    expect(prompt).toContain('what continuation, extension, or follow-up outcome they need');
    expect(prompt).toContain('child-task intake');
  });
});

describe('buildChildTaskMarkdownReviewPrompt', () => {
  it('keeps child-task review focused on editable staged-shell sections', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('existing staged shell');
    expect(prompt).toContain('Do NOT validate or rewrite platform-owned lineage, context-pack binding, or source sections.');
  });

  it('lists content sections that the file may fill', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('Request Summary');
    expect(prompt).toContain('Desired Outcome');
    expect(prompt).toContain('Constraints');
    expect(prompt).toContain('Acceptance Signals');
    expect(prompt).toContain('Parent Task Carry-Forward Summary');
    expect(prompt).toContain('Suggested Routing / Planner Notes');
  });

  it('wraps file content with delimiters', () => {
    const content = '# My Child Task\n\nSome content.';
    const prompt = buildChildTaskMarkdownReviewPrompt('child.md', content);
    expect(prompt).toContain('--- BEGIN ATTACHED FILE ---');
    expect(prompt).toContain(content);
    expect(prompt).toContain('--- END ATTACHED FILE ---');
  });

  it('labels the file as supporting context, not workflow definition', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('supporting context');
    expect(prompt).toContain('child-task workflow');
  });

  it('standard-mode prompt does not include platform lineage override instructions', () => {
    const standardPrompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(standardPrompt).not.toContain('platform-controlled');
    expect(standardPrompt).not.toContain('ignore the file values');
  });
});
