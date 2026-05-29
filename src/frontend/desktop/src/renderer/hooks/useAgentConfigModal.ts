import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';
import { useToastContext } from '../contexts/ToastContext';
import type { ProviderFrontendDescriptor } from '../../shared/desktopContractProvider';
import type {
  AgentExtensionRendererCatalogEntry,
  AgentExtensionAgentId,
  AgentExtensionKind,
  AgentExtensionProviderId,
} from '../../shared/desktopContractAgentConfig';

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

// Add-extension form state (transient — cleared after successful call)
export type ExtensionAddSource =
  | { type: 'git'; url: string; ref: string; source_subpath: string }
  | { type: 'local'; path: string; source_subpath: string }
  | { type: 'direct-attachment'; skill_markdown: string };

export type ExtensionAddForm = {
  id: string;
  kind: AgentExtensionKind;
  provider_id: AgentExtensionProviderId;
  sourceType: 'git' | 'local' | 'direct-attachment';
  gitUrl: string;
  gitRef: string;
  gitSubpath: string;
  localPath: string;
  localSubpath: string;
  skillMarkdown: string;
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
  // Assignment actions
  onToggleExtensionAssignment: (agentId: string, extensionId: string, selected: boolean) => void;
  onSaveAssignments: () => Promise<void>;
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
    assignments: Array<{ agent_id: string; model_id: string; reasoning_effort?: string }>,
  ) => Promise<unknown>;
};

const NO_REASONING_EFFORT = 'none';
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UNAVAILABLE_CAPABILITIES_WARNING = 'Reasoning effort options could not be loaded from the installed Copilot CLI. Effort changes are blocked until capabilities can be discovered.';
const STALE_CAPABILITIES_WARNING = 'Cached reasoning effort options may be out of date. Confirm the installed Copilot CLI supports the selected effort before saving.';

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

const DEFAULT_ADD_FORM: ExtensionAddForm = {
  id: '',
  kind: 'skill',
  provider_id: 'copilot',
  sourceType: 'git',
  gitUrl: '',
  gitRef: '',
  gitSubpath: '',
  localPath: '',
  localSubpath: '',
  skillMarkdown: '',
};

