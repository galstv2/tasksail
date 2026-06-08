/**
 * External MCP registry loader and validator.
 *
 * All consumers should use loadExternalMcpRegistry() to access external
 * registry data. Do not parse the JSON file directly.
 *
 * This module is intentionally separate from the internal MCP registry
 * loader (src/backend/platform/mcp-registry/load.ts).
 */
import path from 'node:path';

import { readTextFile, safeJsonParse } from '../core/io.js';
import { isRecord } from '../core/guards.js';

import type {
  ExternalMcpLocalServer,
  ExternalMcpRegistry,
  ExternalMcpRegistryLoadResult,
  ExternalMcpServer,
  ExternalMcpTransport,
  ExternalMcpUrlServer,
  ExternalMcpValidationError,
} from './types.js';
import {
  ALLOWED_TRANSPORTS,
  CURRENT_SCHEMA_VERSION,
  MAX_ARGS_ITEMS,
  MAX_COMMAND_LENGTH,
  MAX_ENV_VARS,
  MAX_FALLBACK_DESCRIPTION_LENGTH,
  MAX_PREFERRED_FOR_ITEM_LENGTH,
  MAX_PREFERRED_FOR_ITEMS,
  MAX_PURPOSE_LENGTH,
  MIN_PURPOSE_LENGTH,
  MAX_TOOLS_ITEMS,
} from './types.js';

/** Default seed registry path relative to repo root. */
export const DEFAULT_REGISTRY_PATH = 'config/mcp-registry-external.default.json';

/** Runtime registry path relative to repo root. */
export const RUNTIME_REGISTRY_PATH = '.platform-state/mcp-registry-external.json';

/** Sentinel field value for file-not-found errors. */
export const FILE_NOT_FOUND_FIELD = '(file-not-found)';

const HAS_VAR_REF = /\$\{/;

/**
 * Well-formed env var reference: ${IDENTIFIER}
 * Must be the entire value (no partial references or concatenation).
 */
export const ENV_VAR_REF_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * Load and validate the external MCP registry from a JSON file.
 *
 * Returns a result type — never throws for validation failures.
 */
export async function loadExternalMcpRegistry(
  registryPath: string,
): Promise<ExternalMcpRegistryLoadResult> {
  const raw = await readTextFile(registryPath);
  if (raw === undefined) {
    return {
      ok: false,
      errors: [{
        field: FILE_NOT_FOUND_FIELD,
        message: `Registry file not found: ${registryPath}`,
        fix: 'Run "pnpm run setup" to seed the external MCP registry.',
      }],
    };
  }

  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw, registryPath);
  } catch (e: unknown) {
    return {
      ok: false,
      errors: [{
        field: '(file)',
        message: e instanceof Error ? e.message : 'Invalid JSON',
        fix: 'Delete the file and re-run "pnpm run setup" to re-seed.',
      }],
    };
  }

  return validateExternalMcpRegistry(parsed);
}

/**
 * Load and validate the checked-in default external registry.
 */
export async function loadDefaultExternalRegistry(
  repoRoot: string,
): Promise<ExternalMcpRegistryLoadResult> {
  return loadExternalMcpRegistry(path.join(repoRoot, DEFAULT_REGISTRY_PATH));
}

function err(field: string, message: string, fix: string): ExternalMcpValidationError {
  return { field, message, fix };
}

export function validateExternalMcpRegistry(data: unknown): ExternalMcpRegistryLoadResult {
  const errors: ExternalMcpValidationError[] = [];

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
      'Delete .platform-state/mcp-registry-external.json and re-run "pnpm run setup" to re-seed.',
    ));
  }

  const servers = data['external_servers'];
  if (servers !== undefined && !Array.isArray(servers)) {
    errors.push(err('external_servers', 'Must be an array.', 'Set "external_servers": [] or omit it entirely.'));
    return { ok: false, errors };
  }

  const serverArray = (servers ?? []) as unknown[];
  const validated: ExternalMcpServer[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < serverArray.length; i++) {
    const prefix = `external_servers[${i}]`;
    const result = validateServerEntry(serverArray[i], prefix, seenIds);
    if ('errors' in result) {
      errors.push(...result.errors);
    } else {
      validated.push(result.server);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    registry: {
      schema_version: version as number,
      external_servers: validated,
    },
  };
}

type ServerResult =
  | { server: ExternalMcpServer }
  | { errors: ExternalMcpValidationError[] };

