/**
 * MCP registry loader and validator.
 *
 * All platform consumers should use loadMcpRegistry() to access registry data.
 * Do not parse the JSON file directly.
 */
import path from 'node:path';

import { readTextFile, safeJsonParse } from '../core/io.js';
import { isRecord } from '../core/guards.js';

import type {
  McpComposeMetadata,
  McpHealthSpec,
  McpRegistryLoadResult,
  McpRegistryValidationError,
  McpServiceEntry,
  McpVolumeMount,
} from './types.js';
import { ALLOWED_ENV_FILE_REFS, CURRENT_SCHEMA_VERSION } from './types.js';

/** Default runtime registry path relative to repo root. */
export const RUNTIME_REGISTRY_PATH = '.platform-state/mcp-registry.json';

/** Default seed registry path relative to repo root. */
export const DEFAULT_REGISTRY_PATH = 'config/mcp-registry.default.json';

/**
 * Shell-style variable reference pattern: ${IDENTIFIER:-default}
 * Captures: full match, variable name, default value.
 */
const VAR_REF_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}(.*)$/;

const HAS_VAR_REF = /\$\{/;

/**
 * Load and validate the MCP registry from a JSON file.
 *
 * Returns a result type — never throws for validation failures.
 * Callers decide how to handle errors (log, exit, surface to UI).
 */
export async function loadMcpRegistry(
  registryPath: string,
): Promise<McpRegistryLoadResult> {
  const raw = await readTextFile(registryPath);
  if (raw === undefined) {
    return {
      ok: false,
      errors: [{
        field: '(file)',
        message: `Registry file not found: ${registryPath}`,
        fix: 'Run "pnpm run setup" to seed the runtime registry.',
      }],
    };
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw, registryPath);
  } catch (err: unknown) {
    return {
      ok: false,
      errors: [{
        field: '(file)',
        message: err instanceof Error ? err.message : 'Invalid JSON',
        fix: 'Delete the file and re-run "pnpm run setup" to re-seed.',
      }],
    };
  }

  return validateRegistry(parsed);
}

/**
 * Load and validate the checked-in default registry.
 */
export async function loadDefaultRegistry(
  repoRoot: string,
): Promise<McpRegistryLoadResult> {
  return loadMcpRegistry(path.join(repoRoot, DEFAULT_REGISTRY_PATH));
}

function err(field: string, message: string, fix: string): McpRegistryValidationError {
  return { field, message, fix };
}

