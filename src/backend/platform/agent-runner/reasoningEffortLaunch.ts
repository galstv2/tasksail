import {
  isReasoningEffortRejectionOutput,
  normalizeReasoningEffort,
  validateReasoningEffortForCapabilities,
  type CliProvider,
  type ProviderReasoningEffortCapabilities,
} from '../cli-provider/index.js';
import { emitTaskProgressEvent, type AgentId } from '../core/index.js';
import type { Logger } from '../core/logger.js';

type RoleAgentReasoningEffortInput = {
  provider: CliProvider;
  logger: Logger;
  repoRoot: string;
  taskId: string;
  agentId: AgentId;
  modelId: string;
  effort: string | undefined;
};

function unavailableCapabilities(providerId: string): ProviderReasoningEffortCapabilities {
  return {
    providerId,
    cliVersion: null,
    effortChoices: [],
    source: 'unavailable',
    stale: true,
    error: 'Provider does not expose reasoning effort capabilities.',
  };
}

export async function validateRoleAgentReasoningEffortBeforeSpawn(
  input: RoleAgentReasoningEffortInput,
): Promise<string | undefined> {
  const effort = normalizeReasoningEffort(input.effort);
  if (!effort) return undefined;

  const capabilities = input.provider.reasoningEffortCapabilities
    ? await input.provider.reasoningEffortCapabilities(input.repoRoot)
    : unavailableCapabilities(input.provider.id);
  const validation = validateReasoningEffortForCapabilities({
    providerId: input.provider.id,
    agentId: input.agentId,
    modelId: input.modelId,
    effort,
    capabilities,
  });

  if (!validation.ok) {
    const reason = validation.reason ?? 'capability-discovery-failed';
    input.logger.warn('agent.reasoning_effort.rejected_before_spawn', {
      providerId: input.provider.id,
      agentId: input.agentId,
      modelId: input.modelId,
      effort,
      reason,
    });
    await emitTaskProgressEvent({
      logger: input.logger,
      repoRoot: input.repoRoot,
      taskId: input.taskId,
      event: {
        type: 'pipeline.agent_reasoning_effort.rejected_before_spawn',
        input: { agentId: input.agentId, modelId: input.modelId, effort, reason },
      },
    }).catch(() => {});
    throw new Error(validation.message ?? `Invalid reasoning effort: ${effort}`);
  }

  input.logger.info('agent.reasoning_effort.validated', {
    providerId: input.provider.id,
    agentId: input.agentId,
    modelId: input.modelId,
    effort,
    capabilitySource: capabilities.source,
  });
  return effort;
}

export function logPostSpawnReasoningEffortRejection(input: {
  providerId: string;
  logger: Logger;
  agentId: AgentId;
  modelId: string;
  effort: string | undefined;
  output: string;
}): void {
  if (!input.effort || !isReasoningEffortRejectionOutput(input.output)) return;
  input.logger.warn('agent.reasoning_effort.rejected_after_spawn', {
    providerId: input.providerId,
    agentId: input.agentId,
    modelId: input.modelId,
    effort: input.effort,
  });
}
