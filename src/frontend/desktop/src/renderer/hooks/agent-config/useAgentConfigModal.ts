import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DesktopShellClient } from '../../services/desktopShellClient';
import { desktopShellClient } from '../../services/desktopShellClient';
import { useToastContext } from '../../contexts/ToastContext';
import type { ProviderFrontendDescriptor } from '../../../shared/desktopContractProvider';
import type { ExternalMcpServerEntry } from '../../../shared/desktopContract';
import type {
  AgentExtensionRendererCatalogEntry,
  AgentExtensionAgentId,
  AgentConfigSaveAgentModelsRequest,
} from '../../../shared/desktopContractAgentConfig';
import {
  useAgentExtensionActions,
  toAssignmentMap,
  toMcpAssignmentMap,
} from './useAgentExtensionActions';
import type { ExtensionAddForm } from './useAgentExtensionActions';
export type { ExtensionAddForm, ExtensionAddSource } from './useAgentExtensionActions';

export type AgentConfigTab = 'agents' | 'models' | 'skills-plugins';

export type AgentConfigAgent = {
  agent_id: string;
  human_name: string;
  role_name: string;
  current_model: string;
  selected_model: string;
  current_effort: string;
  selected_effort: string;
  workflow_order: number;
  // Per-agent timeouts in whole seconds; undefined renders as blank. idle is planner-only.
  current_wall_clock_timeout_s?: number;
  selected_wall_clock_timeout_s?: number;
  current_idle_timeout_s?: number;
  selected_idle_timeout_s?: number;
};

export type AgentConfigModelOption = {
  display_name: string;
  model_id: string;
  synthetic?: boolean;
};

export type AgentConfigAgentRow = AgentConfigAgent & {
  options: AgentConfigModelOption[];
  effortOptions: string[];
  effortDisabled: boolean;
  currentModelMissing: boolean;
  selectedExtensionIds: string[];
  selectedExternalMcpIds: string[];
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
  extensions: AgentExtensionRendererCatalogEntry[];
  // Per-agent assignment map: agent_id → set of extension IDs
  extensionAssignments: Record<string, string[]>;
  addForm: ExtensionAddForm;
  extensionSaving: boolean;
  newModelDisplayName: string;
  newModelId: string;
  removingModelId: string | null;
  saving: boolean;
  error: string | null;
  isDirty: boolean;
  isAssignmentsDirty: boolean;
  showRestartNotice: boolean;
  effortWarning: string | null;
  pendingModelChange: PendingModelChange | null;
  descriptor: ProviderFrontendDescriptor | null;
  onClose: () => void;
  onSelectTab: (tab: AgentConfigTab) => void;
  onAgentModelChange: (agentId: string, modelId: string) => void;
  onAgentEffortChange: (agentId: string, effort: string) => void;
  onAgentWallClockTimeoutChange: (agentId: string, value: string) => void;
  onAgentIdleTimeoutChange: (agentId: string, value: string) => void;
  onConfirmModelChange: () => void;
  onCancelModelChange: () => void;
  onNewModelDisplayNameChange: (value: string) => void;
  onNewModelIdChange: (value: string) => void;
  onAddModel: () => Promise<void>;
  onRemoveModel: (modelId: string) => void;
  onConfirmRemoveModel: (modelId: string) => Promise<void>;
  onCancelRemoveModel: () => void;
  onSave: () => Promise<void>;
  // Extension catalog actions
  onAddFormChange: (patch: Partial<ExtensionAddForm>) => void;
  onAddExtension: () => Promise<void>;
  onReseedExtension: (id: string) => Promise<void>;
  onDeleteExtension: (id: string) => Promise<void>;
  // Assignment actions. The single Save Assignments action persists both
  // Skills & Plugins and External MCP assignments; isAssignmentsDirty reflects
  // either category being dirty.
  onToggleExtensionAssignment: (agentId: string, extensionId: string, selected: boolean) => void;
  onSaveAssignments: () => Promise<void>;
  // External MCP server assignments (per-agent, on the Agents tab)
  externalMcpServers: ExternalMcpServerEntry[];
  externalMcpAssignments: Record<string, string[]>;
  onToggleExternalMcpAssignment: (agentId: string, serverId: string, selected: boolean) => void;
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
          reasoning_effort?: string;
          workflow_order?: number;
          wall_clock_timeout_s?: number;
          idle_timeout_s?: number;
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
          reasoning_effort?: string;
          workflow_order?: number;
          wall_clock_timeout_s?: number;
          idle_timeout_s?: number;
        }>;
      };
    }
  | {
      ok: true;
      response: {
        action: 'agentConfig.loadCapabilities';
        mode: 'read-only';
        message: string;
        providerId: string;
        cliVersion: string | null;
        effortChoices: string[];
        stale: boolean;
      };
    }
  | {
      ok: false;
      error: string;
      details?: string[];
    };

