import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { createMockClient } from '../../test/factories/clientFactory';
import { useMcpConfigModal } from './useMcpConfigModal';
import type { ExternalMcpServerEntry, ExternalMcpUrlServerEntry } from '../../shared/desktopContract';

const VALID_PURPOSE = 'Use for vendor billing API documentation';
const VALID_PREFERRED_FOR = 'vendor billing API tasks';

const { logEmit } = vi.hoisted(() => {
  const logEmit = vi.fn(() => Promise.resolve({ ok: true }));
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      getBootstrapInfo: vi.fn().mockResolvedValue({
        appName: 'TaskSail',
        platform: 'test',
        logLevel: 'info',
        rendererForwardLevel: 'info',
        versions: { chrome: undefined, electron: undefined, node: 'test' },
      }),
      log: { emit: logEmit },
    },
  });
  return { logEmit };
});

function makeServer(overrides: Partial<ExternalMcpUrlServerEntry> = {}): ExternalMcpServerEntry {
  return {
    id: 'test-mcp',
    display_name: 'Test MCP',
    purpose: 'Test',
    enabled: true,
    transport: 'sse',
    url: 'https://mcp.example.com/sse',
    ...overrides,
  };
}

describe('useMcpConfigModal', () => {
  beforeEach(() => {
    logEmit.mockClear();
  });

  it('loads servers on mount for accurate pmdge count', async () => {
    const servers = [makeServer(), makeServer({ id: 'mcp-2', display_name: 'MCP 2' })];
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.enabledServerCount).toBe(2));
  });

  it('opens to list view and reloads servers', async () => {
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: [] },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(client.listExternalMcpServers).toHaveBeenCalledTimes(1));

    await act(async () => { result.current.openMcpConfigModal(); });
    expect(result.current.mcpConfigModalProps.isOpen).toBe(true);
    expect(result.current.mcpConfigModalProps.view).toBe('list');
    expect(client.listExternalMcpServers).toHaveBeenCalledTimes(2);
  });

  it('switches to form view on add', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    expect(result.current.mcpConfigModalProps.view).toBe('form');
    expect(result.current.mcpConfigModalProps.editingServerId).toBeNull();
  });

  it('switches to form view on edit with pre-populated draft', async () => {
    const servers = [makeServer()];
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.enabledServerCount).toBe(1));

    act(() => { result.current.mcpConfigModalProps.onEdit('test-mcp'); });
    expect(result.current.mcpConfigModalProps.view).toBe('form');
    expect(result.current.mcpConfigModalProps.editingServerId).toBe('test-mcp');
    expect(result.current.mcpConfigModalProps.draft.display_name).toBe('Test MCP');
    expect(result.current.mcpConfigModalProps.draft.url).toBe('https://mcp.example.com/sse');
  });

  it('returns to list view on cancel', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    expect(result.current.mcpConfigModalProps.view).toBe('form');

    act(() => { result.current.mcpConfigModalProps.onCancel(); });
    expect(result.current.mcpConfigModalProps.view).toBe('list');
  });

  it('resets connection validation when URL changes', async () => {
    const client = createMockClient({
      validateExternalMcpConnection: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://a.com/sse'); });

    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('success');

    // Change URL resets validation.
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://b.com/sse'); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('idle');
  });

  it('does NOT reset validation when purpose changes', async () => {
    const client = createMockClient({
      validateExternalMcpConnection: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://a.com/sse'); });

    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('success');

    // Change purpose does NOT reset validation.
    act(() => { result.current.mcpConfigModalProps.onDraftChange('purpose', 'new purpose'); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('success');
  });

  it('shows inline remove confirmation', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onRemove('test-mcp'); });
    expect(result.current.mcpConfigModalProps.removingServerId).toBe('test-mcp');

    act(() => { result.current.mcpConfigModalProps.onCancelRemove(); });
    expect(result.current.mcpConfigModalProps.removingServerId).toBeNull();
  });

  it('toggleEnabled updates server list', async () => {
    const before = [makeServer({ enabled: true })];
    const after = [makeServer({ enabled: false })];
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: before },
      }),
      toggleExternalMcpServer: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.toggleEnabled', mode: 'mutated', message: '', servers: after },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.enabledServerCount).toBe(1));

    await act(async () => { await result.current.mcpConfigModalProps.onToggleEnabled('test-mcp'); });
    expect(result.current.enabledServerCount).toBe(0);
  });

  it('logs and surfaces MCP server load rejections', async () => {
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockRejectedValue(new Error('MCP list failed.')),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));

    await waitFor(() => {
      expect(result.current.mcpConfigModalProps.error).toBe('MCP list failed.');
      expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'mcp.servers.load.failed',
        level: 'warn',
        extra: { reason: 'MCP list failed.' },
      }));
    });
  });

  it('logs and surfaces MCP toggle rejections', async () => {
    const client = createMockClient({
      toggleExternalMcpServer: vi.fn().mockRejectedValue(new Error('Toggle failed.')),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    await act(async () => { await result.current.mcpConfigModalProps.onToggleEnabled('test-mcp'); });

    expect(result.current.mcpConfigModalProps.error).toBe('Toggle failed.');
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'mcp.server.toggle.failed',
      level: 'warn',
      extra: { serverId: 'test-mcp', reason: 'Toggle failed.' },
    }));
  });

  it('logs and surfaces MCP remove rejections', async () => {
    const client = createMockClient({
      removeExternalMcpServer: vi.fn().mockRejectedValue(new Error('Remove failed.')),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    await act(async () => { await result.current.mcpConfigModalProps.onConfirmRemove('test-mcp'); });

    expect(result.current.mcpConfigModalProps.error).toBe('Remove failed.');
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'mcp.server.remove.failed',
      level: 'warn',
      extra: { serverId: 'test-mcp', reason: 'Remove failed.' },
    }));
  });

  it('logs and exits validating state when MCP validation rejects', async () => {
    const client = createMockClient({
      validateExternalMcpConnection: vi.fn().mockRejectedValue(new Error('Validation bridge failed.')),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://mcp.example.com/sse'); });
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });

    expect(result.current.mcpConfigModalProps.connectionValidation).toEqual({
      status: 'failed',
      message: 'Validation bridge failed.',
    });
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'mcp.connection.validate.failed',
      level: 'warn',
      extra: { reason: 'Validation bridge failed.' },
    }));
  });

  it('logs and exits saving state when MCP save rejects', async () => {
    const client = createMockClient({
      validateExternalMcpConnection: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' },
      }),
      addExternalMcpServer: vi.fn().mockRejectedValue(new Error('Save failed.')),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => {
      result.current.mcpConfigModalProps.onDraftChange('display_name', 'Test MCP');
      result.current.mcpConfigModalProps.onDraftChange('purpose', VALID_PURPOSE);
      result.current.mcpConfigModalProps.onDraftChange('preferred_for', VALID_PREFERRED_FOR);
      result.current.mcpConfigModalProps.onDraftChange('url', 'https://mcp.example.com/sse');
    });
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    await act(async () => { await result.current.mcpConfigModalProps.onSave(); });

    expect(result.current.mcpConfigModalProps.saving).toBe(false);
    expect(result.current.mcpConfigModalProps.error).toBe('Save failed.');
    expect(logEmit).toHaveBeenCalledWith(expect.objectContaining({
      msg: 'mcp.server.save.failed',
      level: 'warn',
      extra: { serverId: 'test-mcp', reason: 'Save failed.' },
    }));
  });

  it('disables Save for a short purpose until the purpose floor is met', async () => {
    const client = createMockClient({
      validateExternalMcpConnection: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => {
      result.current.mcpConfigModalProps.onDraftChange('purpose', 'Short');
      result.current.mcpConfigModalProps.onDraftChange('preferred_for', VALID_PREFERRED_FOR);
      result.current.mcpConfigModalProps.onDraftChange('url', 'https://mcp.example.com/sse');
    });
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });

    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(false);
    expect(result.current.mcpConfigModalProps.fieldErrors.purpose).toContain('at least 20 characters');

    act(() => { result.current.mcpConfigModalProps.onDraftChange('purpose', VALID_PURPOSE); });
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(true);
  });

  it('disables Save until Preferred For has at least one cue', async () => {
    const client = createMockClient({
      validateExternalMcpConnection: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => {
      result.current.mcpConfigModalProps.onDraftChange('purpose', VALID_PURPOSE);
      result.current.mcpConfigModalProps.onDraftChange('url', 'https://mcp.example.com/sse');
    });
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });

    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(false);
    expect(result.current.mcpConfigModalProps.fieldErrors.preferred_for).toContain('at least one usage cue');

    act(() => { result.current.mcpConfigModalProps.onDraftChange('preferred_for', VALID_PREFERRED_FOR); });
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(true);
  });
});

