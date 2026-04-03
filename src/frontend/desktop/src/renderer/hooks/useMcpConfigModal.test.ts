import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { createMockClient } from '../../test/factories/clientFactory';
import { useMcpConfigModal } from './useMcpConfigModal';
import type { ExternalMcpServerEntry } from '../../shared/desktopContract';

function makeServer(overrides: Partial<ExternalMcpServerEntry> = {}): ExternalMcpServerEntry {
  return {
    id: 'test-mcp',
    display_name: 'Test MCP',
    purpose: 'Test',
    enabled: true,
    transport: 'sse',
    url: 'https://mcp.example.com/sse',
    agent_scope: { mode: 'allowlist', agent_ids: ['swe'] },
    ...overrides,
  };
}

describe('useMcpConfigModal', () => {
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
    act(() => { result.current.mcpConfigModalProps.onDraftChange('purpose', 'Test'); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('url', 'https://mcp.example.com/sse'); });
    act(() => { result.current.mcpConfigModalProps.onDraftChange('agent_ids', ['swe']); });

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
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('idle');

    // Re-validate succeeds.
    await act(async () => { await result.current.mcpConfigModalProps.onValidateConnection(); });
    expect(result.current.mcpConfigModalProps.connectionValidation.status).toBe('success');
    expect(result.current.mcpConfigModalProps.saveEnabled).toBe(true);

    // Save succeeds.
    act(() => {
      result.current.mcpConfigModalProps.onDraftChange('display_name', 'Test');
      result.current.mcpConfigModalProps.onDraftChange('purpose', 'Test');
      result.current.mcpConfigModalProps.onDraftChange('agent_ids', ['swe']);
    });
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
});
