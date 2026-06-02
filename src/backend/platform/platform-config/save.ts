import { createHash } from 'node:crypto';
import path from 'node:path';

import { isRecord, readTextFile, writeTextFileAtomic } from '../core/index.js';
import { resetProvider, resolveCliProviderId } from '../cli-provider/index.js';
import type { PlatformConfig, PlatformConfigValidationError } from './types.js';
import { loadPlatformConfig, validatePlatformConfig } from './load.js';
import { resetPlatformConfigCache } from './get.js';

const DEFAULT_PLATFORM_CONFIG_PATH = 'config/platform.default.json';
const RUNTIME_PLATFORM_CONFIG_PATH = '.platform-state/platform.json';

const RUNTIME_REPAIR_WARNING =
  'Runtime platform config is missing or invalid. A valid save will recreate '
  + '.platform-state/platform.json from the saved defaults.';
const CONFLICT_MESSAGE =
  'config/platform.default.json changed since this modal loaded. Reload settings before saving.';
const VALIDATION_MESSAGE = 'Submitted platform settings are invalid.';

export type SystemSettingsRuntimeStatus = 'valid' | 'missing' | 'invalid';

export type SystemSettingsEnvOverrideScope =
  | 'effective-config'
  | 'engine-resolution'
  | 'provider-resolution';

export interface SystemSettingsEnvOverride {
  field: keyof PlatformConfig;
  envVar: string;
  value: string;
  scope: SystemSettingsEnvOverrideScope;
}

export interface SystemSettingsReadResult {
  defaultConfigPath: string;
  runtimeConfigPath: string;
  defaultFileHash: string;
  runtimeFileHash: string | null;
  config: PlatformConfig;
  runtimeConfig: PlatformConfig | null;
  runtimeStatus: SystemSettingsRuntimeStatus;
  runtimeWarning: string | null;
  envOverrides: SystemSettingsEnvOverride[];
}

export interface SystemSettingsSaveResult {
  defaultConfigPath: string;
  runtimeConfigPath: string;
  defaultFileHash: string;
  runtimeFileHash: string;
  config: PlatformConfig;
  runtimeConfig: PlatformConfig;
  runtimeWarning: string | null;
  envOverrides: SystemSettingsEnvOverride[];
}

export interface SystemSettingsSavePayload {
  baseDefaultFileHash: string;
  config: PlatformConfig;
}

export type SystemSettingsSaveErrorCode =
  | 'conflict'
  | 'validation'
  | 'partial-propagation';

export class SystemSettingsSaveError extends Error {
  readonly code: SystemSettingsSaveErrorCode;
  readonly details: string[];

  constructor(code: SystemSettingsSaveErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'SystemSettingsSaveError';
    this.code = code;
    this.details = details;
  }
}

export interface SystemSettingsReadOptions {
  env?: NodeJS.ProcessEnv;
}

export interface SystemSettingsSaveOptions {
  env?: NodeJS.ProcessEnv;
  // Injectable atomic writer so the partial-propagation failure path is testable.
  // Production callers use the default temp-file + rename helper.
  writeFileAtomic?: (filePath: string, content: string) => Promise<void>;
}

// The known PlatformConfig keys, written in config/platform.default.json field
// order so saved diffs stay minimal and deterministic.
function buildKnownConfigObject(config: PlatformConfig): Record<string, unknown> {
  return {
    schema_version: config.schema_version,
    cli_provider: config.cli_provider,
    slice_artifact_format: config.slice_artifact_format,
    container_runtime: config.container_runtime,
    container_engine_host: config.container_engine_host,
    container_engine_wsl_distro: config.container_engine_wsl_distro,
    max_parallel_tasks: config.max_parallel_tasks,
    retain_failed_task_worktrees: config.retain_failed_task_worktrees,
    max_retained_failed_task_worktrees: config.max_retained_failed_task_worktrees,
    max_retry_generations_per_slug: config.max_retry_generations_per_slug,
    completed_task_runtime_retention_ms: config.completed_task_runtime_retention_ms,
    auto_merge: config.auto_merge,
    external_mcp_local_enabled: config.external_mcp_local_enabled,
    mcp_port: config.mcp_port,
    repo_context_mcp_external_mount_roots: config.repo_context_mcp_external_mount_roots,
  };
}

