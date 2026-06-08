import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { DesktopShellClient } from '../../services/desktopShellClient';
import { useToastContext } from '../../contexts/ToastContext';
import type { ExternalMcpServerEntry } from '../../../shared/desktopContract';
import type {
  AgentExtensionRendererCatalogEntry,
  AgentExtensionAgentId,
  AgentExtensionKind,
  AgentExtensionProviderId,
} from '../../../shared/desktopContractAgentConfig';

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

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function createDefaultAddForm(providerId: AgentExtensionProviderId): ExtensionAddForm {
  return {
    id: '',
    kind: 'skill',
    provider_id: providerId,
    sourceType: 'git',
    gitUrl: '',
    gitRef: '',
    gitSubpath: '',
    localPath: '',
    localSubpath: '',
    skillMarkdown: '',
  };
}

// Build a stable assignment map from the IPC response shape
export function toAssignmentMap(
  assignments: Array<{ agent_id: AgentExtensionAgentId; extension_ids: string[] }>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) {
    map[entry.agent_id] = [...entry.extension_ids];
  }
  return map;
}

// Build a stable assignment map from the external MCP assignment IPC response shape
export function toMcpAssignmentMap(
  assignments: Array<{ agent_id: AgentExtensionAgentId; external_mcp_server_ids: string[] }>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) {
    map[entry.agent_id] = [...entry.external_mcp_server_ids];
  }
  return map;
}

export type UseAgentExtensionActionsParams = {
  client: DesktopShellClient;
  // The active provider id (descriptor?.providerId), used to seed the add-extension form.
  providerId: AgentExtensionProviderId | undefined;
  // The modal owns error state; extension actions surface validation/IPC errors through it.
  setError: (value: string | null) => void;
};

export type UseAgentExtensionActionsResult = {
  extensions: AgentExtensionRendererCatalogEntry[];
  externalMcpServers: ExternalMcpServerEntry[];
  workingAssignments: Record<string, string[]>;
  workingMcpAssignments: Record<string, string[]>;
  addForm: ExtensionAddForm;
  extensionSaving: boolean;
  isAssignmentsDirty: boolean;
  // Loader setters consumed by the modal's loadConfig to initialize state after the shared read.
  setExtensions: Dispatch<SetStateAction<AgentExtensionRendererCatalogEntry[]>>;
  setExternalMcpServers: Dispatch<SetStateAction<ExternalMcpServerEntry[]>>;
  setSavedAssignments: Dispatch<SetStateAction<Record<string, string[]>>>;
  setWorkingAssignments: Dispatch<SetStateAction<Record<string, string[]>>>;
  setSavedMcpAssignments: Dispatch<SetStateAction<Record<string, string[]>>>;
  setWorkingMcpAssignments: Dispatch<SetStateAction<Record<string, string[]>>>;
  onAddFormChange: (patch: Partial<ExtensionAddForm>) => void;
  onAddExtension: () => Promise<void>;
  onReseedExtension: (id: string) => Promise<void>;
  onDeleteExtension: (id: string) => Promise<void>;
  onToggleExtensionAssignment: (agentId: string, extensionId: string, selected: boolean) => void;
  onToggleExternalMcpAssignment: (agentId: string, serverId: string, selected: boolean) => void;
  onSaveAssignments: () => Promise<void>;
};

/**
 * Extension catalog + per-agent assignment (Skills & Plugins and External MCP) state and actions.
 * Extracted from useAgentConfigModal to keep that hook within the file-size policy; behavior is unchanged.
 */
