import { readTextFile, safeJsonParse } from '../core/index.js';
import type { AgentId } from '../core/index.js';
import path from 'node:path';
import type {
  AgentProfile,
  RegistryJson,
  RegistryAgentEntry,
} from './types.js';
import { getActiveProvider, normalizeReasoningEffort } from '../cli-provider/index.js';
import type { CliProvider } from '../cli-provider/index.js';

/**
 * Convert a human-friendly AgentId to the registry agent_id string via the
 * active provider's canonical nickname map. The platform-core AgentId type uses
 * nicknames (lily, alice, ...); registry.json uses provider-agent IDs
 * (planning-agent, product-manager, ...).
 */
export function toRegistryId(provider: CliProvider, agentId: AgentId): string {
  return provider.runtimeToProviderAgentId(agentId);
}

/** Convert a registry agent_id string to a human-friendly AgentId via the active provider. */
export function fromRegistryId(provider: CliProvider, registryId: string): AgentId | undefined {
  return provider.providerToRuntimeAgentId(registryId);
}

/**
 * Load and parse the active provider agent registry.
 */
export async function loadAgentRegistry(
  repoRoot: string,
): Promise<RegistryJson> {
  const registryPath = path.join(repoRoot, getActiveProvider(repoRoot).agentConfigPaths().registry);
  const content = await readTextFile(registryPath);
  if (content === undefined) {
    throw new Error(`Agent registry not found at ${registryPath}`);
  }
  return safeJsonParse<RegistryJson>(content, registryPath);
}

/**
 * Find a specific agent entry in the registry by AgentId.
 */
export function findRegistryEntry(
  provider: CliProvider,
  registry: RegistryJson,
  agentId: AgentId,
): RegistryAgentEntry | undefined {
  const registryId = toRegistryId(provider, agentId);
  return registry.agents.find((a) => a.agent_id === registryId);
}

function registryStringField(entry: RegistryAgentEntry, fieldName: string): string {
  const value = (entry as unknown as Record<string, unknown>)[fieldName];
  return typeof value === 'string' ? value.trim() : '';
}

function resolveProviderRegistryMetadata(
  provider: CliProvider,
  entry: RegistryAgentEntry,
): Pick<AgentProfile, 'instructionPath' | 'agentProfilePath'> {
  for (const fieldName of provider.requiredRegistryFields()) {
    if (!registryStringField(entry, fieldName)) {
      throw new Error(
        `Agent "${entry.agent_id}" is missing provider-required registry field "${fieldName}"`,
      );
    }
  }

  const instructionPath = registryStringField(entry, 'instruction_path');
  const agentProfilePath = registryStringField(entry, 'agent_profile_path');
  return {
    ...(instructionPath ? { instructionPath } : {}),
    ...(agentProfilePath ? { agentProfilePath } : {}),
  };
}

/**
 * Resolve the full AgentProfile for a given AgentId from the registry.
 */
export function resolveAgentProfile(
  provider: CliProvider,
  registry: RegistryJson,
  agentId: AgentId,
): AgentProfile {
  const entry = findRegistryEntry(provider, registry, agentId);
  if (!entry) {
    throw new Error(
      `Agent "${agentId}" (registry id: ${toRegistryId(provider, agentId)}) not found in registry`,
    );
  }

  const reasoningEffort = normalizeReasoningEffort(entry.reasoning_effort);
  const providerMetadata = resolveProviderRegistryMetadata(provider, entry);
  return {
    id: agentId,
    registryId: entry.agent_id,
    displayName: entry.human_name,
    role: entry.role_name,
    requiredModel: entry.required_model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    autonomyProfile: entry.autonomy_profile as AgentProfile['autonomyProfile'],
    allowedDirs: entry.allowed_dirs,
    denyRules: entry.deny_rules,
    ...providerMetadata,
    wallClockTimeoutS: entry.wall_clock_timeout_s,
    workflowOrder: entry.workflow_order,
    interactive: entry.interactive,
    idleTimeoutS: entry.idle_timeout_s,
  };
}

/**
 * Resolve the active model for an agent invocation.
 * Registry-authoritative: derives the model exclusively from profile.requiredModel
 * (which is sourced from the active provider registry). MUST NOT inherit from
 * parent process env — env inheritance is a silent-regression vector in parallel
 * task launches.
 * Throws `role-registry-model-missing` if registry entry has no required_model.
 */
export function resolveActiveModel(
  agentId: AgentId,
  profile: AgentProfile,
): string {
  if (!profile.requiredModel) {
    throw new Error(
      `role-registry-model-missing: agent "${agentId}" has no required_model in active provider registry`,
    );
  }
  return profile.requiredModel;
}
