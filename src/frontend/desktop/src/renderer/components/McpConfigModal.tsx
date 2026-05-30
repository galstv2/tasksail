import { useCallback, useEffect } from 'react';

import type { McpConfigModalProps } from '../hooks/useMcpConfigModal';
import { CloseIcon } from './creation-steps/icons';
import McpServerForm from './McpServerForm';

function agentScopeBadge(count: number, totalAgents: number): string {
  if (totalAgents > 0 && count >= totalAgents) return 'all agents';
  return `${count} agent${count !== 1 ? 's' : ''}`;
}

function McpConfigModal(props: McpConfigModalProps): JSX.Element | null {
  const {
    isOpen,
    view,
    servers,
    error,
    removingServerId,
    agentRoster = {},
    onClose,
    onToggleEnabled,
    onRemove,
    onConfirmRemove,
    onCancelRemove,
    onEdit,
    onAdd,
  } = props;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const title = view === 'form'
    ? (props.editingServerId ? 'Edit MCP Server' : 'Add MCP Server')
    : 'External MCP Servers';

  return (
    <div
      className="mcp-modal__overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="mcp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mcp-modal__header">
          <h2 className="mcp-modal__title">{title}</h2>
          <button
            type="button"
            className="mcp-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="mcp-modal__body">
          <div className="mcp-modal__vetting-notice" role="status">
            You are responsible for vetting every external MCP server you configure. Local servers run as child processes with the agent&apos;s OS permissions; remote servers receive any headers and environment you configure. Review a server before enabling it, and have agents corroborate its output.
          </div>
          {view === 'form' ? (
            <McpServerForm
              draft={props.draft}
              editingServerId={props.editingServerId}
              connectionValidation={props.connectionValidation}
              localEnabled={props.localEnabled}
              localCommandCheck={props.localCommandCheck}
              fieldErrors={props.fieldErrors}
              saving={props.saving}
              saveEnabled={props.saveEnabled}
              agentRoster={agentRoster}
              error={error}
              onDraftChange={props.onDraftChange}
              onValidateConnection={props.onValidateConnection}
              onCheckLocalCommand={props.onCheckLocalCommand}
              onSave={props.onSave}
              onCancel={props.onCancel}
            />
          ) : (
            <>
              {error && (
                <div className="mcp-modal__error" role="alert">
                  {error}
                </div>
              )}
              {servers.length === 0 ? (
                <div className="mcp-modal__empty">
                  <p>No external MCP servers configured.</p>
                  <button
                    type="button"
                    className="mcp-modal__btn mcp-modal__btn--primary"
                    onClick={onAdd}
                  >
                    Add Server
                  </button>
                </div>
              ) : (
                <ul className="mcp-modal__list">
                  {servers.map((server) => (
                    <li key={server.id} className="mcp-modal__item">
                      <div className="mcp-modal__item-info">
                        <span className="mcp-modal__item-name">
                          {server.display_name}
                        </span>
                        <span className="mcp-modal__item-pmdges">
                          <span className="mcp-modal__pmdge">{server.transport}</span>
                          <span className="mcp-modal__pmdge">
                            {agentScopeBadge(server.agent_scope.agent_ids.length, Object.keys(agentRoster).length)}
                          </span>
                        </span>
                      </div>
                      <div className="mcp-modal__item-actions">
                        {removingServerId === server.id ? (
                          <span className="mcp-modal__confirm-remove">
                            <span>Remove?</span>
                            <button
                              type="button"
                              className="mcp-modal__btn mcp-modal__btn--danger"
                              onClick={() => onConfirmRemove(server.id)}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="mcp-modal__btn"
                              onClick={onCancelRemove}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <>
                            <label className="mcp-modal__toggle">
                              <input
                                type="checkbox"
                                checked={server.enabled}
                                onChange={() => onToggleEnabled(server.id)}
                              />
                              <span className="mcp-modal__toggle-label">
                                {server.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                            </label>
                            <button
                              type="button"
                              className="mcp-modal__btn"
                              onClick={() => onEdit(server.id)}
                              aria-label={`Edit ${server.display_name}`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="mcp-modal__btn mcp-modal__btn--danger"
                              onClick={() => onRemove(server.id)}
                              aria-label={`Remove ${server.display_name}`}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <footer className="mcp-modal__footer">
          <span className="mcp-modal__footer-esc">ESC to close</span>
          {view === 'list' && servers.length > 0 && (
            <button
              type="button"
              className="mcp-modal__btn mcp-modal__btn--primary"
              onClick={onAdd}
            >
              Add Server
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default McpConfigModal;
