import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PlannerModal from './PlannerModal';
import type { PlannerModalProps } from './PlannerModal';
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

  it('overlay click calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<PlannerModal {...makeProps({ onClose })} />);
    const overlay = container.querySelector('.planner-modal__overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledOnce();
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
            { taskId: 'TASK-001', title: 'Add search', summary: '', rootTaskId: '', qmdRecordId: '', followupReason: '', year: '2026', archivePath: '/path', contextPackName: 'pack' },
          ],
        })}
      />,
    );
    expect(screen.getByLabelText('Parent task selection')).toBeInTheDocument();
    expect(screen.getByText('Add search (2026)')).toBeInTheDocument();
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
});
