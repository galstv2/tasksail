/**
 * External MCP agent-assignment store.
 *
 * Durable per-agent assignment of external MCP servers, persisted to
 * `.platform-state/external-mcp-agent-assignments.json`. This file — NOT the
 * stale `agent_scope` field on a server entry — is the single source of truth
 * for which agents receive which external MCP servers at prompt and launch time.
 *
 * Assignment rows are keyed by provider registry agent ID (planning-agent,
 * product-manager, software-engineer, software-engineer-verify, qa). Runtime
 * agent nicknames (lily, alice, dalton, dalton-verify, ron) are mapped to their
 * provider ID at selection time. software-engineer-verify (dalton-verify) is a
 * distinct key and never inherits software-engineer's assignments.
 */
import path from 'node:path';

import { readTextFile, safeJsonParse, writeTextFileAtomic } from '../core/io.js';
import { isRecord } from '../core/guards.js';
import { getActiveProvider, getProviderFrontendDescriptor } from '../cli-provider/index.js';

import { loadExternalMcpRegistryWithFallback } from './load.js';
import type { ExternalMcpRegistry, ExternalMcpServer } from './types.js';

export const EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION = 1;

/** Runtime assignment store path relative to repo root. */
export const EXTERNAL_MCP_ASSIGNMENTS_PATH =
  '.platform-state/external-mcp-agent-assignments.json';

/** One agent's assigned external MCP server IDs. agent_id is a provider registry ID. */
export interface ExternalMcpAgentAssignment {
  agent_id: string;
  external_mcp_server_ids: string[];
}

export interface ExternalMcpAgentAssignmentsDocument {
  schema_version: 1;
  assignments: ExternalMcpAgentAssignment[];
}

export type ExternalMcpAssignmentsLoadResult =
  | { ok: true; document: ExternalMcpAgentAssignmentsDocument }
  | { ok: false; errors: string[] };

/** Result of resolving the external MCP servers visible to one agent at runtime. */
export interface ExternalMcpRuntimeSelection {
  runtimeAgentId: string;
  providerAgentId: string;
  servers: ExternalMcpServer[];
  warnings: string[];
}

function assignmentsFilePath(repoRoot: string): string {
  return path.join(repoRoot, EXTERNAL_MCP_ASSIGNMENTS_PATH);
}

/**
 * Active provider registry agent IDs in workflow order (ascending workflow_order,
 * then ID). With the current roster: planning-agent, product-manager,
 * software-engineer, qa, software-engineer-verify (qa precedes the verify role
 * because qa.workflow_order=3 and software-engineer-verify.workflow_order=99).
 */
function providerAgentIdsInOrder(repoRoot: string): string[] {
  return getProviderFrontendDescriptor(repoRoot).roster.map((entry) => entry.agentId);
}

function emptyAssignments(providerAgentIds: string[]): ExternalMcpAgentAssignmentsDocument {
  return {
    schema_version: EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION,
    assignments: providerAgentIds.map((agent_id) => ({
      agent_id,
      external_mcp_server_ids: [],
    })),
  };
}

