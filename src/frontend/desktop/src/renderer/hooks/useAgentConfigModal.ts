import { useCallback, useMemo, useRef, useState } from 'react';

import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';
import { useToastContext } from '../contexts/ToastContext';

export type AgentConfigTab = 'agents' | 'models';

export type AgentConfigAgent = {
  agent_id: string;
  human_name: string;
  role_name: string;
  current_model: string;
  selected_model: string;
  workflow_order: number;
};

export type AgentConfigModelOption = {
  display_name: string;
  model_id: string;
  synthetic?: boolean;
};

export type AgentConfigAgentRow = AgentConfigAgent & {
  options: AgentConfigModelOption[];
  currentModelMissing: boolean;
};

export type AgentConfigCatalogEntry = {
  display_name: string;
  model_id: string;
};

export type AgentConfigCatalogRow = AgentConfigCatalogEntry & {
  usageCount: number;
  inUseBy: string[];
};

export type PendingModelChange = {
  agentId: string;
  agentName: string;
  fromModel: string;
  toModel: string;
  previousSelectedModelId: string;
};

export type AgentConfigModalProps = {
  isOpen: boolean;
  isLoading: boolean;
  activeTab: AgentConfigTab;
  agents: AgentConfigAgentRow[];
  models: AgentConfigCatalogRow[];
  newModelDisplayName: string;
  newModelId: string;
  removingModelId: string | null;
  saving: boolean;
  error: string | null;
  isDirty: boolean;
  showRestartNotice: boolean;
  pendingModelChange: PendingModelChange | null;
  onClose: () => void;
  onSelectTab: (tab: AgentConfigTab) => void;
  onAgentModelChange: (agentId: string, modelId: string) => void;
  onConfirmModelChange: () => void;
  onCancelModelChange: () => void;
  onNewModelDisplayNameChange: (value: string) => void;
  onNewModelIdChange: (value: string) => void;
  onAddModel: () => Promise<void>;
  onRemoveModel: (modelId: string) => void;
  onConfirmRemoveModel: (modelId: string) => Promise<void>;
  onCancelRemoveModel: () => void;
  onSave: () => Promise<void>;
};

export type UseAgentConfigModalResult = {
  agentConfigModalProps: AgentConfigModalProps;
  openAgentConfigModal: () => void;
};

type AgentConfigResponse =
  | {
      ok: true;
      response: {
        action: 'agentConfig.loadAgents';
        mode: 'read-only';
        message: string;
        agents: Array<{
          agent_id: string;
          human_name: string;
          role_name: string;
          required_model: string;
          workflow_order?: number;
        }>;
      };
    }
  | {
      ok: true;
      response: {
        action: 'agentConfig.loadModelCatalog' | 'agentConfig.addModel' | 'agentConfig.removeModel';
        mode: 'read-only' | 'mutated';
        message: string;
        models: AgentConfigCatalogEntry[];
      };
    }
  | {
      ok: true;
      response: {
        action: 'agentConfig.saveAgentModels';
        mode: 'mutated';
        message: string;
        agents: Array<{
          agent_id: string;
          human_name: string;
          role_name: string;
          required_model: string;
          workflow_order?: number;
        }>;
      };
    }
  | {
      ok: false;
      error: string;
      details?: string[];
    };

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const LILY_AGENT_ID = 'planning-agent';

function findPlannerModel(
  agents: Array<{
    agent_id: string;
    required_model: string;
  }>,
): string | null {
  return agents.find((agent) => agent.agent_id === LILY_AGENT_ID)?.required_model ?? null;
}

function toAgentRows(
  agents: Array<{
    agent_id: string;
    human_name: string;
    role_name: string;
    required_model: string;
    workflow_order?: number;
  }>,
): AgentConfigAgent[] {
  return [...agents]
    .sort((left, right) => (left.workflow_order ?? Number.MAX_SAFE_INTEGER) - (right.workflow_order ?? Number.MAX_SAFE_INTEGER))
    .map((agent, index) => ({
      agent_id: agent.agent_id,
      human_name: agent.human_name,
      role_name: agent.role_name,
      current_model: agent.required_model,
      selected_model: agent.required_model,
      workflow_order: agent.workflow_order ?? index,
    }));
}

function asAgentConfigResponse(value: unknown): AgentConfigResponse {
  return value as AgentConfigResponse;
}