interface EnvOverrideSpec {
  field: keyof PlatformConfig;
  envVar: string;
  scope: SystemSettingsEnvOverrideScope;
}

// TASKSAIL_MAX_PARALLEL_TASKS and CONTAINER_RUNTIME mutate the effective
// PlatformConfig via getPlatformConfig. CONTAINER_ENGINE_HOST/WSL_DISTRO affect
// engine-host resolution (resolve.ts). TASKSAIL_CLI_PROVIDER affects provider
// resolution (cli-provider/registry.ts).
const ENV_OVERRIDE_SPECS: readonly EnvOverrideSpec[] = [
  { field: 'max_parallel_tasks', envVar: 'TASKSAIL_MAX_PARALLEL_TASKS', scope: 'effective-config' },
  { field: 'container_runtime', envVar: 'CONTAINER_RUNTIME', scope: 'effective-config' },
  { field: 'container_engine_host', envVar: 'CONTAINER_ENGINE_HOST', scope: 'engine-resolution' },
  { field: 'container_engine_wsl_distro', envVar: 'CONTAINER_ENGINE_WSL_DISTRO', scope: 'engine-resolution' },
  { field: 'cli_provider', envVar: 'TASKSAIL_CLI_PROVIDER', scope: 'provider-resolution' },
];

