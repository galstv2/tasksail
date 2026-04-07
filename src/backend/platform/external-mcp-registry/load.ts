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
  ExternalMcpAgentScope,
  ExternalMcpRegistry,
  ExternalMcpRegistryLoadResult,
  ExternalMcpServer,
  ExternalMcpTransport,
  ExternalMcpValidationError,
} from './types.js';
import {
  ALLOWED_TRANSPORTS,
  CURRENT_SCHEMA_VERSION,
  MAX_FALLBACK_DESCRIPTION_LENGTH,
  MAX_PREFERRED_FOR_ITEM_LENGTH,
  MAX_PREFERRED_FOR_ITEMS,
  MAX_PURPOSE_LENGTH,
} from './types.js';

/** Default seed registry path relative to repo root. */
export const DEFAULT_REGISTRY_PATH = 'config/mcp-registry-external.default.json';

/** Runtime registry path relative to repo root. */
export const RUNTIME_REGISTRY_PATH = '.platform-state/mcp-registry-external.json';

/** Sentinel field value for file-not-found errors. */
export const FILE_NOT_FOUND_FIELD = '(file-not-found)';

/**
 * Detect any ${...} reference in a string.
 */
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function err(field: string, message: string, fix: string): ExternalMcpValidationError {
  return { field, message, fix };
}

export function validateExternalMcpRegistry(data: unknown): ExternalMcpRegistryLoadResult {
  const errors: ExternalMcpValidationError[] = [];

  if (!isRecord(data)) {
    errors.push(err('(root)', 'Registry must be a JSON object.', 'Ensure the file contains a top-level { } object.'));
    return { ok: false, errors };
  }

  // Schema version
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

  // external_servers — optional, defaults to empty
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

// ---------------------------------------------------------------------------
// Server entry validation
// ---------------------------------------------------------------------------

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

  // id
  const id = requireString(data, 'id', prefix, errors);
  if (id !== undefined) {
    if (seenIds.has(id)) {
      errors.push(err(`${prefix}.id`, `Duplicate server ID "${id}".`, 'Remove the duplicate entry or use a unique ID.'));
    } else {
      seenIds.add(id);
    }
  }

  // display_name
  const displayName = requireString(data, 'display_name', prefix, errors);

  // purpose — required, length-limited
  const purpose = requireString(data, 'purpose', prefix, errors);
  if (purpose !== undefined && purpose.length > MAX_PURPOSE_LENGTH) {
    errors.push(err(
      `${prefix}.purpose`,
      `Purpose is ${purpose.length} characters, exceeding the ${MAX_PURPOSE_LENGTH}-character limit.`,
      `Keep purpose to a short phrase (max ${MAX_PURPOSE_LENGTH} characters).`,
    ));
  }

  // preferred_for — optional, must be non-empty array of short strings
  let preferredFor: string[] | undefined;
  if (data['preferred_for'] !== undefined) {
    if (!Array.isArray(data['preferred_for'])) {
      errors.push(err(`${prefix}.preferred_for`, 'Must be an array of strings.', 'Set "preferred_for": ["cue1", "cue2"] or omit it.'));
    } else {
      const arr = data['preferred_for'] as unknown[];
      if (arr.length === 0) {
        errors.push(err(`${prefix}.preferred_for`, 'Must be a non-empty array if provided.', 'Add at least one item or omit the field entirely.'));
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
      }
    }
  }

  // fallback_description — optional, length-limited
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

  // enabled
  const enabled = requireBoolean(data, 'enabled', prefix, errors);

  // transport
  const transport = requireString(data, 'transport', prefix, errors);
  if (transport !== undefined && !ALLOWED_TRANSPORTS.includes(transport as ExternalMcpTransport)) {
    errors.push(err(
      `${prefix}.transport`,
      `Unsupported transport "${transport}".`,
      `Use one of: ${ALLOWED_TRANSPORTS.join(', ')}`,
    ));
  }

  // url — must be absolute https:// (or http:// for local dev)
  const url = requireString(data, 'url', prefix, errors);
  if (url !== undefined) {
    validateUrl(url, `${prefix}.url`, errors);
  }

  // headers — optional, values may contain ${ENV_VAR} references
  let headers: Record<string, string> | undefined;
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

  // agent_scope
  let agentScope: ExternalMcpAgentScope | undefined;
  if (!isRecord(data['agent_scope'])) {
    errors.push(err(`${prefix}.agent_scope`, 'Must be an object.', 'Add "agent_scope": { "mode": "allowlist", "agent_ids": [...] }.'));
  } else {
    agentScope = validateAgentScope(data['agent_scope'], `${prefix}.agent_scope`, errors);
  }

  if (errors.length > 0) {
    return { errors };
  }

  const server: ExternalMcpServer = {
    id: id!,
    display_name: displayName!,
    purpose: purpose!,
    enabled: enabled!,
    transport: transport as ExternalMcpTransport,
    url: url!,
    agent_scope: agentScope!,
  };

  if (preferredFor !== undefined) {
    server.preferred_for = preferredFor;
  }
  if (fallbackDescription !== undefined) {
    server.fallback_description = fallbackDescription;
  }
  if (headers !== undefined && Object.keys(headers).length > 0) {
    server.headers = headers;
  }

  return { server };
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Agent scope validation
// ---------------------------------------------------------------------------

function validateAgentScope(
  data: Record<string, unknown>,
  prefix: string,
  errors: ExternalMcpValidationError[],
): ExternalMcpAgentScope | undefined {
  const mode = data['mode'];
  if (mode !== 'allowlist') {
    errors.push(err(`${prefix}.mode`, `Unsupported mode "${String(mode)}".`, 'Use "mode": "allowlist".'));
  }

  if (!Array.isArray(data['agent_ids'])) {
    errors.push(err(`${prefix}.agent_ids`, 'Must be an array of agent ID strings.', 'Add "agent_ids": ["software-engineer", "qa"] listing which agents should see this server.'));
    return undefined;
  }

  const agentIds: string[] = [];
  for (let i = 0; i < (data['agent_ids'] as unknown[]).length; i++) {
    const item = (data['agent_ids'] as unknown[])[i];
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(err(`${prefix}.agent_ids[${i}]`, 'Must be a non-empty string.', 'Each agent_id must be a string identifier.'));
      continue;
    }
    agentIds.push(item.trim());
  }

  if (agentIds.length === 0 && errors.length === 0) {
    errors.push(err(`${prefix}.agent_ids`, 'Must contain at least one agent ID.', 'Add at least one agent ID to the allowlist.'));
    return undefined;
  }

  if (errors.length > 0) {
    return undefined;
  }

  return { mode: 'allowlist', agent_ids: agentIds };
}

// ---------------------------------------------------------------------------
// Agent filtering
// ---------------------------------------------------------------------------

/**
 * Return enabled external servers whose agent_scope includes the given agent.
 *
 * Agent IDs in agent_scope are NOT validated against the agent registry.
 * Unknown IDs are harmless no-ops.
 */
export function resolveBehavioralBaseMcpAgentId(agentId: string): string {
  return agentId === 'dalton-verify' ? 'dalton' : agentId;
}

export function getExternalServersForAgent(
  registry: ExternalMcpRegistry,
  agentId: string,
): ExternalMcpServer[] {
  const effectiveAgentId = resolveBehavioralBaseMcpAgentId(agentId);
  return registry.external_servers.filter((s) =>
    s.enabled && s.agent_scope.agent_ids.includes(effectiveAgentId),
  );
}

// ---------------------------------------------------------------------------
// Load with fallback
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

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