type AgentConfigCapabilities = {
  effortChoices: string[];
  stale: boolean;
};

type AgentConfigClientWithCapabilities = DesktopShellClient & {
  loadCapabilities?: () => Promise<unknown>;
  saveAgentModels: (
    assignments: AgentConfigSaveAgentModelsRequest['payload']['assignments'],
  ) => Promise<unknown>;
};

const NO_REASONING_EFFORT = 'none';
const FALLBACK_CLI_DISPLAY_NAME = 'active provider';

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

function normalizeEffort(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized && normalized !== NO_REASONING_EFFORT ? normalized : NO_REASONING_EFFORT;
}

// Accepts only a whole-second integer string in the inclusive range 1..86400 (no clear/0/blank).
// Returns the parsed seconds, or null for any value that must not advance into savable state.
function parseTimeoutSecondsInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : null;
}

function installedProviderLabel(cliDisplayName: string): string {
  return cliDisplayName === FALLBACK_CLI_DISPLAY_NAME
    ? 'the active provider'
    : `the installed ${cliDisplayName}`;
}

function formatUnavailableCapabilitiesWarning(cliDisplayName: string): string {
  return `Reasoning effort options could not be loaded from ${installedProviderLabel(cliDisplayName)}. Effort changes are blocked until capabilities can be discovered.`;
}

function formatStaleCapabilitiesWarning(cliDisplayName: string): string {
  return `Cached reasoning effort options may be out of date. Confirm ${installedProviderLabel(cliDisplayName)} supports the selected effort before saving.`;
}

function findPlannerAssignment(
  agents: Array<{
    agent_id: string;
    required_model: string;
    reasoning_effort?: string;
  }>,
  plannerAgentId: string | null,
): { model: string; effort: string } | null {
  if (!plannerAgentId) {
    return null;
  }
  const agent = agents.find((entry) => entry.agent_id === plannerAgentId);
  return agent ? { model: agent.required_model, effort: normalizeEffort(agent.reasoning_effort) } : null;
}

function toAgentRows(
  agents: Array<{
    agent_id: string;
    human_name: string;
    role_name: string;
    required_model: string;
    reasoning_effort?: string;
    workflow_order?: number;
    wall_clock_timeout_s?: number;
    idle_timeout_s?: number;
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
      current_effort: normalizeEffort(agent.reasoning_effort),
      selected_effort: normalizeEffort(agent.reasoning_effort),
      workflow_order: agent.workflow_order ?? index,
      current_wall_clock_timeout_s: agent.wall_clock_timeout_s,
      selected_wall_clock_timeout_s: agent.wall_clock_timeout_s,
      current_idle_timeout_s: agent.idle_timeout_s,
      selected_idle_timeout_s: agent.idle_timeout_s,
    }));
}

function asAgentConfigResponse(value: unknown): AgentConfigResponse {
  return value as AgentConfigResponse;
}

