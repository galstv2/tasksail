import { readTextFile, safeJsonParse } from '../core/index.js';
import type { AgentId } from '../core/index.js';
import path from 'node:path';
import type {
  AgentProfile,
  RegistryJson,
  RegistryAgentEntry,
} from './types.js';
import { getActiveProvider, normalizeReasoningEffort } from '../cli-provider/index.js';

/**
 * Mapping from human-friendly AgentId to registry agent_id.
 * The platform-core AgentId type uses nicknames (lily, alice, ...),
 * while registry.json uses role-based IDs (planning-agent, product-manager, ...).
 */
const AGENT_ID_TO_REGISTRY_ID: Record<AgentId, string> = {
  lily: 'planning-agent',
  alice: 'product-manager',
  dalton: 'software-engineer',
  'dalton-verify': 'software-engineer-verify',
  ron: 'qa',
};

const REGISTRY_ID_TO_AGENT_ID: Record<string, AgentId> = Object.fromEntries(
  Object.entries(AGENT_ID_TO_REGISTRY_ID).map(([k, v]) => [v, k as AgentId]),
) as Record<string, AgentId>;

/** Convert a human-friendly AgentId to the registry agent_id string. */
export function toRegistryId(agentId: AgentId): string {
  return AGENT_ID_TO_REGISTRY_ID[agentId];
}

/** Convert a registry agent_id string to a human-friendly AgentId. */
export function fromRegistryId(registryId: string): AgentId | undefined {
  return REGISTRY_ID_TO_AGENT_ID[registryId];
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
  registry: RegistryJson,
  agentId: AgentId,
): RegistryAgentEntry | undefined {
  const registryId = toRegistryId(agentId);
  return registry.agents.find((a) => a.agent_id === registryId);
}

/**
 * Resolve the full AgentProfile for a given AgentId from the registry.
 */
export function resolveAgentProfile(
  registry: RegistryJson,
  agentId: AgentId,
): AgentProfile {
  const entry = findRegistryEntry(registry, agentId);
  if (!entry) {
    throw new Error(
      `Agent "${agentId}" (registry id: ${toRegistryId(agentId)}) not found in registry`,
    );
  }

  const reasoningEffort = normalizeReasoningEffort(entry.reasoning_effort);
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
    instructionPath: entry.instruction_path,
    agentProfilePath: entry.agent_profile_path,
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
