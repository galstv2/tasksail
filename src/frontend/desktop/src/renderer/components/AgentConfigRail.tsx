export type AgentConfigRailProps = {
  onClick: () => void;
};

function AgentConfigRail({ onClick }: AgentConfigRailProps): JSX.Element {
  return (
    <button
      type="button"
      className="config-rail__btn"
      onClick={onClick}
      aria-label="Open agent configuration"
      title="Agent Configuration"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="6" cy="5" r="2.1" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.8 11.7c.4-1.6 1.8-2.7 3.6-2.7 1.7 0 3.1 1.1 3.5 2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="11.3" cy="6.2" r="1.7" stroke="currentColor" strokeWidth="1.2" opacity="0.78" />
        <path d="M9.8 12.1c.3-1.2 1.4-2 2.7-2 .6 0 1.2.2 1.7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.78" />
      </svg>
    </button>
  );
}

export default AgentConfigRail;
