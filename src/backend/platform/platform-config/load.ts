import { isRecord, readTextFile, safeJsonParse } from '../core/index.js';
import type { ContainerBackend } from '../core/index.js';
import type {
  PlatformConfig,
  PlatformConfigLoadResult,
  PlatformConfigValidationError,
} from './types.js';
import { CURRENT_PLATFORM_CONFIG_SCHEMA_VERSION } from './types.js';

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

  // mcp_port_range
  let mcpPortRange: { min: number; max: number } = { min: 8811, max: 8820 };
  const rawPortRange = data['mcp_port_range'];
  if (rawPortRange === undefined) {
    mcpPortRange = { min: 8811, max: 8820 };
  } else if (
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
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    config: {
      schema_version: version as number,
      container_runtime: containerRuntime as ContainerBackend,
      max_parallel_tasks: maxParallelTasks,
      retain_failed_task_worktrees: retainFailedTaskWorktrees,
      max_retained_failed_task_worktrees: maxRetainedFailedTaskWorktrees,
      max_retry_generations_per_slug: maxRetryGenerationsPerSlug,
      completed_task_runtime_retention_ms: completedTaskRuntimeRetentionMs,
      mcp_port_range: mcpPortRange,
    } satisfies PlatformConfig,
    raw,
  };
}
