import { useState } from 'react';

import {
  TAB_ORDER,
  TAB_LABELS,
  isDraftDirty,
  type AgentInstructionsBrowserProps,
  type InstructionsTab,
} from '../hooks/useAgentInstructionsModal';
import { classNames } from '../utils/classNames';

import '../styles/agentInstructions.css';

const TAB_ICONS: Record<InstructionsTab, JSX.Element> = {
  profiles: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 14c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  instructions: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  prompts: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 6l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  templates: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6h12M6 6v8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
};

const BROWSER_MODAL_STYLE = {
  width: 'min(720px, 100%)',
  height: 'min(82vh, 680px)',
  maxHeight: 'min(82vh, 680px)',
} as const;

function AgentInstructionsBrowser(props: AgentInstructionsBrowserProps): JSX.Element | null {
  const {
    isOpen,
    isLoading,
    files,
    draftsByPath,
    error,
    loadingPath,
    onClose,
    onSelectFile,
  } = props;

  const [activeTab, setActiveTab] = useState<InstructionsTab>('profiles');

  if (!isOpen) return null;

  const totalCount = TAB_ORDER.reduce((sum, tab) => sum + files[tab].length, 0);
  const activeFiles = files[activeTab];

  return (
    <div className="mcp-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="mcp-modal instructions-browser"
        style={BROWSER_MODAL_STYLE}
        role="dialog"
        aria-label="Platform Instructions"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mcp-modal__header">
          <div className="instructions-browser__header-main">
            <h2 className="mcp-modal__title">Platform Instructions</h2>
            <div className="instructions-browser__tabs" role="tablist" aria-label="Instruction directory tabs">
              {TAB_ORDER.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  className={classNames(
                    'instructions-browser__tab',
                    activeTab === tab && 'instructions-browser__tab--active',
                  )}
                  onClick={() => setActiveTab(tab)}
                >
                  <span className="instructions-browser__tab-icon">{TAB_ICONS[tab]}</span>
                  {TAB_LABELS[tab]}
                  <span className="instructions-browser__tab-count">{files[tab].length}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="mcp-modal__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>

        <div className="mcp-modal__body instructions-browser__body">
          {error && (
            <div className="mcp-modal__error" role="alert">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="instructions-browser__loading">
              <div className="instructions-browser__shimmer-row" />
              <div className="instructions-browser__shimmer-row" />
              <div className="instructions-browser__shimmer-row" />
              <div className="instructions-browser__shimmer-row" style={{ width: '70%' }} />
            </div>
          ) : activeFiles.length === 0 ? (
            <div className="instructions-browser__empty">No files in this directory.</div>
          ) : (
            <div className="instructions-browser__file-list">
              {activeFiles.map((f) => {
                const draft = draftsByPath[f.relativePath];
                const dirty = isDraftDirty(draft);
                const loading = loadingPath === f.relativePath;
                return (
                  <button
                    key={f.relativePath}
                    type="button"
                    className={classNames(
                      'instructions-browser__file-row',
                      loading && 'instructions-browser__file-row--loading',
                    )}
                    onClick={() => void onSelectFile(f.relativePath)}
                  >
                    <svg className="instructions-browser__file-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4.5 2h4.5l3 3v8.5h-7.5V2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="instructions-browser__file-name">{f.fileName}</span>
                    {dirty && <span className="instructions-browser__dirty-indicator">modified</span>}
                    <svg className="instructions-browser__file-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="mcp-modal__footer">
          <span className="mcp-modal__footer-esc">ESC to close</span>
          <span className="instructions-browser__file-count">{totalCount} files</span>
        </footer>
      </div>
    </div>
  );
}

export default AgentInstructionsBrowser;
