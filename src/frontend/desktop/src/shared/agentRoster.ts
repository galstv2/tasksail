import registryPayload from '../../../../../.github/agents/registry.json';

export type NamedWorkflowAgentKey =
  | 'planning-agent'
  | 'product-manager'
  | 'software-engineer'
  | 'qa';

export type NamedWorkflowAgentProfile = {
  role: string;
  humanName: string;
  displayName: string;
};

type RegistryAgentEntry = {
  agent_id: string;
  role_name?: string;
  human_name?: string;
};

type AgentRegistryPayload = {
  agents?: RegistryAgentEntry[];
};

function createProfile(role: string, humanName: string): NamedWorkflowAgentProfile {
  return {
    role,
    humanName,
    displayName: `${humanName} (${role})`,
  };
}

function createProfileFromRegistry(agentId: NamedWorkflowAgentKey): NamedWorkflowAgentProfile {
  const payload = registryPayload as AgentRegistryPayload;
  const entry = payload.agents?.find((agent) => agent.agent_id === agentId);
  if (!entry?.role_name || !entry.human_name) {
    throw new Error(`Missing role_name or human_name for ${agentId} in .github/agents/registry.json`);
  }
  return createProfile(entry.role_name, entry.human_name);
}

export const namedWorkflowAgentRoster: Record<NamedWorkflowAgentKey, NamedWorkflowAgentProfile> = {
  'planning-agent': createProfileFromRegistry('planning-agent'),
  'product-manager': createProfileFromRegistry('product-manager'),
  'software-engineer': createProfileFromRegistry('software-engineer'),
  qa: createProfileFromRegistry('qa'),
};

export const planningAgentDisplayName = namedWorkflowAgentRoster['planning-agent'].displayName;

export function getPlannerConversationLabel(role: 'planner' | 'operator'): string {
  return role === 'planner'
    ? namedWorkflowAgentRoster['planning-agent'].humanName
    : 'Operator';
}