function validateServerEntry(
  data: unknown,
  prefix: string,
  seenIds: Set<string>,
): ServerResult {
  const errors: ExternalMcpValidationError[] = [];

  if (!isRecord(data)) {
    return { errors: [err(prefix, 'Server entry must be an object.', 'Each entry in "external_servers" must be a { } object.')] };
  }

  const id = requireString(data, 'id', prefix, errors);
  if (id !== undefined) {
    if (seenIds.has(id)) {
      errors.push(err(`${prefix}.id`, `Duplicate server ID "${id}".`, 'Remove the duplicate entry or use a unique ID.'));
    } else {
      seenIds.add(id);
    }
  }

  const displayName = requireString(data, 'display_name', prefix, errors);

  const purpose = requireString(data, 'purpose', prefix, errors);
  if (purpose !== undefined && purpose.length > MAX_PURPOSE_LENGTH) {
    errors.push(err(
      `${prefix}.purpose`,
      `Purpose is ${purpose.length} characters, exceeding the ${MAX_PURPOSE_LENGTH}-character limit.`,
      `Keep purpose to a short phrase (max ${MAX_PURPOSE_LENGTH} characters).`,
    ));
  }
  if (purpose !== undefined && purpose.length < MIN_PURPOSE_LENGTH) {
    errors.push(err(
      `${prefix}.purpose`,
      `Server purpose must describe when to use this server (at least ${MIN_PURPOSE_LENGTH} characters).`,
      `Describe what this server provides and when an agent should use it (min ${MIN_PURPOSE_LENGTH} characters).`,
    ));
  }

  let preferredFor: string[] | undefined;
  if (data['preferred_for'] === undefined) {
    errors.push(err(
      `${prefix}.preferred_for`,
      'Server preferred_for requires at least one usage cue.',
      'Add "preferred_for": ["cue"] with at least one task cue for when agents should use this server.',
    ));
  } else {
    if (!Array.isArray(data['preferred_for'])) {
      errors.push(err(`${prefix}.preferred_for`, 'Must be an array of strings.', 'Set "preferred_for": ["cue1", "cue2"] with at least one usage cue.'));
    } else {
      const arr = data['preferred_for'] as unknown[];
      if (arr.length === 0) {
        errors.push(err(`${prefix}.preferred_for`, 'Server preferred_for requires at least one usage cue.', 'Add at least one usage cue.'));
      } else if (arr.length > MAX_PREFERRED_FOR_ITEMS) {
        errors.push(err(
          `${prefix}.preferred_for`,
          `Too many items (${arr.length}), maximum is ${MAX_PREFERRED_FOR_ITEMS}.`,
          `Keep preferred_for to at most ${MAX_PREFERRED_FOR_ITEMS} concise cues.`,
        ));
      } else {
        preferredFor = [];
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          if (typeof item !== 'string' || item.trim().length === 0) {
            errors.push(err(`${prefix}.preferred_for[${i}]`, 'Must be a non-empty string.', 'Each preferred_for item must be a short cue string.'));
            continue;
          }
          const trimmed = item.trim();
          if (trimmed.length > MAX_PREFERRED_FOR_ITEM_LENGTH) {
            errors.push(err(
              `${prefix}.preferred_for[${i}]`,
              `Item is ${trimmed.length} characters, exceeding the ${MAX_PREFERRED_FOR_ITEM_LENGTH}-character limit.`,
              `Keep each preferred_for item concise (max ${MAX_PREFERRED_FOR_ITEM_LENGTH} characters).`,
            ));
            continue;
          }
          preferredFor.push(trimmed);
        }
        if (preferredFor.length === 0) {
          errors.push(err(`${prefix}.preferred_for`, 'Server preferred_for requires at least one usage cue.', 'Add at least one non-empty usage cue.'));
        }
      }
    }
  }

  let fallbackDescription: string | undefined;
  if (data['fallback_description'] !== undefined) {
    if (typeof data['fallback_description'] !== 'string') {
      errors.push(err(`${prefix}.fallback_description`, 'Must be a string.', 'Set fallback_description to a brief capability description.'));
    } else {
      const trimmed = (data['fallback_description'] as string).trim();
      if (trimmed.length === 0) {
        errors.push(err(`${prefix}.fallback_description`, 'Must be non-empty if provided.', 'Add a brief description or omit the field entirely.'));
      } else if (trimmed.length > MAX_FALLBACK_DESCRIPTION_LENGTH) {
        errors.push(err(
          `${prefix}.fallback_description`,
          `Description is ${trimmed.length} characters, exceeding the ${MAX_FALLBACK_DESCRIPTION_LENGTH}-character limit.`,
          `Keep fallback_description concise (max ${MAX_FALLBACK_DESCRIPTION_LENGTH} characters).`,
        ));
      } else {
        fallbackDescription = trimmed;
      }
    }
  }

  const enabled = requireBoolean(data, 'enabled', prefix, errors);

  const transport = requireString(data, 'transport', prefix, errors);
  if (transport !== undefined && !ALLOWED_TRANSPORTS.includes(transport as ExternalMcpTransport)) {
    errors.push(err(
      `${prefix}.transport`,
      `Unsupported transport "${transport}".`,
      `Use one of: ${ALLOWED_TRANSPORTS.join(', ')}`,
    ));
  }

  // Transport-conditional fields. Local servers carry command/args/env/cwd
  // and a required tools allowlist; url servers carry url/headers and an
  // optional tools allowlist.
  const isLocalTransport = transport === 'local';

  let url: string | undefined;
  let headers: Record<string, string> | undefined;
  let command: string | undefined;
  let args: string[] | undefined;
  let env: Record<string, string> | undefined;
  let cwd: string | undefined;
  let tools: string[] | undefined;

  if (isLocalTransport) {
    // Local (stdio) server: command-launched child process. url/headers are
    // not valid on a local entry.
    if (data['url'] !== undefined) {
      errors.push(err(`${prefix}.url`, 'A local server must not declare a url.', 'Remove "url" from local entries and set "command".'));
    }
    if (data['headers'] !== undefined) {
      errors.push(err(`${prefix}.headers`, 'A local server must not declare headers.', 'Remove "headers"; use "env" for local server environment variables.'));
    }

    command = requireString(data, 'command', prefix, errors);
    if (command !== undefined && command.length > MAX_COMMAND_LENGTH) {
      errors.push(err(
        `${prefix}.command`,
        `Command is ${command.length} characters, exceeding the ${MAX_COMMAND_LENGTH}-character limit.`,
        `Keep command under ${MAX_COMMAND_LENGTH} characters.`,
      ));
    }

    // args preserve their exact value (no trim); env values may be ${ENV_VAR}.
    args = validateStringArrayField(data, 'args', prefix, errors, MAX_ARGS_ITEMS, false);
    env = validateEnvRefMap(data, 'env', prefix, errors, MAX_ENV_VARS);
    cwd = validateAbsoluteCwd(data, prefix, errors);

    // tools: required, non-empty, must not contain '*'.
    if (data['tools'] === undefined) {
      errors.push(err(`${prefix}.tools`, 'A local server must declare a non-empty tools allowlist.', 'Set "tools": ["tool_a", "tool_b"]; explicit tools are required for local servers.'));
    } else {
      tools = validateStringArrayField(data, 'tools', prefix, errors, MAX_TOOLS_ITEMS, true);
      if (tools !== undefined) {
        if (tools.length === 0) {
          errors.push(err(`${prefix}.tools`, 'tools must be a non-empty array.', 'List at least one tool name; local servers cannot use an empty allowlist.'));
        } else if (tools.includes('*')) {
          errors.push(err(`${prefix}.tools`, 'A local server must not use the "*" tool wildcard.', 'List explicit tool names; "*" is not permitted for local servers.'));
        }
      }
    }
  } else {
    url = requireString(data, 'url', prefix, errors);
    if (url !== undefined) {
      validateUrl(url, `${prefix}.url`, errors);
    }

    // Header values may contain whole-value ${ENV_VAR} references.
    if (data['headers'] !== undefined) {
      if (!isRecord(data['headers'])) {
        errors.push(err(`${prefix}.headers`, 'Must be an object.', 'Use "headers": { "Name": "value" } with string values.'));
      } else {
        headers = {};
        for (const [key, val] of Object.entries(data['headers'] as Record<string, unknown>)) {
          if (typeof val !== 'string') {
            errors.push(err(`${prefix}.headers.${key}`, 'Value must be a string.', 'Header values must be strings or ${ENV_VAR} references.'));
            continue;
          }
          const trimmed = val.trim();
          if (trimmed.length === 0) {
            errors.push(err(`${prefix}.headers.${key}`, 'Value must be non-empty.', 'Provide a header value or ${ENV_VAR} reference.'));
            continue;
          }
          if (HAS_VAR_REF.test(trimmed)) {
            if (!ENV_VAR_REF_PATTERN.test(trimmed)) {
              errors.push(err(
                `${prefix}.headers.${key}`,
                `Malformed variable reference "${trimmed}".`,
                'Use the format ${ENV_VAR_NAME}. The entire value must be a single reference.',
              ));
              continue;
            }
          }
          headers[key] = trimmed;
        }
      }
    }

    // URL servers may omit tools or use the wildcard.
    tools = validateStringArrayField(data, 'tools', prefix, errors, MAX_TOOLS_ITEMS, true);
  }

  // agent_scope is no longer an assignment source. A stale agent_scope field in
  // input JSON is ignored here and stripped from normalized output (see below);
  // per-agent assignment now lives in external-mcp-agent-assignments.json.

  if (errors.length > 0) {
    return { errors };
  }

  let server: ExternalMcpServer;
  if (isLocalTransport) {
    const localServer: ExternalMcpLocalServer = {
      id: id!,
      display_name: displayName!,
      purpose: purpose!,
      enabled: enabled!,
      transport: 'local',
      command: command!,
      tools: tools!,
    };
    if (args !== undefined) {
      localServer.args = args;
    }
    if (env !== undefined && Object.keys(env).length > 0) {
      localServer.env = env;
    }
    if (cwd !== undefined) {
      localServer.cwd = cwd;
    }
    server = localServer;
  } else {
    const urlServer: ExternalMcpUrlServer = {
      id: id!,
      display_name: displayName!,
      purpose: purpose!,
      enabled: enabled!,
      transport: transport as 'http' | 'sse',
      url: url!,
    };
    if (headers !== undefined && Object.keys(headers).length > 0) {
      urlServer.headers = headers;
    }
    if (tools !== undefined) {
      urlServer.tools = tools;
    }
    server = urlServer;
  }

  if (preferredFor !== undefined) {
    server.preferred_for = preferredFor;
  }
  if (fallbackDescription !== undefined) {
    server.fallback_description = fallbackDescription;
  }

  return { server };
}

