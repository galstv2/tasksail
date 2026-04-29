import path from 'node:path';

import { isRecord, readTextFile, safeJsonParse } from '../core/index.js';
import type { ContainerBackend, ContainerEngineHost } from '../core/index.js';
import type {
  PlatformConfig,
  PlatformConfigLoadResult,
  PlatformConfigValidationError,
} from './types.js';
import {
  CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION,
  VALID_ENGINE_HOSTS,
  isValidWslDistroName,
} from './types.js';

const VALID_RUNTIMES: ReadonlySet<ContainerBackend> = new Set([
  'docker',
  'podman',
]);

function err(
  field: string,
  message: string,
  fix: string,
): PlatformConfigValidationError {
  return { field, message, fix };
}

/**
 * Load and validate the platform config from disk.
 *
 * Returns a result object instead of throwing so callers can decide whether
 * missing config is recoverable or should fail closed.
 */
export async function loadPlatformConfig(
  configPath: string,
): Promise<PlatformConfigLoadResult> {
  const raw = await readTextFile(configPath);
  if (raw === undefined) {
    return {
      valid: false,
      errors: [
        err(
          '(file)',
          `Platform config file not found: ${configPath}`,
          'Run "pnpm run setup" to seed the runtime platform config.',
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw, configPath);
  } catch (error: unknown) {
    return {
      valid: false,
      errors: [
        err(
          '(file)',
          error instanceof Error ? error.message : 'Invalid JSON.',
          'Fix the JSON syntax or delete the file and re-run "pnpm run setup".',
        ),
      ],
    };
  }

  return validatePlatformConfig(parsed, raw);
}

function validatePlatformConfig(data: unknown, raw: string): PlatformConfigLoadResult {
  const errors: PlatformConfigValidationError[] = [];

  if (!isRecord(data)) {
    return {
      valid: false,
      errors: [
        err(
          '(root)',
          'Platform config must be a JSON object.',
          'Ensure the file contains a top-level { } object.',
        ),
      ],
    };
  }

  const version = data['schema_version'];
  if (
    typeof version !== 'number'
    || !Number.isInteger(version)
    || version !== CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION
  ) {
    errors.push(
      err(
        'schema_version',
        `Expected ${CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION}, got ${JSON.stringify(version)}.`,
        'Delete .platform-state/platform.json and re-run "pnpm run setup".',
      ),
    );
  }

  const containerRuntime = data['container_runtime'];
  if (
    typeof containerRuntime !== 'string'
    || !VALID_RUNTIMES.has(containerRuntime as ContainerBackend)
  ) {
    errors.push(
      err(
        'container_runtime',
        `Must be "docker" or "podman", got ${JSON.stringify(containerRuntime)}.`,
        'Set container_runtime to "docker" or "podman".',
      ),
    );
  }

  const rawCliProvider = data['cli_provider'];
  let cliProvider = 'copilot';
  if (rawCliProvider !== undefined) {
    if (typeof rawCliProvider !== 'string' || rawCliProvider.trim() === '') {
      errors.push(
        err(
          'cli_provider',
          `Must be a non-empty string when present, got ${JSON.stringify(rawCliProvider)}.`,
          'Set cli_provider to "copilot" or remove it to use the default.',
        ),
      );
    } else {
      cliProvider = rawCliProvider.trim();
    }
  }

  const rawContainerEngineHost = data['container_engine_host'];
  let containerEngineHost: ContainerEngineHost = 'auto';
  if (
    rawContainerEngineHost !== undefined
    && (
      typeof rawContainerEngineHost !== 'string'
      || !VALID_ENGINE_HOSTS.has(rawContainerEngineHost as ContainerEngineHost)
    )
  ) {
    errors.push(
      err(
        'container_engine_host',
        `Must be "auto", "native", "desktop-linux", or "wsl", got ${JSON.stringify(rawContainerEngineHost)}.`,
        'Set container_engine_host to "auto", "native", "desktop-linux", or "wsl".',
      ),
    );
  } else if (rawContainerEngineHost !== undefined) {
    containerEngineHost = rawContainerEngineHost as ContainerEngineHost;
  }

  const rawContainerEngineWslDistro = data['container_engine_wsl_distro'];
  let containerEngineWslDistro: string | null = null;
  if (typeof rawContainerEngineWslDistro === 'string') {
    containerEngineWslDistro = rawContainerEngineWslDistro;
  } else if (
    rawContainerEngineWslDistro !== undefined
    && rawContainerEngineWslDistro !== null
  ) {
    errors.push(
      err(
        'container_engine_wsl_distro',
        `Must be null or a string, got ${JSON.stringify(rawContainerEngineWslDistro)}.`,
        'Set container_engine_wsl_distro to null or a WSL distro name string.',
      ),
    );
  }

  if (
    containerEngineHost === 'wsl'
    && !isValidWslDistroName(containerEngineWslDistro)
  ) {
    errors.push(
      err(
        'container_engine_wsl_distro',
        `Must be a non-empty WSL distro name without path separators when container_engine_host is "wsl", got ${JSON.stringify(rawContainerEngineWslDistro)}.`,
        'Set container_engine_wsl_distro to a WSL distro name such as "Ubuntu".',
      ),
    );
  }

  // max_parallel_tasks
  let maxParallelTasks = 10;
  const rawMaxParallel = data['max_parallel_tasks'];
  if (rawMaxParallel === undefined) {
    maxParallelTasks = 10;
  } else if (
    typeof rawMaxParallel !== 'number'
    || !Number.isInteger(rawMaxParallel)
    || rawMaxParallel < 1
  ) {
    errors.push(
      err(
        'max_parallel_tasks',
        `Must be a positive integer ≥ 1, got ${JSON.stringify(rawMaxParallel)}.`,
        'Set max_parallel_tasks to a positive integer.',
      ),
    );
  } else {
    maxParallelTasks = rawMaxParallel;
  }

  // retain_failed_task_worktrees
  let retainFailedTaskWorktrees = true;
  const rawRetain = data['retain_failed_task_worktrees'];
  if (rawRetain === undefined) {
    retainFailedTaskWorktrees = true;
  } else if (typeof rawRetain !== 'boolean') {
    errors.push(
      err(
        'retain_failed_task_worktrees',
        `Must be a boolean, got ${JSON.stringify(rawRetain)}.`,
        'Set retain_failed_task_worktrees to true or false.',
      ),
    );
  } else {
    retainFailedTaskWorktrees = rawRetain;
  }

  // max_retained_failed_task_worktrees
  let maxRetainedFailedTaskWorktrees = 10;
  const rawMaxRetained = data['max_retained_failed_task_worktrees'];
  if (rawMaxRetained === undefined) {
    maxRetainedFailedTaskWorktrees = 10;
  } else if (
    typeof rawMaxRetained !== 'number'
    || !Number.isInteger(rawMaxRetained)
    || rawMaxRetained < 0
  ) {
    errors.push(
      err(
        'max_retained_failed_task_worktrees',
        `Must be a non-negative integer, got ${JSON.stringify(rawMaxRetained)}.`,
        'Set max_retained_failed_task_worktrees to a non-negative integer.',
      ),
    );
  } else {
    maxRetainedFailedTaskWorktrees = rawMaxRetained;
  }

  // max_retry_generations_per_slug
  let maxRetryGenerationsPerSlug = 5;
  const rawMaxRetry = data['max_retry_generations_per_slug'];
  if (rawMaxRetry === undefined) {
    maxRetryGenerationsPerSlug = 5;
  } else if (
    typeof rawMaxRetry !== 'number'
    || !Number.isInteger(rawMaxRetry)
    || rawMaxRetry < 1
  ) {
    errors.push(
      err(
        'max_retry_generations_per_slug',
        `Must be a positive integer ≥ 1, got ${JSON.stringify(rawMaxRetry)}.`,
        'Set max_retry_generations_per_slug to a positive integer ≥ 1. Use retain_failed_task_worktrees=false to disable retention instead.',
      ),
    );
  } else {
    maxRetryGenerationsPerSlug = rawMaxRetry;
  }

  // completed_task_runtime_retention_ms
  let completedTaskRuntimeRetentionMs = 3600000;
  const rawRetentionMs = data['completed_task_runtime_retention_ms'];
  if (rawRetentionMs === undefined) {
    completedTaskRuntimeRetentionMs = 3600000;
  } else if (
    typeof rawRetentionMs !== 'number'
    || !Number.isInteger(rawRetentionMs)
    || rawRetentionMs < 0
  ) {
    errors.push(
      err(
        'completed_task_runtime_retention_ms',
        `Must be a non-negative integer, got ${JSON.stringify(rawRetentionMs)}.`,
        'Set completed_task_runtime_retention_ms to a non-negative integer.',
      ),
    );
  } else {
    completedTaskRuntimeRetentionMs = rawRetentionMs;
  }

  // mcp_port
  let mcpPort = 8811;
  const rawPort = data['mcp_port'];
  if (rawPort !== undefined) {
    if (
      typeof rawPort !== 'number'
      || !Number.isInteger(rawPort)
      || rawPort < 1
      || rawPort > 65535
    ) {
      errors.push(
        err(
          'mcp_port',
          `Must be an integer port number from 1 to 65535, got ${JSON.stringify(rawPort)}.`,
          'Set mcp_port to a valid integer port number from 1 to 65535.',
        ),
      );
    } else {
      mcpPort = rawPort;
    }
  }

  // mcp_port_range is migration-window compatibility for one release. It is
  // read-only: when mcp_port is absent, derive mcp_port from mcp_port_range.min.
  let mcpPortRange: { min: number; max: number } | undefined;
  const rawPortRange = data['mcp_port_range'];
  if (rawPortRange !== undefined) {
    if (
      !isRecord(rawPortRange)
      || typeof rawPortRange['min'] !== 'number'
      || typeof rawPortRange['max'] !== 'number'
      || !Number.isInteger(rawPortRange['min'])
      || !Number.isInteger(rawPortRange['max'])
      || rawPortRange['min'] < 1
      || rawPortRange['max'] > 65535
      || rawPortRange['min'] > rawPortRange['max']
    ) {
      errors.push(
        err(
          'mcp_port_range',
          `Must be an object { min, max } with 1 ≤ min ≤ max ≤ 65535, got ${JSON.stringify(rawPortRange)}.`,
          'Set mcp_port_range to an object with valid integer min and max port numbers.',
        ),
      );
    } else {
      mcpPortRange = { min: rawPortRange['min'] as number, max: rawPortRange['max'] as number };
      if (rawPort === undefined) {
        mcpPort = mcpPortRange.min;
      }
    }
  }

  // repo_context_mcp_external_mount_roots
  let repoContextMcpExternalMountRoots: string[] = [];
  const rawExternalMountRoots = data['repo_context_mcp_external_mount_roots'];
  if (rawExternalMountRoots !== undefined) {
    if (!Array.isArray(rawExternalMountRoots)) {
      errors.push(
        err(
          'repo_context_mcp_external_mount_roots',
          `Must be an array of absolute paths, got ${JSON.stringify(rawExternalMountRoots)}.`,
          'Set repo_context_mcp_external_mount_roots to an array of absolute host paths.',
        ),
      );
    } else {
      repoContextMcpExternalMountRoots = rawExternalMountRoots.filter((root): root is string => {
        if (typeof root !== 'string' || !path.isAbsolute(root)) {
          errors.push(
            err(
              'repo_context_mcp_external_mount_roots',
              `Each entry must be an absolute host path, got ${JSON.stringify(root)}.`,
              'Use absolute host paths in repo_context_mcp_external_mount_roots.',
            ),
          );
          return false;
        }
        return true;
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    config: {
      schema_version: version as number,
      cli_provider: cliProvider,
      container_runtime: containerRuntime as ContainerBackend,
      container_engine_host: containerEngineHost,
      container_engine_wsl_distro: containerEngineWslDistro,
      max_parallel_tasks: maxParallelTasks,
      retain_failed_task_worktrees: retainFailedTaskWorktrees,
      max_retained_failed_task_worktrees: maxRetainedFailedTaskWorktrees,
      max_retry_generations_per_slug: maxRetryGenerationsPerSlug,
      completed_task_runtime_retention_ms: completedTaskRuntimeRetentionMs,
      mcp_port: mcpPort,
      repo_context_mcp_external_mount_roots: repoContextMcpExternalMountRoots,
    } satisfies PlatformConfig,
    raw,
  };
}
