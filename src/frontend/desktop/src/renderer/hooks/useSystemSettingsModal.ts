import { useCallback, useMemo, useRef, useState } from 'react';

import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';
import type {
  SystemSettingsPlatformConfig,
  SystemSettingsEnvOverride,
  SystemSettingsRuntimeStatus,
} from '../../shared/desktopContract';

export type SystemSettingsFieldErrors = Partial<Record<keyof SystemSettingsPlatformConfig, string>>;

export type SystemSettingsModalProps = {
  isOpen: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  draft: SystemSettingsPlatformConfig | null;
  fieldErrors: SystemSettingsFieldErrors;
  envOverrides: SystemSettingsEnvOverride[];
  runtimeWarning: string | null;
  runtimeStatus: SystemSettingsRuntimeStatus | null;
  // True while a task is running: all controls are locked and save is blocked.
  tasksActive: boolean;
  dirty: boolean;
  saveDisabled: boolean;
  // Restart confirmation gate: Save Changes opens it; confirming saves then restarts.
  confirmRestartOpen: boolean;
  mountRootsText: string;
  onClose: () => void;
  onFieldChange: <K extends keyof SystemSettingsPlatformConfig>(
    field: K,
    value: SystemSettingsPlatformConfig[K],
  ) => void;
  onMountRootsTextChange: (text: string) => void;
  onSave: () => void;
  onConfirmRestart: () => void;
  onCancelRestart: () => void;
  onDiscard: () => void;
};

export type UseSystemSettingsModalResult = {
  systemSettingsModalProps: SystemSettingsModalProps;
  openSystemSettingsModal: () => void;
};

const PATH_SEPARATOR = /[\\/]/;