function normalizeEffort(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized && normalized !== NO_REASONING_EFFORT ? normalized : NO_REASONING_EFFORT;
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

// Build a stable assignment map from the IPC response shape
function toAssignmentMap(
  assignments: Array<{ agent_id: AgentExtensionAgentId; extension_ids: string[] }>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) {
    map[entry.agent_id] = [...entry.extension_ids];
  }
  return map;
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
  const [extensions, setExtensions] = useState<AgentExtensionRendererCatalogEntry[]>([]);
  // Saved assignment map (reflects last-loaded or last-saved state)
  const [savedAssignments, setSavedAssignments] = useState<Record<string, string[]>>({});
  // Working (unsaved) assignment map
  const [workingAssignments, setWorkingAssignments] = useState<Record<string, string[]>>({});
  const [addForm, setAddForm] = useState<ExtensionAddForm>(DEFAULT_ADD_FORM);
  const [extensionSaving, setExtensionSaving] = useState(false);
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
              message: UNAVAILABLE_CAPABILITIES_WARNING,
              providerId: 'unknown',
              cliVersion: null,
              effortChoices: [],
              stale: true,
            },
          });
      const [agentResultRaw, modelResultRaw, capabilityResultRaw, descriptorResult, extensionsResultRaw, assignmentsResultRaw] = await Promise.all([
        client.loadAgentConfig(),
        client.loadModelCatalog(),
        loadCapabilities,
        client.describeActiveProvider(),
        client.listAgentExtensions(),
        client.loadAgentExtensionAssignments(),
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
    () => agents.some((agent) => agent.selected_model !== agent.current_model || agent.selected_effort !== agent.current_effort),
    [agents],
  );

  const isAssignmentsDirty = useMemo(() => {
    const agentIds = new Set([...Object.keys(savedAssignments), ...Object.keys(workingAssignments)]);
    for (const agentId of agentIds) {
      const saved = (savedAssignments[agentId] ?? []).slice().sort().join(',');
      const working = (workingAssignments[agentId] ?? []).slice().sort().join(',');
      if (saved !== working) return true;
    }
    return false;
  }, [savedAssignments, workingAssignments]);

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
      };
    });
  }, [agents, capabilities.effortChoices, models, workingAssignments]);

  const effortWarning = useMemo(() => {
    if (capabilities.effortChoices.length === 0) {
      return UNAVAILABLE_CAPABILITIES_WARNING;
    }
    if (capabilities.stale) {
      return STALE_CAPABILITIES_WARNING;
    }
    return null;
  }, [capabilities.effortChoices.length, capabilities.stale]);

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

  // ── Extension catalog actions ────────────────────────────────────────────────

  const onAddFormChange = useCallback((patch: Partial<ExtensionAddForm>) => {
    setAddForm((current) => ({ ...current, ...patch }));
    setError(null);
  }, []);

  const onAddExtension = useCallback(async () => {
    const id = addForm.id.trim();
    if (!id) {
      setError('Extension ID is required.');
      return;
    }
    if (!EXTENSION_ID_PATTERN.test(id)) {
      setError('Extension ID must be a lowercase slug matching ^[a-z0-9][a-z0-9-]{0,63}$.');
      return;
    }

    if (addForm.sourceType === 'direct-attachment' && addForm.kind === 'plugin') {
      setError('Plugins require a git or local directory source in V1.');
      return;
    }

    setExtensionSaving(true);
    setError(null);

    try {
      let payload: Parameters<DesktopShellClient['addAgentExtension']>[0];

      if (addForm.sourceType === 'git') {
        payload = {
          id,
          kind: addForm.kind,
          provider_id: addForm.provider_id,
          source: {
            type: 'git',
            url: addForm.gitUrl.trim(),
            ref: addForm.gitRef.trim(),
            ...(addForm.gitSubpath.trim() ? { source_subpath: addForm.gitSubpath.trim() } : {}),
          },
        };
      } else if (addForm.sourceType === 'local') {
        payload = {
          id,
          kind: addForm.kind,
          provider_id: addForm.provider_id,
          source: {
            type: 'local',
            path: addForm.localPath.trim(),
            ...(addForm.localSubpath.trim() ? { source_subpath: addForm.localSubpath.trim() } : {}),
          },
        };
      } else {
        // direct-attachment — skill only (plugin already rejected above)
        payload = {
          id,
          kind: 'skill' as const,
          provider_id: addForm.provider_id,
          source: {
            type: 'direct-attachment',
            skill_markdown: addForm.skillMarkdown,
          },
        };
      }

      const result = await client.addAgentExtension(payload) as { ok: boolean; response?: { extension?: AgentExtensionRendererCatalogEntry }; error?: string };

      if (result.ok && result.response?.extension) {
        setExtensions((current) => [...current, result.response!.extension!]);
        setAddForm(DEFAULT_ADD_FORM);
        addToast({ severity: 'success', message: `Extension "${result.response.extension.display_name}" added.`, duration: 4000 });
        return;
      }

      setError(result.error ?? 'Unable to add extension.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add extension.');
    } finally {
      setExtensionSaving(false);
    }
  }, [addForm, addToast, client]);

  const onReseedExtension = useCallback(async (id: string) => {
    setExtensionSaving(true);
    setError(null);

    try {
      const result = await client.reseedAgentExtension({ id }) as { ok: boolean; response?: { extension?: AgentExtensionRendererCatalogEntry }; error?: string };

      if (result.ok && result.response?.extension) {
        setExtensions((current) =>
          current.map((entry) => (entry.id === id ? result.response!.extension! : entry)),
        );
        addToast({ severity: 'success', message: `Extension "${result.response.extension.display_name}" reseeded.`, duration: 4000 });
        return;
      }

      setError(result.error ?? 'Unable to reseed extension.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reseed extension.');
    } finally {
      setExtensionSaving(false);
    }
  }, [addToast, client]);

  const onDeleteExtension = useCallback(async (id: string) => {
    setExtensionSaving(true);
    setError(null);

    // The backend rejects deleting an assigned entry unless the same request clears
    // assignments. Mirror the persisted (saved) assignment state — which is what the
    // backend checks — to decide whether to opt into the combined delete-plus-unassign.
    const wasAssigned = Object.values(savedAssignments).some((ids) => ids.includes(id));

    try {
      const result = await client.deleteAgentExtension({ id, remove_assignments: wasAssigned }) as { ok: boolean; response?: { id?: string }; error?: string };

      if (result.ok) {
        setExtensions((current) => current.filter((entry) => entry.id !== id));
        // Remove from working assignments too
        setWorkingAssignments((current) => {
          const next = { ...current };
          for (const agentId of Object.keys(next)) {
            next[agentId] = next[agentId].filter((eid) => eid !== id);
          }
          return next;
        });
        setSavedAssignments((current) => {
          const next = { ...current };
          for (const agentId of Object.keys(next)) {
            next[agentId] = next[agentId].filter((eid) => eid !== id);
          }
          return next;
        });
        addToast({
          severity: 'success',
          message: wasAssigned ? 'Extension deleted and unassigned from agents.' : 'Extension deleted.',
          duration: 4000,
        });
        return;
      }

      setError(result.error ?? 'Unable to delete extension.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete extension.');
    } finally {
      setExtensionSaving(false);
    }
  }, [addToast, client, savedAssignments]);

  const onToggleExtensionAssignment = useCallback((agentId: string, extensionId: string, selected: boolean) => {
    setWorkingAssignments((current) => {
      const current_ids = current[agentId] ?? [];
      const next_ids = selected
        ? current_ids.includes(extensionId) ? current_ids : [...current_ids, extensionId]
        : current_ids.filter((eid) => eid !== extensionId);
      return { ...current, [agentId]: next_ids };
    });
  }, []);

  const onSaveAssignments = useCallback(async () => {
    if (!isAssignmentsDirty) return;

    setExtensionSaving(true);
    setError(null);

    try {
      // Build payload — IDs only, identity mapping agent_id
      const assignments = Object.entries(workingAssignments).map(([agent_id, extension_ids]) => ({
        agent_id: agent_id as AgentExtensionAgentId,
        extension_ids: [...extension_ids].sort(),
      }));

      const result = await client.saveAgentExtensionAssignments({ assignments }) as {
        ok: boolean;
        response?: { assignments?: Array<{ agent_id: AgentExtensionAgentId; extension_ids: string[] }> };
        error?: string;
      };

      if (result.ok && result.response?.assignments !== undefined) {
        const map = toAssignmentMap(result.response.assignments);
        setSavedAssignments(map);
        setWorkingAssignments(map);
        addToast({ severity: 'success', message: 'Agent extension assignments saved.', duration: 4000 });
        return;
      }

      setError(result.error ?? 'Unable to save assignments.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save assignments.');
    } finally {
      setExtensionSaving(false);
    }
  }, [addToast, client, isAssignmentsDirty, workingAssignments]);

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
    },
    openAgentConfigModal,
  };
}
