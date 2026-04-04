import {
  TAB_ORDER,
  TAB_LABELS,
  isDraftDirty,
  type AgentInstructionsBrowserProps,
} from '../hooks/useAgentInstructionsModal';
import ModalShell from './ModalShell';
import { classNames } from '../utils/classNames';

import '../styles/agentInstructions.css';

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

  const totalCount = TAB_ORDER.reduce((sum, tab) => sum + files[tab].length, 0);

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Platform Instructions"
      maxWidth="680px"
      maxHeight="min(85vh, 800px)"
      escPriority={0}
      footer={<>
        <span className="modal-shell__footer-esc">ESC to close</span>
        <span className="instructions-browser__file-count">{totalCount} files</span>
      </>}
      ariaLabel="Platform Instructions"
    >
      {error && (
        <div className="modal-shell__error" role="alert">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="instructions-browser__loading">
          {TAB_ORDER.map((tab) => (
            <div key={tab} className="instructions-browser__section">
              <div className="instructions-browser__section-header">
                <div className="instructions-browser__shimmer-label" />
              </div>
              <div className="instructions-browser__section-body">
                <div className="instructions-browser__shimmer-row" />
                <div className="instructions-browser__shimmer-row" />
                <div className="instructions-browser__shimmer-row" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="instructions-browser__sections">
          {TAB_ORDER.map((tab) => (
            <div key={tab} className="instructions-browser__section">
              <div className="instructions-browser__section-header">
                <span className="instructions-browser__section-icon">
                  {tab === 'profiles' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M3 14c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  )}
                  {tab === 'instructions' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {tab === 'prompts' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M5 6l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                <span className="instructions-browser__section-title">{TAB_LABELS[tab]}</span>
                <span className="instructions-browser__section-count">{files[tab].length}</span>
              </div>
              <div className="instructions-browser__section-body">
                {files[tab].length === 0 ? (
                  <div className="instructions-browser__empty">No files in this directory.</div>
                ) : (
                  files[tab].map((f) => {
                    const draft = draftsByPath[f.relativePath];
                    const dirty = isDraftDirty(draft);
                    const isLoading = loadingPath === f.relativePath;
                    return (
                      <button
                        key={f.relativePath}
                        type="button"
                        className={classNames(
                          'instructions-browser__file-row',
                          isLoading && 'instructions-browser__file-row--loading',
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
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

export default AgentInstructionsBrowser;
