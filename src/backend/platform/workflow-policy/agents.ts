import path from 'node:path';
import { readTextFile, safeJsonParse } from '../core/index.js';
import {
  AGENT_REGISTRY_RELATIVE_PATH,
  FRONTMATTER_LINE,
  REQUIRED_AGENT_REGISTRY_FIELDS,
  createNamedAgentRecord,
} from './models.js';
import type { ChatAgentProfileParseResult, NamedAgentTeam } from './types.js';

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

export async function loadNamedAgentTeam(
  rootDir: string,
): Promise<{ team: NamedAgentTeam; errors: string[] }> {
  const registryPath = path.join(rootDir, AGENT_REGISTRY_RELATIVE_PATH);
  const raw = await readTextFile(registryPath);
  if (raw === undefined) {
    return {
      team: {},
      errors: [`Missing required agent registry at ${AGENT_REGISTRY_RELATIVE_PATH}.`],
    };
  }

  let payload: RegistryPayload;
  try {
    payload = safeJsonParse<RegistryPayload>(raw, AGENT_REGISTRY_RELATIVE_PATH);
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
    const missingFields = [...REQUIRED_AGENT_REGISTRY_FIELDS].filter((field) => !presentFields.has(field));
    const agentId = String(item.agent_id ?? '').trim();

    if (missingFields.length > 0) {
      errors.push(
        `Registry entry '${agentId || 'unknown'}' is missing required fields: ${missingFields.sort().join(', ')}.`,
      );
      continue;
    }

    if (!agentId) {
      errors.push('Registry entries must declare a non-empty agent_id.');
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
      expectedInstructionHeading: buildExpectedInstructionHeading(roleName, humanName),
      expectedAgentIdentity: buildExpectedAgentIdentity(roleName, humanName),
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

export function parseChatagentProfile(text: string): ChatAgentProfileParseResult {
  const lines = text.split(/\r?\n/);
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmptyIndex < 0) {
    return {
      frontmatter: {},
      body: '',
      errors: ['Agent profile is empty.'],
    };
  }

  const firstNonEmptyLine = lines[firstNonEmptyIndex]!.trim();
  let frontmatterStart = firstNonEmptyIndex;
  let contentEnd: number | null = null;

  if (firstNonEmptyLine === '```chatagent') {
    frontmatterStart = firstNonEmptyIndex + 1;
    if (frontmatterStart >= lines.length || lines[frontmatterStart]!.trim() !== '---') {
      return {
        frontmatter: {},
        body: '',
        errors: ['Agent profile must include YAML frontmatter.'],
      };
    }
  } else if (firstNonEmptyLine !== '---') {
    return {
      frontmatter: {},
      body: '',
      errors: ['Agent profile must begin with YAML frontmatter or a ```chatagent fence.'],
    };
  } else {
    contentEnd = lines.length;
  }

  const frontmatterEnd = lines.findIndex((line, index) => index > frontmatterStart && line.trim() === '---');
  if (frontmatterEnd < 0) {
    return {
      frontmatter: {},
      body: '',
      errors: ['Agent profile frontmatter must close with ---.'],
    };
  }

  if (contentEnd === null) {
    const fenceEnd = lines.findIndex((line, index) => index > frontmatterEnd && line.trim() === '```');
    if (fenceEnd < 0) {
      return {
        frontmatter: {},
        body: '',
        errors: ['Agent profile must close the chatagent fence.'],
      };
    }
    contentEnd = fenceEnd;
  }

  const frontmatter: Record<string, string> = {};
  const errors: string[] = [];

  for (const rawLine of lines.slice(frontmatterStart + 1, frontmatterEnd)) {
    const stripped = rawLine.trim();
    if (!stripped) {
      continue;
    }
    const match = FRONTMATTER_LINE.exec(stripped);
    if (!match?.[1]) {
      errors.push(`Unsupported frontmatter line: ${stripped}`);
      continue;
    }
    frontmatter[match[1]] = (match[2] ?? '').trim();
  }

  return {
    frontmatter,
    body: lines.slice(frontmatterEnd + 1, contentEnd).join('\n').trim(),
    errors,
  };
}
