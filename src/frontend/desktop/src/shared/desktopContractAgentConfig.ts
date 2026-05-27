// Agent configuration contract types — extracted from desktopContract.ts for file-size compliance.

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
