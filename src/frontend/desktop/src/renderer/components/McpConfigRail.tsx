export type McpConfigRailProps = {
  enabledCount: number;
  onClick: () => void;
};

function McpConfigRail({ enabledCount, onClick }: McpConfigRailProps): JSX.Element {
  return (
    <aside className="mcp-rail" aria-label="MCP config">
      <button
        type="button"
        className="mcp-rail__btn"
        onClick={onClick}
        aria-label="Open MCP configuration"
        title="External MCP Servers"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 4.5h4M8 4.5l2.2 2.4M6 11.5h4M6 11.5L3.8 9.1"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="3.5" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="12.5" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="4.5" cy="11.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        {enabledCount > 0 && (
          <span className="mcp-rail__pmdge">{enabledCount}</span>
        )}
      </button>
    </aside>
  );
}

export default McpConfigRail;
