import type { ReinforcementTaskEntry } from '../../../shared/desktopContract';
import type { FeedbackDraft, FeedbackType, SubmitState } from '../../hooks/useFeedbackSubmission';
import TaskPicker from './TaskPicker';

type FeedbackPanelProps = {
  hasActiveContextPack: boolean;
  tasks: ReinforcementTaskEntry[];
  availableYears: string[];
  selectedYear: string | null;
  tasksLoading: boolean;
  tasksError: string | null;
  draft: FeedbackDraft;
  submitState: SubmitState;
  canSubmit: boolean;
  onSelectYear: (year: string | null) => void;
  onSelectTask: (taskId: string) => void;
  onSelectFeedbackType: (type: FeedbackType) => void;
  onSelectStarRating: (rating: number | null) => void;
  onChangeComment: (comment: string) => void;
  onSubmit: () => void;
  onReset: () => void;
};

const FEEDPMCK_TYPES: { value: FeedbackType; label: string }[] = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'none', label: 'Neutral' },
];

const STAR_OPTIONS = [1, 2, 3, 4, 5];

function FeedbackPanel({
  hasActiveContextPack,
  tasks,
  availableYears,
  selectedYear,
  tasksLoading,
  tasksError,
  draft,
  submitState,
  canSubmit,
  onSelectYear,
  onSelectTask,
  onSelectFeedbackType,
  onSelectStarRating,
  onChangeComment,
  onSubmit,
  onReset,
}: FeedbackPanelProps): JSX.Element {
  if (!hasActiveContextPack) {
    return (
      <div className="feedback-panel" data-testid="feedback-panel">
        <p className="feedback-panel__empty" data-testid="feedback-empty-state">
          Activate a context pack to submit feedback.
        </p>
      </div>
    );
  }

  if (submitState.status === 'success') {
    return (
      <div className="feedback-panel" data-testid="feedback-panel">
        <div className="feedback-panel__success" data-testid="feedback-success">
          <p>{submitState.message}</p>
          <button
            type="button"
            className="action-button"
            onClick={onReset}
            data-testid="feedback-reset-btn"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-panel" data-testid="feedback-panel">
      {tasksError && (
        <p className="feedback-panel__error" data-testid="feedback-tasks-error">
          {tasksError}
        </p>
      )}
      <TaskPicker
        tasks={tasks}
        availableYears={availableYears}
        selectedYear={selectedYear}
        selectedTaskId={draft.taskId}
        loading={tasksLoading}
        onSelectYear={onSelectYear}
        onSelectTask={onSelectTask}
      />

      {draft.taskId && (
        <div className="feedback-panel__form" data-testid="feedback-form">
          <div className="feedback-panel__type-group">
            <label className="feedback-panel__label">Feedback</label>
            <div className="feedback-panel__type-buttons" role="radiogroup" aria-label="Feedback type">
              {FEEDPMCK_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`feedback-type-btn ${draft.feedbackType === value ? 'feedback-type-btn--active' : ''}`}
                  onClick={() => onSelectFeedbackType(value)}
                  aria-pressed={draft.feedbackType === value}
                  data-testid={`feedback-type-${value}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="feedback-panel__stars">
            <label className="feedback-panel__label">Rating (optional)</label>
            <div className="feedback-panel__star-row" role="radiogroup" aria-label="Star rating">
              {STAR_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`star-btn ${draft.starRating !== null && n <= draft.starRating ? 'star-btn--filled' : ''}`}
                  onClick={() => onSelectStarRating(draft.starRating === n ? null : n)}
                  aria-label={`${n} star${n !== 1 ? 's' : ''}`}
                  aria-pressed={draft.starRating === n}
                  data-testid={`star-${n}`}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 1l2 4h4l-3.2 2.8L12 13 8 10.2 4 13l1.2-5.2L2 5h4l2-4z"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                      fill={draft.starRating !== null && n <= draft.starRating ? 'currentColor' : 'none'}
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          <div className="feedback-panel__comment">
            <label className="feedback-panel__label" htmlFor="feedback-comment">
              Comment (optional)
            </label>
            <textarea
              id="feedback-comment"
              className="feedback-panel__textarea"
              rows={3}
              value={draft.comment}
              onChange={(e) => onChangeComment(e.target.value)}
              placeholder="What went well or what needs improvement?"
              data-testid="feedback-comment"
            />
          </div>

          {submitState.status === 'error' && (
            <p className="feedback-panel__error" data-testid="feedback-error">
              {submitState.message}
            </p>
          )}

          <div className="feedback-panel__actions">
            <button
              type="button"
              className="action-button action-button--primary"
              disabled={!canSubmit}
              onClick={onSubmit}
              data-testid="feedback-submit-btn"
            >
              {submitState.status === 'submitting' ? 'Submitting\u2026' : 'Submit Feedback'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FeedbackPanel;
