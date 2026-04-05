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

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    config: {
      schema_version: version as number,
      container_runtime: containerRuntime as ContainerBackend,
    } satisfies PlatformConfig,
    raw,
  };
}
