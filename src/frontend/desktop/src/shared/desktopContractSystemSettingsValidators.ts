// Focused validators for the System Settings platform-config IPC actions.
// desktopContractValidators.ts imports from here and acts as a thin action router only.
// These mirror the backend platform-config validation semantics (load.ts) so a
// malformed renderer payload is rejected at the trust boundary before reaching disk.

import {
  isAbsolutePath,
  isNonEmptyString,
  isOneOf,
  isRecord,
  isString,
} from './desktopContractValidationCore';

const VALID_CONTAINER_RUNTIMES = ['docker', 'podman', 'direct'] as const;
const VALID_ENGINE_HOSTS = ['auto', 'native', 'desktop-linux', 'wsl'] as const;
const VALID_SLICE_ARTIFACT_FORMATS = ['markdown', 'xml'] as const;

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function validateSystemSettingsReadPayload(payload: unknown): string[] {
  if (payload !== undefined) {
    return ['payload must be omitted.'];
  }
  return [];
}

function validateSystemSettingsConfig(config: unknown): string[] {
  if (!isRecord(config)) {
    return ['payload.config must be an object.'];
  }

  const errors: string[] = [];
  const field = (name: string): string => `payload.config.${name}`;

  if (config.schema_version !== 1) {
    errors.push(`${field('schema_version')} must be 1.`);
  }
  if (!isNonEmptyString(config.cli_provider)) {
    errors.push(`${field('cli_provider')} must be a non-empty string.`);
  }
  if (!isOneOf(config.slice_artifact_format, VALID_SLICE_ARTIFACT_FORMATS)) {
    errors.push(`${field('slice_artifact_format')} must be markdown or xml.`);
  }
  if (!isOneOf(config.container_runtime, VALID_CONTAINER_RUNTIMES)) {
    errors.push(`${field('container_runtime')} must be docker, podman, or direct.`);
  }
  if (!isOneOf(config.container_engine_host, VALID_ENGINE_HOSTS)) {
    errors.push(`${field('container_engine_host')} must be auto, native, desktop-linux, or wsl.`);
  }
  if (config.container_engine_wsl_distro !== null && !isString(config.container_engine_wsl_distro)) {
    errors.push(`${field('container_engine_wsl_distro')} must be a string or null.`);
  }
  if (config.container_engine_host === 'wsl') {
    const distro = config.container_engine_wsl_distro;
    if (typeof distro !== 'string' || distro.trim() === '' || /[\\/]/.test(distro)) {
      errors.push(
        `${field('container_engine_wsl_distro')} must be a non-empty WSL distro name without path separators when container_engine_host is wsl.`,
      );
    }
  }
  if (!isInteger(config.max_parallel_tasks) || config.max_parallel_tasks < 1) {
    errors.push(`${field('max_parallel_tasks')} must be an integer >= 1.`);
  }
  if (typeof config.retain_failed_task_worktrees !== 'boolean') {
    errors.push(`${field('retain_failed_task_worktrees')} must be a boolean.`);
  }
  if (!isInteger(config.max_retained_failed_task_worktrees) || config.max_retained_failed_task_worktrees < 0) {
    errors.push(`${field('max_retained_failed_task_worktrees')} must be a non-negative integer.`);
  }
  if (!isInteger(config.max_retry_generations_per_slug) || config.max_retry_generations_per_slug < 1) {
    errors.push(`${field('max_retry_generations_per_slug')} must be an integer >= 1.`);
  }
  if (!isInteger(config.completed_task_runtime_retention_ms) || config.completed_task_runtime_retention_ms < 0) {
    errors.push(`${field('completed_task_runtime_retention_ms')} must be a non-negative integer.`);
  }
  if (typeof config.auto_merge !== 'boolean') {
    errors.push(`${field('auto_merge')} must be a boolean.`);
  }
  if (typeof config.external_mcp_local_enabled !== 'boolean') {
    errors.push(`${field('external_mcp_local_enabled')} must be a boolean.`);
  }
  if (!isInteger(config.mcp_port) || config.mcp_port < 1 || config.mcp_port > 65535) {
    errors.push(`${field('mcp_port')} must be an integer from 1 to 65535.`);
  }
  if (!Array.isArray(config.repo_context_mcp_external_mount_roots)) {
    errors.push(`${field('repo_context_mcp_external_mount_roots')} must be an array of absolute paths.`);
  } else {
    config.repo_context_mcp_external_mount_roots.forEach((root, index) => {
      if (!isAbsolutePath(root)) {
        errors.push(`${field('repo_context_mcp_external_mount_roots')}[${index}] must be an absolute path.`);
      }
    });
  }
  return errors;
}

export function validateSystemSettingsSavePayload(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ['payload must be an object.'];
  }
  const errors: string[] = [];
  if (!isNonEmptyString(payload.baseDefaultFileHash)) {
    errors.push('payload.baseDefaultFileHash must be a non-empty string.');
  }
  errors.push(...validateSystemSettingsConfig(payload.config));
  return errors;
}