/**
 * Validate an optional array-of-strings field. Returns the (optionally
 * trimmed) values, or undefined when the field is absent. A present-but-
 * malformed field pushes errors and returns an empty array. args preserve
 * their exact value (trim=false); identifier-like fields such as tools are
 * trimmed (trim=true).
 */
function validateStringArrayField(
  data: Record<string, unknown>,
  field: string,
  prefix: string,
  errors: ExternalMcpValidationError[],
  maxItems: number,
  trim: boolean,
): string[] | undefined {
  const raw = data[field];
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    errors.push(err(`${prefix}.${field}`, 'Must be an array of strings.', `Set "${field}": ["a", "b"] or omit it.`));
    return [];
  }
  if (raw.length > maxItems) {
    errors.push(err(`${prefix}.${field}`, `Too many items (${raw.length}), maximum is ${maxItems}.`, `Keep ${field} to at most ${maxItems} entries.`));
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(err(`${prefix}.${field}[${i}]`, 'Must be a non-empty string.', `Each ${field} entry must be a non-empty string.`));
      continue;
    }
    out.push(trim ? item.trim() : item);
  }
  return out;
}

/**
 * Validate a string→string map whose values are literals or whole-value
 * ${ENV_VAR} references (the same convention as header values). Returns the
 * trimmed map, or undefined when the field is absent.
 */
