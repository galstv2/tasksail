import { useCallback, useEffect } from 'react';

import type { AgentConfigModalProps, ExtensionAddForm } from '../hooks/useAgentConfigModal';
import type { AgentExtensionRendererCatalogEntry } from '../../shared/desktopContractAgentConfig';
import ConfirmOverlay from './ConfirmOverlay';
import MultiSelect, { type MultiSelectOption } from './MultiSelect';
import { CloseIcon } from './creation-steps/icons';
import { roleKindSpriteMap } from './sprites';

// ── Internal sub-components ──────────────────────────────────────────────────

type ExtensionRowProps = {
  entry: AgentExtensionRendererCatalogEntry;
  saving: boolean;
  onReseed: (id: string) => void;
  onDelete: (id: string) => void;
};

function ExtensionRow({ entry, saving, onReseed, onDelete }: ExtensionRowProps): JSX.Element {
  return (
    <li className="agent-config__ext-row">
      <div className="agent-config__ext-row-main">
        <span className="agent-config__ext-name">{entry.display_name}</span>
        <span className="agent-config__ext-badges">
          <span className="mcp-modal__badge">{entry.kind === 'skill' ? 'Skill' : 'Plugin'}</span>
          <span className="mcp-modal__badge">{entry.provider_id}</span>
          <span className={`mcp-modal__badge agent-config__ext-status--${entry.status}`}>
            {entry.status}
          </span>
        </span>
      </div>
      {entry.description && (
        <div className="agent-config__ext-desc">{entry.description}</div>
      )}
      <div className="agent-config__ext-meta">
        <span className="agent-config__model-id">source: {entry.source_type}</span>
        {entry.metadata.skill_names && entry.metadata.skill_names.length > 0 && (
          <span className="agent-config__model-id">skills: {entry.metadata.skill_names.join(', ')}</span>
        )}
        {entry.metadata.plugin_skill_count !== undefined && (
          <span className="agent-config__model-id">plugin skills: {entry.metadata.plugin_skill_count}</span>
        )}
      </div>
      <div className="agent-config__ext-actions">
        {entry.source_type !== 'direct-attachment' && (
          <button
            type="button"
            className="mcp-modal__btn"
            disabled={saving}
            onClick={() => onReseed(entry.id)}
          >
            Reseed
          </button>
        )}
        <button
          type="button"
          className="mcp-modal__btn mcp-modal__btn--danger"
          disabled={saving}
          onClick={() => onDelete(entry.id)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

type AddExtensionFormProps = {
  form: ExtensionAddForm;
  saving: boolean;
  onChange: (patch: Partial<ExtensionAddForm>) => void;
  onSubmit: () => void;
};

function AddExtensionForm({ form, saving, onChange, onSubmit }: AddExtensionFormProps): JSX.Element {
  const isDirectPlugin = form.sourceType === 'direct-attachment' && form.kind === 'plugin';

  return (
    <div className="agent-config__model-form">
      <p className="agent-config__intro" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
        Add Extension
      </p>
      <div className="mcp-form__row" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <label className="mcp-form__field">
          <span className="mcp-form__label">ID (slug)</span>
          <input
            className="mcp-form__input"
            placeholder="e.g. my-skill"
            value={form.id}
            onChange={(e) => onChange({ id: e.target.value })}
          />
        </label>
        <label className="mcp-form__field">
          <span className="mcp-form__label">Kind</span>
          <select
            className="mcp-form__select"
            value={form.kind}
            onChange={(e) => onChange({ kind: e.target.value as 'skill' | 'plugin' })}
          >
            <option value="skill">Skill</option>
            <option value="plugin">Plugin</option>
          </select>
        </label>
        <label className="mcp-form__field">
          <span className="mcp-form__label">Source</span>
          <select
            className="mcp-form__select"
            value={form.sourceType}
            onChange={(e) => onChange({ sourceType: e.target.value as ExtensionAddForm['sourceType'] })}
          >
            <option value="git">Git</option>
            <option value="local">Local path</option>
            <option value="direct-attachment">Direct skill attachment</option>
          </select>
        </label>
      </div>

      {form.sourceType === 'git' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.4rem' }}>
          <div className="mcp-form__row">
            <label className="mcp-form__field mcp-form__field--grow">
              <span className="mcp-form__label">Git URL</span>
              <input
                className="mcp-form__input"
                placeholder="https://github.com/org/repo"
                value={form.gitUrl}
                onChange={(e) => onChange({ gitUrl: e.target.value })}
              />
            </label>
            <label className="mcp-form__field">
              <span className="mcp-form__label">Ref</span>
              <input
                className="mcp-form__input"
                placeholder="main"
                value={form.gitRef}
                onChange={(e) => onChange({ gitRef: e.target.value })}
              />
            </label>
          </div>
          <label className="mcp-form__field">
            <span className="mcp-form__label">Subpath (optional)</span>
            <input
              className="mcp-form__input"
              placeholder="e.g. skills/my-skill"
              value={form.gitSubpath}
              onChange={(e) => onChange({ gitSubpath: e.target.value })}
            />
          </label>
        </div>
      )}

      {form.sourceType === 'local' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.4rem' }}>
          <label className="mcp-form__field mcp-form__field--grow">
            <span className="mcp-form__label">Local path</span>
            <input
              className="mcp-form__input"
              placeholder="/absolute/path/to/extension"
              value={form.localPath}
              onChange={(e) => onChange({ localPath: e.target.value })}
            />
          </label>
          <label className="mcp-form__field">
            <span className="mcp-form__label">Subpath (optional)</span>
            <input
              className="mcp-form__input"
              placeholder="e.g. skills/my-skill"
              value={form.localSubpath}
              onChange={(e) => onChange({ localSubpath: e.target.value })}
            />
          </label>
        </div>
      )}

      {form.sourceType === 'direct-attachment' && form.kind === 'skill' && (
        <label className="mcp-form__field" style={{ marginBottom: '0.4rem' }}>
          <span className="mcp-form__label">Skill Markdown (SKILL.md content)</span>
          <textarea
            className="mcp-form__input"
            rows={6}
            placeholder="# My Skill&#10;..."
            value={form.skillMarkdown}
            onChange={(e) => onChange({ skillMarkdown: e.target.value })}
            style={{ resize: 'vertical', fontFamily: 'var(--ts-font-mono)', fontSize: '0.72rem' }}
          />
        </label>
      )}

      {isDirectPlugin && (
        <div className="agent-config__warning" role="status" style={{ marginBottom: '0.4rem' }}>
          Plugin direct attachment is not supported. Plugins require a git or local directory source.
        </div>
      )}

      <div className="agent-config__model-actions">
        <button
          type="button"
          className="mcp-modal__btn mcp-modal__btn--primary"
          disabled={saving || isDirectPlugin}
          onClick={onSubmit}
        >
          Add Extension
        </button>
      </div>
      <p className="mcp-form__hint">
        Extension IDs are stable lowercase slugs (^[a-z0-9][a-z0-9-]{'{'}0,63{'}'})$.
        Plugins require a git or local directory source — direct attachment is skill-only.
      </p>
    </div>
  );
}

// ── Per-agent extension multiselect ─────────────────────────────────────────

type AgentExtensionSelectProps = {
  agentId: string;
  agentName: string;
  extensions: AgentExtensionRendererCatalogEntry[];
  selectedIds: string[];
  onToggle: (agentId: string, extensionId: string, selected: boolean) => void;
};

function AgentExtensionSelect({ agentId, agentName, extensions, selectedIds, onToggle }: AgentExtensionSelectProps): JSX.Element | null {
  if (extensions.length === 0) return null;
  const selectedCount = selectedIds.length;

  const options: MultiSelectOption[] = extensions.map((entry) => {
    const kindLabel = entry.kind === 'skill' ? 'Skill' : 'Plugin';
    return {
      value: entry.id,
      label: entry.display_name,
      trailingLabel: kindLabel,
      optionAriaLabel: `Assign ${entry.display_name} (${kindLabel}) to ${agentName}`,
    };
  });

  return (
    <div className="agent-config__field agent-config__ext-assign">
      <span className="mcp-form__label" aria-hidden="true">
        Extensions{selectedCount > 0 ? ` (${selectedCount} selected)` : ''}
      </span>
      <MultiSelect
        options={options}
        selectedValues={selectedIds}
        onToggle={(value, selected) => onToggle(agentId, value, selected)}
        ariaLabel={`${agentName} extension assignments`}
        triggerAriaLabel={`Select skills and plugins for ${agentName}`}
        placeholder="Select skills & plugins…"
      />
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────

function AgentConfigModal(props: AgentConfigModalProps): JSX.Element | null {
  const {
    isOpen,
    isLoading,
    activeTab,
    agents,
    models,
    extensions,
    extensionAssignments,
    addForm,
    extensionSaving,
    newModelDisplayName,
    newModelId,
    removingModelId,
    saving,
    error,
    isDirty,
    isAssignmentsDirty,
    showRestartNotice,
    effortWarning,
    pendingModelChange,
    descriptor,
    onClose,
    onSelectTab,
    onAgentModelChange,
    onAgentEffortChange,
    onConfirmModelChange,
    onCancelModelChange,
    onNewModelDisplayNameChange,
    onNewModelIdChange,
    onAddModel,
    onRemoveModel,
    onConfirmRemoveModel,
    onCancelRemoveModel,
    onSave,
    onAddFormChange,
    onAddExtension,
    onReseedExtension,
    onDeleteExtension,
    onToggleExtensionAssignment,
    onSaveAssignments,
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
            <div>
              <h2 className="mcp-modal__title">Agent Configuration</h2>
              {descriptor && (
                <div className="agent-config__provider-subtitle">
                  Provider: {descriptor.providerId}
                </div>
              )}
            </div>
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
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'skills-plugins'}
                className={`agent-config__tab${activeTab === 'skills-plugins' ? ' agent-config__tab--active' : ''}`}
                onClick={() => onSelectTab('skills-plugins')}
              >
                Skills &amp; Plugins
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
            <>
              <p className="agent-config__intro">
                Model support for reasoning effort varies. Verify the selected model supports this effort before changing it.
              </p>
              {effortWarning && (
                <div className="agent-config__warning" role="status">
                  {effortWarning}
                </div>
              )}
              <ul className="agent-config__agent-list">
                {agents.map((agent) => {
                  const roleKind = descriptor?.roster.find((entry) => entry.agentId === agent.agent_id)?.roleKind ?? null;
                  const SpriteComponent = roleKind ? roleKindSpriteMap[roleKind] ?? null : null;
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
                      <span className="mcp-form__label" aria-hidden="true">Model</span>
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
                    <label className="agent-config__field">
                      <span className="agent-config__sr-only">{agent.human_name} reasoning effort</span>
                      <span className="mcp-form__label" aria-hidden="true">Reasoning effort</span>
                      <select
                        className="mcp-form__select"
                        value={agent.selected_effort}
                        onChange={(event) => onAgentEffortChange(agent.agent_id, event.target.value)}
                        aria-label={`${agent.human_name} reasoning effort`}
                        disabled={agent.effortDisabled}
                      >
                        {agent.effortOptions.map((effort) => (
                          <option key={effort} value={effort}>
                            {effort === 'none' ? 'None' : effort}
                          </option>
                        ))}
                      </select>
                    </label>
                    {agent.currentModelMissing && (
                      <div className="agent-config__warning" role="status">
                        Current assignment "{agent.current_model}" is missing from the catalog.
                      </div>
                    )}
                    <AgentExtensionSelect
                      agentId={agent.agent_id}
                      agentName={agent.human_name}
                      extensions={extensions}
                      selectedIds={extensionAssignments[agent.agent_id] ?? []}
                      onToggle={onToggleExtensionAssignment}
                    />
                  </li>
                  );
                })}
              </ul>
            </>
          ) : activeTab === 'models' ? (
            <>
              <p className="agent-config__intro">
                These are the LLM models available to all agents. Display Name is what you see
                in dropdowns. Model ID is the exact identifier the pipeline sends to the active agent CLI.
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
          ) : (
            /* Skills & Plugins tab */
            <>
              <p className="agent-config__intro">
                Manage trusted skills and plugins. Assign them to agents in the Agents tab.
                Plugins require a git or local directory source — direct attachment is skill-only.
              </p>
              {extensions.length === 0 ? (
                <div className="agent-config__empty">No extensions added yet.</div>
              ) : (
                <ul className="agent-config__ext-list">
                  {extensions.map((entry) => (
                    <ExtensionRow
                      key={entry.id}
                      entry={entry}
                      saving={extensionSaving}
                      onReseed={onReseedExtension}
                      onDelete={onDeleteExtension}
                    />
                  ))}
                </ul>
              )}
              <AddExtensionForm
                form={addForm}
                saving={extensionSaving}
                onChange={onAddFormChange}
                onSubmit={() => void onAddExtension()}
              />
            </>
          )}
        </div>

        <footer className="mcp-modal__footer">
          <span className="mcp-modal__footer-esc">ESC to close</span>
          <div className="agent-config__footer-meta">
            {showRestartNotice && (
              <span className="agent-config__restart-notice">
                Restart TaskSail for planner model or reasoning effort changes to take effect.
              </span>
            )}
            {activeTab === 'agents' && (
              <>
                <button
                  type="button"
                  className="mcp-modal__btn mcp-modal__btn--primary"
                  onClick={() => void onSaveAssignments()}
                  disabled={!isAssignmentsDirty || extensionSaving}
                >
                  Save Assignments
                </button>
                <button
                  type="button"
                  className="mcp-modal__btn mcp-modal__btn--primary"
                  onClick={() => void onSave()}
                  disabled={!isDirty || saving}
                >
                  Save Changes
                </button>
              </>
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
