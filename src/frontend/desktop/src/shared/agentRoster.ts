import type { ProviderFrontendDescriptor } from './desktopContractProvider';

export type NamedWorkflowAgentProfile = {
  role: string;
  humanName: string;
  displayName: string;
};

export type NamedWorkflowAgentRoster = Record<string, NamedWorkflowAgentProfile>;

function createProfile(role: string, humanName: string): NamedWorkflowAgentProfile {
  return {
    role,
    humanName,
    displayName: `${humanName} (${role})`,
  };
}

export function createNamedWorkflowAgentRoster(
  descriptor: ProviderFrontendDescriptor,
): NamedWorkflowAgentRoster {
  return Object.fromEntries(
    descriptor.roster.map((entry) => [
      entry.agentId,
      createProfile(entry.roleName, entry.humanName),
    ]),
  );
}

export function getPlanningAgentDisplayName(
  descriptor: ProviderFrontendDescriptor,
  plannerAgentId: string | null,
): string {
  if (!plannerAgentId) {
    return 'Planning Agent';
  }
  return createNamedWorkflowAgentRoster(descriptor)[plannerAgentId]?.displayName ?? 'Planning Agent';
}

export function getPlannerConversationLabel(
  descriptor: ProviderFrontendDescriptor,
  plannerAgentId: string | null,
  role: 'planner' | 'operator',
): string {
  if (role === 'operator') {
    return 'Operator';
  }
  if (!plannerAgentId) {
    return 'Planner';
  }
  return createNamedWorkflowAgentRoster(descriptor)[plannerAgentId]?.humanName ?? 'Planner';
}
