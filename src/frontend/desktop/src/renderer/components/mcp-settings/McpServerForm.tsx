import { useCallback, useState } from 'react';

import type { McpConfigModalProps, ConnectionValidationState, LocalCommandCheckState } from '../../hooks/system-settings/useMcpConfigModal';
import { classNames } from '../../utils/classNames';

type Props = Pick<
  McpConfigModalProps,
  'draft' | 'editingServerId' | 'connectionValidation' | 'localEnabled' | 'localCommandCheck' | 'fieldErrors' | 'saving' | 'saveEnabled' | 'error' | 'onDraftChange' | 'onValidateConnection' | 'onCheckLocalCommand' | 'onSave' | 'onCancel'
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

function LocalCommandBadge({ state }: { state: LocalCommandCheckState }): JSX.Element | null {
  switch (state.status) {
    case 'idle':
      return null;
    case 'checking':
      return <span className="mcp-form__validation mcp-form__validation--pending">Checking...</span>;
    case 'found':
      return (
        <span className="mcp-form__validation mcp-form__validation--success">
          Found{state.resolvedPath ? `: ${state.resolvedPath}` : ''}
        </span>
      );
    case 'not-found':
      return <span className="mcp-form__validation mcp-form__validation--failed">{state.message}</span>;
  }
}

const LOCAL_GUIDE_ROWS: ReadonlyArray<{ term: string; copy: string }> = [
  {
    term: 'Command',
    copy: 'Executable on PATH or an absolute executable path. Examples: npx, node, python, /opt/mcp/bin/server.',
  },
  {
    term: 'Arguments',
    copy: 'One argv item per line, in order. Example for npm servers: -y on one line and @vendor/mcp-server on the next line.',
  },
  {
    term: 'Environment',
    copy: 'Variables passed to the local server process. Use ${ENV_VAR_NAME} for secrets that already exist in the launch environment; avoid pasting raw secrets.',
  },
  {
    term: 'Working Directory',
    copy: 'Optional absolute cwd for servers that read local project files. Leave blank unless the server docs require it.',
  },
  {
    term: 'Tools',
    copy: 'Required allowlist, one exact MCP tool name per line. "*" is rejected for local servers.',
  },
  {
    term: 'Assignment',
    copy: 'Managed separately in Agent Configuration; this form only configures the server.',
  },
  {
    term: 'Check command',
    copy: 'PATH lookup only. It does not start the server or validate arguments, env, cwd, tools, or trustworthiness.',
  },
];

