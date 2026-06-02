import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isRecord, safeJsonParse } from '../core/index.js';
import type { AgentConfigPaths, RoleKind } from './types.js';
import { getActiveProvider } from './registry.js';

export type { RoleKind } from './types.js';

interface RegistryAgentEntry {
  agent_id?: unknown;
  role_name?: unknown;
  human_name?: unknown;
  workflow_order?: unknown;
}

interface RegistryPayload {
  agents?: unknown;
}

export interface ProviderFrontendDescriptor {
  providerId: string;
  cliDisplayName: string;
  homeDirName: string;
  registryPath: string;
  agentConfigPaths: AgentConfigPaths;
  promptPathEnvVars: { handoffsDir: string; implStepsDir: string };
  contextPackEnvVars: { paths: string; searchRoots: string };
  roster: Array<{
    agentId: string;
    roleName: string;
    humanName: string;
    workflowOrder: number;
    roleKind: RoleKind | null;
  }>;
  plannerAgentId: string | null;
}

// Roster is parsed from a static registry JSON file; the long-running
// Electron process touches it on every getProviderFrontendDescriptor call.
// Memoize per registryPath so the disk read+parse runs once per path.
const rosterCache = new Map<string, ProviderFrontendDescriptor['roster']>();

function loadRoster(registryPath: string, roleKindForAgent: (agentId: string) => RoleKind | null): ProviderFrontendDescriptor['roster'] {
  const cached = rosterCache.get(registryPath);
  if (cached) {
    return cached;
  }

  const parsed = safeJsonParse<RegistryPayload>(
    readFileSync(registryPath, 'utf-8'),
    registryPath,
  );
  if (!isRecord(parsed) || !Array.isArray(parsed.agents)) {
    throw new Error(`Agent registry at ${registryPath} must contain an agents array.`);
  }

  const roster = parsed.agents
    .map((entry): ProviderFrontendDescriptor['roster'][number] | null => {
      const item = entry as RegistryAgentEntry;
      if (
        typeof item.agent_id !== 'string'
        || typeof item.role_name !== 'string'
        || typeof item.human_name !== 'string'
        || !Number.isInteger(item.workflow_order)
      ) {
        return null;
      }
      return {
        agentId: item.agent_id,
        roleName: item.role_name,
        humanName: item.human_name,
        workflowOrder: item.workflow_order as number,
        roleKind: roleKindForAgent(item.agent_id),
      };
    })
    .filter((entry): entry is ProviderFrontendDescriptor['roster'][number] => entry !== null)
    .sort((a, b) => a.workflowOrder - b.workflowOrder || a.agentId.localeCompare(b.agentId));

  rosterCache.set(registryPath, roster);
  return roster;
}

export function getProviderFrontendDescriptor(repoRoot: string): ProviderFrontendDescriptor {
  const provider = getActiveProvider(repoRoot);
  const agentConfigPaths = provider.agentConfigPaths();
  const registryPath = path.join(repoRoot, agentConfigPaths.registry);

  return {
    providerId: provider.id,
    cliDisplayName: provider.cliDisplayName(),
    homeDirName: provider.homeDirName(),
    registryPath,
    agentConfigPaths,
    promptPathEnvVars: provider.promptPathEnvVars(),
    contextPackEnvVars: provider.contextPackEnvVars(),
    roster: loadRoster(registryPath, (agentId) => provider.roleKindForAgent(agentId)),
    plannerAgentId: provider.plannerAgentId(),
  };
}

export function _clearRosterCache(): void {
  rosterCache.clear();
}