function validateEnvRefMap(
  data: Record<string, unknown>,
  field: string,
  prefix: string,
  errors: ExternalMcpValidationError[],
  maxVars: number,
): Record<string, string> | undefined {
  const raw = data[field];
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    errors.push(err(`${prefix}.${field}`, 'Must be an object.', `Use "${field}": { "NAME": "value" } with string values.`));
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > maxVars) {
    errors.push(err(`${prefix}.${field}`, `Too many entries (${entries.length}), maximum is ${maxVars}.`, `Keep ${field} to at most ${maxVars} variables.`));
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, val] of entries) {
    if (key.trim().length === 0) {
      errors.push(err(`${prefix}.${field}`, 'Variable names must be non-empty.', `Each ${field} key must be a non-empty variable name.`));
      continue;
    }
    if (typeof val !== 'string') {
      errors.push(err(`${prefix}.${field}.${key}`, 'Value must be a string.', `${field} values must be strings or \${ENV_VAR} references.`));
      continue;
    }
    const trimmed = val.trim();
    if (trimmed.length === 0) {
      errors.push(err(`${prefix}.${field}.${key}`, 'Value must be non-empty.', `Provide a ${field} value or \${ENV_VAR} reference.`));
      continue;
    }
    if (HAS_VAR_REF.test(trimmed) && !ENV_VAR_REF_PATTERN.test(trimmed)) {
      errors.push(err(
        `${prefix}.${field}.${key}`,
        `Malformed variable reference "${trimmed}".`,
        'Use the format ${ENV_VAR_NAME}. The entire value must be a single reference.',
      ));
      continue;
    }
    out[key] = trimmed;
  }
  return out;
}

