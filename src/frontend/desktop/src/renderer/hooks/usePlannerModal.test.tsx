import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import type { PlannerStreamEvent } from '../../shared/desktopContract';
import {
  createMockClient,
  createPlannerSubmitResponse,
} from '../../test';
import { buildChildTaskMarkdownReviewPrompt, buildChildTaskStarterPrompt, buildMarkdownReviewPrompt } from '../../shared/plannerWorkflow';
import { usePlannerModal } from './usePlannerModal';

afterEach(() => {
  cleanup();
});

let subscribedPlannerEvent: ((plannerEvent: PlannerStreamEvent) => void) | null = null;

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
  options?: { hasActiveContextPack?: boolean; activeContextPackDir?: string | null },
) {
  const c = client ?? createClient();
  const hasActive = options?.hasActiveContextPack ?? true;
  const activeDir = options?.activeContextPackDir ?? (hasActive ? '/tmp/test-context-pack' : null);
  return renderHook(
    () => {
      const [contractError, setContractError] = useState('');
      return usePlannerModal(c, 'idle', hasActive, contractError, setContractError, activeDir);
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

  it('modal status follows explicit broker lifecycle', async () => {
    const { result } = renderPlannerModalHook();

    await act(async () => {
      result.current.openPlannerModal();
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('active');

    act(() => {
      subscribedPlannerEvent?.({ eventType: 'planner.turn.started', brokerStatus: 'running', turnId: 'turn-1', done: false });
    });
    expect(result.current.plannerModalProps.sessionStatus).toBe('busy');

    act(() => {
      subscribedPlannerEvent?.({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-1', done: true });
    });
    expect(result.current.plannerModalProps.sessionStatus).toBe('active');
  });

  it('failed planner events set failed status without marking idle completion as disconnect', async () => {
    const { result } = renderPlannerModalHook();

    await act(async () => {
      result.current.openPlannerModal();
    });

    act(() => {
      subscribedPlannerEvent?.({
        eventType: 'planner.turn.failed',
        brokerStatus: 'failed',
        turnId: 'turn-1',
        done: true,
        error: 'Planner turn failed.',
      });
    });

    expect(result.current.plannerModalProps.sessionStatus).toBe('failed');
    expect(result.current.plannerModalProps.draftError).toBe('Planner turn failed.');

    act(() => {
      subscribedPlannerEvent?.({ eventType: 'planner.turn.completed', brokerStatus: 'completed', turnId: 'turn-2', done: true });
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
    vi.useFakeTimers();
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

    // Advance past the 500ms delay and let the async read() resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.plannerModalProps.awaitingDraft).toBe(false);
    expect(result.current.plannerModalProps.draftError).toBe('IPC dead');

    vi.useRealTimers();
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

  it('View Draft reads staged draft after broker-managed save completes', async () => {
    vi.useFakeTimers();
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
      readStagedDraft: vi.fn().mockResolvedValue({
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
      }),
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
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(client.savePlannerDraft).toHaveBeenCalledTimes(1);
    expect(client.readStagedDraft).toHaveBeenCalledTimes(1);
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

  it('exposes selectedMarkdownFile and pick/clear handlers', () => {
    const { result } = renderPlannerModalHook();
    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
    expect(typeof result.current.plannerModalProps.onPickMarkdownFile).toBe('function');
    expect(typeof result.current.plannerModalProps.onClearSelectedFile).toBe('function');
  });

  it('pickMarkdownFile sets selectedMarkdownFile on successful selection', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec\n\nContent here.',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toEqual({
      filename: 'spec.md',
      path: '/home/user/spec.md',
      content: '# Spec\n\nContent here.',
    });
  });

  it('pickMarkdownFile does not set error on cancelled selection', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'cancelled',
          message: 'Markdown file selection was cancelled.',
          filename: null,
          path: null,
          content: null,
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
    expect(result.current.plannerModalProps.draftError).toBeFalsy();
  });

  it('pickMarkdownFile sets draftError on failure', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: 'Selected file exceeds the 128 KB size limit (256 KB).',
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
    expect(result.current.plannerModalProps.draftError).toBe('Selected file exceeds the 128 KB size limit (256 KB).');
  });

  it('clearSelectedFile resets selectedMarkdownFile', async () => {
    const client = createClient({
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

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();

    act(() => {
      result.current.plannerModalProps.onClearSelectedFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
  });

  it('closing modal clears selectedMarkdownFile', async () => {
    const client = createClient({
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

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();

    act(() => {
      result.current.plannerModalProps.onClose();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
  });

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
    expect(sentText).toContain('Do NOT write the staged draft');

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
    vi.useFakeTimers();
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
    act(() => {
      result.current.plannerModalProps.onViewDraft!();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.plannerModalProps.awaitingDraft).toBe(false);
    expect(result.current.plannerModalProps.draftError).toBe('Lily has not written a draft yet. Try again shortly.');

    vi.useRealTimers();
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
            { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/archive/2026/task.md', contextPackName: 'test-pack' },
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
            { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/archive/2026/task.md', contextPackName: 'test-pack' },
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
        { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/archive/2026/task.md', contextPackName: 'test-pack' },
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
            { taskId: 'TASK-001', title: 'Test', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'pack' },
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
            { taskId: 'TASK-001', title: 'Test', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'pack' },
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
            { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/archive/2026/task.md', contextPackName: 'test-pack' },
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
        { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/archive/2026/task.md', contextPackName: 'test-pack' },
      );
    });

    expect(result.current.plannerModalProps.draft.taskKind).toBe('child-task');
    expect(result.current.plannerModalProps.draft.parentTaskId).toBe('TASK-001');
    expect(result.current.plannerModalProps.draft.rootTaskId).toBe('TASK-001');
    expect(result.current.plannerModalProps.draft.parentQmdScope).toBe('qmd/context-packs/test-pack');
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
            { taskId: 'TASK-001', title: 'First task', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path/1', contextPackName: 'pack' },
            { taskId: 'TASK-002', title: 'Second task', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path/2', contextPackName: 'pack' },
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
        { taskId: 'TASK-001', title: 'First task', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path/1', contextPackName: 'pack' },
      );
    });

    expect(result.current.plannerModalProps.draft.parentTaskId).toBe('TASK-001');

    act(() => {
      result.current.plannerModalProps.onSelectParentTask!(
        { taskId: 'TASK-002', title: 'Second task', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path/2', contextPackName: 'pack' },
      );
    });

    expect(result.current.plannerModalProps.draft.parentTaskId).toBe('TASK-002');
    expect(result.current.plannerModalProps.draft.taskKind).toBe('child-task');
  });

  it('sends child-task starter prompt to Lily when parent task is selected', async () => {
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
            { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'test-pack' },
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
        { taskId: 'TASK-001', title: 'Add search module', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'test-pack' },
      );
    });

    // sendPlannerMessage is called once for session start and once for the starter prompt
    const starterCall = sendPlannerMessage.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('child-task workflow'),
    );
    expect(starterCall).toBeDefined();
    const sentText = starterCall![0] as string;
    expect(sentText).toContain('Parent Task ID: TASK-001');
    expect(sentText).toContain('Add search module');
    expect(sentText).toContain('Do NOT change Task Kind');
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
            { taskId: 'TASK-001', title: 'Parent task', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'test-pack' },
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
        { taskId: 'TASK-001', title: 'Parent task', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'test-pack' },
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
    expect(reviewText).toContain('Parent Task ID: TASK-001');
    expect(reviewText).toContain('must NOT be overridden');
    expect(reviewText).toContain('child-draft.md');
    expect(reviewText).toContain('Build on parent work.');
    expect(reviewText).toContain('Review this child-task draft.');
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
    expect(prompt).toContain('Do NOT write the staged draft');
    expect(prompt).toContain('Wait until I confirm');
  });

  it('instructs Lily to ask follow-up questions for missing sections', () => {
    const prompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('ask me follow-up questions');
    expect(prompt).toContain('Do not guess or fabricate');
  });

  it('includes child-task lineage requirements', () => {
    const prompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(prompt).toContain('Parent Task ID');
    expect(prompt).toContain('Root Task ID');
    expect(prompt).toContain('Follow-Up Reason');
    expect(prompt).toContain('Parent Task Carry-Forward Summary');
    expect(prompt).toContain('child-task');
  });
});

describe('buildChildTaskStarterPrompt', () => {
  it('includes workflow mode and lineage fields', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Add search module',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'qmd/context-packs/test-pack',
      carryForwardSummary: '',
    });
    expect(prompt).toContain('child-task workflow');
    expect(prompt).toContain('Task Kind: child-task');
    expect(prompt).toContain('Parent Task ID: TASK-001');
    expect(prompt).toContain('Root Task ID: TASK-001');
    expect(prompt).toContain('Parent Task Title: Add search module');
    expect(prompt).toContain('Parent QMD Scope: qmd/context-packs/test-pack');
  });

  it('includes carry-forward summary when provided', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Add search module',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'qmd/context-packs/test-pack',
      carryForwardSummary: 'Preserve read-only console behavior.',
    });
    expect(prompt).toContain('Preserve read-only console behavior.');
  });

  it('omits carry-forward line when empty', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
      carryForwardSummary: '',
    });
    expect(prompt).not.toContain('Carry-Forward Summary:');
  });

  it('tells Lily not to change lineage fields', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
      carryForwardSummary: '',
    });
    expect(prompt).toContain('Do NOT change Task Kind');
    expect(prompt).toContain('Do NOT change');
    expect(prompt).toContain('Parent Task ID');
  });

  it('differs from standard planning mode — contains child-task specifics', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-001',
      parentTaskTitle: 'Task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'scope',
      carryForwardSummary: '',
    });
    expect(prompt).toContain('active context pack archive');
    expect(prompt).toContain('child-task intake');
  });
});