function isAbsoluteRoot(value: string): boolean {
  // Mirror the contract-layer isAbsolutePath trust-boundary check, which rejects
  // parent traversal. Keeping these aligned means a draft the client accepts is
  // also accepted by the IPC validator (no surprise banner error after save).
  if (value.includes('..')) {
    return false;
  }
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function parseMountRoots(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Mirror the backend platform-config validation so invalid drafts stay local and
// Save Changes is blocked before any IPC round-trip.
function computeFieldErrors(draft: SystemSettingsPlatformConfig | null): SystemSettingsFieldErrors {
  if (!draft) {
    return {};
  }
  const errors: SystemSettingsFieldErrors = {};
  const intAtLeast = (value: number, min: number): boolean => Number.isInteger(value) && value >= min;

  if (draft.cli_provider.trim() === '') {
    errors.cli_provider = 'Provider is required.';
  }
  if (!intAtLeast(draft.max_parallel_tasks, 1)) {
    errors.max_parallel_tasks = 'Must be a whole number ≥ 1.';
  }
  if (!intAtLeast(draft.max_retained_failed_task_worktrees, 0)) {
    errors.max_retained_failed_task_worktrees = 'Must be a whole number ≥ 0.';
  }
  if (!intAtLeast(draft.max_retry_generations_per_slug, 1)) {
    errors.max_retry_generations_per_slug = 'Must be a whole number ≥ 1.';
  }
  if (!intAtLeast(draft.completed_task_runtime_retention_ms, 0)) {
    errors.completed_task_runtime_retention_ms = 'Must be a whole number ≥ 0.';
  }
  if (!Number.isInteger(draft.mcp_port) || draft.mcp_port < 1 || draft.mcp_port > 65535) {
    errors.mcp_port = 'Must be a port from 1 to 65535.';
  }
  if (draft.container_engine_host === 'wsl') {
    const distro = draft.container_engine_wsl_distro;
    if (distro === null || distro.trim() === '' || PATH_SEPARATOR.test(distro)) {
      errors.container_engine_wsl_distro = 'A WSL distro name without path separators is required.';
    }
  }
  if (draft.repo_context_mcp_external_mount_roots.some((root) => !isAbsoluteRoot(root))) {
    errors.repo_context_mcp_external_mount_roots = 'Each mount root must be an absolute path.';
  }
  return errors;
}

export function useSystemSettingsModal(
  client: DesktopShellClient = desktopShellClient,
): UseSystemSettingsModalResult {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draft, setDraft] = useState<SystemSettingsPlatformConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<SystemSettingsPlatformConfig | null>(null);
  const [baseDefaultFileHash, setBaseDefaultFileHash] = useState<string | null>(null);
  const [envOverrides, setEnvOverrides] = useState<SystemSettingsEnvOverride[]>([]);
  const [runtimeWarning, setRuntimeWarning] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<SystemSettingsRuntimeStatus | null>(null);
  const [mountRootsText, setMountRootsText] = useState('');
  const [tasksActive, setTasksActive] = useState(false);
  const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await client.readSystemSettings();
      if (result.ok && result.response.action === 'systemSettings.read') {
        const resp = result.response;
        setDraft(resp.config);
        setSavedConfig(resp.config);
        setBaseDefaultFileHash(resp.defaultFileHash);
        setEnvOverrides(resp.envOverrides);
        setRuntimeWarning(resp.runtimeWarning);
        setRuntimeStatus(resp.runtimeStatus);
        setTasksActive(resp.tasksActive);
        setMountRootsText(resp.config.repo_context_mcp_external_mount_roots.join('\n'));
      } else if (!result.ok) {
        setError(result.error);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load system settings.');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [client]);

  const openSystemSettingsModal = useCallback(() => {
    setIsOpen(true);
    setSuccess(null);
    void load();
  }, [load]);

  const onClose = useCallback(() => {
    setIsOpen(false);
    setError(null);
  }, []);

  const onFieldChange = useCallback(
    <K extends keyof SystemSettingsPlatformConfig>(field: K, value: SystemSettingsPlatformConfig[K]) => {
      setSuccess(null);
      setDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [],
  );

  const onMountRootsTextChange = useCallback((text: string) => {
    setSuccess(null);
    setMountRootsText(text);
    setDraft((prev) =>
      prev ? { ...prev, repo_context_mcp_external_mount_roots: parseMountRoots(text) } : prev,
    );
  }, []);

  const onDiscard = useCallback(() => {
    setSuccess(null);
    setError(null);
    if (savedConfig) {
      setDraft(savedConfig);
      setMountRootsText(savedConfig.repo_context_mcp_external_mount_roots.join('\n'));
    }
  }, [savedConfig]);

  const fieldErrors = useMemo(() => computeFieldErrors(draft), [draft]);
  const dirty = useMemo(() => {
    if (!draft || !savedConfig) {
      return false;
    }
    return JSON.stringify(draft) !== JSON.stringify(savedConfig);
  }, [draft, savedConfig]);

  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const saveDisabled =
    loading
    || saving
    || !dirty
    || hasFieldErrors
    || draft === null
    || baseDefaultFileHash === null
    || tasksActive;

  // Save then restart. Most platform settings only take effect after a TaskSail
  // restart, so a confirmed save persists the files and relaunches the app.
  const performSaveAndRestart = useCallback(async () => {
    if (!draft || baseDefaultFileHash === null) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await client.saveSystemSettings({ baseDefaultFileHash, config: draft });
      if (result.ok && result.response.action === 'systemSettings.save') {
        const resp = result.response;
        setDraft(resp.config);
        setSavedConfig(resp.config);
        setBaseDefaultFileHash(resp.defaultFileHash);
        setEnvOverrides(resp.envOverrides);
        setRuntimeWarning(resp.runtimeWarning);
        setRuntimeStatus(resp.runtimeStatus);
        setTasksActive(resp.tasksActive);
        setMountRootsText(resp.config.repo_context_mcp_external_mount_roots.join('\n'));
        setSuccess('Settings saved. Restarting TaskSail…');
        // Relaunch so the saved settings take effect. The window may close before
        // this resolves; failures (e.g. dev shells) leave the success status visible.
        void client.restartTaskSail();
      } else if (!result.ok) {
        // Stale-hash conflicts and active-work blocks carry actionable messages.
        setError(result.error);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save system settings.');
    } finally {
      setSaving(false);
    }
  }, [client, draft, baseDefaultFileHash]);

  // Save Changes opens the restart confirmation rather than saving immediately.
  const requestSave = useCallback(() => {
    setConfirmRestartOpen(true);
  }, []);

  const onCancelRestart = useCallback(() => {
    setConfirmRestartOpen(false);
  }, []);

  const onConfirmRestart = useCallback(() => {
    setConfirmRestartOpen(false);
    void performSaveAndRestart();
  }, [performSaveAndRestart]);

  return {
    systemSettingsModalProps: {
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
      onSave: requestSave,
      onConfirmRestart,
      onCancelRestart,
      onDiscard,
    },
    openSystemSettingsModal,
  };
}
