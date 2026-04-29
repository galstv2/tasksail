import type { ProviderFrontendDescriptor } from './desktopContractProvider';

export type NamedWorkflowAgentKey =
  | 'planning-agent'
  | 'product-manager'
  | 'software-engineer'
  | 'software-engineer-verify'
  | 'qa';

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

export function getPlanningAgentDisplayName(descriptor: ProviderFrontendDescriptor): string {
  return createNamedWorkflowAgentRoster(descriptor)['planning-agent']?.displayName ?? 'Planning Agent';
}

export function getPlannerConversationLabel(
  descriptor: ProviderFrontendDescriptor,
  role: 'planner' | 'operator',
): string {
  if (role === 'operator') {
    return 'Operator';
  }
  return createNamedWorkflowAgentRoster(descriptor)['planning-agent']?.humanName ?? 'Planner';
}