export function useAgentExtensionActions(
  params: UseAgentExtensionActionsParams,
): UseAgentExtensionActionsResult {
  const { client, providerId, setError } = params;
  const { addToast } = useToastContext();

  const [extensions, setExtensions] = useState<AgentExtensionRendererCatalogEntry[]>([]);
  // Saved assignment map (reflects last-loaded or last-saved state)
  const [savedAssignments, setSavedAssignments] = useState<Record<string, string[]>>({});
  // Working (unsaved) assignment map
  const [workingAssignments, setWorkingAssignments] = useState<Record<string, string[]>>({});
  // External MCP servers + per-agent assignments (independent of Skills & Plugins)
  const [externalMcpServers, setExternalMcpServers] = useState<ExternalMcpServerEntry[]>([]);
  const [savedMcpAssignments, setSavedMcpAssignments] = useState<Record<string, string[]>>({});
  const [workingMcpAssignments, setWorkingMcpAssignments] = useState<Record<string, string[]>>({});
  const [addForm, setAddForm] = useState<ExtensionAddForm>(() => createDefaultAddForm(''));
  const [extensionSaving, setExtensionSaving] = useState(false);

  useEffect(() => {
    if (!providerId) {
      return;
    }
    setAddForm((current) => (
      current.provider_id === providerId
        ? current
        : { ...current, provider_id: providerId }
    ));
  }, [providerId]);

  const isSkillsAssignmentsDirty = useMemo(() => {
    const agentIds = new Set([...Object.keys(savedAssignments), ...Object.keys(workingAssignments)]);
    for (const agentId of agentIds) {
      const saved = (savedAssignments[agentId] ?? []).slice().sort().join(',');
      const working = (workingAssignments[agentId] ?? []).slice().sort().join(',');
      if (saved !== working) return true;
    }
    return false;
  }, [savedAssignments, workingAssignments]);

  const isExternalMcpAssignmentsDirty = useMemo(() => {
    const agentIds = new Set([...Object.keys(savedMcpAssignments), ...Object.keys(workingMcpAssignments)]);
    for (const agentId of agentIds) {
      const saved = (savedMcpAssignments[agentId] ?? []).slice().sort().join(',');
      const working = (workingMcpAssignments[agentId] ?? []).slice().sort().join(',');
      if (saved !== working) return true;
    }
    return false;
  }, [savedMcpAssignments, workingMcpAssignments]);

  // The single Save Assignments action covers both categories.
  const isAssignmentsDirty = isSkillsAssignmentsDirty || isExternalMcpAssignmentsDirty;

  const onAddFormChange = useCallback((patch: Partial<ExtensionAddForm>) => {
    setAddForm((current) => ({ ...current, ...patch }));
    setError(null);
  }, [setError]);

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
      setError('Plugins require a git or local directory source.');
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
        setAddForm(createDefaultAddForm(providerId ?? addForm.provider_id));
        addToast({ severity: 'success', message: `Extension "${result.response.extension.display_name}" added.`, duration: 4000 });
        return;
      }

      setError(result.error ?? 'Unable to add extension.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add extension.');
    } finally {
      setExtensionSaving(false);
    }
  }, [addForm, addToast, client, providerId, setError]);

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
  }, [addToast, client, setError]);

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
  }, [addToast, client, savedAssignments, setError]);

  const onToggleExtensionAssignment = useCallback((agentId: string, extensionId: string, selected: boolean) => {
    setWorkingAssignments((current) => {
      const current_ids = current[agentId] ?? [];
      const next_ids = selected
        ? current_ids.includes(extensionId) ? current_ids : [...current_ids, extensionId]
        : current_ids.filter((eid) => eid !== extensionId);
      return { ...current, [agentId]: next_ids };
    });
  }, []);

  const onToggleExternalMcpAssignment = useCallback((agentId: string, serverId: string, selected: boolean) => {
    setWorkingMcpAssignments((current) => {
      const current_ids = current[agentId] ?? [];
      const next_ids = selected
        ? current_ids.includes(serverId) ? current_ids : [...current_ids, serverId]
        : current_ids.filter((sid) => sid !== serverId);
      return { ...current, [agentId]: next_ids };
    });
  }, []);

  const onSaveAssignments = useCallback(async () => {
    if (!isAssignmentsDirty) return;

    setExtensionSaving(true);
    setError(null);

    const errors: string[] = [];
    let savedAny = false;

    // Skills & Plugins — its saved snapshot updates only on its own success.
    if (isSkillsAssignmentsDirty) {
      try {
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
          savedAny = true;
        } else {
          errors.push(result.error ?? 'Unable to save skills & plugins assignments.');
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unable to save skills & plugins assignments.');
      }
    }

    // External MCP — independent save; its snapshot updates only on its own success.
    if (isExternalMcpAssignmentsDirty) {
      try {
        const assignments = Object.entries(workingMcpAssignments).map(([agent_id, external_mcp_server_ids]) => ({
          agent_id: agent_id as AgentExtensionAgentId,
          external_mcp_server_ids: [...external_mcp_server_ids].sort(),
        }));
        const result = await client.saveExternalMcpAssignments({ assignments }) as {
          ok: boolean;
          response?: { assignments?: Array<{ agent_id: AgentExtensionAgentId; external_mcp_server_ids: string[] }> };
          error?: string;
        };
        if (result.ok && result.response?.assignments !== undefined) {
          const map = toMcpAssignmentMap(result.response.assignments);
          setSavedMcpAssignments(map);
          setWorkingMcpAssignments(map);
          savedAny = true;
        } else {
          errors.push(result.error ?? 'Unable to save external MCP assignments.');
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unable to save external MCP assignments.');
      }
    }

    if (errors.length > 0) {
      setError(errors.join(' '));
    } else if (savedAny) {
      addToast({ severity: 'success', message: 'Agent assignments saved.', duration: 4000 });
    }

    setExtensionSaving(false);
  }, [
    addToast,
    client,
    isAssignmentsDirty,
    isSkillsAssignmentsDirty,
    isExternalMcpAssignmentsDirty,
    workingAssignments,
    workingMcpAssignments,
    setError,
  ]);

  return {
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
  };
}
