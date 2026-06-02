import path from 'node:path';
import { isRecord } from '../core/guards.js';
import { createLogger } from '../core/logger.js';
import {
  assignmentFilePath,
  getActiveProviderAgentIds,
  isValidAgentId,
  normalizeProviderAgentIds,
} from './ids.js';
import type {
  AgentExtensionAgentId,
  AgentExtensionFsAdapter,
  AgentExtensionMutationSeams,
  AgentExtensionsSourceManifest,
  AgentLaunchExtensionAssignments,
} from './types.js';
import { buildDefaultFs } from './materialize.js';
import { readSourceManifest } from './sourceManifest.js';
import { withAgentExtensionsLock } from './lock.js';

const log = createLogger('platform/agent-extensions/assignment');

function platformStateDir(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state');
}

function resolveProviderAgentIds(
  repoRoot: string,
  providerAgentIds?: readonly AgentExtensionAgentId[],
): AgentExtensionAgentId[] {
  return providerAgentIds !== undefined
    ? normalizeProviderAgentIds(providerAgentIds)
    : getActiveProviderAgentIds(repoRoot);
}

function emptyAssignments(providerAgentIds: readonly AgentExtensionAgentId[]): AgentLaunchExtensionAssignments {
  return {
    schema_version: 1,
    assignments: providerAgentIds.map((agentId) => ({
      agent_id: agentId,
      extension_ids: [],
    })),
  };
}

function parseAssignments(
  raw: string,
  providerAgentIds: readonly AgentExtensionAgentId[],
): AgentLaunchExtensionAssignments {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyAssignments(providerAgentIds);
  }

  if (!isRecord(parsed) || (parsed as Record<string, unknown>).schema_version !== 1) {
    return emptyAssignments(providerAgentIds);
  }
  if (!Array.isArray((parsed as Record<string, unknown>).assignments)) {
    return emptyAssignments(providerAgentIds);
  }

  const assignments = ((parsed as Record<string, unknown>).assignments as unknown[])
    .filter((entry): entry is { agent_id: string; extension_ids: string[] } => {
      if (!isRecord(entry)) return false;
      const e = entry as Record<string, unknown>;
      return (
        typeof e.agent_id === 'string' &&
        isValidAgentId(e.agent_id, providerAgentIds) &&
        Array.isArray(e.extension_ids) &&
        (e.extension_ids as unknown[]).every((id) => typeof id === 'string')
      );
    });

  // Fill in any missing agents with empty lists
  const presentIds = new Set(assignments.map((a) => a.agent_id));
  for (const agentId of providerAgentIds) {
    if (!presentIds.has(agentId)) {
      assignments.push({ agent_id: agentId, extension_ids: [] });
    }
  }

  return {
    schema_version: 1,
    assignments: sortAssignments(assignments, providerAgentIds),
  };
}

function sortAssignments(
  assignments: Array<{ agent_id: AgentExtensionAgentId | string; extension_ids: string[] }>,
  providerAgentIds: readonly AgentExtensionAgentId[],
): Array<{ agent_id: AgentExtensionAgentId; extension_ids: string[] }> {
  const agentOrder = new Map(providerAgentIds.map((id, i) => [id, i]));
  return [...assignments]
    .sort((a, b) => {
      const ai = agentOrder.get(a.agent_id as AgentExtensionAgentId) ?? 999;
      const bi = agentOrder.get(b.agent_id as AgentExtensionAgentId) ?? 999;
      return ai - bi;
    })
    .map((a) => ({
      agent_id: a.agent_id as AgentExtensionAgentId,
      extension_ids: [...a.extension_ids].sort(),
    }));
}