function LocalTransportGuide(): JSX.Element {
  return (
    <div className="mcp-form__local-guide">
      <p className="mcp-form__local-guide-title">Local transport setup</p>
      <p className="mcp-form__local-guide-copy">
        Local servers run from a command on this machine when an assigned agent starts. Put only the
        executable in Command; put flags, package names, and server options in Arguments. Assign servers
        to agents separately in Agent Configuration.
      </p>
      <dl className="mcp-form__local-guide-list">
        {LOCAL_GUIDE_ROWS.map((row) => (
          <div key={row.term} className="mcp-form__local-guide-row">
            <dt className="mcp-form__local-guide-term">{row.term}:</dt>
            <dd className="mcp-form__local-guide-copy">{row.copy}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function McpServerForm({
  draft,
  editingServerId,
  connectionValidation,
  localEnabled,
  localCommandCheck,
  fieldErrors,
  saving,
  saveEnabled,
  error,
  onDraftChange,
  onValidateConnection,
  onCheckLocalCommand,
  onSave,
  onCancel,
}: Props): JSX.Element {
  const [urlBlurError, setUrlBlurError] = useState<string | null>(null);
  const purposeLength = draft.purpose.length;
  const purposeCounterWarning = draft.purpose.trim().length < 20;

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
          placeholder="Use when the task involves vendor billing API calls or needs up-to-date endpoint schemas."
        />
        <span className="mcp-form__hint">Describe what this server provides and when an agent should reach for it (min 20 characters). The more specific, the better the agent can judge relevance.</span>
        <span className={classNames('mcp-form__counter', purposeCounterWarning && 'mcp-form__counter--warning')}>
          {purposeLength} / 200, min 20
        </span>
        {fieldErrors.purpose && <span className="mcp-form__error">{fieldErrors.purpose}</span>}
      </div>

      <div className="mcp-form__field">
        <label className="mcp-form__label">Preferred For *</label>
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
        {draft.transport !== 'local' && (
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
        )}
        <div className="mcp-form__field">
          <label className="mcp-form__label">Transport</label>
          <select
            className="mcp-form__select"
            value={draft.transport}
            onChange={(e) => onDraftChange('transport', e.target.value)}
          >
            <option value="sse">SSE</option>
            <option value="http">HTTP</option>
            <option
              value="local"
              disabled={!localEnabled}
              title={localEnabled ? undefined : 'Enable external_mcp_local_enabled in platform settings to add local (stdio) servers.'}
            >
              Local (stdio){localEnabled ? '' : ' — disabled'}
            </option>
          </select>
          {!localEnabled && (
            <span className="mcp-form__hint">
              Enable <code>external_mcp_local_enabled</code> in platform settings to add local (stdio) servers.
            </span>
          )}
        </div>
      </div>

      {draft.transport === 'local' ? (
        <>
          <span className="mcp-form__hint">
            Local servers launch as a child process with the agent&apos;s OS permissions at each run.
          </span>
          <LocalTransportGuide />
          <div className="mcp-form__field">
            <label className="mcp-form__label">Command *</label>
            <input
              className={classNames('mcp-form__input', fieldErrors.command && 'mcp-form__input--error')}
              type="text"
              value={draft.command}
              onChange={(e) => onDraftChange('command', e.target.value)}
              placeholder="npx"
            />
            <span className="mcp-form__hint">Executable only; put flags, package names, and server options in Arguments.</span>
            {fieldErrors.command && <span className="mcp-form__error">{fieldErrors.command}</span>}
          </div>

          <div className="mcp-form__field">
            <label className="mcp-form__label">Arguments (optional)</label>
            <textarea
              className="mcp-form__textarea"
              value={draft.args}
              onChange={(e) => onDraftChange('args', e.target.value)}
              placeholder={'-y\n@scope/server'}
              rows={3}
            />
            <span className="mcp-form__hint">One argument per line; each line becomes one argv item in order.</span>
          </div>

          <div className="mcp-form__field">
            <label className="mcp-form__label">Environment (optional)</label>
            {draft.env.map((e, i) => (
              <div key={i} className="mcp-form__header-row">
                <input
                  className="mcp-form__input mcp-form__input--sm"
                  type="text"
                  value={e.key}
                  placeholder="VAR_NAME"
                  onChange={(ev) => {
                    const next = [...draft.env];
                    next[i] = { ...next[i], key: ev.target.value };
                    onDraftChange('env', next);
                  }}
                />
                <input
                  className="mcp-form__input mcp-form__input--sm"
                  type="text"
                  value={e.value}
                  placeholder="${ENV_VAR_NAME}"
                  onChange={(ev) => {
                    const next = [...draft.env];
                    next[i] = { ...next[i], value: ev.target.value };
                    onDraftChange('env', next);
                  }}
                />
                <button
                  type="button"
                  className="mcp-form__btn-icon"
                  aria-label="Remove env variable"
                  onClick={() => onDraftChange('env', draft.env.filter((_, j) => j !== i))}
                >
                  &times;
                </button>
              </div>
            ))}
            <button
              type="button"
              className="mcp-form__btn-link"
              onClick={() => onDraftChange('env', [...draft.env, { key: '', value: '' }])}
            >
              + Add env variable
            </button>
            <span className="mcp-form__hint">
              {'Values may be literal strings or whole-value ${ENV_VAR_NAME} references. Prefer env references for secrets.'}
            </span>
          </div>

          <div className="mcp-form__field">
            <label className="mcp-form__label">Working Directory (optional)</label>
            <input
              className={classNames('mcp-form__input', fieldErrors.cwd && 'mcp-form__input--error')}
              type="text"
              value={draft.cwd}
              onChange={(e) => onDraftChange('cwd', e.target.value)}
              placeholder="/absolute/path"
            />
            <span className="mcp-form__hint">Optional absolute path used as the server process cwd.</span>
            {fieldErrors.cwd && <span className="mcp-form__error">{fieldErrors.cwd}</span>}
          </div>

          <div className="mcp-form__field">
            <label className="mcp-form__label">Tools *</label>
            <textarea
              className={classNames('mcp-form__textarea', fieldErrors.tools && 'mcp-form__input--error')}
              value={draft.tools}
              onChange={(e) => onDraftChange('tools', e.target.value)}
              placeholder={'read_file\nlist_dir'}
              rows={3}
            />
            <span className="mcp-form__hint">One exact MCP tool name per line. Required for local servers; &quot;*&quot; is not allowed.</span>
            {fieldErrors.tools && <span className="mcp-form__error">{fieldErrors.tools}</span>}
          </div>
        </>
      ) : (
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
      )}

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
          {draft.transport === 'local' ? (
            <>
              <button
                type="button"
                className="mcp-modal__btn"
                onClick={onCheckLocalCommand}
                disabled={!draft.command.trim() || localCommandCheck.status === 'checking'}
              >
                Check command
              </button>
              <LocalCommandBadge state={localCommandCheck} />
            </>
          ) : (
            <>
              <button
                type="button"
                className="mcp-modal__btn"
                onClick={onValidateConnection}
                disabled={!draft.url || connectionValidation.status === 'validating'}
              >
                Validate Connection
              </button>
              <ValidationBadge state={connectionValidation} />
            </>
          )}
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
