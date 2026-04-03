/**
 * External MCP registry validation for local-checks.
 *
 * Validates the external MCP registry and produces advisory warnings
 * for agent scope references that don't match the agent registry.
 * Warnings never fail local-checks — they are surfaced separately.
 */
import path from 'node:path';

import { loadAgentRegistry } from '../agent-runner/metadata.js';
import {
  loadExternalMcpRegistry,
  loadDefaultExternalRegistry,
  FILE_NOT_FOUND_FIELD,
  RUNTIME_REGISTRY_PATH,
} from '../external-mcp-registry/load.js';

export interface ExternalMcpCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate the external MCP registry and check agent scope references.
 *
 * - Validates the runtime registry if it exists, otherwise the default.
 * - Reports validation errors as failures (unlike the fallback helper
 *   which swallows errors for the launch path).
 * - Warns (does not fail) if agent_scope.agent_ids reference IDs not
 *   found in .github/agents/registry.json.
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

  // Registry is valid — check agent scope references against the roster.
  let knownAgentIds: Set<string> | null = null;
  try {
    const agentRegistry = await loadAgentRegistry(repoRoot);
    knownAgentIds = new Set(
      agentRegistry.agents.map((a) => a.agent_id).filter(Boolean),
    );
  } catch {
    // Agent registry not readable — skip scope validation.
  }

  if (knownAgentIds) {
    for (const server of result.registry.external_servers) {
      for (const agentId of server.agent_scope.agent_ids) {
        if (!knownAgentIds.has(agentId)) {
          warnings.push(
            `External MCP server "${server.id}": agent_scope references ` +
            `unknown agent ID "${agentId}" (not in .github/agents/registry.json).`,
          );
        }
      }
    }
  }

  return { valid: true, errors: [], warnings };
}