describe('buildChildTaskMarkdownReviewPrompt', () => {
  const lineage = {
    parentTaskId: 'TASK-001',
    rootTaskId: 'TASK-001',
    parentQmdScope: 'qmd/context-packs/test-pack',
  };

  it('includes platform lineage fields that must not be overridden', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft', lineage);
    expect(prompt).toContain('Parent Task ID: TASK-001');
    expect(prompt).toContain('Root Task ID: TASK-001');
    expect(prompt).toContain('Parent QMD Scope: qmd/context-packs/test-pack');
    expect(prompt).toContain('Task Kind: child-task');
  });

  it('tells Lily to ignore file values that conflict with platform lineage', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft', lineage);
    expect(prompt).toContain('ignore the file values');
    expect(prompt).toContain('keep the platform values');
  });

  it('lists content sections that the file may fill', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft', lineage);
    expect(prompt).toContain('Request Summary');
    expect(prompt).toContain('Desired Outcome');
    expect(prompt).toContain('Constraints');
    expect(prompt).toContain('Acceptance Signals');
    expect(prompt).toContain('Follow-Up Reason');
    expect(prompt).toContain('Parent Task Carry-Forward Summary');
  });

  it('wraps file content with delimiters', () => {
    const content = '# My Child Task\n\nSome content.';
    const prompt = buildChildTaskMarkdownReviewPrompt('child.md', content, lineage);
    expect(prompt).toContain('--- BEGIN ATTACHED FILE ---');
    expect(prompt).toContain(content);
    expect(prompt).toContain('--- END ATTACHED FILE ---');
  });

  it('labels the file as supporting context, not workflow definition', () => {
    const prompt = buildChildTaskMarkdownReviewPrompt('draft.md', '# Draft', lineage);
    expect(prompt).toContain('supporting context');
    expect(prompt).toContain('child-task workflow');
  });

  it('standard-mode prompt does not include platform lineage override instructions', () => {
    const standardPrompt = buildMarkdownReviewPrompt('draft.md', '# Draft');
    expect(standardPrompt).not.toContain('platform-controlled');
    expect(standardPrompt).not.toContain('ignore the file values');
  });
});