function serializeAssignments(
  assignments: AgentLaunchExtensionAssignments,
  providerAgentIds: readonly AgentExtensionAgentId[],
): string {
  const filledAssignments = [...assignments.assignments];
  const presentIds = new Set(filledAssignments.map((assignment) => assignment.agent_id));
  for (const agentId of providerAgentIds) {
    if (!presentIds.has(agentId)) {
      filledAssignments.push({ agent_id: agentId, extension_ids: [] });
    }
  }
  const sorted = {
    schema_version: assignments.schema_version,
    assignments: sortAssignments(filledAssignments, providerAgentIds),
  };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

// Lock-free atomic write of the assignment file. Callers MUST already hold
// withAgentExtensionsLock (withDirLock is non-reentrant). Performs no validation and
// emits no event — used both by saveAssignmentsUnderLock and the delete-plus-unassign
// transaction, which validates/logs at its own level.
export async function persistAssignments(
  repoRoot: string,
  assignments: AgentLaunchExtensionAssignments,
  fs: AgentExtensionFsAdapter,
  providerAgentIds?: readonly AgentExtensionAgentId[],
): Promise<void> {
  const roster = resolveProviderAgentIds(repoRoot, providerAgentIds);
  for (const assignment of assignments.assignments) {
    if (!isValidAgentId(assignment.agent_id, roster)) {
      throw new Error(`Unknown agent ID: ${assignment.agent_id}`);
    }
  }
  const psDir = platformStateDir(repoRoot);
  const filePath = assignmentFilePath(psDir);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeTextFileAtomic(filePath, serializeAssignments(assignments, roster));
}

export async function loadAssignments(
  repoRoot: string,
  fs: AgentExtensionFsAdapter,
  providerAgentIds?: readonly AgentExtensionAgentId[],
): Promise<AgentLaunchExtensionAssignments> {
  const roster = resolveProviderAgentIds(repoRoot, providerAgentIds);
  const psDir = platformStateDir(repoRoot);
  const filePath = assignmentFilePath(psDir);
  const raw = await fs.readTextFile(filePath);
  if (raw === null) {
    return emptyAssignments(roster);
  }
  return parseAssignments(raw, roster);
}

export async function saveAssignmentsUnderLock(
  repoRoot: string,
  newAssignments: AgentLaunchExtensionAssignments,
  manifest: AgentExtensionsSourceManifest,
  fs: AgentExtensionFsAdapter,
  providerAgentIds?: readonly AgentExtensionAgentId[],
): Promise<AgentLaunchExtensionAssignments> {
  const roster = resolveProviderAgentIds(repoRoot, providerAgentIds);
  const enabledIds = new Set(
    manifest.extensions.filter((e) => e.enabled).map((e) => e.id),
  );
  const allIds = new Set(manifest.extensions.map((e) => e.id));

  for (const assignment of newAssignments.assignments) {
    if (!isValidAgentId(assignment.agent_id, roster)) {
      throw new Error(`Unknown agent ID: ${assignment.agent_id}`);
    }
    for (const extId of assignment.extension_ids) {
      if (!allIds.has(extId)) {
        log.progress({
          level: 'warn',
          event: 'agent_extensions.assignment.save.rejected',
          extra: { agentId: assignment.agent_id, id: extId, reasonCode: 'unknown-extension-id' },
          text: `[agent-extensions] assignment.save.rejected: unknown extension "${extId}"`,
        });
        throw new Error(
          `Cannot assign unknown extension "${extId}". Add it to the catalog first.`,
        );
      }
      if (!enabledIds.has(extId)) {
        log.progress({
          level: 'warn',
          event: 'agent_extensions.assignment.save.rejected',
          extra: { agentId: assignment.agent_id, id: extId, reasonCode: 'extension-disabled' },
          text: `[agent-extensions] assignment.save.rejected: disabled extension "${extId}"`,
        });
        throw new Error(
          `Cannot assign disabled extension "${extId}". Enable it in the catalog first.`,
        );
      }
    }
  }

  await persistAssignments(repoRoot, newAssignments, fs, roster);

  const saved = parseAssignments(serializeAssignments(newAssignments, roster), roster);

  const count = newAssignments.assignments.reduce(
    (acc, a) => acc + a.extension_ids.length, 0,
  );
  log.progress({
    level: 'info',
    event: 'agent_extensions.assignment.save.completed',
    extra: { count },
    text: `[agent-extensions] assignment.save.completed (${count} assignments)`,
  });

  return saved;
}

export async function loadAgentLaunchExtensionAssignments(
  repoRoot: string,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentLaunchExtensionAssignments> {
  const fs = seams?.fs ?? buildDefaultFs();
  return loadAssignments(repoRoot, fs, seams?.providerAgentIds);
}

export async function saveAgentLaunchExtensionAssignments(
  repoRoot: string,
  assignments: AgentLaunchExtensionAssignments,
  seams?: AgentExtensionMutationSeams,
): Promise<AgentLaunchExtensionAssignments> {
  const fs = seams?.fs ?? buildDefaultFs();

  return withAgentExtensionsLock(repoRoot, 'saveAgentLaunchExtensionAssignments', async () => {
    const manifest = await readSourceManifest(repoRoot, fs);
    return saveAssignmentsUnderLock(repoRoot, assignments, manifest, fs, seams?.providerAgentIds);
  });
}

export function removeExtensionFromAssignments(
  assignments: AgentLaunchExtensionAssignments,
  idToRemove: string,
): AgentLaunchExtensionAssignments {
  return {
    schema_version: 1,
    assignments: assignments.assignments.map((a) => ({
      ...a,
      extension_ids: a.extension_ids.filter((id) => id !== idToRemove),
    })),
  };
}