/**
 * Validate an optional cwd field: must be an absolute path when present.
 * A relative cwd is rejected to avoid surprising resolution against the
 * launcher working directory.
 */
function validateAbsoluteCwd(
  data: Record<string, unknown>,
  prefix: string,
  errors: ExternalMcpValidationError[],
): string | undefined {
  const raw = data['cwd'];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    errors.push(err(`${prefix}.cwd`, 'Must be a non-empty string.', 'Set cwd to an absolute path or omit it.'));
    return undefined;
  }
  if (!path.isAbsolute(raw)) {
    errors.push(err(`${prefix}.cwd`, `cwd must be an absolute path, got "${raw}".`, 'Use an absolute path for cwd to avoid surprising resolution against the launcher working directory.'));
    return undefined;
  }
  return raw;
}

/** Hostnames allowed with http:// (local development only). */
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function validateUrl(
  url: string,
  field: string,
  errors: ExternalMcpValidationError[],
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    errors.push(err(field, `"${url}" is not a valid absolute URL.`, 'Provide a full URL starting with https:// (or http:// for local dev).'));
    return;
  }

  const scheme = parsed.protocol.replace(/:$/, '');
  if (scheme !== 'https' && scheme !== 'http') {
    errors.push(err(
      field,
      `URL scheme "${scheme}" is not supported.`,
      'Use https:// for production or http:// for local development.',
    ));
    return;
  }

  if (scheme === 'http' && !LOCAL_DEV_HOSTS.has(parsed.hostname)) {
    errors.push(err(
      field,
      `http:// is only allowed for local development hosts (${[...LOCAL_DEV_HOSTS].join(', ')}). Got "${parsed.hostname}".`,
      'Use https:// for remote endpoints or http://localhost for local dev.',
    ));
  }
}

/**
 * Load the external MCP registry, trying the runtime file first and
 * falling back to the checked-in default if the runtime file is missing.
 *
 * Returns a valid empty registry if neither file exists.
 */
export async function loadExternalMcpRegistryWithFallback(
  repoRoot: string,
): Promise<ExternalMcpRegistry> {
  const runtimePath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);
  const result = await loadExternalMcpRegistry(runtimePath);
  if (result.ok) return result.registry;

  const isNotFound = result.errors.length === 1
    && result.errors[0].field === FILE_NOT_FOUND_FIELD;
  if (isNotFound) {
    const defaultResult = await loadDefaultExternalRegistry(repoRoot);
    if (defaultResult.ok) return defaultResult.registry;
  }

  return { schema_version: CURRENT_SCHEMA_VERSION, external_servers: [] };
}

function requireString(
  data: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: ExternalMcpValidationError[],
): string | undefined {
  const val = data[key];
  if (typeof val !== 'string') {
    errors.push(err(`${prefix}.${key}`, `Required string field "${key}" is missing or not a string.`, `Add a non-empty "${key}" value.`));
    return undefined;
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    errors.push(err(`${prefix}.${key}`, `Required string field "${key}" is empty or blank.`, `Add a non-empty "${key}" value.`));
    return undefined;
  }
  return trimmed;
}

function requireBoolean(
  data: Record<string, unknown>,
  key: string,
  prefix: string,
  errors: ExternalMcpValidationError[],
): boolean | undefined {
  const val = data[key];
  if (typeof val !== 'boolean') {
    errors.push(err(`${prefix}.${key}`, `Required boolean field "${key}" is missing or not a boolean.`, `Add "${key}": true or "${key}": false.`));
    return undefined;
  }
  return val;
}
