// Agent configuration contract types — extracted from desktopContract.ts for file-size compliance.

// ── Renderer-safe extension catalog types ─────────────────────────────────────
// These are re-declared here (structurally identical to backend types) so the
// renderer never imports the node-side backend module directly.

export type AgentExtensionKind = 'skill' | 'plugin';
export type AgentExtensionSourceType = 'git' | 'local' | 'direct-attachment';
export type AgentExtensionProviderId = string;
// Provider-neutral: the concrete valid agent-ID set is the active provider's roster,
// validated at the Electron save handlers against getProviderFrontendDescriptor —
// not a frontend-hardcoded union.
export type AgentExtensionAgentId = string;

/** Renderer-safe catalog entry: no raw source paths, no runtime_path, no receipt bodies. */
export type AgentExtensionRendererCatalogEntry = {
  id: string;
  kind: AgentExtensionKind;
  provider_id: AgentExtensionProviderId;
  display_name: string;
  description: string;
  enabled: boolean;
  source_type: AgentExtensionSourceType;
  imported_at?: string;
  reseeded_at?: string;
  status: 'available' | 'unavailable';
  metadata: {
    skill_names?: string[];
    plugin_component_classes?: string[];
    plugin_skill_count?: number;
  };
};

export type AgentLaunchExtensionAssignments = {
  schema_version: 1;
  assignments: Array<{
    agent_id: AgentExtensionAgentId;
    extension_ids: string[];
  }>;
};

// ── IPC request / response types ──────────────────────────────────────────────

export type AgentConfigListExtensionsRequest = {
  action: 'agentConfig.listExtensions';
  payload?: undefined;
};

export type AgentConfigListExtensionsResponse = {
  action: 'agentConfig.listExtensions';
  mode: 'read-only';
  message: string;
  extensions: AgentExtensionRendererCatalogEntry[];
};

/**
 * Discriminated add-extension request.
 * - git:   carries source fields directly (url, ref, optional commit_sha/source_subpath)
 * - local: carries source fields directly (path, optional source_subpath)
 * - direct-attachment (skill only): carries skill_markdown. The backend
 *   writes config/skill-authored/<id>/SKILL.md atomically inside the lock-held
 *   addAgentExtension transaction; the handler never writes it directly.
 *   Plugin + direct-attachment is rejected early in the validator.
 */
export type AgentConfigAddExtensionRequest =
  | {
      action: 'agentConfig.addExtension';
      payload: {
        id: string;
        kind: AgentExtensionKind;
        provider_id: AgentExtensionProviderId;
        source: { type: 'git'; url: string; ref: string; commit_sha?: string; source_subpath?: string };
      };
    }
  | {
      action: 'agentConfig.addExtension';
      payload: {
        id: string;
        kind: AgentExtensionKind;
        provider_id: AgentExtensionProviderId;
        source: { type: 'local'; path: string; source_subpath?: string };
      };
    }
  | {
      action: 'agentConfig.addExtension';
      payload: {
        id: string;
        kind: 'skill'; // direct-attachment only valid for skills (V1)
        provider_id: AgentExtensionProviderId;
        source: { type: 'direct-attachment'; skill_markdown: string };
      };
    };

export type AgentConfigAddExtensionResponse = {
  action: 'agentConfig.addExtension';
  mode: 'mutated';
  message: string;
  extension: AgentExtensionRendererCatalogEntry;
};

export type AgentConfigReseedExtensionRequest = {
  action: 'agentConfig.reseedExtension';
  payload: { id: string };
};

export type AgentConfigReseedExtensionResponse = {
  action: 'agentConfig.reseedExtension';
  mode: 'mutated';
  message: string;
  extension: AgentExtensionRendererCatalogEntry;
};

export type AgentConfigDeleteExtensionRequest = {
  action: 'agentConfig.deleteExtension';
  // remove_assignments=true performs the combined delete-plus-unassign transaction:
  // the backend removes the ID from every agent (atomic assignment write) before
  // deleting. Omitted/false keeps the fail-closed behavior for assigned entries.
  payload: { id: string; remove_assignments?: boolean };
};

export type AgentConfigDeleteExtensionResponse = {
  action: 'agentConfig.deleteExtension';
  mode: 'deleted';
  message: string;
  id: string;
};

export type AgentConfigLoadExtensionAssignmentsRequest = {
  action: 'agentConfig.loadExtensionAssignments';
  payload?: undefined;
};