/** Sort rows by provider workflow order, then server IDs ascending within each row. */
function sortDocument(
  rows: ExternalMcpAgentAssignment[],
  providerAgentIds: string[],
): ExternalMcpAgentAssignmentsDocument {
  const order = new Map(providerAgentIds.map((id, i) => [id, i]));
  const sorted = [...rows]
    .sort((a, b) => {
      const ai = order.get(a.agent_id) ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(b.agent_id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi || a.agent_id.localeCompare(b.agent_id);
    })
    .map((row) => ({
      agent_id: row.agent_id,
      external_mcp_server_ids: [...row.external_mcp_server_ids].sort(),
    }));
  return { schema_version: EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION, assignments: sorted };
}

function serializeDocument(document: ExternalMcpAgentAssignmentsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function persistAssignments(
  repoRoot: string,
  document: ExternalMcpAgentAssignmentsDocument,
): Promise<void> {
  await writeTextFileAtomic(assignmentsFilePath(repoRoot), serializeDocument(document));
}

/**
 * Strictly validate a parsed assignments document. Surfaces actionable errors
 * for UI, local-checks, and save callers. On success, fills any missing provider
 * agents with empty rows and returns a sorted document.
 */
export function validateAssignmentsDocument(
  parsed: unknown,
  providerAgentIds: readonly string[],
  knownServerIds: ReadonlySet<string>,
): ExternalMcpAssignmentsLoadResult {
  if (!isRecord(parsed)) {
    return { ok: false, errors: ['External MCP assignments file must be a JSON object.'] };
  }
  const errors: string[] = [];
  const doc = parsed as Record<string, unknown>;

  if (doc.schema_version !== EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION) {
    errors.push(
      `External MCP assignments schema_version must be ${EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(doc.assignments)) {
    errors.push('External MCP assignments "assignments" must be an array.');
    return { ok: false, errors };
  }

  const allowedAgents = new Set(providerAgentIds);
  const seen = new Set<string>();
  const rows: ExternalMcpAgentAssignment[] = [];

  const entries = doc.assignments as unknown[];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isRecord(entry)) {
      errors.push(`assignments[${i}] must be an object.`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.agent_id !== 'string') {
      errors.push(`assignments[${i}].agent_id must be a string.`);
      continue;
    }
    if (!allowedAgents.has(e.agent_id)) {
      errors.push(
        `assignments[${i}] references unknown agent ID "${e.agent_id}". ` +
          `Valid agent IDs: ${[...allowedAgents].join(', ')}.`,
      );
      continue;
    }
    if (seen.has(e.agent_id)) {
      errors.push(`assignments has a duplicate row for agent ID "${e.agent_id}".`);
      continue;
    }
    seen.add(e.agent_id);

    if (!Array.isArray(e.external_mcp_server_ids)) {
      errors.push(`assignments[${i}].external_mcp_server_ids must be an array.`);
      continue;
    }
    const serverIds: string[] = [];
    for (const sid of e.external_mcp_server_ids as unknown[]) {
      if (typeof sid !== 'string' || sid.trim().length === 0) {
        errors.push(`assignments[${i}] (${e.agent_id}) has a non-string server ID.`);
        continue;
      }
      if (!knownServerIds.has(sid)) {
        errors.push(
          `assignments[${i}] (${e.agent_id}) references unknown external MCP server ID "${sid}".`,
        );
        continue;
      }
      serverIds.push(sid);
    }
    rows.push({ agent_id: e.agent_id, external_mcp_server_ids: serverIds });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  for (const agentId of providerAgentIds) {
    if (!seen.has(agentId)) {
      rows.push({ agent_id: agentId, external_mcp_server_ids: [] });
    }
  }
  return { ok: true, document: sortDocument(rows, [...providerAgentIds]) };
}

/**
 * Leniently normalize whatever is on disk: drop malformed rows, keep recognized
 * provider-agent rows verbatim, fill missing agents with empty rows. Never throws.
 * Used by deletion cleanup, which must tolerate a now-unknown removed server ID.
 */
function normalizeRowsLenient(
  raw: string | undefined,
  providerAgentIds: string[],
): ExternalMcpAgentAssignment[] {
  const allowed = new Set(providerAgentIds);
  const rows: ExternalMcpAgentAssignment[] = [];
  const seen = new Set<string>();

  let parsed: unknown;
  if (raw !== undefined) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  const entries =
    isRecord(parsed) && Array.isArray((parsed as Record<string, unknown>).assignments)
      ? ((parsed as Record<string, unknown>).assignments as unknown[])
      : [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.agent_id !== 'string' || !allowed.has(e.agent_id) || seen.has(e.agent_id)) {
      continue;
    }
    if (!Array.isArray(e.external_mcp_server_ids)) continue;
    const ids = (e.external_mcp_server_ids as unknown[]).filter(
      (x): x is string => typeof x === 'string',
    );
    rows.push({ agent_id: e.agent_id, external_mcp_server_ids: ids });
    seen.add(e.agent_id);
  }

  for (const agentId of providerAgentIds) {
    if (!seen.has(agentId)) rows.push({ agent_id: agentId, external_mcp_server_ids: [] });
  }
  return rows;
}

async function loadAndValidate(
  repoRoot: string,
  registry: ExternalMcpRegistry,
): Promise<ExternalMcpAssignmentsLoadResult> {
  const providerAgentIds = providerAgentIdsInOrder(repoRoot);
  const raw = await readTextFile(assignmentsFilePath(repoRoot));
  if (raw === undefined) {
    return { ok: true, document: emptyAssignments(providerAgentIds) };
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse(raw, EXTERNAL_MCP_ASSIGNMENTS_PATH);
  } catch (e) {
    return {
      ok: false,
      errors: [e instanceof Error ? e.message : 'Invalid JSON in external MCP assignments file.'],
    };
  }
  const knownServerIds = new Set(registry.external_servers.map((s) => s.id));
  return validateAssignmentsDocument(parsed, providerAgentIds, knownServerIds);
}

/**
 * Load and strictly validate the assignment store for UI / local-checks / save
 * callers. A missing file resolves to empty assignments for every active provider
 * agent. A malformed or invalid file returns a structured failure (it never
 * silently degrades to empty assignments).
 */
export async function loadExternalMcpAgentAssignments(
  repoRoot: string,
): Promise<ExternalMcpAssignmentsLoadResult> {
  const registry = await loadExternalMcpRegistryWithFallback(repoRoot);
  return loadAndValidate(repoRoot, registry);
}

/**
 * Persist assignments after validating agent IDs against the active provider
 * registry and server IDs against the external MCP registry. Disabled server IDs
 * are valid saved preferences (they are filtered out only at selection time).
 * Throws on validation failure.
 */
export async function saveExternalMcpAgentAssignments(
  repoRoot: string,
  assignments: ExternalMcpAgentAssignment[],
): Promise<ExternalMcpAgentAssignmentsDocument> {
  const providerAgentIds = providerAgentIdsInOrder(repoRoot);
  const registry = await loadExternalMcpRegistryWithFallback(repoRoot);
  const knownServerIds = new Set(registry.external_servers.map((s) => s.id));

  const result = validateAssignmentsDocument(
    { schema_version: EXTERNAL_MCP_ASSIGNMENTS_SCHEMA_VERSION, assignments },
    providerAgentIds,
    knownServerIds,
  );
  if (!result.ok) {
    throw new Error(`Invalid external MCP assignments:\n${result.errors.join('\n')}`);
  }

  await persistAssignments(repoRoot, result.document);
  return result.document;
}

/**
 * Remove a deleted server ID from every assignment row. Tolerant by design: it
 * never validates server IDs against the registry (the removed server is already
 * gone) and never throws on a malformed file.
 */
export async function removeDeletedExternalMcpServerAssignment(
  repoRoot: string,
  serverId: string,
): Promise<ExternalMcpAgentAssignmentsDocument> {
  const providerAgentIds = providerAgentIdsInOrder(repoRoot);
  const raw = await readTextFile(assignmentsFilePath(repoRoot));
  const rows = normalizeRowsLenient(raw, providerAgentIds).map((row) => ({
    agent_id: row.agent_id,
    external_mcp_server_ids: row.external_mcp_server_ids.filter((id) => id !== serverId),
  }));
  const document = sortDocument(rows, providerAgentIds);
  await persistAssignments(repoRoot, document);
  return document;
}

/**
 * Pure selection core shared by the prompt path and the CLI launch boundary.
 * Returns the enabled servers assigned to the agent. Reads only the assignment
 * document — never `agent_scope` — and never resolves dalton-verify to dalton.
 */
export function selectAssignedExternalMcpServers(
  registry: ExternalMcpRegistry,
  document: ExternalMcpAgentAssignmentsDocument,
  agentId: string,
  runtimeToProviderAgentId: (agentId: string) => string,
): ExternalMcpServer[] {
  const providerAgentId = runtimeToProviderAgentId(agentId);
  const row = document.assignments.find((a) => a.agent_id === providerAgentId);
  const assigned = new Set(row?.external_mcp_server_ids ?? []);
  return registry.external_servers.filter((s) => s.enabled && assigned.has(s.id));
}

/**
 * Resolve the enabled external MCP servers assigned to an agent from disk.
 * Fails closed: any registry/assignment load or validation failure yields no
 * servers plus a warning, so malformed assignment data never injects servers and
 * never disrupts internal MCP wiring.
 */
export async function selectExternalMcpServersForAgent(
  repoRoot: string,
  agentId: string,
): Promise<ExternalMcpRuntimeSelection> {
  const provider = getActiveProvider(repoRoot);
  const runtimeToProviderAgentId = (id: string): string => provider.runtimeToProviderAgentId(id);
  const providerAgentId = runtimeToProviderAgentId(agentId);

  let registry: ExternalMcpRegistry;
  try {
    registry = await loadExternalMcpRegistryWithFallback(repoRoot);
  } catch (e) {
    return {
      runtimeAgentId: agentId,
      providerAgentId,
      servers: [],
      warnings: [
        `Failed to load external MCP registry: ${e instanceof Error ? e.message : String(e)}.`,
      ],
    };
  }

  let result: ExternalMcpAssignmentsLoadResult;
  try {
    result = await loadAndValidate(repoRoot, registry);
  } catch (e) {
    return {
      runtimeAgentId: agentId,
      providerAgentId,
      servers: [],
      warnings: [
        `Failed to load external MCP assignments: ${e instanceof Error ? e.message : String(e)}.`,
      ],
    };
  }

  if (!result.ok) {
    return {
      runtimeAgentId: agentId,
      providerAgentId,
      servers: [],
      warnings: [
        'External MCP assignments are invalid; no external servers were injected.',
        ...result.errors,
      ],
    };
  }

  return {
    runtimeAgentId: agentId,
    providerAgentId,
    servers: selectAssignedExternalMcpServers(registry, result.document, agentId, runtimeToProviderAgentId),
    warnings: [],
  };
}
