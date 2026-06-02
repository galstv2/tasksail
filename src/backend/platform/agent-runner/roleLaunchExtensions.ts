import type { AgentId } from '../core/index.js';
import { readTextFile } from '../core/io.js';
import { createLogger } from '../core/logger.js';
import type { AgentLaunchExtensionDirs, CliProvider } from '../cli-provider/types.js';
import { loadAgentLaunchExtensionAssignments } from '../agent-extensions/assignment.js';
import { AgentExtensionError } from '../agent-extensions/ids.js';
import { createAgentExtensionStage } from '../agent-extensions/stage.js';
import type {
  AgentExtensionAgentId,
  AgentExtensionAvailabilityEntry,
  AgentExtensionFsAdapter,
} from '../agent-extensions/types.js';
import { toRegistryId } from './metadata.js';
import { getActiveProvider } from '../cli-provider/index.js';

const log = createLogger('platform/agent-runner/roleLaunchExtensions');

// Read-only fs view for the lock-free assignment pre-check. Passing this as the
// loader's fs seam avoids constructing the default fs (whose write helpers are
// not needed for a read) and keeps the pre-check dependent only on readTextFile.
const READ_ONLY_ASSIGNMENT_FS: AgentExtensionFsAdapter = {
  readTextFile: async (filePath) => (await readTextFile(filePath)) ?? null,
  writeTextFileAtomic: () => Promise.reject(new Error('roleLaunchExtensions: assignment pre-check is read-only')),
  ensureDir: () => Promise.resolve(),
  rm: () => Promise.resolve(),
  rename: () => Promise.reject(new Error('roleLaunchExtensions: assignment pre-check is read-only')),
  pathExists: () => Promise.resolve(false),
};

// The registry IDs that carry role-agent extension assignments. planning-agent
// (Lily) is intentionally excluded: it is wired by the predecessor Lily gate.
const ROLE_EXTENSION_AGENT_IDS: ReadonlySet<AgentExtensionAgentId> = new Set([
  'product-manager',
  'software-engineer',
  'software-engineer-verify',
  'qa',
]);

export type RoleAgentLaunchExtensionResolution = {
  stageLaunchId: string;
  // undefined when resolution short-circuits to a no-op before mapping: no agent
  // has any assignment, or the runtime agent is out of scope (planning-agent/Lily)
  // or unmapped. Populated for any agent that maps to an assignment owner.
  assignmentAgentId: AgentExtensionAgentId | undefined;
  launchExtensions: AgentLaunchExtensionDirs | undefined;
  availabilityNote: string | undefined;
  extensionIds: readonly string[];
  skillCount: number;
  pluginCount: number;
  cleanup: () => Promise<void>;
};

export type ResolveRoleAgentLaunchExtensionsOptions = {
  repoRoot: string;
  runtimeAgentId: AgentId;
  stageLaunchId: string;
};

/**
 * Thin wrapper over metadata.ts::toRegistryId. Returns the assignment agent ID,
 * or undefined for planning-agent (Lily, out of scope) and any unmapped ID. Does
 * not define its own agent-id map — the registry-id source of truth stays single.
 */
export function roleAgentToExtensionAgentId(
  provider: CliProvider,
  runtimeAgentId: AgentId,
): AgentExtensionAgentId | undefined {
  const registryId = toRegistryId(provider, runtimeAgentId);
  return ROLE_EXTENSION_AGENT_IDS.has(registryId as AgentExtensionAgentId)
    ? (registryId as AgentExtensionAgentId)
    : undefined;
}

/**
 * Resolve a role-agent launch-extension snapshot for this launch: map the
 * runtime agent to its assignment agent ID and stage the assigned extensions
 * once. Returns a no-op resolution (undefined launchExtensions, no note, no-op
 * cleanup) when the mapped agent has no enabled assignments.
 */
function noopResolution(
  stageLaunchId: string,
  assignmentAgentId: AgentExtensionAgentId | undefined,
  cleanup: () => Promise<void> = async () => undefined,
): RoleAgentLaunchExtensionResolution {
  return {
    stageLaunchId,
    assignmentAgentId,
    launchExtensions: undefined,
    availabilityNote: undefined,
    extensionIds: [],
    skillCount: 0,
    pluginCount: 0,
    cleanup,
  };
}

