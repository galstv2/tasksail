import type { getProviderFrontendDescriptor } from '../../../../backend/platform/cli-provider/index.js';

export type AgentLabelProfile = {
  role: string;
  humanName: string;
  displayName: string;
};

export function buildAgentLabelLookup(roster: ReturnType<typeof getProviderFrontendDescriptor>['roster']): Map<string, AgentLabelProfile> {
  return new Map(
    roster.flatMap((entry) => {
      const profile = {
        role: entry.roleName,
        humanName: entry.humanName,
        displayName: `${entry.humanName} (${entry.roleName})`,
      };
      return [
        [entry.agentId, profile],
        [profile.humanName.toLowerCase(), profile],
      ] as Array<[string, AgentLabelProfile]>;
    }),
  );
}

export function getAgentLabel(agentId: string, instanceId: string | null, agentLabelLookup: Map<string, AgentLabelProfile>): string {
  const rosterEntry = agentLabelLookup.get(agentId) ?? agentLabelLookup.get(agentId.toLowerCase());

  if (rosterEntry) {
    return instanceId ? `${rosterEntry.humanName} · ${instanceId}` : rosterEntry.displayName;
  }

  return instanceId ? `${agentId} · ${instanceId}` : agentId;
}