export function validateRegistry(data: unknown): McpRegistryLoadResult {
  const errors: McpRegistryValidationError[] = [];

  if (!isRecord(data)) {
    errors.push(err('(root)', 'Registry must be a JSON object.', 'Ensure the file contains a top-level { } object.'));
    return { ok: false, errors };
  }

  const version = data['schema_version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    errors.push(err('schema_version', 'Must be a positive integer.', 'Set "schema_version": 1 at the top level.'));
  } else if (version > CURRENT_SCHEMA_VERSION) {
    errors.push(err(
      'schema_version',
      `Registry schema version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
      'Update your platform tooling to a version that supports this schema.',
    ));
  } else if (version < CURRENT_SCHEMA_VERSION) {
    errors.push(err(
      'schema_version',
      `Registry schema version ${version} is older than current version ${CURRENT_SCHEMA_VERSION}.`,
      'Delete .platform-state/mcp-registry.json and re-run "pnpm run setup" to re-seed.',
    ));
  }

  if (!Array.isArray(data['services'])) {
    errors.push(err('services', 'Must be an array.', 'Add a "services": [] array to the registry.'));
    return { ok: false, errors };
  }

  const services: McpServiceEntry[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < (data['services'] as unknown[]).length; i++) {
    const prefix = `services[${i}]`;
    const entry = (data['services'] as unknown[])[i];
    const result = validateServiceEntry(entry, prefix, seenIds);
    if ('errors' in result) {
      errors.push(...result.errors);
    } else {
      services.push(result.service);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    registry: {
      schema_version: version as number,
      services,
    },
  };
}

type ServiceResult =
  | { service: McpServiceEntry }
  | { errors: McpRegistryValidationError[] };

function validateServiceEntry(
  data: unknown,
  prefix: string,
  seenIds: Set<string>,
): ServiceResult {
  const errors: McpRegistryValidationError[] = [];

  if (!isRecord(data)) {
    return { errors: [err(prefix, 'Service entry must be an object.', 'Each entry in "services" must be a { } object.')] };
  }

  const id = requireString(data, 'id', prefix, errors);
  const displayName = requireString(data, 'displayName', prefix, errors);

  if (id !== undefined) {
    if (seenIds.has(id)) {
      errors.push(err(`${prefix}.id`, `Duplicate service ID "${id}".`, 'Remove the duplicate entry or use a unique ID.'));
    } else {
      seenIds.add(id);
    }
  }

  const kind = requireString(data, 'kind', prefix, errors);
  if (kind !== undefined && kind !== 'container-http') {
    errors.push(err(`${prefix}.kind`, `Unsupported kind "${kind}".`, 'Use "container-http" — it is the only supported kind.'));
  }

  const enabled = requireBoolean(data, 'enabled', prefix, errors);
  const builtin = requireBoolean(data, 'builtin', prefix, errors);

  let compose: McpComposeMetadata | undefined;
  if (!isRecord(data['compose'])) {
    errors.push(err(`${prefix}.compose`, 'Must be an object.', 'Add a "compose" object with service metadata.'));
  } else {
    const composeResult = validateComposeMetadata(data['compose'], `${prefix}.compose`);
    if ('errors' in composeResult) {
      errors.push(...composeResult.errors);
    } else {
      compose = composeResult.compose;
    }
  }

  let health: McpHealthSpec | undefined;
  if (!isRecord(data['health'])) {
    errors.push(err(`${prefix}.health`, 'Must be an object.', 'Add a "health" object with url, maxRetries, retryIntervalMs.'));
  } else {
    const healthResult = validateHealthSpec(data['health'], `${prefix}.health`);
    if ('errors' in healthResult) {
      errors.push(...healthResult.errors);
    } else {
      health = healthResult.health;
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    service: {
      id: id!,
      displayName: displayName!,
      kind: kind as 'container-http',
      enabled: enabled!,
      builtin: builtin!,
      compose: compose!,
      health: health!,
    },
  };
}

type ComposeResult =
  | { compose: McpComposeMetadata }
  | { errors: McpRegistryValidationError[] };

function validateComposeMetadata(data: Record<string, unknown>, prefix: string): ComposeResult {
  const errors: McpRegistryValidationError[] = [];

  const serviceName = requireString(data, 'serviceName', prefix, errors);
  const containerName = requireString(data, 'containerName', prefix, errors);
  const image = requireString(data, 'image', prefix, errors);
  const dockerfile = requireString(data, 'dockerfile', prefix, errors);
  const buildContext = requireString(data, 'buildContext', prefix, errors);
  const hostBind = requireString(data, 'hostBind', prefix, errors);
  const hostPort = requirePositiveInt(data, 'hostPort', prefix, errors);
  const containerPort = requirePositiveInt(data, 'containerPort', prefix, errors);
  const memoryLimit = requireString(data, 'memoryLimit', prefix, errors);
  const cpuLimit = requireString(data, 'cpuLimit', prefix, errors);
  const stopGracePeriod = requireString(data, 'stopGracePeriod', prefix, errors);

  if (dockerfile !== undefined) {
    validateRepoRelativePath(dockerfile, `${prefix}.dockerfile`, errors);
  }
  // buildContext is relative to the Dockerfile directory (compose convention).
  // Validate that resolving it from the Dockerfile dir stays within the repo.
  if (buildContext !== undefined && dockerfile !== undefined) {
    validateBuildContextPath(buildContext, dockerfile, `${prefix}.buildContext`, errors);
  }

  let envFileRefs: string[] = [];
  if (!Array.isArray(data['envFileRefs'])) {
    errors.push(err(`${prefix}.envFileRefs`, 'Must be an array.', 'Add "envFileRefs": [".env"] to the compose object.'));
  } else {
    envFileRefs = [];
    for (let i = 0; i < (data['envFileRefs'] as unknown[]).length; i++) {
      const ref = (data['envFileRefs'] as unknown[])[i];
      if (typeof ref !== 'string') {
        errors.push(err(`${prefix}.envFileRefs[${i}]`, 'Must be a string.', 'Each envFileRef must be a string filename.'));
        continue;
      }
      if (!ALLOWED_ENV_FILE_REFS.includes(ref)) {
        errors.push(err(
          `${prefix}.envFileRefs[${i}]`,
          `"${ref}" is not an allowed env file reference.`,
          `Use one of: ${ALLOWED_ENV_FILE_REFS.join(', ')}`,
        ));
        continue;
      }
      envFileRefs.push(ref);
    }
  }

  let environment: Record<string, string> = {};
  if (data['environment'] !== undefined) {
    if (!isRecord(data['environment'])) {
      errors.push(err(`${prefix}.environment`, 'Must be an object.', 'Use "environment": { "KEY": "value" } with string values.'));
    } else {
      environment = {};
      for (const [key, val] of Object.entries(data['environment'] as Record<string, unknown>)) {
        if (typeof val !== 'string') {
          errors.push(err(`${prefix}.environment.${key}`, 'Value must be a string.', 'Environment values must be literal strings.'));
          continue;
        }
        if (HAS_VAR_REF.test(val)) {
          errors.push(err(
            `${prefix}.environment.${key}`,
            'Static environment values must not contain variable references.',
            'Use literal string values. Variable references belong in volume paths only.',
          ));
          continue;
        }
        environment[key] = val;
      }
    }
  }

  let volumes: McpVolumeMount[] = [];
  if (!Array.isArray(data['volumes'])) {
    errors.push(err(`${prefix}.volumes`, 'Must be an array.', 'Add a "volumes" array to the compose object.'));
  } else {
    volumes = [];
    for (let i = 0; i < (data['volumes'] as unknown[]).length; i++) {
      const vol = (data['volumes'] as unknown[])[i];
      const volResult = validateVolumeMount(vol, `${prefix}.volumes[${i}]`);
      if ('errors' in volResult) {
        errors.push(...volResult.errors);
      } else {
        volumes.push(volResult.volume);
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    compose: {
      serviceName: serviceName!,
      containerName: containerName!,
      image: image!,
      dockerfile: dockerfile!,
      buildContext: buildContext!,
      hostBind: hostBind!,
      hostPort: hostPort!,
      containerPort: containerPort!,
      envFileRefs,
      environment,
      volumes,
      memoryLimit: memoryLimit!,
      cpuLimit: cpuLimit!,
      stopGracePeriod: stopGracePeriod!,
    },
  };
}

type VolumeResult =
  | { volume: McpVolumeMount }
  | { errors: McpRegistryValidationError[] };

function validateVolumeMount(data: unknown, prefix: string): VolumeResult {
  const errors: McpRegistryValidationError[] = [];

  if (!isRecord(data)) {
    return { errors: [err(prefix, 'Volume entry must be an object.', 'Each volume must be { "host": "...", "container": "...", "mode": "ro"|"rw" }.')] };
  }

  const host = requireString(data, 'host', prefix, errors);
  const container = requireString(data, 'container', prefix, errors);
  const mode = requireString(data, 'mode', prefix, errors);

  if (mode !== undefined && mode !== 'ro' && mode !== 'rw') {
    errors.push(err(`${prefix}.mode`, `Invalid mode "${mode}".`, 'Use "ro" (read-only) or "rw" (read-write).'));
  }

  // Host paths may contain ${VAR:-default} references.
  if (host !== undefined) {
    validateVolumePath(host, `${prefix}.host`, errors);
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { volume: { host: host!, container: container!, mode: mode as 'ro' | 'rw' } };
}

type HealthResult =
  | { health: McpHealthSpec }
  | { errors: McpRegistryValidationError[] };

function validateHealthSpec(data: Record<string, unknown>, prefix: string): HealthResult {
  const errors: McpRegistryValidationError[] = [];

  const url = requireString(data, 'url', prefix, errors);
  const maxRetries = requirePositiveInt(data, 'maxRetries', prefix, errors);
  const retryIntervalMs = requirePositiveInt(data, 'retryIntervalMs', prefix, errors);

  if (errors.length > 0) {
    return { errors };
  }

  return { health: { url: url!, maxRetries: maxRetries!, retryIntervalMs: retryIntervalMs! } };
}

/** Validate compose buildContext from the Dockerfile dir and reject repo escapes. */
function validateBuildContextPath(
  buildContext: string,
  dockerfile: string,
  field: string,
  errors: McpRegistryValidationError[],
): void {
  // Reject absolute paths upfront — path.join silently strips the leading
  // slash on posix (e.g. path.join('docker', '/etc') → 'docker/etc'),
  // which would bypass the escape check.
  if (path.isAbsolute(buildContext)) {
    errors.push(err(
      field,
      `Build context "${buildContext}" is an absolute path.`,
      'Use a relative path for buildContext.',
    ));
    return;
  }
  const dockerfileDir = path.dirname(dockerfile);
  const resolved = path.normalize(path.join(dockerfileDir, buildContext));
  if (resolved.startsWith('..') || path.isAbsolute(resolved)) {
    errors.push(err(
      field,
      `Build context "${buildContext}" resolves to "${resolved}" which escapes the repository root.`,
      'Ensure buildContext relative to the Dockerfile directory stays within the repo.',
    ));
  }
}

/**
 * Validate a repo-relative path does not escape the repo root.
 */
function validateRepoRelativePath(
  pathValue: string,
  field: string,
  errors: McpRegistryValidationError[],
): void {
  const normalized = path.normalize(pathValue);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    errors.push(err(
      field,
      `Path "${pathValue}" escapes the repository root.`,
      'Use a repo-relative path without ".." escapes or absolute prefixes.',
    ));
  }
}

/**
 * Validate volume host paths, leaving ${VAR:-default} for compose while
 * requiring each default path to stay repo-relative and well-formed.
 */
export function validateVolumePath(
  pathValue: string,
  field: string,
  errors: McpRegistryValidationError[],
): void {
  if (!HAS_VAR_REF.test(pathValue)) {
    validateRepoRelativePath(pathValue, field, errors);
    return;
  }

  const match = VAR_REF_PATTERN.exec(pathValue);
  if (!match) {
    errors.push(err(
      field,
      `Malformed variable reference in "${pathValue}".`,
      'Use the format ${VARIABLE_NAME:-default/path}. Nested or unclosed references are not allowed.',
    ));
    return;
  }

  const defaultValue = match[2];
  const suffix = match[3] ?? '';

  // Nested references in defaults or suffixes are rejected before containment checks.
  if (HAS_VAR_REF.test(defaultValue) || HAS_VAR_REF.test(suffix)) {
    errors.push(err(
      field,
      `Malformed variable reference in "${pathValue}".`,
      'Use the format ${VARIABLE_NAME:-default/path}. Nested or unclosed references are not allowed.',
    ));
    return;
  }

  const fullDefault = (defaultValue + suffix).trim();
  if (fullDefault.length === 0) {
    errors.push(err(
      field,
      `Variable reference in "${pathValue}" has an empty or blank default value.`,
      'Provide a valid repo-relative default path, e.g. ${MY_VAR:-./data}.',
    ));
    return;
  }
  validateRepoRelativePath(fullDefault, `${field} (default value)`, errors);
}

function requireString(
  data: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: McpRegistryValidationError[],
): string | undefined {
  const val = data[key];
  if (typeof val !== 'string') {
    errors.push(err(`${prefix}.${key}`, `Required string field "${key}" is missing, empty, or blank.`, `Add a non-empty "${key}" value.`));
    return undefined;
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    errors.push(err(`${prefix}.${key}`, `Required string field "${key}" is missing, empty, or blank.`, `Add a non-empty "${key}" value.`));
    return undefined;
  }
  return trimmed;
}

function requireBoolean(
  data: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: McpRegistryValidationError[],
): boolean | undefined {
  const val = data[key];
  if (typeof val !== 'boolean') {
    errors.push(err(`${prefix}.${key}`, `Required boolean field "${key}" is missing or not a boolean.`, `Add "${key}": true or "${key}": false.`));
    return undefined;
  }
  return val;
}

function requirePositiveInt(
  data: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: McpRegistryValidationError[],
): number | undefined {
  const val = data[key];
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
    errors.push(err(`${prefix}.${key}`, `Required positive integer field "${key}" is missing or invalid.`, `Add a positive integer "${key}" value.`));
    return undefined;
  }
  return val;
}
