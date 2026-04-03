import { useCallback, useEffect } from 'react';

import { namedWorkflowAgentRoster } from '../../shared/agentRoster';
import type { McpConfigModalProps } from '../hooks/useMcpConfigModal';
import McpServerForm from './McpServerForm';

const TOTAL_AGENTS = Object.keys(namedWorkflowAgentRoster).length;

function agentScopeBadge(count: number): string {
  if (count >= TOTAL_AGENTS) return 'all agents';
  return `${count} agent${count !== 1 ? 's' : ''}`;
}

function McpConfigModal(props: McpConfigModalProps): JSX.Element | null {
  const {
    isOpen,
    view,
    servers,
    error,
    removingServerId,
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
            &times;
          </button>
        </header>

        <div className="mcp-modal__body">
          {view === 'form' ? (
            <McpServerForm
              draft={props.draft}
              editingServerId={props.editingServerId}
              connectionValidation={props.connectionValidation}
              fieldErrors={props.fieldErrors}
              saving={props.saving}
              saveEnabled={props.saveEnabled}
              error={error}
              onDraftChange={props.onDraftChange}
              onValidateConnection={props.onValidateConnection}
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
                            {agentScopeBadge(server.agent_scope.agent_ids.length)}
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
