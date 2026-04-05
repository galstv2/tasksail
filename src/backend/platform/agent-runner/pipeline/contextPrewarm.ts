import type { AgentId } from '../../core/index.js';
import { resolveConventionsContext } from '../conventions.js';
import { resolveCorrectionsContext } from '../corrections.js';
import { resolveReinforcementContext } from '../reinforcement.js';
import { prewarmExternalMcpRegistry } from './externalMcpRegistryCache.js';

/**
 * Pre-resolve conventions, corrections, and reinforcement context
 * for all qualifying agents. This populates a warm cache so that
 * per-agent resolution during pipeline execution avoids redundant
 * Python subprocess calls.
 *
 * Corrections and conventions are agent-independent (output depends
 * only on the context pack), so they are resolved once for the first
 * qualifying agent. Reinforcement is agent-specific, so it is resolved
 * per agent.
 */
export async function prewarmPipelineContext(
  agentOrder: readonly AgentId[],
  contextPackDir: string | undefined,
  repoRoot: string,
): Promise<void> {
  await prewarmExternalMcpRegistry(repoRoot);

  if (!contextPackDir) {
    return;
  }

  // Resolve conventions once for the first qualifying agent.
  for (const agentId of agentOrder) {
    const result = await resolveConventionsContext(agentId, contextPackDir, repoRoot);
    if (result.status !== 'not-applicable') {
      break;
    }
  }

  // Resolve corrections once for the first qualifying agent.
  for (const agentId of agentOrder) {
    const result = await resolveCorrectionsContext(agentId, contextPackDir, repoRoot);
    if (result.status !== 'not-applicable') {
      break;
    }
  }

  // Resolve reinforcement per agent in parallel.
  const reinforcementPromises = agentOrder.map((agentId) =>
    resolveReinforcementContext(agentId, contextPackDir, repoRoot),
  );
  await Promise.all(reinforcementPromises);
}
