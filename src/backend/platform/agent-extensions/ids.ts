import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getActiveProvider } from '../cli-provider/index.js';
import { isRecord, safeJsonParse } from '../core/index.js';
import type { CliProvider } from '../cli-provider/index.js';
import type { AgentExtensionAgentId, AgentExtensionKind, AgentExtensionSourceType } from './types.js';

export class AgentExtensionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentExtensionError';
    this.code = code;
  }
}

export function extensionError(code: string, message: string): AgentExtensionError {
  return new AgentExtensionError(code, message);
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidExtensionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function normalizeProviderAgentIds(agentIds: readonly string[]): AgentExtensionAgentId[] {
  const seen = new Set<string>();
  const normalized: AgentExtensionAgentId[] = [];
  for (const id of agentIds) {
    const trimmed = id.trim();
    if (trimmed === '') {
      throw new Error('Provider agent roster contains an empty agent ID.');
    }
    if (seen.has(trimmed)) {
      throw new Error(`Provider agent roster contains duplicate agent ID "${trimmed}".`);
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  if (normalized.length === 0) {
    throw new Error('Provider agent roster must contain at least one agent ID.');
  }
  return normalized;
}

export function isValidAgentId(id: string, providerAgentIds: readonly AgentExtensionAgentId[]): id is AgentExtensionAgentId {
  return providerAgentIds.includes(id);
}

export function getActiveProviderAgentIds(repoRoot: string): AgentExtensionAgentId[] {
  return getProviderAgentIds(repoRoot, getActiveProvider(repoRoot));
}

export function getProviderAgentIds(
  repoRoot: string,
  provider: Pick<CliProvider, 'agentConfigPaths'>,
): AgentExtensionAgentId[] {
  const registryPath = path.join(repoRoot, provider.agentConfigPaths().registry);
  const parsed = safeJsonParse<unknown>(readFileSync(registryPath, 'utf-8'), registryPath);
  if (!isRecord(parsed) || !Array.isArray(parsed.agents)) {
    throw new Error(`Agent registry at ${registryPath} must contain an agents array.`);
  }

  const roster = parsed.agents.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Agent registry entry at index ${index} must be an object.`);
    }
    if (typeof entry.agent_id !== 'string' || entry.agent_id.trim() === '') {
      throw new Error(`Agent registry entry at index ${index} must have a non-empty agent_id.`);
    }
    if (!Number.isInteger(entry.workflow_order)) {
      throw new Error(`Agent registry entry "${entry.agent_id}" must have an integer workflow_order.`);
    }
    return {
      agentId: entry.agent_id,
      workflowOrder: entry.workflow_order as number,
    };
  });

  return normalizeProviderAgentIds(
    roster
      .sort((a, b) => a.workflowOrder - b.workflowOrder || a.agentId.localeCompare(b.agentId))
      .map((entry) => entry.agentId),
  );
}

export function runtimeSkillDir(platformStateDir: string, id: string): string {
  return `${platformStateDir}/skills/${id}`;
}

export function runtimePluginDir(platformStateDir: string, id: string): string {
  return `${platformStateDir}/plugins/${id}`;
}

export function runtimeCopyDir(
  platformStateDir: string,
  kind: AgentExtensionKind,
  id: string,
): string {
  return kind === 'skill'
    ? runtimeSkillDir(platformStateDir, id)
    : runtimePluginDir(platformStateDir, id);
}

export function importReceiptPath(
  platformStateDir: string,
  kind: AgentExtensionKind,
  id: string,
): string {
  const sub = kind === 'skill' ? 'skills' : 'plugins';
  return `${platformStateDir}/agent-extensions/imports/${sub}/${id}.json`;
}

export function lockDir(platformStateDir: string): string {
  return `${platformStateDir}/agent-extensions/.lock`;
}

export function assignmentFilePath(platformStateDir: string): string {
  return `${platformStateDir}/agent-launch-extensions.json`;
}

export function tempDirForId(platformStateDir: string, id: string): string {
  return `${platformStateDir}/agent-extensions/.tmp-${id}-${process.pid}`;
}

export function validatePluginDirectAttachment(source: { type: AgentExtensionSourceType }): string | null {
  if (source.type === 'direct-attachment') {
    return 'Plugin direct-attachment is not supported in V1. Use git or local source for plugins.';
  }
  return null;
}
