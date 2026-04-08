type SailScreenProps = {
  sailPhase: 'countdown' | 'sailing';
  countdown: number;
};

function SailScreen({ sailPhase, countdown }: SailScreenProps): JSX.Element {
  return (
    <div className="sail-overlay" role="presentation">
      <div className="sail-pill" role="dialog" aria-modal="true" aria-label="Submitting task" aria-live="polite">
        {sailPhase === 'countdown' ? (
          <div className="sail-countdown" key={countdown}>
            <span className="sail-countdown__number">{countdown}</span>
            <span className="sail-countdown__ring" />
          </div>
        ) : (
          <div className="sail-away">
            <svg className="sail-away__boat" width="28" height="28" viewBox="0 0 36 36" fill="none">
              <path d="M18 5v22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M18 6l10 13H18Z" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M18 9l-6 10h6Z" fill="currentColor" opacity="0.06" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M10 27c0 3 4 5 8 5s8-2 8-5Z" fill="currentColor" opacity="0.08" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            <span className="sail-away__label">Sailing away</span>
            <span className="sail-away__dots">
              <span className="sail-away__dot" />
              <span className="sail-away__dot" />
              <span className="sail-away__dot" />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default SailScreen;
