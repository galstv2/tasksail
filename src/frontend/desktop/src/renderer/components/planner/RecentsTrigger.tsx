import { forwardRef } from 'react';

export interface RecentsTriggerProps {
  count: number;
  loading: boolean;
  replayInFlight: boolean;
  replayingTitle: string | null;
  popoverOpen: boolean;
  onToggle: () => void;
  /** When true the trigger is rendered but non-interactive (e.g. once a planning
   *  conversation has started — switching away would drop the active session). */
  disabled?: boolean;
  /** Tooltip shown when `disabled` is true, explaining why the control is locked. */
  disabledHint?: string;
}

const REPLAY_TITLE_TRUNCATE = 18;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export const RecentsTrigger = forwardRef<HTMLButtonElement, RecentsTriggerProps>(
  function RecentsTrigger(props, ref) {
    const { count, loading, replayInFlight, replayingTitle, popoverOpen, onToggle, disabled, disabledHint } = props;

    if (count === 0 && !loading) {
      return null;
    }

    if (loading && count === 0) {
      return (
        <span
          className="recents-trigger recents-trigger--skeleton"
          aria-hidden="true"
          data-testid="recents-trigger-skeleton"
        />
      );
    }

    if (replayInFlight && replayingTitle) {
      const truncated = truncate(replayingTitle, REPLAY_TITLE_TRUNCATE);
      return (
        <button
          ref={ref}
          type="button"
          className="recents-trigger recents-trigger--replaying"
          aria-busy="true"
          aria-label={`Replaying ${replayingTitle}`}
          aria-haspopup="listbox"
          aria-expanded={popoverOpen}
          aria-controls="recents-listbox"
          tabIndex={-1}
        >
          <span className="recents-trigger__label">
            Replaying &ldquo;{truncated}&rdquo;
          </span>
        </button>
      );
    }

    const baseClass = popoverOpen
      ? 'recents-trigger recents-trigger--open'
      : 'recents-trigger';
    const className = disabled ? `${baseClass} recents-trigger--disabled` : baseClass;

    return (
      <button
        ref={ref}
        type="button"
        className={className}
        aria-haspopup="listbox"
        aria-expanded={popoverOpen}
        aria-controls="recents-listbox"
        aria-label={`Recent conversations, ${count} available`}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onClick={disabled ? undefined : onToggle}
      >
        <span className="recents-trigger__label">Recent Task</span>
      </button>
    );
  },
);

export default RecentsTrigger;