function applyPlannerRestartCheck(
  agents: Array<{ agent_id: string; required_model: string; reasoning_effort?: string }>,
  plannerAgentId: string | null,
  plannerStartupAssignmentRef: React.RefObject<{ model: string; effort: string } | null>,
  setShowRestartNotice: (value: boolean) => void,
): void {
  if (!plannerAgentId) {
    setShowRestartNotice(false);
    return;
  }
  const nextPlannerAssignment = findPlannerAssignment(agents, plannerAgentId);
  if (plannerStartupAssignmentRef.current === null && nextPlannerAssignment !== null) {
    (plannerStartupAssignmentRef as React.MutableRefObject<{ model: string; effort: string } | null>).current = nextPlannerAssignment;
  }
  const baseline = plannerStartupAssignmentRef.current;
  setShowRestartNotice(
    baseline !== null &&
      nextPlannerAssignment !== null &&
      (nextPlannerAssignment.model !== baseline.model || nextPlannerAssignment.effort !== baseline.effort),
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
  const [descriptor, setDescriptor] = useState<ProviderFrontendDescriptor | null>(null);
  const [capabilities, setCapabilities] = useState<AgentConfigCapabilities>({
    effortChoices: [],
    stale: true,
  });
  const plannerStartupAssignmentRef = useRef<{ model: string; effort: string } | null>(null);

  const {
    extensions,
    externalMcpServers,
    workingAssignments,
    workingMcpAssignments,
    addForm,
    extensionSaving,
    isAssignmentsDirty,
    setExtensions,
    setExternalMcpServers,
    setSavedAssignments,
    setWorkingAssignments,
    setSavedMcpAssignments,
    setWorkingMcpAssignments,
    onAddFormChange,
    onAddExtension,
    onReseedExtension,
    onDeleteExtension,
    onToggleExtensionAssignment,
    onToggleExternalMcpAssignment,
    onSaveAssignments,
  } = useAgentExtensionActions({ client, providerId: descriptor?.providerId, setError });

  const loadConfig = useCallback(async () => {
    setIsLoading(true);

    try {
      const clientWithCapabilities = client as AgentConfigClientWithCapabilities;
      const loadCapabilities = clientWithCapabilities.loadCapabilities
        ? clientWithCapabilities.loadCapabilities()
        : Promise.resolve({
            ok: true,
            response: {
              action: 'agentConfig.loadCapabilities',
              mode: 'read-only',
              message: formatUnavailableCapabilitiesWarning(FALLBACK_CLI_DISPLAY_NAME),
              providerId: 'unknown',
              cliVersion: null,
              effortChoices: [],
              stale: true,
            },
          });
      const [agentResultRaw, modelResultRaw, capabilityResultRaw, descriptorResult, extensionsResultRaw, assignmentsResultRaw, externalMcpServersRaw, mcpAssignmentsResultRaw] = await Promise.all([
        client.loadAgentConfig(),
        client.loadModelCatalog(),
        loadCapabilities,
        client.describeActiveProvider(),
        client.listAgentExtensions(),
        client.loadAgentExtensionAssignments(),
        client.listExternalMcpServers(),
        client.loadExternalMcpAssignments(),
      ]);
      const agentResult = asAgentConfigResponse(agentResultRaw);
      const modelResult = asAgentConfigResponse(modelResultRaw);
      const capabilityResult = asAgentConfigResponse(capabilityResultRaw);
      setDescriptor(descriptorResult);

      let nextError: string | null = null;
      let nextCapabilities: AgentConfigCapabilities = {
        effortChoices: [],
        stale: true,
      };

      if (agentResult.ok && agentResult.response.action === 'agentConfig.loadAgents') {
        setAgents(toAgentRows(agentResult.response.agents));
        applyPlannerRestartCheck(
          agentResult.response.agents,
          descriptorResult.plannerAgentId,
          plannerStartupAssignmentRef,
          setShowRestartNotice,
        );
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

      if (capabilityResult.ok && capabilityResult.response.action === 'agentConfig.loadCapabilities') {
        nextCapabilities = {
          effortChoices: capabilityResult.response.effortChoices.map(normalizeEffort).filter((choice) => choice !== NO_REASONING_EFFORT),
          stale: capabilityResult.response.stale,
        };
      } else if (!capabilityResult.ok && nextError === null) {
        nextError = capabilityResult.error;
      }
      setCapabilities(nextCapabilities);

      // Extensions catalog — pure disk read, no rescan
      const extResult = extensionsResultRaw as { ok: boolean; response?: { extensions?: AgentExtensionRendererCatalogEntry[] }; error?: string };
      if (extResult.ok && extResult.response?.extensions) {
        setExtensions(extResult.response.extensions);
      } else if (!extResult.ok && nextError === null) {
        nextError = (extResult.error as string) ?? 'Unable to load extensions.';
      }

      // Assignments — pure disk read, no rescan
      const assignResult = assignmentsResultRaw as { ok: boolean; response?: { assignments?: Array<{ agent_id: AgentExtensionAgentId; extension_ids: string[] }> }; error?: string };
      if (assignResult.ok && assignResult.response?.assignments) {
        const map = toAssignmentMap(assignResult.response.assignments);
        setSavedAssignments(map);
        setWorkingAssignments(map);
      } else if (!assignResult.ok && nextError === null) {
        nextError = (assignResult.error as string) ?? 'Unable to load assignments.';
      }

      // External MCP servers — populates the Agents-tab assignment selector
      const mcpServersResult = externalMcpServersRaw as { ok: boolean; response?: { servers?: ExternalMcpServerEntry[] }; error?: string };
      if (mcpServersResult.ok && mcpServersResult.response?.servers) {
        setExternalMcpServers(mcpServersResult.response.servers);
      } else if (!mcpServersResult.ok && nextError === null) {
        nextError = (mcpServersResult.error as string) ?? 'Unable to load external MCP servers.';
      }

      // External MCP assignments — pure disk read
      const mcpAssignResult = mcpAssignmentsResultRaw as { ok: boolean; response?: { assignments?: Array<{ agent_id: AgentExtensionAgentId; external_mcp_server_ids: string[] }> }; error?: string };
      if (mcpAssignResult.ok && mcpAssignResult.response?.assignments) {
        const map = toMcpAssignmentMap(mcpAssignResult.response.assignments);
        setSavedMcpAssignments(map);
        setWorkingMcpAssignments(map);
      } else if (!mcpAssignResult.ok && nextError === null) {
        nextError = (mcpAssignResult.error as string) ?? 'Unable to load external MCP assignments.';
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
    plannerStartupAssignmentRef.current = null;
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

  const onAgentEffortChange = useCallback((agentId: string, effort: string) => {
    const selectedEffort = normalizeEffort(effort);
    setAgents((current) =>
      current.map((agent) => (
        agent.agent_id === agentId
          ? { ...agent, selected_effort: selectedEffort }
          : agent
      )),
    );
    setError(null);
  }, []);

  const onAgentWallClockTimeoutChange = useCallback((agentId: string, value: string) => {
    // A blank field is allowed mid-edit: it renders blank and is omitted on save (never a disable
    // operation), so the controlled input does not snap back when cleared to retype. Non-empty
    // invalid input shows an error and never advances to a savable value.
    if (value.trim() === '') {
      setAgents((current) =>
        current.map((agent) => (
          agent.agent_id === agentId ? { ...agent, selected_wall_clock_timeout_s: undefined } : agent
        )),
      );
      setError(null);
      return;
    }
    const seconds = parseTimeoutSecondsInput(value);
    if (seconds === null) {
      setError('Wall clock timeout must be a whole number of seconds from 1 to 86400.');
      return;
    }
    setAgents((current) =>
      current.map((agent) => (
        agent.agent_id === agentId ? { ...agent, selected_wall_clock_timeout_s: seconds } : agent
      )),
    );
    setError(null);
  }, []);

  const onAgentIdleTimeoutChange = useCallback((agentId: string, value: string) => {
    // Same blank-allowed editing semantics as the wall-clock handler above.
    if (value.trim() === '') {
      setAgents((current) =>
        current.map((agent) => (
          agent.agent_id === agentId ? { ...agent, selected_idle_timeout_s: undefined } : agent
        )),
      );
      setError(null);
      return;
    }
    const seconds = parseTimeoutSecondsInput(value);
    if (seconds === null) {
      setError('Idle timeout must be a whole number of seconds from 1 to 86400.');
      return;
    }
    setAgents((current) =>
      current.map((agent) => (
        agent.agent_id === agentId ? { ...agent, selected_idle_timeout_s: seconds } : agent
      )),
    );
    setError(null);
  }, []);

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
    () => agents.some((agent) =>
      agent.selected_model !== agent.current_model
      || agent.selected_effort !== agent.current_effort
      || agent.selected_wall_clock_timeout_s !== agent.current_wall_clock_timeout_s
      || agent.selected_idle_timeout_s !== agent.current_idle_timeout_s),
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
        await (client as AgentConfigClientWithCapabilities).saveAgentModels(
          agents.map((agent) => ({
            agent_id: agent.agent_id,
            model_id: agent.selected_model,
            ...(agent.selected_effort !== NO_REASONING_EFFORT ? { reasoning_effort: agent.selected_effort } : {}),
            ...(agent.selected_wall_clock_timeout_s !== undefined
              ? { wall_clock_timeout_s: agent.selected_wall_clock_timeout_s }
              : {}),
            ...(descriptor?.plannerAgentId === agent.agent_id && agent.selected_idle_timeout_s !== undefined
              ? { idle_timeout_s: agent.selected_idle_timeout_s }
              : {}),
          })),
        ),
      );

      if (result.ok && result.response.action === 'agentConfig.saveAgentModels') {
        setAgents(toAgentRows(result.response.agents));
        applyPlannerRestartCheck(result.response.agents, descriptor?.plannerAgentId ?? null, plannerStartupAssignmentRef, setShowRestartNotice);
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
  }, [addToast, agents, client, descriptor?.plannerAgentId, isDirty]);

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

  useEffect(() => {
    const availableEfforts = capabilities.effortChoices;
    setAgents((current) =>
      current.map((agent) => {
        const validEfforts = availableEfforts.length === 0
          ? [NO_REASONING_EFFORT, ...(agent.current_effort !== NO_REASONING_EFFORT ? [agent.current_effort] : [])]
          : [NO_REASONING_EFFORT, ...availableEfforts];

        return validEfforts.includes(agent.selected_effort)
          ? agent
          : { ...agent, selected_effort: agent.current_effort };
      }),
    );
  }, [capabilities.effortChoices]);

  const agentRows = useMemo<AgentConfigAgentRow[]>(() => {
    const baseOptions: AgentConfigModelOption[] = models;
    const catalogModelIds = new Set(models.map((m) => m.model_id));
    const availableEfforts = capabilities.effortChoices;
    const effortDisabled = availableEfforts.length === 0;

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

      const effortOptions = effortDisabled
        ? [NO_REASONING_EFFORT, ...(agent.current_effort !== NO_REASONING_EFFORT ? [agent.current_effort] : [])]
        : [NO_REASONING_EFFORT, ...availableEfforts];
      const selected_effort = effortOptions.includes(agent.selected_effort)
        ? agent.selected_effort
        : agent.current_effort;

      return {
        ...agent,
        selected_effort,
        options: extras.length > 0 ? [...baseOptions, ...extras] : baseOptions,
        effortOptions,
        effortDisabled,
        currentModelMissing: !catalogModelIds.has(agent.current_model),
        selectedExtensionIds: workingAssignments[agent.agent_id] ?? [],
        selectedExternalMcpIds: workingMcpAssignments[agent.agent_id] ?? [],
      };
    });
  }, [agents, capabilities.effortChoices, models, workingAssignments, workingMcpAssignments]);

  const effortWarning = useMemo(() => {
    const cliDisplayName = descriptor?.cliDisplayName ?? FALLBACK_CLI_DISPLAY_NAME;
    if (capabilities.effortChoices.length === 0) {
      return formatUnavailableCapabilitiesWarning(cliDisplayName);
    }
    if (capabilities.stale) {
      return formatStaleCapabilitiesWarning(cliDisplayName);
    }
    return null;
  }, [capabilities.effortChoices.length, capabilities.stale, descriptor?.cliDisplayName]);

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
      extensions,
      extensionAssignments: workingAssignments,
      addForm,
      extensionSaving,
      newModelDisplayName,
      newModelId,
      removingModelId,
      saving,
      error,
      isDirty,
      isAssignmentsDirty,
      showRestartNotice,
      effortWarning,
      pendingModelChange,
      descriptor,
      onClose,
      onSelectTab,
      onAgentModelChange,
      onAgentEffortChange,
      onAgentWallClockTimeoutChange,
      onAgentIdleTimeoutChange,
      onConfirmModelChange,
      onCancelModelChange,
      onNewModelDisplayNameChange,
      onNewModelIdChange,
      onAddModel,
      onRemoveModel,
      onConfirmRemoveModel,
      onCancelRemoveModel,
      onSave,
      onAddFormChange,
      onAddExtension,
      onReseedExtension,
      onDeleteExtension,
      onToggleExtensionAssignment,
      onSaveAssignments,
      externalMcpServers,
      externalMcpAssignments: workingMcpAssignments,
      onToggleExternalMcpAssignment,
    },
    openAgentConfigModal,
  };
}
