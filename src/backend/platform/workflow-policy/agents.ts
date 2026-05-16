import path from 'node:path';
import { readTextFile, safeJsonParse } from '../core/index.js';
import {
  REQUIRED_AGENT_REGISTRY_FIELDS,
  createNamedAgentRecord,
  getAgentRegistryRelativePath,
} from './models.js';
import type { NamedAgentTeam } from './types.js';

interface RegistryAgentEntry {
  agent_id?: unknown;
  role_name?: unknown;
  human_name?: unknown;
  instruction_path?: unknown;
  agent_profile_path?: unknown;
  workflow_order?: unknown;
  required_model?: unknown;
  [key: string]: unknown;
}

interface RegistryPayload {
  agents?: unknown;
}

const CANONICAL_WORKFLOW_AGENT_IDS = new Set([
  'planning-agent',
  'product-manager',
  'software-engineer',
  'qa',
]);

export function buildExpectedInstructionHeading(roleName: string, humanName: string): string {
  if (humanName) {
    return `# ${roleName} (${humanName}) — Instructions`;
  }
  return `# ${roleName} — Instructions`;
}

export function buildExpectedAgentIdentity(roleName: string, humanName: string): string {
  if (roleName === 'QA' && humanName) {
    return `Act as ${humanName}, QA.`;
  }
  if (humanName) {
    return `Act as ${humanName}, the ${roleName}.`;
  }
  return `Act as the ${roleName}.`;
}

function expectedInstructionHeadingForAgent(
  agentId: string,
  roleName: string,
  humanName: string,
): string {
  if (agentId === 'planning-agent') {
    return `# ${roleName} Instructions`;
  }
  return buildExpectedInstructionHeading(roleName, humanName);
}

function expectedAgentIdentityForAgent(
  agentId: string,
  roleName: string,
  humanName: string,
): string {
  if (agentId === 'planning-agent') {
    return `Act as the ${roleName}.`;
  }
  return buildExpectedAgentIdentity(roleName, humanName);
}

export async function loadNamedAgentTeam(
  rootDir: string,
): Promise<{ team: NamedAgentTeam; errors: string[] }> {
  const registryRelativePath = getAgentRegistryRelativePath(rootDir);
  const registryPath = path.join(rootDir, registryRelativePath);
  const raw = await readTextFile(registryPath);
  if (raw === undefined) {
    return {
      team: {},
      errors: [`Missing required agent registry at ${registryRelativePath}.`],
    };
  }

  let payload: RegistryPayload;
  try {
    payload = safeJsonParse<RegistryPayload>(raw, registryRelativePath);
  } catch (error) {
    return {
      team: {},
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      team: {},
      errors: ['Agent registry must be a JSON object.'],
    };
  }

  const agentsPayload = payload.agents;
  if (!Array.isArray(agentsPayload)) {
    return {
      team: {},
      errors: ['Agent registry must contain an \'agents\' list.'],
    };
  }

  const team: NamedAgentTeam = {};
  const errors: string[] = [];

  for (const item of agentsPayload as RegistryAgentEntry[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('Each registry agent entry must be a JSON object.');
      continue;
    }

    const presentFields = new Set(Object.keys(item));
    const agentId = String(item.agent_id ?? '').trim();

    if (!agentId) {
      errors.push('Registry entries must declare a non-empty agent_id.');
      continue;
    }

    if (!CANONICAL_WORKFLOW_AGENT_IDS.has(agentId)) {
      continue;
    }

    const missingFields = [...REQUIRED_AGENT_REGISTRY_FIELDS].filter((field) => !presentFields.has(field));
    if (missingFields.length > 0) {
      errors.push(
        `Registry entry '${agentId}' is missing required fields: ${missingFields.sort().join(', ')}.`,
      );
      continue;
    }

    if (agentId in team) {
      errors.push(`Registry entry '${agentId}' is duplicated.`);
      continue;
    }

    const roleName = String(item.role_name ?? '').trim();
    const humanName = String(item.human_name ?? '').trim();
    const instructionPath = String(item.instruction_path ?? '').trim();
    const agentProfilePath = String(item.agent_profile_path ?? '').trim();
    const workflowOrder = item.workflow_order;

    if (!roleName) {
      errors.push(`Registry entry '${agentId}' must declare a non-empty role_name.`);
      continue;
    }

    if (!instructionPath) {
      errors.push(`Registry entry '${agentId}' must declare a non-empty instruction_path.`);
      continue;
    }

    if (!agentProfilePath) {
      errors.push(`Registry entry '${agentId}' must declare a non-empty agent_profile_path.`);
      continue;
    }

    if (!Number.isInteger(workflowOrder)) {
      errors.push(`Registry entry '${agentId}' must declare workflow_order as an integer.`);
      continue;
    }

    team[agentId] = createNamedAgentRecord({
      role: roleName,
      name: humanName,
      instructionPath,
      agentProfilePath,
      workflowOrder: workflowOrder as number,
      expectedInstructionHeading: expectedInstructionHeadingForAgent(agentId, roleName, humanName),
      expectedAgentIdentity: expectedAgentIdentityForAgent(agentId, roleName, humanName),
      requiredModel: String(item.required_model ?? '').trim(),
    });
  }

  return { team, errors };
}

export function canonicalAgentLabel(namedAgentTeam: NamedAgentTeam, agentKey: string): string {
  const agent = namedAgentTeam[agentKey];
  if (!agent) {
    return agentKey;
  }
  if (agent.name) {
    return `${agent.name} (${agent.role})`;
  }
  return agent.role;
}

export function expectedInstructionHeading(namedAgentTeam: NamedAgentTeam, agentKey: string): string {
  const agent = namedAgentTeam[agentKey];
  if (!agent) {
    return '';
  }
  return agent.expectedInstructionHeading || buildExpectedInstructionHeading(agent.role, agent.name);
}
