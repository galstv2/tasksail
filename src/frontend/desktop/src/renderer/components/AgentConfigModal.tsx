import { useCallback, useEffect } from 'react';

import type { AgentConfigModalProps } from '../hooks/useAgentConfigModal';
import ConfirmOverlay from './ConfirmOverlay';
import { CloseIcon } from './creation-steps/icons';
import { agentSpriteMap } from './sprites';

function AgentConfigModal(props: AgentConfigModalProps): JSX.Element | null {
  const {
    isOpen,
    isLoading,
    activeTab,
    agents,
    models,
    newModelDisplayName,
    newModelId,
    removingModelId,
    saving,
    error,
    isDirty,
    showRestartNotice,
    pendingModelChange,
    onClose,
    onSelectTab,
    onAgentModelChange,
    onConfirmModelChange,
    onCancelModelChange,
    onNewModelDisplayNameChange,
    onNewModelIdChange,
    onAddModel,
    onRemoveModel,
    onConfirmRemoveModel,
    onCancelRemoveModel,
    onSave,
  } = props;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, isOpen]);

  if (!isOpen) {
    return null;
  }

  const removingModel = removingModelId
    ? models.find((m) => m.model_id === removingModelId)
    : null;

  return (
    <div className="mcp-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="mcp-modal agent-config"
        role="dialog"
        aria-modal="true"
        aria-label="Agent Configuration"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mcp-modal__header">
          <div className="agent-config__header-main">
            <h2 className="mcp-modal__title">Agent Configuration</h2>
            <div className="agent-config__tabs" role="tablist" aria-label="Agent configuration tabs">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'agents'}
                className={`agent-config__tab${activeTab === 'agents' ? ' agent-config__tab--active' : ''}`}
                onClick={() => onSelectTab('agents')}
              >
                Agents
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'models'}
                className={`agent-config__tab${activeTab === 'models' ? ' agent-config__tab--active' : ''}`}
                onClick={() => onSelectTab('models')}
              >
                Models
              </button>
            </div>
          </div>
          <button type="button" className="mcp-modal__close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="mcp-modal__body agent-config__body">
          {error && (
            <div className="mcp-modal__error" role="alert">
              {error}
            </div>
          )}
          {isLoading ? (
            <div className="agent-config__loading">Loading agent configuration…</div>
          ) : activeTab === 'agents' ? (
            <ul className="agent-config__agent-list">
              {agents.map((agent) => {
                const SpriteComponent = agentSpriteMap[agent.agent_id as keyof typeof agentSpriteMap];
                return (
                <li key={agent.agent_id} className="agent-config__agent-row">
                  {SpriteComponent && (
                    <div className="agent-config__sprite" aria-hidden="true">
                      <SpriteComponent size={36} />
                    </div>
                  )}
                  <div className="agent-config__agent-header">
                    <span className="agent-config__agent-name">{agent.human_name}</span>
                    <span className="mcp-modal__badge">{agent.role_name}</span>
                  </div>
                  <label className="agent-config__field">
                    <span className="agent-config__sr-only">{agent.human_name} model</span>
                    <select
                      className="mcp-form__select"
                      value={agent.selected_model}
                      onChange={(event) => onAgentModelChange(agent.agent_id, event.target.value)}
                      aria-label={`${agent.human_name} model`}
                    >
                      {agent.options.map((option) => (
                        <option key={option.model_id} value={option.model_id}>
                          {option.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {agent.currentModelMissing && (
                    <div className="agent-config__warning" role="status">
                      Current assignment "{agent.current_model}" is missing from the catalog.
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          ) : (
            <>
              <p className="agent-config__intro">
                These are the LLM models available to all agents. Display Name is what you see
                in dropdowns. Model ID is the exact identifier the pipeline sends to Copilot.
              </p>
              {models.length === 0 ? (
                <div className="agent-config__empty">No models available yet.</div>
              ) : (
                <ul className="agent-config__model-list">
                  {models.map((model) => {
                    const disabled = model.inUseBy.length > 0;
                    const usageLabel = `${model.usageCount} agent${model.usageCount === 1 ? '' : 's'}`;

                    return (
                      <li key={model.model_id} className="agent-config__model-row">
                        <div className="agent-config__model-display">{model.display_name}</div>
                        <div className="agent-config__model-id">{model.model_id}</div>
                        <span className="mcp-modal__badge">{usageLabel}</span>
                        <button
                          type="button"
                          className="mcp-modal__btn mcp-modal__btn--danger"
                          disabled={disabled}
                          title={disabled ? `In use by ${model.inUseBy.join(', ')}` : 'Remove model'}
                          onClick={() => onRemoveModel(model.model_id)}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="agent-config__model-form">
                <div className="mcp-form__row">
                  <label className="mcp-form__field mcp-form__field--grow">
                    <span className="mcp-form__label">Display Name</span>
                    <input
                      className="mcp-form__input"
                      placeholder="e.g. GPT 4.1"
                      value={newModelDisplayName}
                      onChange={(event) => onNewModelDisplayNameChange(event.target.value)}
                    />
                  </label>
                  <label className="mcp-form__field mcp-form__field--grow">
                    <span className="mcp-form__label">Model ID</span>
                    <input
                      className="mcp-form__input"
                      placeholder="e.g. gpt-4.1"
                      value={newModelId}
                      onChange={(event) => onNewModelIdChange(event.target.value)}
                    />
                  </label>
                  <div className="agent-config__model-actions">
                    <button
                      type="button"
                      className="mcp-modal__btn mcp-modal__btn--primary"
                      disabled={saving}
                      onClick={() => void onAddModel()}
                    >
                      Add
                    </button>
                  </div>
                </div>
                <p className="mcp-form__hint">Models in use by agents cannot be removed.</p>
              </div>
            </>
          )}
        </div>

        <footer className="mcp-modal__footer">
          <span className="mcp-modal__footer-esc">ESC to close</span>
          <div className="agent-config__footer-meta">
            {showRestartNotice && (
              <span className="agent-config__restart-notice">
                Restart TaskSail for the planner model change to take effect.
              </span>
            )}
            {activeTab === 'agents' && (
              <button
                type="button"
                className="mcp-modal__btn mcp-modal__btn--primary"
                onClick={() => void onSave()}
                disabled={!isDirty || saving}
              >
                Save Changes
              </button>
            )}
          </div>
        </footer>

        <ConfirmOverlay
          visible={pendingModelChange !== null}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ background: 'color-mix(in srgb, var(--ts-accent) 12%, transparent)', borderRadius: '50%', padding: 6 }}>
              <path d="M7 16l-4-4 4-4" stroke="var(--ts-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 12h14" stroke="var(--ts-accent)" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M17 8l4 4-4 4" stroke="var(--ts-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12H7" stroke="var(--ts-accent)" strokeWidth="1.6" strokeLinecap="round" opacity="0.3" />
            </svg>
          }
          title="Change model assignment?"
          body={pendingModelChange ? (
            <>
              Switch <strong>{pendingModelChange.agentName}</strong> from{' '}
              <span className="agent-config__confirm-model">{pendingModelChange.fromModel}</span>{' '}
              to{' '}
              <span className="agent-config__confirm-model">{pendingModelChange.toModel}</span>
            </>
          ) : null}
          cancelLabel="Cancel"
          confirmLabel="Confirm"
          confirmVariant="primary"
          onCancel={onCancelModelChange}
          onConfirm={onConfirmModelChange}
        />

        <ConfirmOverlay
          visible={removingModelId !== null}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ background: 'color-mix(in srgb, var(--ts-error) 12%, transparent)', borderRadius: '50%', padding: 6 }}>
              <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="var(--ts-error)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 11v6M14 11v6" stroke="var(--ts-error)" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          }
          title="Remove model?"
          body={removingModel
            ? <>Remove <strong>{removingModel.display_name}</strong> (<span className="agent-config__confirm-model">{removingModel.model_id}</span>) from the catalog? This cannot be undone.</>
            : <>Remove this model from the catalog? This cannot be undone.</>}
          cancelLabel="Keep Model"
          confirmLabel="Remove"
          confirmVariant="danger"
          autoFocusCancel
          onCancel={onCancelRemoveModel}
          onConfirm={() => removingModelId && void onConfirmRemoveModel(removingModelId)}
        />
      </div>
    </div>
  );
}

export default AgentConfigModal;
