// System Settings platform-config contract types — extracted from desktopContract.ts
// for file-size compliance. These mirror the backend PlatformConfig shape but are
// declared renderer-side so the renderer never imports the node-side backend module.

export type SystemSettingsContainerRuntime = 'docker' | 'podman' | 'direct';
export type SystemSettingsContainerEngineHost = 'auto' | 'native' | 'desktop-linux' | 'wsl';
export type SystemSettingsSliceArtifactFormat = 'markdown' | 'xml';

export type SystemSettingsPlatformConfig = {
  schema_version: number;
  cli_provider: string;
  slice_artifact_format: SystemSettingsSliceArtifactFormat;
  container_runtime: SystemSettingsContainerRuntime;
  container_engine_host: SystemSettingsContainerEngineHost;
  container_engine_wsl_distro: string | null;
  max_parallel_tasks: number;
  retain_failed_task_worktrees: boolean;
  max_retained_failed_task_worktrees: number;
  max_retry_generations_per_slug: number;
  completed_task_runtime_retention_ms: number;
  auto_merge: boolean;
  external_mcp_local_enabled: boolean;
  mcp_port: number;
  repo_context_mcp_external_mount_roots: string[];
};

export type SystemSettingsEnvOverrideScope =
  | 'effective-config'
  | 'engine-resolution'
  | 'provider-resolution';

export type SystemSettingsEnvOverride = {
  field: keyof SystemSettingsPlatformConfig;
  envVar: string;
  value: string;
  scope: SystemSettingsEnvOverrideScope;
};

export type SystemSettingsRuntimeStatus = 'valid' | 'missing' | 'invalid';

export type SystemSettingsReadRequest = {
  action: 'systemSettings.read';
  payload?: undefined;
};

export type SystemSettingsReadResponse = {
  action: 'systemSettings.read';
  mode: 'read-only';
  message: string;
  defaultConfigPath: string;
  runtimeConfigPath: string;
  defaultFileHash: string;
  runtimeFileHash: string | null;
  config: SystemSettingsPlatformConfig;
  runtimeConfig: SystemSettingsPlatformConfig | null;
  runtimeStatus: SystemSettingsRuntimeStatus;
  runtimeWarning: string | null;
  // True when a task is running; settings are locked (read-only) until it finishes.
  tasksActive: boolean;
  envOverrides: SystemSettingsEnvOverride[];
};

export type SystemSettingsSaveRequest = {
  action: 'systemSettings.save';
  payload: {
    baseDefaultFileHash: string;
    config: SystemSettingsPlatformConfig;
  };
};

export type SystemSettingsSaveResponse = {
  action: 'systemSettings.save';
  mode: 'saved';
  message: string;
  defaultConfigPath: string;
  runtimeConfigPath: string;
  defaultFileHash: string;
  runtimeFileHash: string;
  config: SystemSettingsPlatformConfig;
  runtimeConfig: SystemSettingsPlatformConfig;
  runtimeStatus: 'valid';
  runtimeWarning: string | null;
  tasksActive: boolean;
  envOverrides: SystemSettingsEnvOverride[];
};

export type SystemSettingsRestartRequest = {
  action: 'systemSettings.restart';
  payload?: undefined;
};

export type SystemSettingsRestartResponse = {
  action: 'systemSettings.restart';
  mode: 'restarting';
  message: string;
};
