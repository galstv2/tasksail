import type { AgentId } from '../core/index.js';
import { readTextFile } from '../core/index.js';
import path from 'node:path';
import type { ResolvedContext } from './types.js';
import { toRegistryId } from './metadata.js';

/** Registry IDs of active agents that require conventions context. */
const CONVENTIONS_AGENTS = new Set([
  'software-engineer',
]);

export function resolveBehavioralBaseRegistryId(agentId: AgentId): string {
  const registryId = toRegistryId(agentId);
  if (registryId === 'software-engineer-verify') {
    return 'software-engineer';
  }
  return registryId;
}

/**
 * Check whether an agent role requires conventions context injection.
 */
export function roleRequiresConventions(agentId: AgentId): boolean {
  return CONVENTIONS_AGENTS.has(resolveBehavioralBaseRegistryId(agentId));
}

/**
 * Resolve conventions context for an agent.
 * Attempts to load context-pack conventions via the repo-context MCP
 * conventions endpoint. Returns a ResolvedContext with status information.
 */
export async function resolveConventionsContext(
  agentId: AgentId,
  contextPackDir: string | undefined,
  repoRoot: string,
): Promise<ResolvedContext> {
  if (!roleRequiresConventions(agentId)) {
    return {
      status: 'not-applicable',
      reason: 'Agent role does not require conventions context by default.',
      injectionEnabled: false,
    };
  }

  if (!contextPackDir) {
    return {
      status: 'unavailable',
      reason: 'No active context pack is selected in ACTIVE_CONTEXT_PACK_DIR.',
      injectionEnabled: false,
    };
  }

  const repoContextAppPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'repo-context-app.py',
  );
  const content = await readTextFile(repoContextAppPath);
  if (content === undefined) {
    return {
      status: 'malformed',
      reason: 'Repo-context conventions loader is unavailable.',
      injectionEnabled: false,
    };
  }

  // In the full implementation, this would invoke the repo-context-app.py
  // conventions command and parse the JSON output. For now, return the
  // status indicating the loader is available but resolution is delegated
  // to the Python helper at runtime.
  return {
    status: 'available',
    reason: 'Conventions context resolution delegated to Python helper.',
    injectionEnabled: true,
    contextFile: path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'context-pack-conventions.md',
    ),
  };
}