describe('useMcpConfigModal — integration round-trips', () => {
  it('full add → toggle → remove round-trip', async () => {
    const server = makeServer();
    const serverDisabled = makeServer({ enabled: false });

    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: [] },
      }),
      validateExternalMcpConnection: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' },
      }),
      addExternalMcpServer: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.add', mode: 'mutated', message: 'Added.', servers: [server] },
      }),
      toggleExternalMcpServer: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.toggleEnabled', mode: 'mutated', message: 'Toggled.', servers: [serverDisabled] },
      }),
      removeExternalMcpServer: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.remove', mode: 'mutated', message: 'Removed.', servers: [] },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    // Open modal → start add flow.
    act(() => { result.current.openMcpConfigModal(); });
    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    expect(result.current.mcpConfigModalProps.view).toBe('form');

    // Fill draft and validate.
    act(() => { result.current.mcpConfigModalProps.onDraftChange('display_name', 'Test MCP'); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('purpose', VALID_PURPOSE); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('preferred_for', VALID_PREFERRED_FOR); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://mcp.example.com/sse'); });

    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('success');

    // Save → returns to list with server.
    await act(async () => { await result.current.mcpConfigModalProps.onSave(); });
    expect(result.current.mcpConfigModalProps.view).toBe('list');
    expect(result.current.mcpConfigModalProps.servers).toHaveLength(1);
    expect(result.current.enabledServerCount).toBe(1);

    // Toggle enabled → disabled.
    await act(async () => { await result.current.mcpConfigModalProps.onToggleEnabled('test-mcp'); });
    expect(result.current.enabledServerCount).toBe(0);

    // Remove with confirmation → list is empty.
    act(() => { result.current.mcpConfigModalProps.onRemove('test-mcp'); });
    expect(result.current.mcpConfigModalProps.removingServerId).toBe('test-mcp');
    await act(async () => { await result.current.mcpConfigModalProps.onConfirmRemove('test-mcp'); });
    expect(result.current.mcpConfigModalProps.servers).toHaveLength(0);
  });

  it('connection validation failure → fix → save', async () => {
    const server = makeServer();
    let validateCallCount = 0;

    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: [] },
      }),
      validateExternalMcpConnection: vi.fn().mockImplementation(async () => {
        validateCallCount++;
        if (validateCallCount === 1) {
          return { ok: true, response: { action: 'externalMcp.validateConnection', mode: 'validated', success: false, message: 'Connection refused' } };
        }
        return { ok: true, response: { action: 'externalMcp.validateConnection', mode: 'validated', success: true, message: 'OK' } };
      }),
      addExternalMcpServer: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.add', mode: 'mutated', message: 'Added.', servers: [server] },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps).toBeTruthy());

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://pmd.example.com/sse'); });

    // First validation fails.
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('failed');
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(false);

    // Fix URL (resets validation).
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://good.example.com/sse'); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('display_name', 'Test MCP'); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('purpose', VALID_PURPOSE); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('preferred_for', VALID_PREFERRED_FOR); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('idle');

    // Re-validate succeeds.
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('success');
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(true);

    // Save succeeds.
    await act(async () => { await result.current.mcpConfigModalProps.onSave(); });
    expect(result.current.mcpConfigModalProps.view).toBe('list');
  });

  it('remove clears stale editing state', async () => {
    const server = makeServer();
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: [server] },
      }),
      removeExternalMcpServer: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.remove', mode: 'mutated', message: 'Removed.', servers: [] },
      }),
    });

    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps.servers).toHaveLength(1));

    // Start editing the server.
    act(() => { result.current.mcpConfigModalProps.onEdit('test-mcp'); });
    expect(result.current.mcpConfigModalProps.view).toBe('form');
    expect(result.current.mcpConfigModalProps.editingServerId).toBe('test-mcp');

    // Remove it while editing → should return to list.
    await act(async () => { await result.current.mcpConfigModalProps.onConfirmRemove('test-mcp'); });
    expect(result.current.mcpConfigModalProps.view).toBe('list');
    expect(result.current.mcpConfigModalProps.editingServerId).toBeNull();
    expect(result.current.mcpConfigModalProps.servers).toHaveLength(0);
  });

  it('serializes a local draft to a local entry on save and bypasses the network-probe gate', async () => {
    const client = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: [], localEnabled: true },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(client));
    await waitFor(() => expect(result.current.mcpConfigModalProps.localEnabled).toBe(true));

    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => {
      result.current.mcpConfigModalProps.onDraftChange('display_name', 'Local FS');
      result.current.mcpConfigModalProps.onDraftChange('purpose', 'Local filesystem tools');
      result.current.mcpConfigModalProps.onDraftChange('preferred_for', 'local file inspection');
      result.current.mcpConfigModalProps.onDraftChange('transport', 'local');
      result.current.mcpConfigModalProps.onDraftChange('command', 'npx');
      result.current.mcpConfigModalProps.onDraftChange('args', '-y\n@scope/fs');
      result.current.mcpConfigModalProps.onDraftChange('tools', 'read_file\nlist_dir');
    });

    // The local gate is satisfied by command + tools without any connection probe.
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('idle');
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(true);

    await act(async () => { await result.current.mcpConfigModalProps.onSave(); });

    expect(client.addExternalMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'local',
      command: 'npx',
      args: ['-y', '@scope/fs'],
      tools: ['read_file', 'list_dir'],
    }));
    const entry = vi.mocked(client.addExternalMcpServer).mock.calls[0]?.[0];
    expect(entry && 'url' in entry).toBe(false);
    expect(entry && 'headers' in entry).toBe(false);
  });

  it('gates local Save on the opt-in flag plus command + non-"*" tools', async () => {
    // With localEnabled false, a fully-populated local draft must stay disabled
    // (never persist a local server the launch path would exclude).
    const disabledClient = createMockClient();
    const { result: disabled } = renderHook(() => useMcpConfigModal(disabledClient));
    await waitFor(() => expect(disabled.current.mcpConfigModalProps).toBeTruthy());
    act(() => { disabled.current.mcpConfigModalProps.onAdd(); });
    act(() => {
      disabled.current.mcpConfigModalProps.onDraftChange('transport', 'local');
      disabled.current.mcpConfigModalProps.onDraftChange('purpose', 'Local filesystem tools');
      disabled.current.mcpConfigModalProps.onDraftChange('preferred_for', 'local file inspection');
      disabled.current.mcpConfigModalProps.onDraftChange('command', 'npx');
      disabled.current.mcpConfigModalProps.onDraftChange('tools', 'read_file');
    });
    expect(disabled.current.mcpConfigModalProps.localEnabled).toBe(false);
    expect(disabled.current.mcpConfigModalProps.saveEnabled).toBe(false);

    // With localEnabled true, gate on command + non-'*' tools.
    const enabledClient = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: { action: 'externalMcp.list', mode: 'read-only', message: '', servers: [], localEnabled: true },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(enabledClient));
    await waitFor(() => expect(result.current.mcpConfigModalProps.localEnabled).toBe(true));
    act(() => { result.current.mcpConfigModalProps.onAdd(); });
    act(() => {
      result.current.mcpConfigModalProps.onDraftChange('transport', 'local');
      result.current.mcpConfigModalProps.onDraftChange('purpose', 'Local filesystem tools');
      result.current.mcpConfigModalProps.onDraftChange('preferred_for', 'local file inspection');
      result.current.mcpConfigModalProps.onDraftChange('command', 'npx');
    });
    // Command present, tools missing → disabled.
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(false);

    act(() => { result.current.mcpConfigModalProps.onDraftChange('tools', '*'); });
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(false);

    act(() => { result.current.mcpConfigModalProps.onDraftChange('tools', 'read_file'); });
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(true);
  });

  it('surfaces localEnabled from the list response', async () => {
    // localEnabled: true must flow from the list response into props. The hook
    // initialises localEnabled to false, so observing true here proves the
    // setLocalEnabled(response.localEnabled) read path (not just the default).
    const enabledClient = createMockClient({
      listExternalMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'externalMcp.list',
          mode: 'read-only',
          message: '',
          servers: [],
          localEnabled: true,
        },
      }),
    });
    const { result } = renderHook(() => useMcpConfigModal(enabledClient));
    await waitFor(() => expect(result.current.mcpConfigModalProps.localEnabled).toBe(true));

    // A list reporting false flows through as false.
    const disabledClient = createMockClient();
    const { result: disabledResult } = renderHook(() => useMcpConfigModal(disabledClient));
    await waitFor(() => expect(disabledResult.current.mcpConfigModalProps).toBeTruthy());
    expect(disabledResult.current.mcpConfigModalProps.localEnabled).toBe(false);
  });
});
