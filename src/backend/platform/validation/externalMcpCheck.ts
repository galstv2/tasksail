/**
 * External MCP registry validation for local-checks.
 *
 * Validates the external MCP registry and the external MCP agent-assignment
 * store (.platform-state/external-mcp-agent-assignments.json). Unknown agent IDs
 * and unknown server IDs in the assignment file are hard failures. Stale
 * agent_scope on a server entry is no longer assignment data and is not checked.
 */
import path from 'node:path';

import { readTextFile, safeJsonParse } from '../core/io.js';
import { loadAgentRegistry } from '../agent-runner/metadata.js';
import {
  loadExternalMcpRegistry,
  loadDefaultExternalRegistry,
  FILE_NOT_FOUND_FIELD,
  RUNTIME_REGISTRY_PATH,
} from '../external-mcp-registry/load.js';
import {
  EXTERNAL_MCP_ASSIGNMENTS_PATH,
  validateAssignmentsDocument,
} from '../external-mcp-registry/index.js';

export interface ExternalMcpCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the external MCP registry and the agent-assignment store.
 *
 * - Validates the runtime registry if it exists, otherwise the default.
 * - Reports registry validation errors as failures (unlike the fallback
 *   helper which swallows errors for the launch path).
 * - When an assignment file is present, fails on malformed JSON, unknown
 *   agent IDs, and unknown server IDs.
 */
export async function checkExternalMcpRegistry(
  repoRoot: string,
): Promise<ExternalMcpCheckResult> {
  const warnings: string[] = [];

  // Try runtime first, fall back to default on file-not-found.
  const runtimePath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);
  let result = await loadExternalMcpRegistry(runtimePath);

  if (!result.ok) {
    const isNotFound = result.errors.length === 1
      && result.errors[0].field === FILE_NOT_FOUND_FIELD;

    if (isNotFound) {
      result = await loadDefaultExternalRegistry(repoRoot);
      if (!result.ok) {
        const stillNotFound = result.errors.length === 1
          && result.errors[0].field === FILE_NOT_FOUND_FIELD;
        if (stillNotFound) {
          return { valid: true, errors: [], warnings: [] };
        }
      }
    }
  }

  if (!result.ok) {
    const errors = result.errors.map(
      (e) => `${e.field}: ${e.message} (fix: ${e.fix})`,
    );
    return { valid: false, errors, warnings };
  }

  // Registry is valid — validate the assignment store against the roster.
  let knownAgentIds: Set<string> | null = null;
  try {
    const agentRegistry = await loadAgentRegistry(repoRoot);
    knownAgentIds = new Set(
      agentRegistry.agents.map((a) => a.agent_id).filter(Boolean),
    );
  } catch {
    // Agent registry not readable — skip assignment validation.
  }

  if (knownAgentIds) {
    const assignmentsPath = path.join(repoRoot, EXTERNAL_MCP_ASSIGNMENTS_PATH);
    const assignmentsRaw = await readTextFile(assignmentsPath);
    if (assignmentsRaw !== undefined) {
      let parsed: unknown;
      try {
        parsed = safeJsonParse(assignmentsRaw, EXTERNAL_MCP_ASSIGNMENTS_PATH);
      } catch (e) {
        return {
          valid: false,
          errors: [e instanceof Error ? e.message : 'Invalid JSON in external MCP assignments file.'],
          warnings,
        };
      }
      const knownServerIds = new Set(result.registry.external_servers.map((s) => s.id));
      const validation = validateAssignmentsDocument(parsed, [...knownAgentIds], knownServerIds);
      if (!validation.ok) {
        return { valid: false, errors: validation.errors, warnings };
      }
    }
  }

  return { valid: true, errors: [], warnings };
}
