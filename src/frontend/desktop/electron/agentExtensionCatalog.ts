import {
  addAgentExtension,
  deleteAgentExtension,
  listAgentExtensions,
  loadAgentLaunchExtensionAssignments,
  reseedAgentExtension,
  saveAgentLaunchExtensionAssignments,
} from '../../../backend/platform/agent-extensions/index.js';
import type {
  AgentExtensionRendererCatalogEntry,
  AgentLaunchExtensionAssignments,
} from '../../../backend/platform/agent-extensions/index.js';
import { getProviderFrontendDescriptor } from '../../../backend/platform/cli-provider/index.js';

import type {
  AgentConfigAddExtensionRequest,
  AgentConfigSaveExtensionAssignmentsRequest,
} from '../src/shared/desktopContractAgentConfig';
import type { DesktopInvokeResult } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

// Re-export for Track C renderer consumption (structurally identical to backend types)
export type { AgentExtensionRendererCatalogEntry, AgentLaunchExtensionAssignments };

type AgentExtensionCatalogHandlerOptions = {
  repoRoot?: string;
};

function fail(action: string, error: string, details?: string[]): DesktopInvokeResult {
  return {
    ok: false,
    action,
    error,
    ...(details && details.length > 0 ? { details } : {}),
  };
}

export function createAgentExtensionCatalogHandlers(
  options: AgentExtensionCatalogHandlerOptions = {},
) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  return {
    listExtensions: async (): Promise<DesktopInvokeResult> => {
      try {
        const extensions = await listAgentExtensions(repoRoot);
        return {
          ok: true,
          response: {
            action: 'agentConfig.listExtensions' as const,
            mode: 'read-only' as const,
            message: `${extensions.length} extension(s) loaded.`,
            extensions,
          },
        };
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.listExtensions',
          'Failed to list extensions.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },

    addExtension: async (
      payload: AgentConfigAddExtensionRequest['payload'],
    ): Promise<DesktopInvokeResult> => {
      try {
        let backendSource: Parameters<typeof addAgentExtension>[1]['source'];

        if (payload.source.type === 'git') {
          backendSource = {
            type: 'git',
            url: payload.source.url,
            ref: payload.source.ref,
            ...(payload.source.commit_sha ? { commit_sha: payload.source.commit_sha } : {}),
            ...(payload.source.source_subpath ? { source_subpath: payload.source.source_subpath } : {}),
          };
        } else if (payload.source.type === 'local') {
          backendSource = {
            type: 'local',
            path: payload.source.path,
            ...(payload.source.source_subpath ? { source_subpath: payload.source.source_subpath } : {}),
          };
        } else {
          // direct-attachment: the backend writes config/skill-authored/<id>/SKILL.md
          // atomically inside the lock-held add transaction (single-writer). The handler
          // only forwards the authored markdown; it never touches the filesystem here.
          backendSource = { type: 'direct-attachment', skill_markdown: payload.source.skill_markdown };
        }

        const entry = await addAgentExtension(repoRoot, {
          id: payload.id,
          kind: payload.kind,
          provider_id: payload.provider_id,
          source: backendSource,
        });

        return {
          ok: true,
          response: {
            action: 'agentConfig.addExtension' as const,
            mode: 'mutated' as const,
            message: `Added extension "${entry.display_name}".`,
            extension: entry,
          },
        };
      } catch (err) {
        // Return safe generic error — do NOT include source URLs, paths, or stdout/stderr
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.addExtension',
          'Failed to add extension. Check the source configuration.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },

    reseedExtension: async (payload: { id: string }): Promise<DesktopInvokeResult> => {
      try {
        const entry = await reseedAgentExtension(repoRoot, payload.id);
        return {
          ok: true,
          response: {
            action: 'agentConfig.reseedExtension' as const,
            mode: 'mutated' as const,
            message: `Reseeded extension "${entry.display_name}".`,
            extension: entry,
          },
        };
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.reseedExtension',
          'Failed to reseed extension.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },

    deleteExtension: async (
      payload: { id: string; remove_assignments?: boolean },
    ): Promise<DesktopInvokeResult> => {
      try {
        await deleteAgentExtension(repoRoot, payload.id, {
          removeAssignments: payload.remove_assignments ?? false,
        });
        return {
          ok: true,
          response: {
            action: 'agentConfig.deleteExtension' as const,
            mode: 'deleted' as const,
            message: `Deleted extension "${payload.id}".`,
            id: payload.id,
          },
        };
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.deleteExtension',
          'Failed to delete extension.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },

    loadExtensionAssignments: async (): Promise<DesktopInvokeResult> => {
      try {
        const result = await loadAgentLaunchExtensionAssignments(repoRoot);
        return {
          ok: true,
          response: {
            action: 'agentConfig.loadExtensionAssignments' as const,
            mode: 'read-only' as const,
            message: `${result.assignments.length} agent assignment(s) loaded.`,
            assignments: result.assignments,
          },
        };
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.loadExtensionAssignments',
          'Failed to load extension assignments.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },

    saveExtensionAssignments: async (
      payload: AgentConfigSaveExtensionAssignmentsRequest['payload'],
    ): Promise<DesktopInvokeResult> => {
      try {
        const rosterIds = new Set(
          getProviderFrontendDescriptor(repoRoot).roster.map((entry) => entry.agentId),
        );
        const unknownAgentIds = payload.assignments
          .map((a) => a.agent_id)
          .filter((agentId) => !rosterIds.has(agentId));
        if (unknownAgentIds.length > 0) {
          return fail(
            'agentConfig.saveExtensionAssignments',
            `Unknown agent ID(s): ${unknownAgentIds.join(', ')}.`,
            [`Valid agent IDs: ${[...rosterIds].join(', ')}.`],
          );
        }
        const assignments: AgentLaunchExtensionAssignments = {
          schema_version: 1,
          assignments: payload.assignments.map((a) => ({
            agent_id: a.agent_id as AgentLaunchExtensionAssignments['assignments'][number]['agent_id'],
            extension_ids: [...a.extension_ids],
          })),
        };
        const result = await saveAgentLaunchExtensionAssignments(repoRoot, assignments);
        return {
          ok: true,
          response: {
            action: 'agentConfig.saveExtensionAssignments' as const,
            mode: 'mutated' as const,
            message: `Saved extension assignments for ${result.assignments.length} agent(s).`,
            assignments: result.assignments,
          },
        };
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.saveExtensionAssignments',
          'Failed to save extension assignments.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },
  };
}

const defaultHandlers = createAgentExtensionCatalogHandlers();

export const listAgentExtensionsCatalog = defaultHandlers.listExtensions;
export const addAgentExtensionCatalog = defaultHandlers.addExtension;
export const reseedAgentExtensionCatalog = defaultHandlers.reseedExtension;
export const deleteAgentExtensionCatalog = defaultHandlers.deleteExtension;
export const loadAgentExtensionAssignments = defaultHandlers.loadExtensionAssignments;
export const saveAgentExtensionAssignments = defaultHandlers.saveExtensionAssignments;
