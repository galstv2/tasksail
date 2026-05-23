import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PlannerModal from './PlannerModal';
import type { PlannerModalProps } from './PlannerModal';
import type { PlannerFocusSnapshot } from '../../shared/desktopContract';
import { PLANNER_FOCUS_FALLBACK_MESSAGE } from '../../shared/desktopContractPlanner';
import { createLocalDraft } from '../plannerComposer';
import type { PlannerConversationMessage } from '../plannerComposer';

afterEach(() => {
  cleanup();
});

function makeProps(overrides: Partial<PlannerModalProps> = {}): PlannerModalProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    draft: createLocalDraft({
      title: '',
      summary: '',
      desiredOutcome: '',
      constraints: [],
      acceptanceSignals: [],
      planningNotes: '',
      suggestedPath: 'sequential',
    }),
    composerStage: 'compose',
    onPreview: vi.fn(),
    onConfirm: vi.fn(),
    isFollowUpDraft: false,
    planningEnabled: true,
    contractError: '',
    primaryActionLabel: 'Confirm & Send to Dropbox',
    stageCopy: 'Compose a new task intake.',
    messages: [],
    onSendMessage: vi.fn(),
    ...overrides,
  };
}

function makeFocusSnapshot(): PlannerFocusSnapshot {
  return {
    version: 1,
    contextPackDir: '/tmp/test-context-pack',
    contextPackId: 'test-pack',
    title: 'Add search',
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
  };
}

function makeArchivedParentTask() {
  return {
    taskId: 'TASK-001',
    title: 'Add search',
    summary: '',
    rootTaskId: '',
    qmdRecordId: '',
    followupReason: '',
    year: '2026',
    archivePath: '/path',
    archivedAt: null,
    contextPackName: 'pack',
    plannerFocusSnapshot: makeFocusSnapshot(),
  };
}

