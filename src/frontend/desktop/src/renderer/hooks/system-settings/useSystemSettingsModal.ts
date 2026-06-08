import { useCallback, useMemo, useRef, useState } from 'react';

import { desktopShellClient, type DesktopShellClient } from '../../services/desktopShellClient';
import type {
  LogExplorerCategory,
  LogExplorerFileEntry,
  LogExplorerLevelFilter,
  LogExplorerListFilesResponse,
  LogExplorerReadFileResponse,
  SystemSettingsPlatformConfig,
  SystemSettingsEnvOverride,
  SystemSettingsRuntimeStatus,
} from '../../../shared/desktopContract';

export type SystemSettingsFieldErrors = Partial<Record<keyof SystemSettingsPlatformConfig, string>>;
export type SystemSettingsTab = 'settings' | 'log-explorer';

export type SystemSettingsLogExplorerProps = {
  loadingFiles: boolean;
  loadingFile: boolean;
  error: string | null;
  sourceLabel: string | null;
  categories: Record<LogExplorerCategory, LogExplorerFileEntry[]>;
  selectedCategory: LogExplorerCategory;
  selectedLevelFilter: LogExplorerLevelFilter;
  selectedFileName: string;
  file: LogExplorerReadFileResponse | null;
  onRefresh: () => void;
  onSelectCategory: (category: LogExplorerCategory) => void;
  onSelectLevelFilter: (levelFilter: LogExplorerLevelFilter) => void;
  onSelectFile: (fileName: string) => void;
  onOlder: () => void;
  onNewer: () => void;
};