function collectEnvOverrides(env: NodeJS.ProcessEnv): SystemSettingsEnvOverride[] {
  const overrides: SystemSettingsEnvOverride[] = [];
  for (const spec of ENV_OVERRIDE_SPECS) {
    const value = env[spec.envVar];
    if (value !== undefined && value !== '') {
      overrides.push({ field: spec.field, envVar: spec.envVar, value, scope: spec.scope });
    }
  }
  return overrides;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function serialize(data: Record<string, unknown>): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function parseRecordLenient(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatErrorList(errors: PlatformConfigValidationError[]): string[] {
  return errors.map((e) => `${e.field}: ${e.message}`);
}

interface RuntimeInspection {
  status: SystemSettingsRuntimeStatus;
  config: PlatformConfig | null;
  // Parsed runtime object (including runtime-only keys), only when valid.
  data: Record<string, unknown> | null;
  fileHash: string | null;
}

async function inspectRuntime(runtimeConfigPath: string): Promise<RuntimeInspection> {
  // Single read: the validity decision and the runtime-only-key data must derive
  // from the same file snapshot. Validate the bytes already read instead of
  // re-reading via loadPlatformConfig, which would open a TOCTOU window where a
  // concurrent edit could split validity from the preserved runtime-only keys.
  const raw = await readTextFile(runtimeConfigPath);
  if (raw === undefined) {
    return { status: 'missing', config: null, data: null, fileHash: null };
  }
  const fileHash = sha256(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid', config: null, data: null, fileHash };
  }
  const result = validatePlatformConfig(parsed, raw);
  if (!result.valid) {
    return { status: 'invalid', config: null, data: null, fileHash };
  }
  return {
    status: 'valid',
    config: result.config,
    data: isRecord(parsed) ? parsed : {},
    fileHash,
  };
}

/**
 * Read the checked-in default platform config and the runtime mirror for the
 * System Settings modal. Never blocks on a missing/corrupt runtime file — that
 * state is reported via runtimeStatus + a repair warning so the modal can still
 * load and a valid save can repair it.
 */
export async function readSystemSettings(
  repoRoot: string,
  options: SystemSettingsReadOptions = {},
): Promise<SystemSettingsReadResult> {
  const env = options.env ?? process.env;
  const defaultConfigPath = path.join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  const runtimeConfigPath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);

  const defaultResult = await loadPlatformConfig(defaultConfigPath);
  if (!defaultResult.valid) {
    throw new Error(
      `Invalid platform default config at ${defaultConfigPath}: ${formatErrorList(defaultResult.errors).join('; ')}`,
    );
  }

  const runtime = await inspectRuntime(runtimeConfigPath);

  return {
    defaultConfigPath,
    runtimeConfigPath,
    defaultFileHash: sha256(defaultResult.raw),
    runtimeFileHash: runtime.fileHash,
    config: defaultResult.config,
    runtimeConfig: runtime.config,
    runtimeStatus: runtime.status,
    runtimeWarning: runtime.status === 'valid' ? null : RUNTIME_REPAIR_WARNING,
    envOverrides: collectEnvOverrides(env),
  };
}

/**
 * Persist a System Settings draft. Writes config/platform.default.json first
 * (the persistent source of truth for default-declared keys), then propagates
 * .platform-state/platform.json with default-wins semantics. Repairs a missing
 * or corrupt runtime file from the saved default. Rejects stale-hash conflicts,
 * invalid drafts, and unknown providers before touching disk.
 */
export async function saveSystemSettings(
  repoRoot: string,
  payload: SystemSettingsSavePayload,
  options: SystemSettingsSaveOptions = {},
): Promise<SystemSettingsSaveResult> {
  const env = options.env ?? process.env;
  const write = options.writeFileAtomic ?? writeTextFileAtomic;
  const defaultConfigPath = path.join(repoRoot, DEFAULT_PLATFORM_CONFIG_PATH);
  const runtimeConfigPath = path.join(repoRoot, RUNTIME_PLATFORM_CONFIG_PATH);

  // 1. Conflict detection against the on-disk default before any write.
  const currentDefaultRaw = await readTextFile(defaultConfigPath);
  const currentDefaultHash = currentDefaultRaw === undefined ? null : sha256(currentDefaultRaw);
  if (currentDefaultHash !== payload.baseDefaultFileHash) {
    throw new SystemSettingsSaveError('conflict', CONFLICT_MESSAGE);
  }

  // 2. Build the default output document, preserving unknown keys already in the
  //    file and overwriting known PlatformConfig keys with the submitted draft.
  const currentDefaultData = parseRecordLenient(currentDefaultRaw);
  const outputDefaultData = { ...currentDefaultData, ...buildKnownConfigObject(payload.config) };
  const defaultOutputRaw = serialize(outputDefaultData);

  // 3. Validate the default output with the canonical platform-config semantics.
  const defaultValidation = validatePlatformConfig(outputDefaultData, defaultOutputRaw);
  if (!defaultValidation.valid) {
    throw new SystemSettingsSaveError(
      'validation',
      VALIDATION_MESSAGE,
      formatErrorList(defaultValidation.errors),
    );
  }

  // 4. Reject a non-empty but unregistered cli_provider before writing.
  try {
    resolveCliProviderId(repoRoot, defaultValidation.config.cli_provider);
  } catch (error: unknown) {
    throw new SystemSettingsSaveError('validation', VALIDATION_MESSAGE, [
      `cli_provider: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  // 5. Build the runtime output with default-wins semantics. Runtime-only keys
  //    are preserved only from a valid, parseable runtime file; a missing or
  //    corrupt runtime is recreated from the saved default.
  const runtime = await inspectRuntime(runtimeConfigPath);
  const runtimeBaseData = runtime.status === 'valid' && runtime.data ? runtime.data : {};
  const outputRuntimeData = { ...runtimeBaseData, ...outputDefaultData };
  const runtimeOutputRaw = serialize(outputRuntimeData);

  const runtimeValidation = validatePlatformConfig(outputRuntimeData, runtimeOutputRaw);
  if (!runtimeValidation.valid) {
    throw new SystemSettingsSaveError(
      'validation',
      VALIDATION_MESSAGE,
      formatErrorList(runtimeValidation.errors),
    );
  }

  // 6. Write default first, then runtime. A runtime failure after a successful
  //    default write is reported as a partial propagation without claiming the
  //    runtime file was updated. No destructive rollback is attempted.
  await write(defaultConfigPath, defaultOutputRaw);
  try {
    await write(runtimeConfigPath, runtimeOutputRaw);
  } catch (error: unknown) {
    throw new SystemSettingsSaveError(
      'partial-propagation',
      `Saved ${DEFAULT_PLATFORM_CONFIG_PATH} but failed to update ${RUNTIME_PLATFORM_CONFIG_PATH}: `
        + `${error instanceof Error ? error.message : String(error)}. Reload settings before retrying.`,
    );
  }

  // 7. Invalidate caches so future reads observe the rewritten runtime/provider.
  resetPlatformConfigCache();
  resetProvider(repoRoot);

  return {
    defaultConfigPath,
    runtimeConfigPath,
    defaultFileHash: sha256(defaultOutputRaw),
    runtimeFileHash: sha256(runtimeOutputRaw),
    config: defaultValidation.config,
    runtimeConfig: runtimeValidation.config,
    runtimeWarning: null,
    envOverrides: collectEnvOverrides(env),
  };
}
