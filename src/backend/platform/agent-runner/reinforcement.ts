import type { AgentId } from '../core/index.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ResolvedContext } from './types.js';
import { resolveBehavioralBaseRegistryId } from './conventions.js';

/** Active workflow roles consume reinforcement context. */
const REINFORCEMENT_AGENTS = new Set([
  'planning-agent',
  'product-manager',
  'software-engineer',
  'qa',
]);

/**
 * Check whether an agent role requires reinforcement context injection.
 */
export function roleRequiresReinforcement(agentId: AgentId): boolean {
  return REINFORCEMENT_AGENTS.has(resolveBehavioralBaseRegistryId(agentId));
}

/**
 * Resolve reinforcement context for an agent.
 *
 * Strict private-only injection: only the per-agent reward memory
 * markdown is injected.  The shared agent-rewards.json is never used
 * because it contains all agents' data.
 */
export async function resolveReinforcementContext(
  agentId: AgentId,
  contextPackDir: string | undefined,
  repoRoot: string,
): Promise<ResolvedContext> {
  if (!roleRequiresReinforcement(agentId)) {
    return {
      status: 'not-applicable',
      reason: 'Agent role does not require reinforcement context by default.',
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

  const agentRewardMd = path.join(
    repoRoot, 'AgentWorkSpace', 'qmd', 'glopml', 'agent-rewards',
    `${resolveBehavioralBaseRegistryId(agentId)}.md`,
  );
  if (existsSync(agentRewardMd)) {
    return {
      status: 'available',
      reason: 'Reinforcement context available for injection.',
      injectionEnabled: true,
      contextFile: agentRewardMd,
    };
  }

  return {
    status: 'unavailable',
    reason: 'No per-agent reward memory has been generated yet.',
    injectionEnabled: false,
  };
}
