import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExternalMcpServerEntry } from '../../shared/desktopContract';
import { createNamedWorkflowAgentRoster, type NamedWorkflowAgentRoster } from '../../shared/agentRoster';
import { createLogger } from '../log/logger';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';
import { splitLines } from '../utils/splitLines';

export type McpModalView = 'list' | 'form';

export type ConnectionValidationState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'success'; message: string; toolCount?: number }
  | { status: 'failed'; message: string };

export type LocalCommandCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'found'; resolvedPath?: string }
  | { status: 'not-found'; message: string };

export type McpServerFormDraft = {
  id: string;
  display_name: string;
  purpose: string;
  preferred_for: string;
  fallback_description: string;
  transport: 'http' | 'sse' | 'local';
  // url (http/sse) fields
  url: string;
  headers: Array<{ key: string; value: string }>;
  // local (stdio) fields
  command: string;
  args: string;
  env: Array<{ key: string; value: string }>;
  cwd: string;
  tools: string;
  agent_ids: string[];
  enabled: boolean;
};

export type McpConfigModalProps = {
  isOpen: boolean;
  view: McpModalView;
  servers: ExternalMcpServerEntry[];
  error: string | null;
  fieldErrors: Record<string, string>;
  editingServerId: string | null;
  draft: McpServerFormDraft;
  agentRoster?: NamedWorkflowAgentRoster;
  connectionValidation: ConnectionValidationState;
  localEnabled: boolean;
  localCommandCheck: LocalCommandCheckState;
  removingServerId: string | null;
  saving: boolean;
  onClose: () => void;
  onToggleEnabled: (serverId: string) => void;
  onRemove: (serverId: string) => void;
  onConfirmRemove: (serverId: string) => void;
  onCancelRemove: () => void;
  onEdit: (serverId: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  saveEnabled: boolean;
  onSave: () => void;
  onValidateConnection: () => void;
  onCheckLocalCommand: () => void;
  onDraftChange: (field: keyof McpServerFormDraft, value: unknown) => void;
};

export type UseMcpConfigModalResult = {
  mcpConfigModalProps: McpConfigModalProps;
  openMcpConfigModal: () => void;
  enabledServerCount: number;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'server';
}

function emptyDraft(): McpServerFormDraft {
  return {
    id: '',
    display_name: '',
    purpose: '',
    preferred_for: '',
    fallback_description: '',
    transport: 'sse',
    url: '',
    headers: [],
    command: '',
    args: '',
    env: [],
    cwd: '',
    tools: '',
    agent_ids: [],
    enabled: true,
  };
}

const EMPTY_AGENT_ROSTER: NamedWorkflowAgentRoster = {};

function serverToDraft(server: ExternalMcpServerEntry): McpServerFormDraft {
  const draft = emptyDraft();
  draft.id = server.id;
  draft.display_name = server.display_name;
  draft.purpose = server.purpose;
  draft.preferred_for = (server.preferred_for ?? []).join('\n');
  draft.fallback_description = server.fallback_description ?? '';
  draft.transport = server.transport;
  draft.agent_ids = [...server.agent_scope.agent_ids];
  draft.enabled = server.enabled;
  draft.tools = (server.tools ?? []).join('\n');
  if (server.transport === 'local') {
    draft.command = server.command;
    draft.args = (server.args ?? []).join('\n');
    draft.env = Object.entries(server.env ?? {}).map(([key, value]) => ({ key, value }));
    draft.cwd = server.cwd ?? '';
  } else {
    draft.url = server.url;
    draft.headers = Object.entries(server.headers ?? {}).map(([key, value]) => ({ key, value }));
  }
  return draft;
}

function draftToEntry(draft: McpServerFormDraft): ExternalMcpServerEntry {
  const preferred_for = splitLines(draft.preferred_for);
  const common = {
    id: draft.id,
    display_name: draft.display_name,
    purpose: draft.purpose,
    ...(preferred_for.length > 0 ? { preferred_for } : {}),
    ...(draft.fallback_description.trim() ? { fallback_description: draft.fallback_description.trim() } : {}),
    agent_scope: { mode: 'allowlist' as const, agent_ids: draft.agent_ids },
    enabled: draft.enabled,
  };

  if (draft.transport === 'local') {
    const env: Record<string, string> = {};
    for (const e of draft.env) {
      if (e.key.trim()) env[e.key.trim()] = e.value;
    }
    const args = splitLines(draft.args);
    return {
      ...common,
      transport: 'local',
      command: draft.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
      tools: splitLines(draft.tools),
    };
  }

  const headers: Record<string, string> = {};
  for (const h of draft.headers) {
    if (h.key.trim()) headers[h.key.trim()] = h.value;
  }
  const tools = splitLines(draft.tools);
  return {
    ...common,
    transport: draft.transport,
    url: draft.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(tools.length > 0 ? { tools } : {}),
  };
}

const CONNECTION_FIELDS: (keyof McpServerFormDraft)[] = ['url', 'transport', 'headers'];
const MIN_PURPOSE_LENGTH = 20;
const log = createLogger('src/renderer/hooks/useMcpConfigModal');

function mcpErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useMcpConfigModal(
  client: DesktopShellClient = desktopShellClient,
): UseMcpConfigModalResult {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<McpModalView>('list');
  const [servers, setServers] = useState<ExternalMcpServerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<McpServerFormDraft>(emptyDraft());
  const [agentRoster, setAgentRoster] = useState<NamedWorkflowAgentRoster>(EMPTY_AGENT_ROSTER);
  const [connectionValidation, setConnectionValidation] = useState<ConnectionValidationState>({ status: 'idle' });
  const [localEnabled, setLocalEnabled] = useState(false);
  const [localCommandCheck, setLocalCommandCheck] = useState<LocalCommandCheckState>({ status: 'idle' });
  const [removingServerId, setRemovingServerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Track whether connection fields have changed since last validation.
  const lastValidatedRef = useRef<{ url: string; transport: string; headers: string } | null>(null);

  const loadServers = useCallback(async () => {
    try {
      const result = await client.listExternalMcpServers();
      if (result.ok && result.response.action === 'externalMcp.list') {
        setServers(result.response.servers);
        setLocalEnabled(result.response.localEnabled);
        setError(null);
      } else if (!result.ok) {
        setError(result.error);
      }
    } catch (err: unknown) {
      const message = mcpErrorMessage(err, 'Unable to load MCP servers.');
      log.warn('mcp.servers.load.failed', { reason: message });
      setError(message);
    }
  }, [client]);

  const loadProviderRoster = useCallback(async () => {
    try {
      const descriptor = await client.describeActiveProvider();
      setAgentRoster(createNamedWorkflowAgentRoster(descriptor));
    } catch (err: unknown) {
      const message = mcpErrorMessage(err, 'Unable to load provider roster.');
      log.warn('mcp.provider-roster.load.failed', { reason: message });
    }
  }, [client]);

  useEffect(() => {
    loadServers().catch(() => {});
    loadProviderRoster().catch(() => {});
  }, [loadProviderRoster, loadServers]);

  const openMcpConfigModal = useCallback(() => {
    setIsOpen(true);
    setView('list');
    setRemovingServerId(null);
    loadServers().catch(() => {});
    loadProviderRoster().catch(() => {});
  }, [loadProviderRoster, loadServers]);

  const onClose = useCallback(() => {
    setIsOpen(false);
    setView('list');
    setError(null);
    setFieldErrors({});
    setRemovingServerId(null);
  }, []);

  const onToggleEnabled = useCallback(
    async (serverId: string) => {
      try {
        const result = await client.toggleExternalMcpServer(serverId);
        if (result.ok && result.response.action === 'externalMcp.toggleEnabled') {
          setServers(result.response.servers);
        } else if (!result.ok) {
          setError(result.error);
        }
      } catch (err: unknown) {
        const message = mcpErrorMessage(err, 'Unable to toggle MCP server.');
        log.warn('mcp.server.toggle.failed', { serverId, reason: message });
        setError(message);
      }
    },
    [client],
  );

  const onRemove = useCallback((serverId: string) => {
    setRemovingServerId(serverId);
  }, []);

  const onConfirmRemove = useCallback(
    async (serverId: string) => {
      try {
        const result = await client.removeExternalMcpServer(serverId);
        if (result.ok && result.response.action === 'externalMcp.remove') {
          setServers(result.response.servers);
          setRemovingServerId(null);
          // Clear form state if the removed server was being edited.
          if (editingServerId === serverId) {
            setView('list');
            setEditingServerId(null);
          }
        } else if (!result.ok) {
          setError(result.error);
        }
      } catch (err: unknown) {
        const message = mcpErrorMessage(err, 'Unable to remove MCP server.');
        log.warn('mcp.server.remove.failed', { serverId, reason: message });
        setError(message);
      }
    },
    [client, editingServerId],
  );

  const onCancelRemove = useCallback(() => {
    setRemovingServerId(null);
  }, []);

  const onAdd = useCallback(() => {
    setView('form');
    setEditingServerId(null);
    setDraft(emptyDraft());
    setConnectionValidation({ status: 'idle' });
    setLocalCommandCheck({ status: 'idle' });
    setFieldErrors({});
    setError(null);
    lastValidatedRef.current = null;
  }, []);

  const onEdit = useCallback(
    (serverId: string) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;
      setView('form');
      setEditingServerId(serverId);
      setDraft(serverToDraft(server));
      setLocalCommandCheck({ status: 'idle' });
      // Mark connection as already validated for existing url servers.
      setConnectionValidation({ status: 'success', message: 'Previously saved.' });
      lastValidatedRef.current = server.transport === 'local'
        ? null
        : {
            url: server.url,
            transport: server.transport,
            headers: JSON.stringify(server.headers ?? {}),
          };
      setFieldErrors({});
      setError(null);
    },
    [servers],
  );

  const onCancel = useCallback(() => {
    setView('list');
    setEditingServerId(null);
    setFieldErrors({});
    setError(null);
  }, []);

  const onDraftChange = useCallback(
    (field: keyof McpServerFormDraft, value: unknown) => {
      setDraft((prev) => {
        const next = { ...prev, [field]: value };
        // Auto-generate ID from display name for new servers.
        if (field === 'display_name' && !editingServerId) {
          next.id = slugify(value as string);
        }
        return next;
      });
      // Reset connection validation if connection fields changed.
      if (CONNECTION_FIELDS.includes(field)) {
        setConnectionValidation({ status: 'idle' });
        lastValidatedRef.current = null;
      }
      // Reset the advisory command check when the command changes.
      if (field === 'command') {
        setLocalCommandCheck({ status: 'idle' });
      }
      // Clear field-specific error.
      setFieldErrors((prev) => {
        if (!(field in prev)) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [editingServerId],
  );

  const onValidateConnection = useCallback(async () => {
    // The network probe is url-only; local servers use the advisory command check.
    if (draft.transport === 'local') return;
    setConnectionValidation({ status: 'validating' });
    const headersObj: Record<string, string> = {};
    for (const h of draft.headers) {
      if (h.key.trim()) headersObj[h.key.trim()] = h.value;
    }
    try {
      const result = await client.validateExternalMcpConnection({
        transport: draft.transport,
        url: draft.url,
        headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
      });
      if (result.ok && result.response.action === 'externalMcp.validateConnection') {
        const resp = result.response;
        if (resp.success) {
          setConnectionValidation({
            status: 'success',
            message: resp.message,
            toolCount: resp.toolCount,
          });
          lastValidatedRef.current = {
            url: draft.url,
            transport: draft.transport,
            headers: JSON.stringify(headersObj),
          };
        } else {
          setConnectionValidation({ status: 'failed', message: resp.message });
        }
      } else if (!result.ok) {
        setConnectionValidation({ status: 'failed', message: result.error });
      }
    } catch (err: unknown) {
      const message = mcpErrorMessage(err, 'Unable to validate MCP connection.');
      log.warn('mcp.connection.validate.failed', { reason: message });
      setConnectionValidation({ status: 'failed', message });
    }
  }, [client, draft]);

  // Advisory only: resolves the command on PATH; never executes it and never
  // gates Save.
  const onCheckLocalCommand = useCallback(async () => {
    const command = draft.command.trim();
    if (!command) {
      setLocalCommandCheck({ status: 'not-found', message: 'Enter a command to check.' });
      return;
    }
    setLocalCommandCheck({ status: 'checking' });
    try {
      const result = await client.validateExternalMcpLocalCommand({ command });
      if (result.ok && result.response.action === 'externalMcp.validateLocalCommand') {
        const resp = result.response;
        setLocalCommandCheck(
          resp.found
            ? { status: 'found', ...(resp.resolvedPath ? { resolvedPath: resp.resolvedPath } : {}) }
            : { status: 'not-found', message: resp.message },
        );
      } else if (!result.ok) {
        setLocalCommandCheck({ status: 'not-found', message: result.error });
      }
    } catch (err: unknown) {
      const message = mcpErrorMessage(err, 'Unable to check command.');
      log.warn('mcp.local-command.check.failed', { reason: message });
      setLocalCommandCheck({ status: 'not-found', message });
    }
  }, [client, draft.command]);

  const onSave = useCallback(async () => {
    setSaving(true);
    setFieldErrors({});
    setError(null);
    try {
      const entry = draftToEntry(draft);
      const result = editingServerId
        ? await client.updateExternalMcpServer(entry)
        : await client.addExternalMcpServer(entry);

      if (result.ok) {
        const resp = result.response;
        if (resp.action === 'externalMcp.add' || resp.action === 'externalMcp.update') {
          setServers(resp.servers);
        }
        setView('list');
        setEditingServerId(null);
      } else {
        // Map backend validation errors to field paths.
        if (result.details && result.details.length > 0) {
          const mapped: Record<string, string> = {};
          for (const detail of result.details) {
            const colonIdx = detail.indexOf(':');
            if (colonIdx > 0) {
              const fieldPath = detail.slice(0, colonIdx).trim();
              const msg = detail.slice(colonIdx + 1).trim();
              // Extract the leaf field name for display.
              const leaf = fieldPath.split('.').pop() ?? fieldPath;
              mapped[leaf] = msg;
            }
          }
          setFieldErrors(mapped);
        }
        setError(result.error);
      }
    } catch (err: unknown) {
      const message = mcpErrorMessage(err, 'Unable to save MCP server.');
      log.warn('mcp.server.save.failed', {
        serverId: editingServerId ?? draft.id,
        reason: message,
      });
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [client, draft, editingServerId]);

  const enabledServerCount = servers.filter((s) => s.enabled).length;
  const purposeLength = draft.purpose.trim().length;
  const preferredForList = splitLines(draft.preferred_for);
  const descriptionFieldErrors: Record<string, string> = {};
  if (purposeLength > 0 && purposeLength < MIN_PURPOSE_LENGTH) {
    descriptionFieldErrors.purpose = `Purpose must describe when to use this server (at least ${MIN_PURPOSE_LENGTH} characters).`;
  }
  if (preferredForList.length === 0) {
    descriptionFieldErrors.preferred_for = 'Preferred For requires at least one usage cue.';
  }
  const descriptionGateSatisfied =
    purposeLength >= MIN_PURPOSE_LENGTH &&
    preferredForList.length > 0;

  // For edit flow: check if only non-connection fields changed.
  const connectionFieldsChanged = editingServerId && lastValidatedRef.current
    ? (
        draft.url !== lastValidatedRef.current.url ||
        draft.transport !== lastValidatedRef.current.transport ||
        JSON.stringify(
          Object.fromEntries(draft.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])),
        ) !== lastValidatedRef.current.headers
      )
    : false;

  // Local servers gate on the opt-in flag plus a non-empty command and a
  // non-empty tools allowlist (no '*'); they bypass the network-probe success
  // requirement. The advisory command check is never part of this gate.
  // Requiring localEnabled prevents persisting a local server the launch path
  // would silently exclude.
  const localToolsList = splitLines(draft.tools);
  const localGateSatisfied =
    localEnabled &&
    draft.command.trim().length > 0 &&
    localToolsList.length > 0 &&
    !localToolsList.includes('*');

  const saveEnabled =
    !saving &&
    descriptionGateSatisfied &&
    (draft.transport === 'local'
      ? localGateSatisfied
      : connectionValidation.status === 'success' && !connectionFieldsChanged);

  return {
    mcpConfigModalProps: {
      isOpen,
      view,
      servers,
      error,
      fieldErrors: { ...descriptionFieldErrors, ...fieldErrors },
      editingServerId,
      draft,
      agentRoster,
      connectionValidation,
      localEnabled,
      localCommandCheck,
      removingServerId,
      saving,
      onClose,
      onToggleEnabled,
      onRemove,
      onConfirmRemove,
      onCancelRemove,
      onEdit,
      onAdd,
      onCancel,
      saveEnabled,
      onSave,
      onValidateConnection,
      onCheckLocalCommand,
      onDraftChange,
    },
    openMcpConfigModal,
    enabledServerCount,
  };
}
