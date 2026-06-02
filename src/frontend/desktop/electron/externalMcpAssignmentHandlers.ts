import {
  loadExternalMcpAgentAssignments,
  saveExternalMcpAgentAssignments,
} from '../../../backend/platform/external-mcp-registry/index.js';
import { clearExternalMcpRegistryCache } from '../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache.js';
import { getProviderFrontendDescriptor } from '../../../backend/platform/cli-provider/index.js';

import type {
  AgentConfigSaveExternalMcpAssignmentsRequest,
  ExternalMcpAgentAssignments,
} from '../src/shared/desktopContractAgentConfig';
import type { DesktopInvokeResult } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

type ExternalMcpAssignmentHandlerOptions = {
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

export function createExternalMcpAssignmentHandlers(
  options: ExternalMcpAssignmentHandlerOptions = {},
) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  return {
    loadExternalMcpAssignments: async (): Promise<DesktopInvokeResult> => {
      try {
        const result = await loadExternalMcpAgentAssignments(repoRoot);
        if (!result.ok) {
          return fail(
            'agentConfig.loadExternalMcpAssignments',
            'External MCP assignments file is invalid.',
            result.errors,
          );
        }
        // Store-validated agent IDs are provider registry IDs (the contract union).
        const assignments = result.document
          .assignments as ExternalMcpAgentAssignments['assignments'];
        return {
          ok: true,
          response: {
            action: 'agentConfig.loadExternalMcpAssignments' as const,
            mode: 'read-only' as const,
            message: `${assignments.length} agent assignment(s) loaded.`,
            assignments,
          },
        };
      } catch (err) {
        const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
        return fail(
          'agentConfig.loadExternalMcpAssignments',
          'Failed to load external MCP assignments.',
          typeof code === 'string' ? [code] : undefined,
        );
      }
    },

    saveExternalMcpAssignments: async (
      payload: AgentConfigSaveExternalMcpAssignmentsRequest['payload'],
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
            'agentConfig.saveExternalMcpAssignments',
            `Unknown agent ID(s): ${unknownAgentIds.join(', ')}.`,
            [`Valid agent IDs: ${[...rosterIds].join(', ')}.`],
          );
        }
        const document = await saveExternalMcpAgentAssignments(
          repoRoot,
          payload.assignments.map((a) => ({
            agent_id: a.agent_id,
            external_mcp_server_ids: [...a.external_mcp_server_ids],
          })),
        );
        // Assignment changes alter which servers each agent receives at launch.
        clearExternalMcpRegistryCache(repoRoot);
        const assignments = document.assignments as ExternalMcpAgentAssignments['assignments'];
        return {
          ok: true,
          response: {
            action: 'agentConfig.saveExternalMcpAssignments' as const,
            mode: 'mutated' as const,
            message: `Saved external MCP assignments for ${assignments.length} agent(s).`,
            assignments,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : undefined;
        return fail(
          'agentConfig.saveExternalMcpAssignments',
          'Failed to save external MCP assignments.',
          message ? [message] : undefined,
        );
      }
    },
  };
}

const defaultHandlers = createExternalMcpAssignmentHandlers();

export const loadExternalMcpAssignments = defaultHandlers.loadExternalMcpAssignments;
export const saveExternalMcpAssignments = defaultHandlers.saveExternalMcpAssignments;