export async function resolveRoleAgentLaunchExtensions(
  options: ResolveRoleAgentLaunchExtensionsOptions,
): Promise<RoleAgentLaunchExtensionResolution> {
  const { repoRoot, runtimeAgentId, stageLaunchId } = options;

  // Resolve the active provider up front so a provider-resolution failure surfaces
  // instead of being swallowed by the legacy defensive catch below.
  const provider = getActiveProvider(repoRoot);

  // Map the runtime agent. toRegistryId is read defensively: some legacy role-agent
  // test harnesses partially mock metadata.js without toRegistryId, and an
  // unavailable mapping is treated as unmapped (no extensions). In production
  // toRegistryId is always present, so this catch is inert there.
  let assignmentAgentId: AgentExtensionAgentId | undefined;
  try {
    assignmentAgentId = roleAgentToExtensionAgentId(provider, runtimeAgentId);
  } catch {
    return noopResolution(stageLaunchId, undefined);
  }
  if (!assignmentAgentId) {
    // Out of scope (planning-agent/Lily) or unmapped runtime agent: graceful no-op.
    return noopResolution(stageLaunchId, undefined);
  }

  // Lock-free pre-check: read the assignment store without acquiring the staging
  // lock. When no agent has any assignment, emit the content-safe none log and
  // short-circuit before staging. createAgentExtensionStage re-reads under the lock,
  // so the captured snapshot stays authoritative.
  const assignments = await loadAgentLaunchExtensionAssignments(repoRoot, { fs: READ_ONLY_ASSIGNMENT_FS });
  const hasAnyAssignment = assignments.assignments.some((entry) => entry.extension_ids.length > 0);
  if (!hasAnyAssignment) {
    log.info('agent.launch_extensions.none', {
      agentId: runtimeAgentId,
      assignmentAgentId,
      launchId: stageLaunchId,
    });
    return noopResolution(stageLaunchId, assignmentAgentId);
  }

  const stage = await createAgentExtensionStage({
    repoRoot,
    agentId: assignmentAgentId,
    launchId: stageLaunchId,
  });

  if (stage.launchExtensions === undefined) {
    log.info('agent.launch_extensions.none', {
      agentId: runtimeAgentId,
      assignmentAgentId,
      launchId: stageLaunchId,
    });
    return noopResolution(stageLaunchId, assignmentAgentId, stage.cleanup);
  }

  const extensionIds = stage.availabilityEntries.map((entry) => entry.id);
  const skillCount = stage.availabilityEntries.filter((entry) => entry.kind === 'skill').length;
  const pluginCount = stage.availabilityEntries.filter((entry) => entry.kind === 'plugin').length;

  log.info('agent.launch_extensions.resolved', {
    agentId: runtimeAgentId,
    assignmentAgentId,
    launchId: stageLaunchId,
    skillCount,
    pluginCount,
    extensionIds,
  });

  return {
    stageLaunchId,
    assignmentAgentId,
    launchExtensions: stage.launchExtensions,
    availabilityNote: buildRoleAgentLaunchAvailabilityNote(stage.availabilityEntries),
    extensionIds,
    skillCount,
    pluginCount,
    cleanup: stage.cleanup,
  };
}

/**
 * Build a metadata-only availability note from cached catalog metadata. Includes
 * names, kinds, descriptions, and cached bundled skill names only — never skill
 * bodies, plugin manifests, source paths, staged paths, or env var names.
 */
export function buildRoleAgentLaunchAvailabilityNote(
  entries: readonly AgentExtensionAvailabilityEntry[],
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'skill') {
      lines.push(`- Skill: ${entry.display_name} - ${entry.description}`);
      continue;
    }
    lines.push(`- Plugin: ${entry.display_name} - ${entry.description}`);
    const bundledSkillNames = entry.metadata.skill_names ?? [];
    if (bundledSkillNames.length > 0) {
      lines.push(`  Bundled skills: ${bundledSkillNames.join(', ')}`);
    }
  }

  return [
    'Optional Skills And Plugins Available For This Agent Launch',
    '',
    'The following extensions are available to you in this launch. Use them only when they are relevant to your assigned role and task.',
    '',
    ...lines,
    '',
    'These extensions do not change your assignment, writable roots, read-only roots, task worktrees, workflow policy, MCP/root-containment rules, artifact ownership, or validation requirements. Those remain authoritative.',
  ].join('\n');
}

/**
 * Prepend the availability note to a launch prompt. Returns the prompt unchanged
 * when there is no note (no assignments, or dry-run resolution skipped).
 */
export function prependRoleAgentLaunchAvailabilityNote(args: {
  prompt: string;
  availabilityNote?: string;
}): string {
  if (!args.availabilityNote) {
    return args.prompt;
  }
  return `${args.availabilityNote}\n\n---\n\n${args.prompt}`;
}

/**
 * Clean the captured stage exactly once. Cleanup failure is logged content-safe
 * and swallowed: it must never convert a determined agent result into a failure.
 */
export async function cleanupRoleAgentLaunchExtensions(
  resolution: RoleAgentLaunchExtensionResolution | undefined,
  loggerContext: { repoRoot: string; agentId: AgentId; taskId?: string; launchId?: string },
): Promise<void> {
  if (!resolution) {
    return;
  }
  try {
    await resolution.cleanup();
  } catch (err) {
    const reasonCode = err instanceof AgentExtensionError ? err.code : 'cleanup-failed';
    log.warn('agent.launch_extensions.cleanup_failed', {
      agentId: loggerContext.agentId,
      launchId: loggerContext.launchId ?? resolution.stageLaunchId,
      reasonCode,
    });
  }
}
