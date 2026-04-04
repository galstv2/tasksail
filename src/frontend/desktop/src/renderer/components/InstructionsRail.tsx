export type InstructionsRailProps = {
  onClick: () => void;
};

function InstructionsRail({ onClick }: InstructionsRailProps): JSX.Element {
  return (
    <button
      type="button"
      className="config-rail__btn"
      onClick={onClick}
      aria-label="Open platform instructions"
      title="Platform Instructions"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 8.5l3-3 1 1-3 3H6.5v-1z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default InstructionsRail;