export type AgentConfigLoadExtensionAssignmentsResponse = {
  action: 'agentConfig.loadExtensionAssignments';
  mode: 'read-only';
  message: string;
  assignments: AgentLaunchExtensionAssignments['assignments'];
};

export type AgentConfigSaveExtensionAssignmentsRequest = {
  action: 'agentConfig.saveExtensionAssignments';
  payload: {
    assignments: AgentLaunchExtensionAssignments['assignments'];
  };
};

export type AgentConfigSaveExtensionAssignmentsResponse = {
  action: 'agentConfig.saveExtensionAssignments';
  mode: 'mutated';
  message: string;
  assignments: AgentLaunchExtensionAssignments['assignments'];
};

// ── External MCP agent assignments ─────────────────────────────────────────────
// Durable per-agent assignment of external MCP servers, keyed by provider
// registry agent ID. Stored in .platform-state/external-mcp-agent-assignments.json.

export type ExternalMcpAgentAssignments = {
  schema_version: 1;
  assignments: Array<{
    agent_id: AgentExtensionAgentId;
    external_mcp_server_ids: string[];
  }>;
};

export type AgentConfigLoadExternalMcpAssignmentsRequest = {
  action: 'agentConfig.loadExternalMcpAssignments';
  payload?: undefined;
};

export type AgentConfigLoadExternalMcpAssignmentsResponse = {
  action: 'agentConfig.loadExternalMcpAssignments';
  mode: 'read-only';
  message: string;
  assignments: ExternalMcpAgentAssignments['assignments'];
};

export type AgentConfigSaveExternalMcpAssignmentsRequest = {
  action: 'agentConfig.saveExternalMcpAssignments';
  payload: {
    assignments: ExternalMcpAgentAssignments['assignments'];
  };
};

export type AgentConfigSaveExternalMcpAssignmentsResponse = {
  action: 'agentConfig.saveExternalMcpAssignments';
  mode: 'mutated';
  message: string;
  assignments: ExternalMcpAgentAssignments['assignments'];
};

// ── Existing agent config types ────────────────────────────────────────────────

export type AgentConfigAgentEntry = {
  agent_id: string;
  human_name: string;
  role_name: string;
  required_model: string;
  reasoning_effort?: string;
  workflow_order: number;
};

export type AgentConfigModelCatalogEntry = {
  display_name: string;
  model_id: string;
};

export type AgentConfigLoadAgentsRequest = {
  action: 'agentConfig.loadAgents';
  payload?: undefined;
};

export type AgentConfigLoadAgentsResponse = {
  action: 'agentConfig.loadAgents';
  mode: 'read-only';
  message: string;
  agents: AgentConfigAgentEntry[];
};

export type AgentConfigLoadModelCatalogRequest = {
  action: 'agentConfig.loadModelCatalog';
  payload?: undefined;
};

export type AgentConfigLoadModelCatalogResponse = {
  action: 'agentConfig.loadModelCatalog';
  mode: 'read-only';
  message: string;
  models: AgentConfigModelCatalogEntry[];
};

export type AgentConfigLoadCapabilitiesRequest = {
  action: 'agentConfig.loadCapabilities';
  payload?: undefined;
};

export type AgentConfigLoadCapabilitiesResponse = {
  action: 'agentConfig.loadCapabilities';
  mode: 'read-only';
  message: string;
  providerId: string;
  cliVersion: string | null;
  effortChoices: string[];
  stale: boolean;
};

export type AgentConfigSaveAgentModelsRequest = {
  action: 'agentConfig.saveAgentModels';
  payload: {
    assignments: Array<{
      agent_id: string;
      model_id: string;
      reasoning_effort?: string;
    }>;
  };
};

export type AgentConfigSaveAgentModelsResponse = {
  action: 'agentConfig.saveAgentModels';
  mode: 'mutated';
  message: string;
  agents: AgentConfigAgentEntry[];
};

export type AgentConfigAddModelRequest = {
  action: 'agentConfig.addModel';
  payload: AgentConfigModelCatalogEntry;
};

export type AgentConfigAddModelResponse = {
  action: 'agentConfig.addModel';
  mode: 'mutated';
  message: string;
  models: AgentConfigModelCatalogEntry[];
};

export type AgentConfigRemoveModelRequest = {
  action: 'agentConfig.removeModel';
  payload: { model_id: string };
};

export type AgentConfigRemoveModelResponse = {
  action: 'agentConfig.removeModel';
  mode: 'mutated';
  message: string;
  models: AgentConfigModelCatalogEntry[];
};
