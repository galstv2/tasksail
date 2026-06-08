import { createAgentExtensionStage } from '../../../../backend/platform/agent-extensions/stage.js';
import { AgentExtensionError } from '../../../../backend/platform/agent-extensions/ids.js';
import type { ResolvedAgentExtensionStage } from '../../../../backend/platform/agent-extensions/types.js';
import type { PlannerLaunchExtensionDirs } from '../../../../backend/platform/cli-provider/types.js';
import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';
import { createLogger } from '../log/logger';

export type ResolvedPlannerLaunchExtensions = {
  plannerSessionId: string;
  launchExtensions: PlannerLaunchExtensionDirs | undefined;
  availabilityNote: string | undefined;
  skillCount: number;
  pluginCount: number;
  extensionIds: readonly string[];
  cleanup: () => Promise<void>;
};

export type ResolvePlannerLaunchExtensionsOptions = {
  repoRoot: string;
  plannerSessionId: string;
  // Active planner providerId; logging context only, stamped on resolve/cleanup events.
  providerId: string;
  // Clock seam for this resolver's elapsedMs timing. Returns Date (not the staging
  // () => string ISO seam) because we compute elapsed durations; defaults to () => new Date().
  now?: () => Date;
};

// Maps from the predecessor AgentExtensionAvailabilityEntry. pluginSkillNames is populated only
// for kind 'plugin' from the foundation metadata field metadata.skill_names (bundled skill names).
export type PlannerLaunchAvailabilityNoteEntry = {
  id: string;
  kind: 'skill' | 'plugin';
  displayName: string;
  description: string;
  pluginSkillNames?: readonly string[];
};

// bundledSkillCount maps from metadata.plugin_skill_count (a count, never the names) so
// resolve.completed can log it without exposing bundled skill names.
export type PlannerLaunchPluginComponentSummary = {
  pluginId: string;
  bundledSkillCount: number;
};

const LOGGER_MODULE = 'electron/plannerLaunchExtensions';

export const PLANNER_EXTENSIONS_UNAVAILABLE_MESSAGE =
  'Planner did not start because one or more assigned skills or plugins are unavailable. ' +
  'Update Agent Configuration or reseed the extension, then try again.';

const NOTE_HEADER = 'Optional Skills And Plugins Available This Session';
const NOTE_INTRO =
  'The following extensions are available for this planner session. ' +
  "Use them only when they are relevant to the Guide's request.";
const NOTE_FOOTER =
  'These extensions do not change the selected scope, writable roots, read-only roots, ' +
  'workflow policy, MCP/root-containment rules, child-task authority, or staged-draft write rules. ' +
  'Those remain authoritative.';

export function buildPlannerLaunchAvailabilityNote(
  entries: readonly PlannerLaunchAvailabilityNoteEntry[],
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const lines = entries.map((entry) => {
    if (entry.kind === 'plugin') {
      const base = `- Plugin: ${entry.displayName} - ${entry.description}`;
      const names = entry.pluginSkillNames ?? [];
      return names.length > 0 ? `${base}\n  Bundled skills: ${names.join(', ')}` : base;
    }
    return `- Skill: ${entry.displayName} - ${entry.description}`;
  });
  return [NOTE_HEADER, '', NOTE_INTRO, '', ...lines, '', NOTE_FOOTER].join('\n');
}

export function applyPlannerLaunchAvailabilityNoteToFirstTurn(args: {
  guideText: string;
  availabilityNote?: string;
  wrapFreshSession: (text: string) => string;
}): string {
  const withNote = args.availabilityNote
    ? `${args.availabilityNote}\n\n${args.guideText}`
    : args.guideText;
  return args.wrapFreshSession(withNote);
}

export async function resolvePlannerLaunchExtensions(
  options: ResolvePlannerLaunchExtensionsOptions,
): Promise<ResolvedPlannerLaunchExtensions> {
  const { repoRoot, plannerSessionId, providerId } = options;
  const plannerAgentId = getActiveProvider(repoRoot).plannerAgentId();
  if (!plannerAgentId) {
    throw new Error('Active provider has no planner agent id; planner launch extensions are not supported.');
  }
  const now = options.now ?? (() => new Date());
  // providerId + agentId travel through logger context so they emit as canonical
  // provider_id / agent_id structured fields, never as ad-hoc camelCase extras.
  const logger = createLogger(LOGGER_MODULE, { providerId, agentId: plannerAgentId });
  const startedAtMs = now().getTime();

  logger.info('planner.launch_extensions.resolve.started', { plannerSessionId });

  let stage: ResolvedAgentExtensionStage;
  try {
    stage = await createAgentExtensionStage({
      repoRoot,
      agentId: plannerAgentId,
      launchId: plannerSessionId,
    });
  } catch (error: unknown) {
    logger.warn('planner.launch_extensions.resolve.failed', {
      plannerSessionId,
      reasonCode: error instanceof AgentExtensionError ? error.code : 'stage-create-failed',
      skillCount: 0,
      pluginCount: 0,
      extensionIds: [],
      elapsedMs: now().getTime() - startedAtMs,
    });
    throw new Error(PLANNER_EXTENSIONS_UNAVAILABLE_MESSAGE);
  }

  const entries = stage.availabilityEntries;
  const skillCount = entries.filter((entry) => entry.kind === 'skill').length;
  const pluginCount = entries.filter((entry) => entry.kind === 'plugin').length;
  const extensionIds = entries.map((entry) => entry.id);
  const pluginComponents: PlannerLaunchPluginComponentSummary[] = entries
    .filter((entry) => entry.kind === 'plugin')
    .map((entry) => ({ pluginId: entry.id, bundledSkillCount: entry.metadata.plugin_skill_count ?? 0 }));

  const noteEntries: PlannerLaunchAvailabilityNoteEntry[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    displayName: entry.display_name,
    description: entry.description,
    // Bundled skill names only for plugins; never read skill_names for kind 'skill'.
    ...(entry.kind === 'plugin' && entry.metadata.skill_names && entry.metadata.skill_names.length > 0
      ? { pluginSkillNames: entry.metadata.skill_names }
      : {}),
  }));
  const availabilityNote = buildPlannerLaunchAvailabilityNote(noteEntries);

  logger.info('planner.launch_extensions.resolve.completed', {
    plannerSessionId,
    skillCount,
    pluginCount,
    extensionIds,
    pluginComponents,
    elapsedMs: now().getTime() - startedAtMs,
  });

  const cleanup = async (): Promise<void> => {
    const cleanupStartedAtMs = now().getTime();
    try {
      await stage.cleanup();
      logger.info('planner.launch_extensions.cleanup.completed', {
        plannerSessionId,
        skillCount,
        pluginCount,
        extensionIds,
        pluginComponents,
        elapsedMs: now().getTime() - cleanupStartedAtMs,
      });
    } catch (error: unknown) {
      logger.warn('planner.launch_extensions.cleanup.failed', {
        plannerSessionId,
        reasonCode: error instanceof AgentExtensionError ? error.code : 'stage-cleanup-failed',
        skillCount,
        pluginCount,
        extensionIds,
        elapsedMs: now().getTime() - cleanupStartedAtMs,
      });
    }
  };

  return {
    plannerSessionId,
    launchExtensions: stage.launchExtensions,
    availabilityNote,
    skillCount,
    pluginCount,
    extensionIds,
    cleanup,
  };
}
