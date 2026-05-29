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

export const VALID_AGENT_IDS: AgentExtensionAgentId[] = [
  'planning-agent',
  'product-manager',
  'software-engineer',
  'software-engineer-verify',
  'qa',
];

export function isValidExtensionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function isValidAgentId(id: string): id is AgentExtensionAgentId {
  return VALID_AGENT_IDS.includes(id as AgentExtensionAgentId);
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
