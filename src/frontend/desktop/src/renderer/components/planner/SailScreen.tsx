/**
 * SailScreen — Minimal "Submitted" confirmation card.
 *
 * Renders a frosted-glass pill with an animated checkmark and "Submitted"
 * label. Fades in, holds briefly, then fades out on its own.
 * Apple HIG-inspired confirmation moment.
 */

type SailScreenProps = {
  /** When true the exit fade-out class is applied. */
  exiting: boolean;
};

function SailScreen({ exiting }: SailScreenProps): JSX.Element {
  return (
    <div
      className={`sail-overlay${exiting ? ' sail-overlay--exit' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Task submitted"
    >
      <div className="sail-pill">
        {/* ── Animated checkmark circle ──────────────────────────────────── */}
        <svg
          className="sail-check"
          width="36"
          height="36"
          viewBox="0 0 36 36"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="sail-check__ring"
            cx="18"
            cy="18"
            r="15"
            stroke="var(--ts-success)"
            strokeWidth="1.6"
            fill="none"
          />
          <path
            className="sail-check__mark"
            d="M11.5 18.5 L16 23 L25 13"
            stroke="var(--ts-success)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>

        <span className="sail-label">Submitted</span>
      </div>
    </div>
  );
}

export default SailScreen;
