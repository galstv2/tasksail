// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockClient } from '../../test';

import { useFeedbackSubmission } from './useFeedbackSubmission';

describe('useFeedbackSubmission', () => {
  it('starts with empty draft and idle state', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    expect(result.current.draft).toEqual({
      taskId: '',
      feedbackType: 'none',
      starRating: null,
      comment: '',
    });
    expect(result.current.submitState).toEqual({ status: 'idle' });
  });

  it('onSelectTask updates taskId and resets submitState to idle', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectTask('T-1');
    });

    expect(result.current.draft.taskId).toBe('T-1');
    expect(result.current.submitState).toEqual({ status: 'idle' });
  });

  it('onSelectFeedbackType updates feedbackType', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectFeedbackType('negative');
    });

    expect(result.current.draft.feedbackType).toBe('negative');
  });

  it('onSelectStarRating updates starRating', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectStarRating(3);
    });

    expect(result.current.draft.starRating).toBe(3);
  });

  it('onChangeComment updates comment', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onChangeComment('Great work');
    });

    expect(result.current.draft.comment).toBe('Great work');
  });

  it('canSubmit is false when taskId is empty', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    expect(result.current.canSubmit).toBe(false);
  });

  it('canSubmit is true when taskId is set', () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectTask('T-1');
    });

    expect(result.current.canSubmit).toBe(true);
  });

  it('onSubmit sends payload and sets success', async () => {
    const client = createMockClient({
      submitReinforcementFeedback: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'reinforcement.submitFeedback', data: {} },
      }),
    });
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectTask('T-1');
    });

    await act(async () => {
      await result.current.onSubmit('/ctx');
    });

    await waitFor(() => {
      expect(result.current.submitState.status).toBe('success');
    });
  });

  it('onSubmit detects settlement in response', async () => {
    const client = createMockClient({
      submitReinforcementFeedback: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.submitFeedback',
          data: { settlement: true },
        },
      }),
    });
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectTask('T-1');
    });

    await act(async () => {
      await result.current.onSubmit('/ctx');
    });

    await waitFor(() => {
      expect(result.current.submitState.status).toBe('success');
    });
    expect(
      result.current.submitState.status === 'success' && result.current.submitState.settlement,
    ).toBe(true);
  });

  it('onSubmit sets error on failure', async () => {
    const client = createMockClient({
      submitReinforcementFeedback: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Failed',
      }),
    });
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectTask('T-1');
    });

    await act(async () => {
      await result.current.onSubmit('/ctx');
    });

    await waitFor(() => {
      expect(result.current.submitState.status).toBe('error');
    });
  });

  it('onReset clears draft and submitState', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useFeedbackSubmission(client));

    act(() => {
      result.current.onSelectTask('T-1');
      result.current.onSelectFeedbackType('negative');
      result.current.onSelectStarRating(4);
      result.current.onChangeComment('A comment');
    });

    act(() => {
      result.current.onReset();
    });

    expect(result.current.draft).toEqual({
      taskId: '',
      feedbackType: 'none',
      starRating: null,
      comment: '',
    });
    expect(result.current.submitState).toEqual({ status: 'idle' });
  });
});
