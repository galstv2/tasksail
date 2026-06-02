import type { SystemSettingsModalProps } from '../hooks/useSystemSettingsModal';
import type { SystemSettingsPlatformConfig } from '../../shared/desktopContract';
import ModalShell, { ModalShellEscHint } from './ModalShell';
import ConfirmOverlay from './ConfirmOverlay';

type Field = keyof SystemSettingsPlatformConfig;
type OnFieldChange = SystemSettingsModalProps['onFieldChange'];

const SLICE_FORMAT_OPTIONS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'xml', label: 'XML' },
] as const;
const CONTAINER_RUNTIME_OPTIONS = [
  { value: 'docker', label: 'Docker' },
  { value: 'podman', label: 'Podman' },
  { value: 'direct', label: 'Direct (no container)' },
] as const;
const ENGINE_HOST_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'native', label: 'Native' },
  { value: 'desktop-linux', label: 'Desktop Linux' },
  { value: 'wsl', label: 'WSL' },
] as const;

function FieldError({ message }: { message?: string }): JSX.Element | null {
  return message ? (
    <span className="system-settings__error" role="alert">
      {message}
    </span>
  ) : null;
}

function SelectRow<K extends Field>(props: {
  field: K;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onFieldChange: OnFieldChange;
}): JSX.Element {
  const { field, label, value, options, onFieldChange } = props;
  return (
    <label className="system-settings__field">
      <span className="system-settings__label">{label}</span>
      <select
        className="system-settings__input"
        aria-label={label}
        value={value}
        onChange={(event) => onFieldChange(field, event.target.value as SystemSettingsPlatformConfig[K])}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberRow<K extends Field>(props: {
  field: K;
  label: string;
  value: number;
  error?: string;
  onFieldChange: OnFieldChange;
}): JSX.Element {
  const { field, label, value, error, onFieldChange } = props;
  return (
    <label className="system-settings__field">
      <span className="system-settings__label">{label}</span>
      <input
        type="number"
        className={`system-settings__input${error ? ' system-settings__input--error' : ''}`}
        aria-label={label}
        value={Number.isNaN(value) ? '' : value}
        onChange={(event) =>
          onFieldChange(
            field,
            (event.target.value === '' ? NaN : Number(event.target.value)) as SystemSettingsPlatformConfig[K],
          )
        }
      />
      <FieldError message={error} />
    </label>
  );
}

function TextRow<K extends Field>(props: {
  field: K;
  label: string;
  value: string;
  error?: string;
  onFieldChange: OnFieldChange;
}): JSX.Element {
  const { field, label, value, error, onFieldChange } = props;
  return (
    <label className="system-settings__field">
      <span className="system-settings__label">{label}</span>
      <input
        type="text"
        className={`system-settings__input${error ? ' system-settings__input--error' : ''}`}
        aria-label={label}
        value={value}
        onChange={(event) => onFieldChange(field, event.target.value as SystemSettingsPlatformConfig[K])}
      />
      <FieldError message={error} />
    </label>
  );
}

function CheckboxRow<K extends Field>(props: {
  field: K;
  label: string;
  value: boolean;
  onFieldChange: OnFieldChange;
}): JSX.Element {
  const { field, label, value, onFieldChange } = props;
  return (
    <label className="system-settings__field system-settings__field--checkbox">
      <input
        type="checkbox"
        aria-label={label}
        checked={value}
        onChange={(event) => onFieldChange(field, event.target.checked as SystemSettingsPlatformConfig[K])}
      />
      <span className="system-settings__label">{label}</span>
    </label>
  );
}

export default function SystemSettingsModal(props: SystemSettingsModalProps): JSX.Element {
  const {
    isOpen,
    loading,
    saving,
    error,
    success,
    draft,
    fieldErrors,
    envOverrides,
    runtimeWarning,
    runtimeStatus,
    tasksActive,
    dirty,
    saveDisabled,
    confirmRestartOpen,
    mountRootsText,
    onClose,
    onFieldChange,
    onMountRootsTextChange,
    onSave,
    onConfirmRestart,
    onCancelRestart,
    onDiscard,
  } = props;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="System Settings"
      subtitle="config/platform.default.json"
      ariaLabel="System Settings"
      maxWidth="760px"
      footer={(
        <>
          <ModalShellEscHint />
          <button
            type="button"
            className="action-button"
            onClick={onDiscard}
            disabled={saving || !dirty}
          >
            Discard
          </button>
          <button
            type="button"
            className="action-button action-button--primary"
            onClick={onSave}
            disabled={saveDisabled}
          >
            Save Changes
          </button>
        </>
      )}
    >
      <div className="system-settings">
        {error && (
          <p className="system-settings__alert system-settings__alert--error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="system-settings__alert system-settings__alert--success" role="status">
            {success}
          </p>
        )}
        {runtimeStatus !== null && runtimeStatus !== 'valid' && runtimeWarning && (
          <p className="system-settings__alert system-settings__alert--warning" role="status">
            {runtimeWarning}
          </p>
        )}
        {envOverrides.length > 0 && (
          <div className="system-settings__env" role="status">
            {envOverrides.map((override) => (
              <p key={override.envVar} className="system-settings__env-line">
                Environment override active: {override.envVar} currently affects {override.field}. Saving
                updates the config files but does not change this environment variable.
              </p>
            ))}
          </div>
        )}

        {tasksActive && (
          <p className="system-settings__alert system-settings__alert--warning" role="status">
            Settings are locked while a task is running. Wait for active tasks to finish before making changes.
          </p>
        )}

        {loading || !draft ? (
          <p className="system-settings__loading">Loading platform settings…</p>
        ) : (
          <div className="system-settings__groups">
            <fieldset className="system-settings__group" disabled={tasksActive}>
              <legend className="system-settings__group-title">Platform</legend>
              <div className="system-settings__field">
                <span className="system-settings__label">Schema version</span>
                <span className="system-settings__readonly" data-testid="system-settings-schema-version">
                  {draft.schema_version}
                </span>
              </div>
              <TextRow
                field="cli_provider"
                label="CLI provider"
                value={draft.cli_provider}
                error={fieldErrors.cli_provider}
                onFieldChange={onFieldChange}
              />
              <SelectRow
                field="slice_artifact_format"
                label="Slice artifact format"
                value={draft.slice_artifact_format}
                options={SLICE_FORMAT_OPTIONS}
                onFieldChange={onFieldChange}
              />
            </fieldset>

            <fieldset className="system-settings__group" disabled={tasksActive}>
              <legend className="system-settings__group-title">Runtime</legend>
              <SelectRow
                field="container_runtime"
                label="Container runtime"
                value={draft.container_runtime}
                options={CONTAINER_RUNTIME_OPTIONS}
                onFieldChange={onFieldChange}
              />
              <SelectRow
                field="container_engine_host"
                label="Container engine host"
                value={draft.container_engine_host}
                options={ENGINE_HOST_OPTIONS}
                onFieldChange={onFieldChange}
              />
              <label className="system-settings__field">
                <span className="system-settings__label">WSL distro</span>
                <input
                  type="text"
                  className={`system-settings__input${fieldErrors.container_engine_wsl_distro ? ' system-settings__input--error' : ''}`}
                  aria-label="WSL distro"
                  value={draft.container_engine_wsl_distro ?? ''}
                  onChange={(event) =>
                    onFieldChange(
                      'container_engine_wsl_distro',
                      event.target.value === '' ? null : event.target.value,
                    )
                  }
                />
                <FieldError message={fieldErrors.container_engine_wsl_distro} />
              </label>
            </fieldset>

            <fieldset className="system-settings__group" disabled={tasksActive}>
              <legend className="system-settings__group-title">Task Execution</legend>
              <NumberRow
                field="max_parallel_tasks"
                label="Max parallel tasks"
                value={draft.max_parallel_tasks}
                error={fieldErrors.max_parallel_tasks}
                onFieldChange={onFieldChange}
              />
              <NumberRow
                field="max_retry_generations_per_slug"
                label="Max retry generations per slug"
                value={draft.max_retry_generations_per_slug}
                error={fieldErrors.max_retry_generations_per_slug}
                onFieldChange={onFieldChange}
              />
              <CheckboxRow
                field="auto_merge"
                label="Auto merge"
                value={draft.auto_merge}
                onFieldChange={onFieldChange}
              />
            </fieldset>

            <fieldset className="system-settings__group" disabled={tasksActive}>
              <legend className="system-settings__group-title">Retention</legend>
              <CheckboxRow
                field="retain_failed_task_worktrees"
                label="Retain failed task worktrees"
                value={draft.retain_failed_task_worktrees}
                onFieldChange={onFieldChange}
              />
              <NumberRow
                field="max_retained_failed_task_worktrees"
                label="Max retained failed task worktrees"
                value={draft.max_retained_failed_task_worktrees}
                error={fieldErrors.max_retained_failed_task_worktrees}
                onFieldChange={onFieldChange}
              />
              <NumberRow
                field="completed_task_runtime_retention_ms"
                label="Completed task runtime retention (ms)"
                value={draft.completed_task_runtime_retention_ms}
                error={fieldErrors.completed_task_runtime_retention_ms}
                onFieldChange={onFieldChange}
              />
            </fieldset>

            <fieldset className="system-settings__group" disabled={tasksActive}>
              <legend className="system-settings__group-title">External MCP</legend>
              <CheckboxRow
                field="external_mcp_local_enabled"
                label="Enable local external MCP"
                value={draft.external_mcp_local_enabled}
                onFieldChange={onFieldChange}
              />
              <NumberRow
                field="mcp_port"
                label="MCP port"
                value={draft.mcp_port}
                error={fieldErrors.mcp_port}
                onFieldChange={onFieldChange}
              />
              <label className="system-settings__field">
                <span className="system-settings__label">External mount roots</span>
                <textarea
                  className={`system-settings__textarea${fieldErrors.repo_context_mcp_external_mount_roots ? ' system-settings__input--error' : ''}`}
                  aria-label="External mount roots"
                  rows={3}
                  placeholder="One absolute path per line"
                  value={mountRootsText}
                  onChange={(event) => onMountRootsTextChange(event.target.value)}
                />
                <FieldError message={fieldErrors.repo_context_mcp_external_mount_roots} />
              </label>
            </fieldset>
          </div>
        )}

        <ConfirmOverlay
          visible={confirmRestartOpen}
          icon={(
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-3.5-7.1" />
              <path d="M21 3v5h-5" />
            </svg>
          )}
          title="Restart TaskSail?"
          body={(
            <>
              Saving these settings requires TaskSail to restart to take effect. TaskSail will close and
              reopen. Continue?
            </>
          )}
          confirmLabel="Save &amp; restart"
          cancelLabel="Cancel"
          confirmVariant="primary"
          onConfirm={onConfirmRestart}
          onCancel={onCancelRestart}
          ariaLabel="Restart TaskSail to apply settings"
        />
      </div>
    </ModalShell>
  );
}