function applyPlannerRestartCheck(
  agents: Array<{ agent_id: string; required_model: string }>,
  plannerStartupModelRef: React.RefObject<string | null>,
  setShowRestartNotice: (value: boolean) => void,
): void {
  const nextPlannerModel = findPlannerModel(agents);
  if (plannerStartupModelRef.current === null && nextPlannerModel !== null) {
    (plannerStartupModelRef as React.MutableRefObject<string | null>).current = nextPlannerModel;
  }
  const baseline = plannerStartupModelRef.current;
  setShowRestartNotice(
    baseline !== null && nextPlannerModel !== null && nextPlannerModel !== baseline,
  );
}

export function useAgentConfigModal(
  client: DesktopShellClient = desktopShellClient,
): UseAgentConfigModalResult {
  const { addToast } = useToastContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentConfigTab>('agents');
  const [agents, setAgents] = useState<AgentConfigAgent[]>([]);
  const [models, setModels] = useState<AgentConfigCatalogEntry[]>([]);
  const [newModelDisplayName, setNewModelDisplayName] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [removingModelId, setRemovingModelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRestartNotice, setShowRestartNotice] = useState(false);
  const [pendingModelChange, setPendingModelChange] = useState<PendingModelChange | null>(null);
  const plannerStartupModelRef = useRef<string | null>(null);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);

    try {
      const [agentResultRaw, modelResultRaw] = await Promise.all([
        client.loadAgentConfig(),
        client.loadModelCatalog(),
      ]);
      const agentResult = asAgentConfigResponse(agentResultRaw);
      const modelResult = asAgentConfigResponse(modelResultRaw);

      let nextError: string | null = null;

      if (agentResult.ok && agentResult.response.action === 'agentConfig.loadAgents') {
        setAgents(toAgentRows(agentResult.response.agents));
        applyPlannerRestartCheck(agentResult.response.agents, plannerStartupModelRef, setShowRestartNotice);
      } else if (!agentResult.ok) {
        nextError = agentResult.error;
      }

      if (
        modelResult.ok &&
        modelResult.response.action === 'agentConfig.loadModelCatalog'
      ) {
        setModels(modelResult.response.models);
      } else if (!modelResult.ok && nextError === null) {
        nextError = modelResult.error;
      }

      setError(nextError);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load agent configuration.');
    } finally {
      setIsLoading(false);
    }
  }, [client]);


  const openAgentConfigModal = useCallback(() => {
    setIsOpen(true);
    setActiveTab('agents');
    setRemovingModelId(null);
    setError(null);
    loadConfig().catch(() => {});
  }, [loadConfig]);

  const onClose = useCallback(() => {
    setIsOpen(false);
    setActiveTab('agents');
    setRemovingModelId(null);
    setError(null);
    plannerStartupModelRef.current = null;
    setShowRestartNotice(false);
  }, []);

  const onSelectTab = useCallback((tab: AgentConfigTab) => {
    setActiveTab(tab);
    setRemovingModelId(null);
  }, []);

  const onAgentModelChange = useCallback((agentId: string, modelId: string) => {
    const agent = agents.find((a) => a.agent_id === agentId);
    if (!agent || agent.selected_model === modelId) return;

    const fromDisplayName = models.find((m) => m.model_id === agent.selected_model)?.display_name ?? agent.selected_model;
    const toDisplayName = models.find((m) => m.model_id === modelId)?.display_name ?? modelId;

    setPendingModelChange({
      agentId,
      agentName: agent.human_name,
      fromModel: fromDisplayName,
      toModel: toDisplayName,
      previousSelectedModelId: agent.selected_model,
    });

    // Optimistically apply so the <select> reflects the choice while the dialog is open
    setAgents((current) =>
      current.map((a) => (
        a.agent_id === agentId
          ? { ...a, selected_model: modelId }
          : a
      )),
    );
    setError(null);
  }, [agents, models]);

  const onConfirmModelChange = useCallback(() => {
    // The change is already applied — just dismiss the dialog
    setPendingModelChange(null);
  }, []);

  const onCancelModelChange = useCallback(() => {
    // Revert to the selection that was active before the optimistic update
    if (pendingModelChange) {
      setAgents((current) =>
        current.map((a) => (
          a.agent_id === pendingModelChange.agentId
            ? { ...a, selected_model: pendingModelChange.previousSelectedModelId }
            : a
        )),
      );
    }
    setPendingModelChange(null);
  }, [pendingModelChange]);

  const onNewModelDisplayNameChange = useCallback((value: string) => {
    setNewModelDisplayName(value);
    setError(null);
  }, []);

  const onNewModelIdChange = useCallback((value: string) => {
    setNewModelId(value);
    setError(null);
  }, []);

  const isDirty = useMemo(
    () => agents.some((agent) => agent.selected_model !== agent.current_model),
    [agents],
  );

  const onSave = useCallback(async () => {
    if (!isDirty) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = asAgentConfigResponse(
        await client.saveAgentModels(
          agents.map((agent) => ({
            agent_id: agent.agent_id,
            model_id: agent.selected_model,
          })),
        ),
      );

      if (result.ok && result.response.action === 'agentConfig.saveAgentModels') {
        setAgents(toAgentRows(result.response.agents));
        applyPlannerRestartCheck(result.response.agents, plannerStartupModelRef, setShowRestartNotice);
        addToast({
          severity: 'success',
          message: result.response.message,
          duration: 4000,
        });
        return;
      }

      if (!result.ok) {
        setError(result.error);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save agent assignments.');
    } finally {
      setSaving(false);
    }
  }, [addToast, agents, client, isDirty]);

  const onAddModel = useCallback(async () => {
    const displayName = newModelDisplayName.trim();
    const modelId = newModelId.trim();

    if (!displayName || !modelId) {
      setError('Display Name and Model ID are required.');
      return;
    }

    if (!MODEL_ID_PATTERN.test(modelId)) {
      setError('Model ID must start with a letter or number and contain only letters, numbers, dots, or hyphens.');
      return;
    }

    if (models.some((model) => model.model_id === modelId)) {
      setError(`Model ID "${modelId}" already exists.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = asAgentConfigResponse(
        await client.addModel(displayName, modelId),
      );

      if (result.ok && result.response.action === 'agentConfig.addModel') {
        setModels(result.response.models);
        setNewModelDisplayName('');
        setNewModelId('');
        addToast({
          severity: 'success',
          message: result.response.message,
          duration: 4000,
        });
        return;
      }

      if (!result.ok) {
        setError(result.error);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add model.');
    } finally {
      setSaving(false);
    }
  }, [addToast, client, models, newModelDisplayName, newModelId]);

  const onRemoveModel = useCallback((modelId: string) => {
    setRemovingModelId(modelId);
    setError(null);
  }, []);

  const onCancelRemoveModel = useCallback(() => {
    setRemovingModelId(null);
  }, []);

  const onConfirmRemoveModel = useCallback(async (modelId: string) => {
    setSaving(true);
    setError(null);

    try {
      const result = asAgentConfigResponse(await client.removeModel(modelId));

      if (result.ok && result.response.action === 'agentConfig.removeModel') {
        setModels(result.response.models);
        setRemovingModelId(null);
        addToast({
          severity: 'success',
          message: result.response.message,
          duration: 4000,
        });
        return;
      }

      if (!result.ok) {
        setError(result.error);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to remove model.');
    } finally {
      setSaving(false);
    }
  }, [addToast, client]);

  const agentRows = useMemo<AgentConfigAgentRow[]>(() => {
    const baseOptions: AgentConfigModelOption[] = models;
    const catalogModelIds = new Set(models.map((m) => m.model_id));

    return agents.map((agent) => {
      const extras: AgentConfigModelOption[] = [];
      const seen = new Set(catalogModelIds);

      for (const modelId of [agent.current_model, agent.selected_model]) {
        if (modelId && !seen.has(modelId)) {
          extras.push({
            display_name: `${modelId} (missing from catalog)`,
            model_id: modelId,
            synthetic: true,
          });
          seen.add(modelId);
        }
      }

      return {
        ...agent,
        options: extras.length > 0 ? [...baseOptions, ...extras] : baseOptions,
        currentModelMissing: !catalogModelIds.has(agent.current_model),
      };
    });
  }, [agents, models]);

  const modelRows = useMemo<AgentConfigCatalogRow[]>(
    () => models.map((model) => {
      const inUseBy = agents
        .filter((agent) => agent.current_model === model.model_id)
        .map((agent) => agent.human_name);

      return {
        ...model,
        usageCount: inUseBy.length,
        inUseBy,
      };
    }),
    [agents, models],
  );

  return {
    agentConfigModalProps: {
      isOpen,
      isLoading,
      activeTab,
      agents: agentRows,
      models: modelRows,
      newModelDisplayName,
      newModelId,
      removingModelId,
      saving,
      error,
      isDirty,
      showRestartNotice,
      pendingModelChange,
      onClose,
      onSelectTab,
      onAgentModelChange,
      onConfirmModelChange,
      onCancelModelChange,
      onNewModelDisplayNameChange,
      onNewModelIdChange,
      onAddModel,
      onRemoveModel,
      onConfirmRemoveModel,
      onCancelRemoveModel,
      onSave,
    },
    openAgentConfigModal,
  };
}
