// Focused validators for agent-extension catalog and assignment IPC actions.
// desktopContractValidators.ts imports from here and acts as a thin action router only.

import { isNonEmptyString, isRecord } from './desktopContractValidationCore';
import type { AgentExtensionAgentId } from './desktopContractAgentConfig';

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VALID_KINDS = ['skill', 'plugin'] as const;
const VALID_SOURCE_TYPES = ['git', 'local', 'direct-attachment'] as const;
const VALID_PROVIDER_IDS = ['copilot'] as const;
const VALID_AGENT_IDS: readonly AgentExtensionAgentId[] = [
  'planning-agent',
  'product-manager',
  'software-engineer',
  'software-engineer-verify',
  'qa',
];

function isValidExtensionId(value: unknown): boolean {
  return typeof value === 'string' && EXTENSION_ID_PATTERN.test(value);
}

export function validateListExtensionsPayload(payload: unknown): string[] {
  if (payload !== undefined) {
    return ['payload must be omitted.'];
  }
  return [];
}

export function validateAddExtensionPayload(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ['payload must be an object.'];
  }
  const errors: string[] = [];

  if (!isValidExtensionId(payload.id)) {
    errors.push('payload.id must match ^[a-z0-9][a-z0-9-]{0,63}$.');
  }
  if (!Array.isArray(VALID_KINDS) || !VALID_KINDS.includes(payload.kind as (typeof VALID_KINDS)[number])) {
    errors.push('payload.kind must be skill or plugin.');
  }
  if (!VALID_PROVIDER_IDS.includes(payload.provider_id as (typeof VALID_PROVIDER_IDS)[number])) {
    errors.push('payload.provider_id must be copilot.');
  }

  if (!isRecord(payload.source)) {
    errors.push('payload.source must be an object.');
    return errors;
  }

  if (!VALID_SOURCE_TYPES.includes(payload.source.type as (typeof VALID_SOURCE_TYPES)[number])) {
    errors.push('payload.source.type must be git, local, or direct-attachment.');
    return errors;
  }

  // plugin + direct-attachment is rejected in V1
  if (payload.kind === 'plugin' && payload.source.type === 'direct-attachment') {
    errors.push('Plugins cannot use direct-attachment source in V1. Use git or local source.');
  }

  if (payload.source.type === 'git') {
    if (!isNonEmptyString(payload.source.url)) {
      errors.push('payload.source.url must be a non-empty string for git source.');
    }
    if (!isNonEmptyString(payload.source.ref)) {
      errors.push('payload.source.ref must be a non-empty string for git source.');
    }
    if (payload.source.source_subpath !== undefined && !isNonEmptyString(payload.source.source_subpath)) {
      errors.push('payload.source.source_subpath must be a non-empty string when provided.');
    }
  } else if (payload.source.type === 'local') {
    if (!isNonEmptyString(payload.source.path)) {
      errors.push('payload.source.path must be a non-empty string for local source.');
    }
    if (payload.source.source_subpath !== undefined && !isNonEmptyString(payload.source.source_subpath)) {
      errors.push('payload.source.source_subpath must be a non-empty string when provided.');
    }
  } else if (payload.source.type === 'direct-attachment') {
    if (!isNonEmptyString(payload.source.skill_markdown)) {
      errors.push('payload.source.skill_markdown must be a non-empty string for direct-attachment source.');
    }
  }

  return errors;
}

export function validateReseedExtensionPayload(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ['payload must be an object.'];
  }
  if (!isValidExtensionId(payload.id)) {
    return ['payload.id must match ^[a-z0-9][a-z0-9-]{0,63}$.'];
  }
  return [];
}

export function validateDeleteExtensionPayload(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ['payload must be an object.'];
  }
  const errors: string[] = [];
  if (!isValidExtensionId(payload.id)) {
    errors.push('payload.id must match ^[a-z0-9][a-z0-9-]{0,63}$.');
  }
  if (payload.remove_assignments !== undefined && typeof payload.remove_assignments !== 'boolean') {
    errors.push('payload.remove_assignments must be a boolean when provided.');
  }
  return errors;
}

export function validateLoadExtensionAssignmentsPayload(payload: unknown): string[] {
  if (payload !== undefined) {
    return ['payload must be omitted.'];
  }
  return [];
}

export function validateSaveExtensionAssignmentsPayload(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return ['payload must be an object.'];
  }
  if (!Array.isArray(payload.assignments)) {
    return ['payload.assignments must be an array.'];
  }
  const errors: string[] = [];
  for (const [index, item] of payload.assignments.entries()) {
    const prefix = `payload.assignments[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (!VALID_AGENT_IDS.includes(item.agent_id as AgentExtensionAgentId)) {
      errors.push(`${prefix}.agent_id must be a valid agent ID (planning-agent, product-manager, software-engineer, software-engineer-verify, qa).`);
    }
    if (!Array.isArray(item.extension_ids)) {
      errors.push(`${prefix}.extension_ids must be an array.`);
    } else {
      for (const [eIdx, extId] of item.extension_ids.entries()) {
        if (!isValidExtensionId(extId)) {
          errors.push(`${prefix}.extension_ids[${eIdx}] must match ^[a-z0-9][a-z0-9-]{0,63}$.`);
        }
      }
    }
  }
  return errors;
}
