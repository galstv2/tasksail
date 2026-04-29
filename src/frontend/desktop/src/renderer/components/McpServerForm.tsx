import { useCallback, useState } from 'react';

import type { McpConfigModalProps, ConnectionValidationState } from '../hooks/useMcpConfigModal';
import { classNames } from '../utils/classNames';

type Props = Pick<
  McpConfigModalProps,
  'draft' | 'editingServerId' | 'connectionValidation' | 'fieldErrors' | 'saving' | 'saveEnabled' | 'agentRoster' | 'error' | 'onDraftChange' | 'onValidateConnection' | 'onSave' | 'onCancel'
>;

function isValidAbsoluteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function ValidationBadge({ state }: { state: ConnectionValidationState }): JSX.Element | null {
  switch (state.status) {
    case 'idle':
      return null;
    case 'validating':
      return <span className="mcp-form__validation mcp-form__validation--pending">Validating...</span>;
    case 'success':
      return (
        <span className="mcp-form__validation mcp-form__validation--success">
          Connected{state.toolCount != null ? ` (${state.toolCount} tools)` : ''}
        </span>
      );
    case 'failed':
      return <span className="mcp-form__validation mcp-form__validation--failed">{state.message}</span>;
  }
}

function McpServerForm({
  draft,
  editingServerId,
  connectionValidation,
  fieldErrors,
  saving,
  saveEnabled,
  agentRoster = {},
  error,
  onDraftChange,
  onValidateConnection,
  onSave,
  onCancel,
}: Props): JSX.Element {
  const [urlBlurError, setUrlBlurError] = useState<string | null>(null);
  const agentKeys = Object.keys(agentRoster);

  const handleUrlBlur = useCallback(() => {
    if (draft.url && !isValidAbsoluteUrl(draft.url)) {
      setUrlBlurError('Must be a valid absolute URL (https:// or http:// for local dev).');
    } else {
      setUrlBlurError(null);
    }
  }, [draft.url]);

  const urlError = fieldErrors.url || urlBlurError;

  return (
    <div className="mcp-form">
      <div className="mcp-form__field">
        <label className="mcp-form__label">Display Name *</label>
        <input
          className={classNames('mcp-form__input', fieldErrors.display_name && 'mcp-form__input--error')}
          type="text"
          value={draft.display_name}
          onChange={(e) => onDraftChange('display_name', e.target.value)}
          placeholder="Vendor Docs MCP"
        />
        {fieldErrors.display_name && <span className="mcp-form__error">{fieldErrors.display_name}</span>}
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">
          {editingServerId ? 'ID' : 'ID (optional)'}
        </label>
        <input
          className="mcp-form__input"
          type="text"
          value={draft.id}
          readOnly={!!editingServerId}
          onChange={editingServerId ? undefined : (e) => onDraftChange('id', e.target.value)}
        />
        <span className="mcp-form__hint">
          {editingServerId
            ? 'Stable registry identifier. It cannot be changed after creation.'
            : 'Leave blank to auto-generate it from the display name, or enter a custom stable identifier.'}
        </span>
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">Purpose *</label>
        <input
          className={classNames('mcp-form__input', fieldErrors.purpose && 'mcp-form__input--error')}
          type="text"
          value={draft.purpose}
          onChange={(e) => onDraftChange('purpose', e.target.value)}
          placeholder="Vendor API documentation for the billing integration project"
        />
        <span className="mcp-form__hint">Short phrase — injected into agent context at launch time.</span>
        {fieldErrors.purpose && <span className="mcp-form__error">{fieldErrors.purpose}</span>}
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">Preferred For (optional)</label>
        <textarea
          className={classNames('mcp-form__textarea', fieldErrors.preferred_for && 'mcp-form__input--error')}
          value={draft.preferred_for}
          onChange={(e) => onDraftChange('preferred_for', e.target.value)}
          placeholder={'auth header requirements\nvendor error-code interpretation\nAPI schema lookup'}
          rows={3}
        />
        <span className="mcp-form__hint">One short cue per line. Tells the agent when to try this MCP first.</span>
        {fieldErrors.preferred_for && <span className="mcp-form__error">{fieldErrors.preferred_for}</span>}
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">Fallback Description (optional)</label>
        <textarea
          className={classNames('mcp-form__textarea', fieldErrors.fallback_description && 'mcp-form__input--error')}
          value={draft.fallback_description}
          onChange={(e) => onDraftChange('fallback_description', e.target.value)}
          placeholder="Provides search_docs and get_page tools for vendor API reference"
          rows={2}
        />
        <span className="mcp-form__hint">Brief capability description for the agent context overlay.</span>
        {fieldErrors.fallback_description && <span className="mcp-form__error">{fieldErrors.fallback_description}</span>}
      </div>

      <div className="mcp-form__row">
        <div className="mcp-form__field mcp-form__field--grow">
          <label className="mcp-form__label">URL *</label>
          <input
            className={classNames('mcp-form__input', urlError && 'mcp-form__input--error')}
            type="text"
            value={draft.url}
            onChange={(e) => { onDraftChange('url', e.target.value); setUrlBlurError(null); }}
            onBlur={handleUrlBlur}
            placeholder="https://mcp.vendor.example/sse"
          />
          {urlError && <span className="mcp-form__error">{urlError}</span>}
        </div>
        <div className="mcp-form__field">
          <label className="mcp-form__label">Transport</label>
          <select
            className="mcp-form__select"
            value={draft.transport}
            onChange={(e) => onDraftChange('transport', e.target.value)}
          >
            <option value="sse">SSE</option>
            <option value="http">HTTP</option>
          </select>
        </div>
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">Headers</label>
        {draft.headers.map((h, i) => (
          <div key={i} className="mcp-form__header-row">
            <input
              className="mcp-form__input mcp-form__input--sm"
              type="text"
              value={h.key}
              placeholder="Header name"
              onChange={(e) => {
                const next = [...draft.headers];
                next[i] = { ...next[i], key: e.target.value };
                onDraftChange('headers', next);
              }}
            />
            <input
              className="mcp-form__input mcp-form__input--sm"
              type="text"
              value={h.value}
              placeholder="${ENV_VAR_NAME}"
              onChange={(e) => {
                const next = [...draft.headers];
                next[i] = { ...next[i], value: e.target.value };
                onDraftChange('headers', next);
              }}
            />
            <button
              type="button"
              className="mcp-form__btn-icon"
              aria-label="Remove header"
              onClick={() => {
                const next = draft.headers.filter((_, j) => j !== i);
                onDraftChange('headers', next);
              }}
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          className="mcp-form__btn-link"
          onClick={() => onDraftChange('headers', [...draft.headers, { key: '', value: '' }])}
        >
          + Add header
        </button>
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">Agent Scope</label>
        <div className="mcp-form__agent-list">
          {agentKeys.map((key) => {
            const profile = agentRoster[key];
            const checked = draft.agent_ids.includes(key);
            return (
              <label key={key} className="mcp-form__agent-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? draft.agent_ids.filter((id) => id !== key)
                      : [...draft.agent_ids, key];
                    onDraftChange('agent_ids', next);
                  }}
                />
                <span>{profile.displayName}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__toggle-inline">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onDraftChange('enabled', e.target.checked)}
          />
          <span>Enabled</span>
        </label>
      </div>

      {error && (
        <div className="mcp-form__error-banner" role="alert">{error}</div>
      )}

      <div className="mcp-form__actions">
        <div className="mcp-form__validation-group">
          <button
            type="button"
            className="mcp-modal__btn"
            onClick={onValidateConnection}
            disabled={!draft.url || connectionValidation.status === 'validating'}
          >
            Validate Connection
          </button>
          <ValidationBadge state={connectionValidation} />
        </div>
        <div className="mcp-form__action-buttons">
          <button type="button" className="mcp-modal__btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="mcp-modal__btn mcp-modal__btn--primary"
            onClick={onSave}
            disabled={!saveEnabled}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default McpServerForm;
