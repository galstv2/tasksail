import type { ProviderFrontendDescriptor } from './desktopContractProvider';

export type NamedWorkflowAgentProfile = {
  role: string;
  humanName: string;
  displayName: string;
};

export type NamedWorkflowAgentRoster = Record<string, NamedWorkflowAgentProfile>;

export type PlannerDisplayModel = {
  plannerName: string;
  plannerDisplayName: string;
  plannerRoleName: string;
};

export const FALLBACK_PLANNER_DISPLAY: PlannerDisplayModel = {
  plannerName: 'Planner',
  plannerDisplayName: 'Planning Agent',
  plannerRoleName: 'Planning Agent',
};

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

// Descriptor acquisition stays outside this synchronous helper so planner UI can
// fall back immediately when provider descriptor loading fails.
export function getPlannerDisplayModel(
  descriptor: ProviderFrontendDescriptor | null | undefined,
  plannerAgentId: string | null | undefined = descriptor?.plannerAgentId ?? null,
): PlannerDisplayModel {
  if (!descriptor || !plannerAgentId) {
    return FALLBACK_PLANNER_DISPLAY;
  }
  const profile = createNamedWorkflowAgentRoster(descriptor)[plannerAgentId];
  if (!profile) {
    return FALLBACK_PLANNER_DISPLAY;
  }
  return {
    plannerName: profile.humanName,
    plannerDisplayName: profile.displayName,
    plannerRoleName: profile.role,
  };
}

export function getPlanningAgentDisplayName(
  descriptor: ProviderFrontendDescriptor | null | undefined,
  plannerAgentId: string | null | undefined,
): string {
  return getPlannerDisplayModel(descriptor, plannerAgentId).plannerDisplayName;
}

export function getPlannerConversationLabel(
  descriptor: ProviderFrontendDescriptor | null | undefined,
  plannerAgentId: string | null | undefined,
  role: 'planner' | 'operator',
): string {
  if (role === 'operator') {
    return 'Operator';
  }
  return getPlannerDisplayModel(descriptor, plannerAgentId).plannerName;
}