export type SystemSettingsModalProps = {
  isOpen: boolean;
  activeTab: SystemSettingsTab;
  onSelectTab: (tab: SystemSettingsTab) => void;
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
  logExplorer: SystemSettingsLogExplorerProps;
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
const LOG_PAGE_LIMIT = 100;
const DEFAULT_LOG_CATEGORIES: Record<LogExplorerCategory, LogExplorerFileEntry[]> = {
  info: [],
  warn: [],
  error: [],
};

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
  const [activeTab, setActiveTab] = useState<SystemSettingsTab>('settings');
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
  const [logLoadingFiles, setLogLoadingFiles] = useState(false);
  const [logLoadingFile, setLogLoadingFile] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSourceLabel, setLogSourceLabel] = useState<string | null>(null);
  const [logCategories, setLogCategories] =
    useState<Record<LogExplorerCategory, LogExplorerFileEntry[]>>(DEFAULT_LOG_CATEGORIES);
  const [selectedLogCategory, setSelectedLogCategory] = useState<LogExplorerCategory>('info');
  const [selectedLevelFilter, setSelectedLevelFilter] = useState<LogExplorerLevelFilter>('all');
  const [selectedLogFileName, setSelectedLogFileName] = useState('');
  const [logFile, setLogFile] = useState<LogExplorerReadFileResponse | null>(null);
  const loadingRef = useRef(false);
  const logFilesLoadedRef = useRef(false);
  const listRequestSeqRef = useRef(0);
  const readRequestSeqRef = useRef(0);

  const invalidateLogRequests = useCallback(() => {
    listRequestSeqRef.current += 1;
    readRequestSeqRef.current += 1;
    setLogLoadingFiles(false);
    setLogLoadingFile(false);
  }, []);

  const clearLogFileSelection = useCallback(() => {
    readRequestSeqRef.current += 1;
    setLogFile(null);
    setLogLoadingFile(false);
  }, []);

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
    setActiveTab('settings');
    setSuccess(null);
    void load();
  }, [load]);

  const onClose = useCallback(() => {
    invalidateLogRequests();
    setIsOpen(false);
    setError(null);
  }, [invalidateLogRequests]);

  const readLogFile = useCallback(
    async (
      category: LogExplorerCategory,
      fileName: string,
      levelFilter: LogExplorerLevelFilter,
      cursor?: { startLine?: number; beforeLine?: number },
    ) => {
      if (fileName.trim() === '') {
        clearLogFileSelection();
        return;
      }
      const requestSeq = readRequestSeqRef.current + 1;
      readRequestSeqRef.current = requestSeq;
      setLogLoadingFile(true);
      setLogError(null);
      try {
        const result = await client.readLogFile({
          category,
          fileName,
          limit: LOG_PAGE_LIMIT,
          levelFilter,
          ...(cursor?.startLine !== undefined
            ? { startLine: cursor.startLine }
            : cursor?.beforeLine !== undefined
              ? { beforeLine: cursor.beforeLine }
              : { tail: true }),
        });
        if (readRequestSeqRef.current !== requestSeq) {
          return;
        }
        if (result.ok && result.response.action === 'logExplorer.readFile') {
          setLogFile(result.response);
        } else if (!result.ok) {
          setLogFile(null);
          setLogError(result.error);
        }
      } catch (err: unknown) {
        if (readRequestSeqRef.current === requestSeq) {
          setLogFile(null);
          setLogError(err instanceof Error ? err.message : 'Unable to read log file.');
        }
      } finally {
        if (readRequestSeqRef.current === requestSeq) {
          setLogLoadingFile(false);
        }
      }
    },
    [client],
  );

  const selectNewestFile = useCallback(
    (
      categories: LogExplorerListFilesResponse['categories'],
      preferredCategory: LogExplorerCategory,
      preferredFileName: string,
    ): { category: LogExplorerCategory; fileName: string } => {
      const preferredFiles = categories[preferredCategory];
      if (preferredFileName && preferredFiles.some((file) => file.fileName === preferredFileName)) {
        return { category: preferredCategory, fileName: preferredFileName };
      }
      if (preferredFiles.length > 0) {
        return { category: preferredCategory, fileName: preferredFiles[0].fileName };
      }
      for (const category of ['info', 'warn', 'error'] as const) {
        if (categories[category].length > 0) {
          return { category, fileName: categories[category][0].fileName };
        }
      }
      return { category: preferredCategory, fileName: '' };
    },
    [],
  );

  const loadLogFiles = useCallback(
    async (force = false) => {
      if (!force && logFilesLoadedRef.current) {
        return;
      }
      const requestSeq = listRequestSeqRef.current + 1;
      listRequestSeqRef.current = requestSeq;
      setLogLoadingFiles(true);
      setLogError(null);
      try {
        const result = await client.listLogFiles();
        if (listRequestSeqRef.current !== requestSeq) {
          return;
        }
        if (result.ok && result.response.action === 'logExplorer.listFiles') {
          const response = result.response;
          const nextSelection = selectNewestFile(
            response.categories,
            selectedLogCategory,
            selectedLogFileName,
          );
          logFilesLoadedRef.current = true;
          setLogSourceLabel(response.sourceLabel);
          setLogCategories(response.categories);
          setSelectedLogCategory(nextSelection.category);
          setSelectedLogFileName(nextSelection.fileName);
          if (nextSelection.fileName) {
            void readLogFile(nextSelection.category, nextSelection.fileName, selectedLevelFilter);
          } else {
            clearLogFileSelection();
          }
        } else if (!result.ok) {
          setLogError(result.error);
        }
      } catch (err: unknown) {
        if (listRequestSeqRef.current === requestSeq) {
          setLogError(err instanceof Error ? err.message : 'Unable to list log files.');
        }
      } finally {
        if (listRequestSeqRef.current === requestSeq) {
          setLogLoadingFiles(false);
        }
      }
    },
    [clearLogFileSelection, client, readLogFile, selectNewestFile, selectedLevelFilter, selectedLogCategory, selectedLogFileName],
  );

  const onSelectTab = useCallback(
    (tab: SystemSettingsTab) => {
      setActiveTab(tab);
      if (tab === 'log-explorer') {
        void loadLogFiles(false);
      } else {
        invalidateLogRequests();
      }
    },
    [invalidateLogRequests, loadLogFiles],
  );

  const onRefreshLogs = useCallback(() => {
    void loadLogFiles(true);
  }, [loadLogFiles]);

  const onSelectLogCategory = useCallback(
    (category: LogExplorerCategory) => {
      const fileName = logCategories[category][0]?.fileName ?? '';
      setSelectedLogCategory(category);
      setSelectedLogFileName(fileName);
      setLogError(null);
      if (fileName) {
        void readLogFile(category, fileName, selectedLevelFilter);
      } else {
        clearLogFileSelection();
      }
    },
    [clearLogFileSelection, logCategories, readLogFile, selectedLevelFilter],
  );

  const onSelectLevelFilter = useCallback(
    (levelFilter: LogExplorerLevelFilter) => {
      setSelectedLevelFilter(levelFilter);
      if (selectedLogFileName) {
        void readLogFile(selectedLogCategory, selectedLogFileName, levelFilter);
      }
    },
    [readLogFile, selectedLogCategory, selectedLogFileName],
  );

  const onSelectLogFile = useCallback(
    (fileName: string) => {
      setSelectedLogFileName(fileName);
      setLogError(null);
      if (fileName) {
        void readLogFile(selectedLogCategory, fileName, selectedLevelFilter);
      } else {
        clearLogFileSelection();
      }
    },
    [clearLogFileSelection, readLogFile, selectedLevelFilter, selectedLogCategory],
  );

  const onOlderLogs = useCallback(() => {
    if (logFile?.hasOlder && selectedLogFileName) {
      void readLogFile(selectedLogCategory, selectedLogFileName, selectedLevelFilter, {
        beforeLine: logFile.startLine,
      });
    }
  }, [logFile, readLogFile, selectedLevelFilter, selectedLogCategory, selectedLogFileName]);

  const onNewerLogs = useCallback(() => {
    if (logFile?.hasNewer && selectedLogFileName) {
      void readLogFile(selectedLogCategory, selectedLogFileName, selectedLevelFilter, {
        startLine: logFile.endLine + 1,
      });
    }
  }, [logFile, readLogFile, selectedLevelFilter, selectedLogCategory, selectedLogFileName]);

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
      activeTab,
      onSelectTab,
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
      logExplorer: {
        loadingFiles: logLoadingFiles,
        loadingFile: logLoadingFile,
        error: logError,
        sourceLabel: logSourceLabel,
        categories: logCategories,
        selectedCategory: selectedLogCategory,
        selectedLevelFilter,
        selectedFileName: selectedLogFileName,
        file: logFile,
        onRefresh: onRefreshLogs,
        onSelectCategory: onSelectLogCategory,
        onSelectLevelFilter,
        onSelectFile: onSelectLogFile,
        onOlder: onOlderLogs,
        onNewer: onNewerLogs,
      },
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
