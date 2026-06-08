import type { ProviderReasoningEffortCapabilities } from './types.js';

export type ReasoningEffortRejectionReason = 'unsupported-by-cli' | 'capability-discovery-failed';

export interface ReasoningEffortValidationResult {
  ok: boolean;
  effort?: string;
  reason?: ReasoningEffortRejectionReason;
  message?: string;
  relaunchMessage?: string;
}

const EFFORT_PATTERN = /^[a-z][a-z0-9-]*$/u;

export function normalizeReasoningEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'none' ? normalized : undefined;
}

export function hasReasoningEffort(value: unknown): boolean {
  return normalizeReasoningEffort(value) !== undefined;
}

export function orderProviderReasoningEffortChoices(choices: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const choice of choices) {
    const effort = normalizeReasoningEffort(choice);
    if (effort && EFFORT_PATTERN.test(effort)) {
      seen.add(effort);
    }
  }

  const preferred = ['low', 'medium', 'high', 'xhigh', 'max'];
  const preferredSet = new Set(preferred);
  return [
    ...preferred.filter((choice) => seen.has(choice)),
    ...[...seen].filter((choice) => !preferredSet.has(choice)).sort(),
  ];
}

export function validateReasoningEffortForCapabilities(input: {
  providerId: string;
  cliDisplayName?: string;
  agentId?: string;
  modelId: string;
  effort: unknown;
  capabilities: ProviderReasoningEffortCapabilities;
}): ReasoningEffortValidationResult {
  const effort = normalizeReasoningEffort(input.effort);
  if (!effort) {
    return { ok: true };
  }

  // Stale caches are hard failures for saves and launches because they need a
  // current capability set. The renderer may show a soft warning, but this path
  // rejects with a refresh-oriented message; keep the stale-cache test in sync
  // if this gate changes.
  if (!EFFORT_PATTERN.test(effort) || input.capabilities.source === 'unavailable' || input.capabilities.stale) {
    const cliDisplayName = input.cliDisplayName ?? input.providerId;
    return {
      ok: false,
      effort,
      reason: 'capability-discovery-failed',
      message: reasoningEffortErrorMessage({
        cliDisplayName,
        agentId: input.agentId,
        modelId: input.modelId,
        effort,
        reason: 'capability-discovery-failed',
      }),
      ...(input.agentId ? {
        relaunchMessage: reasoningEffortRejectedBeforeSpawnMessage({
          cliDisplayName,
          agentId: input.agentId,
          modelId: input.modelId,
          effort,
        }),
      } : {}),
    };
  }

  const choices = new Set(orderProviderReasoningEffortChoices(input.capabilities.effortChoices));
  if (!choices.has(effort)) {
    const cliDisplayName = input.cliDisplayName ?? input.providerId;
    return {
      ok: false,
      effort,
      reason: 'unsupported-by-cli',
      message: reasoningEffortErrorMessage({
        cliDisplayName,
        agentId: input.agentId,
        modelId: input.modelId,
        effort,
        reason: 'unsupported-by-cli',
      }),
      ...(input.agentId ? {
        relaunchMessage: reasoningEffortRejectedBeforeSpawnMessage({
          cliDisplayName,
          agentId: input.agentId,
          modelId: input.modelId,
          effort,
        }),
      } : {}),
    };
  }

  return { ok: true, effort };
}

export function isReasoningEffortRejectionOutput(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes('reasoning effort') &&
    (normalized.includes('does not support') ||
      normalized.includes('unsupported') ||
      normalized.includes('invalid') ||
      normalized.includes('not advertised') ||
      normalized.includes('requested'));
}

function providerProductDisplayName(cliDisplayName: string): string {
  return cliDisplayName.replace(/\s+CLI$/u, '') || cliDisplayName;
}

export function providerAdvertisedReasoningEffortLabel(cliDisplayName: string): string {
  return `${providerProductDisplayName(cliDisplayName)}-advertised`;
}

export function reasoningEffortConfigurationGuidance(cliDisplayName: string): string {
  return `Update Agent Configuration to None or a ${providerAdvertisedReasoningEffortLabel(cliDisplayName)} effort before relaunching the task.`;
}

export function reasoningEffortErrorMessage(input: {
  cliDisplayName: string;
  agentId?: string;
  modelId: string;
  effort: string;
  reason: ReasoningEffortRejectionReason;
}): string {
  const agent = input.agentId ? `Agent ${input.agentId}` : 'The selected agent';
  const reason = input.reason === 'capability-discovery-failed'
    ? `${providerProductDisplayName(input.cliDisplayName)} reasoning effort capabilities could not be discovered`
    : `the installed ${input.cliDisplayName} does not advertise that reasoning effort`;
  return `${agent} cannot launch model ${input.modelId} with reasoning effort ${input.effort}: ${reason}. ${reasoningEffortConfigurationGuidance(input.cliDisplayName)}`;
}

export function reasoningEffortRejectedBeforeSpawnMessage(input: {
  cliDisplayName: string;
  agentId: string;
  modelId: string;
  effort: string;
}): string {
  return `Agent ${input.agentId} cannot launch model ${input.modelId} with reasoning effort ${input.effort}. ${reasoningEffortConfigurationGuidance(input.cliDisplayName)}`;
}