describe('PlannerModal', () => {
  it('does not render when isOpen is false', () => {
    render(<PlannerModal {...makeProps({ isOpen: false })} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders overlay, dialog, conversation area, and composer when isOpen is true', () => {
    render(<PlannerModal {...makeProps()} />);
    expect(screen.getByRole('dialog', { name: 'Planning agent' })).toBeInTheDocument();
    expect(screen.getByLabelText('Conversation')).toBeInTheDocument();
    expect(screen.getByLabelText('Planner message input')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<PlannerModal {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByLabelText('Close planner'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(<PlannerModal {...makeProps({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('overlay click does not close the modal', () => {
    const onClose = vi.fn();
    const { container } = render(<PlannerModal {...makeProps({ onClose })} />);
    const overlay = container.querySelector('.planner-modal__overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('textarea accepts input and send button triggers submission', () => {
    const onSendMessage = vi.fn();
    render(<PlannerModal {...makeProps({ onSendMessage })} />);

    const textarea = screen.getByLabelText('Planner message input');
    fireEvent.change(textarea, { target: { value: 'Plan a billing feature' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(onSendMessage).toHaveBeenCalledWith('Plan a billing feature');
  });

  it('Preview Plan button calls the preview handler', () => {
    const onPreview = vi.fn();
    render(<PlannerModal {...makeProps({ onPreview })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview Plan' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('Confirm & Send to Dropbox button calls the confirm handler', () => {
    const onConfirm = vi.fn();
    render(<PlannerModal {...makeProps({ onConfirm, composerStage: 'preview' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Send to Dropbox' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('follow-up lineage banner renders when isFollowUpDraft is true', () => {
    const draft = createLocalDraft({
      title: 'Follow-up task',
      summary: '',
      desiredOutcome: '',
      constraints: [],
      acceptanceSignals: [],
      planningNotes: '',
      suggestedPath: 'sequential',
    });
    draft.taskKind = 'child-task';
    draft.parentTaskId = 'CAP-01';
    draft.rootTaskId = 'CAP-ROOT';

    render(<PlannerModal {...makeProps({ isFollowUpDraft: true, draft })} />);
    const banner = screen.getByLabelText('Follow-up lineage');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('CAP-01');
    expect(banner).toHaveTextContent('CAP-ROOT');
  });

  it('follow-up lineage banner does not render when isFollowUpDraft is false', () => {
    render(<PlannerModal {...makeProps({ isFollowUpDraft: false })} />);
    expect(screen.queryByLabelText('Follow-up lineage')).not.toBeInTheDocument();
  });

  it('renders paperclip attach button in composer bar', () => {
    render(<PlannerModal {...makeProps()} />);
    expect(screen.getByLabelText('Attach markdown file')).toBeInTheDocument();
  });

  it('shows selected-file indicator when a file is selected', () => {
    render(
      <PlannerModal
        {...makeProps({
          selectedMarkdownFile: {
            filename: 'intake-draft.md',
            path: '/home/user/docs/intake-draft.md',
            content: '# Draft\n\nSome content.',
          },
        })}
      />,
    );
    const indicator = screen.getByLabelText('Selected file');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('intake-draft.md');
  });

  it('does not show selected-file indicator when no file is selected', () => {
    render(<PlannerModal {...makeProps({ selectedMarkdownFile: null })} />);
    expect(screen.queryByLabelText('Selected file')).not.toBeInTheDocument();
  });

  it('clear button on selected-file calls onClearSelectedFile', () => {
    const onClearSelectedFile = vi.fn();
    render(
      <PlannerModal
        {...makeProps({
          selectedMarkdownFile: {
            filename: 'intake-draft.md',
            path: '/home/user/docs/intake-draft.md',
            content: '# Draft',
          },
          onClearSelectedFile,
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText('Clear selected file'));
    expect(onClearSelectedFile).toHaveBeenCalledOnce();
  });

  it('attach button calls onPickMarkdownFile', () => {
    const onPickMarkdownFile = vi.fn();
    render(<PlannerModal {...makeProps({ onPickMarkdownFile })} />);
    fireEvent.click(screen.getByLabelText('Attach markdown file'));
    expect(onPickMarkdownFile).toHaveBeenCalledOnce();
  });

  it('renders conversation messages with role differentiation', () => {
    const messages: PlannerConversationMessage[] = [
      { id: 'msg-1', role: 'operator', text: 'Build a billing feature' },
      { id: 'msg-2', role: 'planner', text: 'I will create a plan for billing.' },
    ];
    render(<PlannerModal {...makeProps({ messages })} />);
    const conversation = screen.getByLabelText('Conversation');
    expect(within(conversation).getByText('Build a billing feature')).toBeInTheDocument();
    expect(within(conversation).getByText('I will create a plan for billing.')).toBeInTheDocument();
    const operatorMsg = conversation.querySelector('.planner-msg--operator');
    const plannerMsg = conversation.querySelector('.planner-msg--planner');
    expect(operatorMsg).toBeInTheDocument();
    expect(plannerMsg).toBeInTheDocument();
  });

  it('keeps Draft Spec disabled until the operator sends a message', () => {
    const { rerender } = render(
      <PlannerModal {...makeProps({ sessionStatus: 'active', messages: [] })} />,
    );
    expect(screen.getByRole('button', { name: 'Draft Spec' })).toBeDisabled();

    rerender(
      <PlannerModal {...makeProps({
        sessionStatus: 'active',
        messages: [{ id: 'm1', role: 'planner', text: 'How can I help?' }],
      })} />,
    );
    expect(screen.getByRole('button', { name: 'Draft Spec' })).toBeDisabled();

    rerender(
      <PlannerModal {...makeProps({
        sessionStatus: 'active',
        messages: [{ id: 'm2', role: 'operator', text: 'Build a billing feature' }],
      })} />,
    );
    expect(screen.getByRole('button', { name: 'Draft Spec' })).toBeEnabled();
  });

  it('does not render the recents trigger when there are zero records', () => {
    render(
      <PlannerModal
        {...makeProps({
          recentConversations: [],
          loadingRecentConversations: false,
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: /Recent conversations/i })).toBeNull();
  });

  it('renders the recents trigger with the count, opens the popover, and selects a row', () => {
    const onSelectConversation = vi.fn();
    const records = [1, 2, 3].map((i) => ({
      id: `conversation-${i}`,
      title: `Historical plan ${i}`,
      createdAt: new Date().toISOString(),
      finalizedDestinationPath: `/repo/AgentWorkSpace/dropbox/spec-${i}.md`,
      messageCount: 2 + i,
      taskKind: 'standard' as const,
      scopeMode: 'selected',
      primaryRepoId: 'platform',
      primaryFocusRelativePath: 'src/features/planner/replay-flow',
    }));
    render(
      <PlannerModal
        {...makeProps({
          recentConversations: records,
          onSelectConversation,
        })}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Recent conversations, 3 available/ });
    expect(trigger.textContent).toContain('Recent Task');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const row2 = screen.getByTestId('recents-row-conversation-2');
    fireEvent.click(row2);

    expect(onSelectConversation).toHaveBeenCalledOnce();
    expect(onSelectConversation).toHaveBeenCalledWith('conversation-2');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the replay-aware label and goes non-interactive during replayInFlight', () => {
    const records = [
      {
        id: 'conversation-1',
        title: 'Refactor queue advancement gating',
        createdAt: new Date().toISOString(),
        finalizedDestinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
        messageCount: 6,
        taskKind: 'child-task' as const,
        scopeMode: 'selected',
        primaryRepoId: 'platform',
        primaryFocusRelativePath: 'src/features/planner',
      },
    ];
    const onSelectConversation = vi.fn();

    const { rerender } = render(
      <PlannerModal
        {...makeProps({
          recentConversations: records,
          onSelectConversation,
        })}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Recent conversations/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('recents-row-conversation-1'));

    rerender(
      <PlannerModal
        {...makeProps({
          recentConversations: records,
          replayInFlight: true,
          onSelectConversation,
        })}
      />,
    );

    const replayingTrigger = screen.getByRole('button', { name: /Replaying Refactor queue advancement gating/ });
    expect(replayingTrigger).toHaveAttribute('aria-busy', 'true');
    expect(replayingTrigger).toHaveAttribute('tabindex', '-1');
    expect(replayingTrigger.className).toContain('recents-trigger--replaying');
  });

  it('hides the return-to-blank button in blank state', () => {
    render(<PlannerModal {...makeProps({ childTaskMode: false, replaySourceRecordId: null })} />);
    expect(screen.queryByRole('button', { name: /return to blank planner/i })).toBeNull();
  });

  it('shows the return-to-blank button in child-task mode', () => {
    const onReturnToBlank = vi.fn();
    render(<PlannerModal {...makeProps({ childTaskMode: true, onReturnToBlank })} />);

    fireEvent.click(screen.getByRole('button', { name: /return to blank planner/i }));

    expect(onReturnToBlank).toHaveBeenCalledOnce();
  });

  it('shows the return-to-blank button for replay context', () => {
    const onReturnToBlank = vi.fn();
    render(<PlannerModal {...makeProps({ childTaskMode: false, replaySourceRecordId: 'rec-7', onReturnToBlank })} />);

    fireEvent.click(screen.getByRole('button', { name: /return to blank planner/i }));

    expect(onReturnToBlank).toHaveBeenCalledOnce();
  });

  it('disables the return-to-blank button during replayInFlight', () => {
    const onReturnToBlank = vi.fn();
    render(<PlannerModal {...makeProps({ childTaskMode: true, replayInFlight: true, onReturnToBlank })} />);

    const button = screen.getByRole('button', { name: /return to blank planner/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(onReturnToBlank).not.toHaveBeenCalled();
  });

  it('renders child-task toggle in header', () => {
    render(<PlannerModal {...makeProps()} />);
    expect(screen.getByLabelText('Toggle child-task mode')).toBeInTheDocument();
  });

  it('child-task toggle is disabled when planningEnabled is false', () => {
    render(<PlannerModal {...makeProps({ planningEnabled: false })} />);
    expect(screen.getByLabelText('Toggle child-task mode')).toBeDisabled();
  });

  it('shows parent task dropdown when child-task mode is active', () => {
    render(
      <PlannerModal
        {...makeProps({
          childTaskMode: true,
          archivedTasks: [
            { taskId: 'TASK-001', title: 'Add search', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', archivedAt: null, contextPackName: 'pack', plannerFocusSnapshot: makeFocusSnapshot() },
          ],
        })}
      />,
    );
    expect(screen.getByLabelText('Parent task selection')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /select a completed parent task/i }));
    expect(screen.getByText('Add search')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('renders only the archived tasks it is given (filtering is owned by the hook)', () => {
    render(
      <PlannerModal
        {...makeProps({
          childTaskMode: true,
          archivedTasks: [
            { taskId: 'TASK-001', title: 'Modern parent', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', archivedAt: null, contextPackName: 'pack', plannerFocusSnapshot: makeFocusSnapshot() },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /select a completed parent task/i }));
    expect(screen.getByText('Modern parent')).toBeInTheDocument();
  });

  it('shows an ineligible-archives placeholder when archives exist but none have planner focus snapshots', () => {
    render(
      <PlannerModal
        {...makeProps({
          childTaskMode: true,
          archivedTasks: [],
          archivedTaskTotalCount: 9,
        })}
      />,
    );

    expect(screen.getByText('9 archived tasks found, but none have a saved planner focus')).toBeInTheDocument();
  });

  it('shows the empty-archive placeholder when no archives exist at all', () => {
    render(
      <PlannerModal
        {...makeProps({
          childTaskMode: true,
          archivedTasks: [],
          archivedTaskTotalCount: 0,
        })}
      />,
    );

    expect(screen.getByText('No completed tasks found in archive')).toBeInTheDocument();
  });

  it('shows Loading parent task while child-task restart is in flight', () => {
    render(<PlannerModal {...makeProps({ childTaskMode: true, loadingChildTaskParent: true })} />);

    expect(screen.getByText('Loading parent task...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /loading parent task/i })).toBeDisabled();
  });

  it('does not show parent task dropdown in standard mode', () => {
    render(<PlannerModal {...makeProps({ childTaskMode: false })} />);
    expect(screen.queryByLabelText('Parent task selection')).not.toBeInTheDocument();
  });

  it('disables textarea and send when child-task mode blocks on missing parent', () => {
    render(<PlannerModal {...makeProps({ childTaskMode: true, childTaskBlocked: true })} />);
    expect(screen.getByLabelText('Planner message input')).toBeDisabled();
    expect(screen.getByLabelText('Send message')).toBeDisabled();
    expect(screen.getByLabelText('Attach markdown file')).toBeDisabled();
  });

  it('textarea shows blocked placeholder when child-task mode is missing parent', () => {
    render(<PlannerModal {...makeProps({ childTaskMode: true, childTaskBlocked: true })} />);
    expect(screen.getByLabelText('Planner message input')).toHaveAttribute(
      'placeholder',
      'Select a parent task to begin child-task planning.',
    );
  });

  it('keeps the default placeholder even after conversation messages exist', () => {
    render(<PlannerModal {...makeProps({
      messages: [{ id: 'msg-1', role: 'planner', text: 'Ready.' }],
    })} />);

    expect(screen.getByLabelText('Planner message input')).toHaveAttribute(
      'placeholder',
      'Start a conversation with Lily to begin planning your task.',
    );
  });

  it('shows child-task guidance when a parent task is selected', () => {
    render(<PlannerModal {...makeProps({
      childTaskMode: true,
      selectedParentTask: makeArchivedParentTask(),
      messages: [{ id: 'msg-1', role: 'planner', text: 'Child-task mode activated.' }],
    })} />);

    expect(screen.getByLabelText('Planner message input')).toHaveAttribute(
      'placeholder',
      'Tell Lily what this child task should continue, change, or investigate.',
    );
  });

  it('shows recent-task guidance when replaying a recent conversation', () => {
    render(<PlannerModal {...makeProps({
      replaySourceRecordId: 'conversation-1',
      messages: [{ id: 'msg-1', role: 'planner', text: 'Historical planning context.' }],
    })} />);

    expect(screen.getByLabelText('Planner message input')).toHaveAttribute(
      'placeholder',
      'Continue this planning thread with Lily.',
    );
  });

  it('disables Finalize Spec when no staged draft exists', () => {
    render(
      <PlannerModal
        {...makeProps({
          sessionStatus: 'active',
          onFinalizeSpec: vi.fn(),
          stagedDraft: null,
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Finalize Spec' })).toBeDisabled();
  });

  it('enables Finalize Spec when a staged draft exists', () => {
    const onFinalizeSpec = vi.fn();

    render(
      <PlannerModal
        {...makeProps({
          sessionStatus: 'active',
          onFinalizeSpec,
          stagedDraft: { filename: 'draft.md', content: '# Draft', modifiedAt: new Date().toISOString() },
        })}
      />,
    );

    const finalizeButton = screen.getByRole('button', { name: 'Finalize Spec' });
    expect(finalizeButton).toBeEnabled();

    fireEvent.click(finalizeButton);
    expect(onFinalizeSpec).toHaveBeenCalledOnce();
  });

  it('enables Finalize Spec when session failed but staged draft exists', () => {
    render(
      <PlannerModal
        {...makeProps({
          sessionStatus: 'failed',
          onFinalizeSpec: vi.fn(),
          stagedDraft: { filename: 'draft.md', content: '# Draft', modifiedAt: new Date().toISOString() },
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Finalize Spec' })).toBeEnabled();
  });

  it('does not import useToast (warnings flow through draftError, not toasts)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, 'PlannerModal.tsx'),
      'utf-8',
    );
    expect(source).not.toMatch(/useToast/);
  });

  it('renders the exact fallback message text when parent focus validation fails', () => {
    render(<PlannerModal {...makeProps({ draftError: PLANNER_FOCUS_FALLBACK_MESSAGE })} />);

    expect(screen.getByRole('alert')).toHaveTextContent(PLANNER_FOCUS_FALLBACK_MESSAGE);
  });

  it('renders path-bearing validation issues as "<label>: <path>"', () => {
    render(
      <PlannerModal
        {...makeProps({
          draftError: 'Parent focus invalid.',
          plannerFocusValidationIssues: [
            { code: 'primary-focus-path-missing', label: 'Primary focus path', path: '/repo/src/missing' },
          ],
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Primary focus path: /repo/src/missing');
  });

  it('renders id-bearing validation issues as "<label>: <id>"', () => {
    render(
      <PlannerModal
        {...makeProps({
          draftError: 'Parent focus invalid.',
          plannerFocusValidationIssues: [
            { code: 'selected-focus-id-missing', label: 'Selected focus ID', id: 'legacy-focus' },
          ],
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Selected focus ID: legacy-focus');
  });

  it('clears validation issue details when the issue list is reset', () => {
    const { rerender } = render(
      <PlannerModal
        {...makeProps({
          draftError: 'Parent focus invalid.',
          plannerFocusValidationIssues: [
            { code: 'selected-repo-id-missing', label: 'Selected repo ID', id: 'old-repo' },
          ],
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Selected repo ID: old-repo');

    rerender(<PlannerModal {...makeProps({ plannerFocusValidationIssues: [] })} />);

    expect(screen.queryByText('Selected repo ID: old-repo')).not.toBeInTheDocument();
  });
});
