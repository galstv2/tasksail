import { useCallback, useRef, useState } from 'react';

import type { ReinforcementSubmitFeedbackRequest } from '../../../shared/desktopContract';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import { desktopShellClient } from '../../services/desktopShellClient';

export type FeedbackType = ReinforcementSubmitFeedbackRequest['payload']['feedbackType'];

export type FeedbackDraft = {
  taskId: string;
  feedbackType: FeedbackType;
  starRating: number | null;
  comment: string;
};

export type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; message: string; settlement?: boolean }
  | { status: 'error'; message: string };

export type SubmitOutcome = {
  taskId: string;
  data?: Record<string, unknown>;
};

export type UseFeedbackSubmissionResult = {
  draft: FeedbackDraft;
  submitState: SubmitState;
  onSelectTask: (taskId: string) => void;
  onSelectFeedbackType: (type: FeedbackType) => void;
  onSelectStarRating: (rating: number | null) => void;
  onChangeComment: (comment: string) => void;
  onSubmit: (contextPackDir: string) => Promise<SubmitOutcome | null>;
  onReset: () => void;
  canSubmit: boolean;
};

function emptyDraft(): FeedbackDraft {
  return { taskId: '', feedbackType: 'none', starRating: null, comment: '' };
}

function submitErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Feedback submission failed.';
}

export function useFeedbackSubmission(
  client: DesktopShellClient = desktopShellClient,
): UseFeedbackSubmissionResult {
  const [draft, setDraft] = useState<FeedbackDraft>(emptyDraft());
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  const onSelectTask = useCallback((taskId: string) => {
    setDraft((prev) => ({ ...prev, taskId }));
    setSubmitState({ status: 'idle' });
  }, []);

  const onSelectFeedbackType = useCallback((feedbackType: FeedbackType) => {
    setDraft((prev) => ({ ...prev, feedbackType }));
  }, []);

  const onSelectStarRating = useCallback((starRating: number | null) => {
    setDraft((prev) => ({ ...prev, starRating }));
  }, []);

  const onChangeComment = useCallback((comment: string) => {
    setDraft((prev) => ({ ...prev, comment }));
  }, []);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const onSubmit = useCallback(
    async (contextPackDir: string) => {
      const d = draftRef.current;
      if (!d.taskId) return null;
      setSubmitState({ status: 'submitting' });
      try {
        const result = await client.submitReinforcementFeedback({
          contextPackDir,
          taskId: d.taskId,
          feedbackType: d.feedbackType,
          ...(d.starRating !== null ? { starRating: d.starRating } : {}),
          ...(d.comment.trim() ? { comment: d.comment.trim() } : {}),
        });
        if (result.ok && result.response.action === 'reinforcement.submitFeedback') {
          const resp = result.response;
          const settlement = Boolean(resp.data?.settlement);
          const realignmentRecommended = Boolean(resp.data?.realignment_recommended);
          let message = 'Feedback recorded. Operator Rating updated in the task archive.';
          if (settlement) {
            message += ' Settlement triggered — Reward Received section and per-agent reward memory updated.';
          }
          if (realignmentRecommended) {
            message += ' Realignment recommended based on this feedback.';
          }
          setSubmitState({ status: 'success', message, settlement });
          return {
            taskId: d.taskId,
            ...(resp.data ? { data: resp.data } : {}),
          };
        } else {
          setSubmitState({
            status: 'error',
            message: result.ok ? 'Unexpected response.' : result.error,
          });
        }
      } catch (error: unknown) {
        setSubmitState({
          status: 'error',
          message: submitErrorMessage(error),
        });
      }
      return null;
    },
    [client],
  );

  const onReset = useCallback(() => {
    setDraft(emptyDraft());
    setSubmitState({ status: 'idle' });
  }, []);

  const canSubmit =
    draft.taskId.length > 0 &&
    submitState.status !== 'submitting';

  return {
    draft,
    submitState,
    onSelectTask,
    onSelectFeedbackType,
    onSelectStarRating,
    onChangeComment,
    onSubmit,
    onReset,
    canSubmit,
  };
}
