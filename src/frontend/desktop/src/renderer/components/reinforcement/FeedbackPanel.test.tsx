// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReinforcementTaskEntry } from '../../../shared/desktopContract';
import type { FeedbackDraft, SubmitState } from '../../hooks/useFeedbackSubmission';
import FeedbackPanel from './FeedbackPanel';

afterEach(() => {
  cleanup();
});

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    hasActiveContextPack: true as boolean,
    tasks: [
      {
        taskId: 'task-1',
        title: 'Fix login bug',
        difficulty: 'medium',
        effectiveReward: 100,
        settlementStatus: 'unrewarded' as const,
      },
    ] as ReinforcementTaskEntry[],
    availableYears: ['2026'] as string[],
    selectedYear: null as string | null,
    tasksLoading: false,
    tasksError: null as string | null,
    draft: {
      taskId: '',
      feedbackType: 'none',
      starRating: null,
      comment: '',
    } as FeedbackDraft,
    submitState: { status: 'idle' } as SubmitState,
    canSubmit: false,
    onSelectYear: vi.fn(),
    onSelectTask: vi.fn(),
    onSelectFeedbackType: vi.fn(),
    onSelectStarRating: vi.fn(),
    onChangeComment: vi.fn(),
    onSubmit: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

describe('FeedbackPanel', () => {
  it('renders empty state when no active context pack', () => {
    render(<FeedbackPanel {...defaultProps({ hasActiveContextPack: false })} />);
    expect(screen.getByTestId('feedback-empty-state')).toBeTruthy();
  });

  it('renders task picker when active context pack exists', () => {
    render(<FeedbackPanel {...defaultProps()} />);
    expect(screen.getByTestId('task-picker')).toBeTruthy();
  });

  it('shows feedback form after selecting a task', () => {
    const draft: FeedbackDraft = {
      taskId: 'task-1',
      feedbackType: 'none',
      starRating: null,
      comment: '',
    };
    render(<FeedbackPanel {...defaultProps({ draft })} />);
    expect(screen.getByTestId('feedback-form')).toBeTruthy();
  });

  it('calls onSelectFeedbackType when type button clicked', () => {
    const onSelectFeedbackType = vi.fn();
    const draft: FeedbackDraft = {
      taskId: 'task-1',
      feedbackType: 'none',
      starRating: null,
      comment: '',
    };
    render(
      <FeedbackPanel {...defaultProps({ draft, onSelectFeedbackType })} />,
    );

    fireEvent.click(screen.getByTestId('feedback-type-positive'));

    expect(onSelectFeedbackType).toHaveBeenCalledWith('positive');
  });

  it('calls onSelectStarRating when star clicked', () => {
    const onSelectStarRating = vi.fn();
    const draft: FeedbackDraft = {
      taskId: 'task-1',
      feedbackType: 'positive',
      starRating: null,
      comment: '',
    };
    render(
      <FeedbackPanel {...defaultProps({ draft, onSelectStarRating })} />,
    );

    fireEvent.click(screen.getByTestId('star-3'));

    expect(onSelectStarRating).toHaveBeenCalledWith(3);
  });

  it('shows success state after submission', () => {
    const submitState: SubmitState = {
      status: 'success',
      message: 'Feedback recorded.',
    };
    render(<FeedbackPanel {...defaultProps({ submitState })} />);
    expect(screen.getByTestId('feedback-success')).toBeTruthy();
  });

  it('shows success with settlement info', () => {
    const submitState: SubmitState = {
      status: 'success',
      message: 'Feedback recorded. Settlement triggered — reward memory updated.',
      settlement: true,
    };
    render(<FeedbackPanel {...defaultProps({ submitState })} />);
    expect(screen.getByTestId('feedback-success')).toBeTruthy();
    expect(
      screen.getByText(
        'Feedback recorded. Settlement triggered — reward memory updated.',
      ),
    ).toBeTruthy();
  });

  it('shows error state', () => {
    const submitState: SubmitState = {
      status: 'error',
      message: 'Failed.',
    };
    const draft: FeedbackDraft = {
      taskId: 'task-1',
      feedbackType: 'positive',
      starRating: null,
      comment: '',
    };
    render(<FeedbackPanel {...defaultProps({ submitState, draft })} />);
    const errorEl = screen.getByTestId('feedback-error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toBe('Failed.');
  });

  it('shows task picker empty state when no tasks', () => {
    render(<FeedbackPanel {...defaultProps({ tasks: [] })} />);
    expect(screen.getByTestId('task-picker-empty')).toBeTruthy();
  });

  it('year filter select appears when multiple years available', () => {
    render(
      <FeedbackPanel
        {...defaultProps({ availableYears: ['2026', '2025'] })}
      />,
    );
    expect(screen.getByTestId('task-picker-year-select')).toBeTruthy();
  });

  it('surfaces task-load error from IPC', () => {
    render(
      <FeedbackPanel {...defaultProps({ tasksError: 'Failed to load tasks.' })} />,
    );
    expect(screen.getByTestId('feedback-tasks-error').textContent).toBe('Failed to load tasks.');
  });
});
