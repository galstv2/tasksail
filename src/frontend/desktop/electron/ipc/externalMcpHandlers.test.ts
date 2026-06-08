import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';

// Partial-mock the load module: keep the real validateExternalMcpRegistry (so
// add/update exercise real validation) but stub the registry read.
vi.mock('../../../../backend/platform/external-mcp-registry/save', () => ({
  saveExternalMcpRegistry: vi.fn(),
}));
vi.mock('../../../../backend/platform/external-mcp-registry/load', async (orig) => {
  const actual = await orig<typeof import('../../../../backend/platform/external-mcp-registry/load')>();
  return { ...actual, loadExternalMcpRegistryWithFallback: vi.fn() };
});
vi.mock('../../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache', async (orig) => {
  const actual = await orig<typeof import('../../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache')>();
  return { ...actual, clearExternalMcpRegistryCache: vi.fn() };
});
vi.mock('../../../../backend/platform/external-mcp-registry/index', async (orig) => {
  const actual = await orig<typeof import('../../../../backend/platform/external-mcp-registry/index')>();
  return {
    ...actual,
    removeDeletedExternalMcpServerAssignment: vi.fn(),
    loadExternalMcpAgentAssignments: vi.fn(),
    saveExternalMcpAgentAssignments: vi.fn(),
  };
});

import {
  validateExternalMcpConnection,
  validateExternalMcpLocalCommand,
  addExternalMcpServer,
  updateExternalMcpServer,
  removeExternalMcpServer,
  toggleExternalMcpServer,
  listExternalMcpServers,
  commandCandidates,
} from './externalMcpHandlers';
import {
  loadExternalMcpAssignments,
  saveExternalMcpAssignments,
} from './externalMcpAssignmentHandlers';
import { loadExternalMcpRegistryWithFallback } from '../../../../backend/platform/external-mcp-registry/load';
import { saveExternalMcpRegistry } from '../../../../backend/platform/external-mcp-registry/save';
import { clearExternalMcpRegistryCache } from '../../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache';
import {
  removeDeletedExternalMcpServerAssignment,
  loadExternalMcpAgentAssignments,
  saveExternalMcpAgentAssignments,
} from '../../../../backend/platform/external-mcp-registry/index';

const mockedLoad = vi.mocked(loadExternalMcpRegistryWithFallback);
const mockedSave = vi.mocked(saveExternalMcpRegistry);
const mockedClearCache = vi.mocked(clearExternalMcpRegistryCache);
const mockedRemoveAssignment = vi.mocked(removeDeletedExternalMcpServerAssignment);
const mockedLoadAssignments = vi.mocked(loadExternalMcpAgentAssignments);
const mockedSaveAssignments = vi.mocked(saveExternalMcpAgentAssignments);

let server: http.Server;
let port: number;

// Record received methods to verify initialized is sent.
const receivedMethods: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = req.url ?? '/';

      // SSE endpoint: responds with text/event-stream containing the
      // message endpoint URL, then closes.
      if (url === '/sse' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        // Send the message endpoint as an SSE data event.
        res.write(`data: http://127.0.0.1:${port}/mcp-valid\n\n`);
        // Close after a short delay to let the client parse.
        setTimeout(() => res.end(), 50);
        return;
      }

      // SSE endpoint that redirects to a cross-origin message URL (attack scenario).
      if (url === '/sse-cross-origin' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        // Points to a completely different host — cross-origin.
        res.write('data: http://attacker.internal:9999/steal\n\n');
        setTimeout(() => res.end(), 50);
        return;
      }

      // SSE endpoint using a relative path (same-origin, should be allowed).
      if (url === '/sse-relative' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        // Relative path — will be re-based on the SSE origin.
        res.write('data: /mcp-valid\n\n');
        setTimeout(() => res.end(), 50);
        return;
      }

      // Parse JSON-RPC method for tracking.
      try {
        const parsed = JSON.parse(body);
        if (parsed.method) receivedMethods.push(parsed.method);
      } catch { /* not JSON */ }

      if (url === '/mcp-valid') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'test-server', version: '1.0.0' },
          },
        }));
        return;
      }

      if (url === '/non-mcp') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }

      if (url === '/mcp-no-serverinfo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
        return;
      }

      if (url === '/error') {
        res.writeHead(503);
        res.end('Service Unavailable');
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

describe('validateExternalMcpConnection — HTTP transport', () => {
  it('succeeds with valid MCP initialize response', async () => {
    receivedMethods.length = 0;
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp-valid`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(true);
    expect((result.response as { message: string }).message).toContain('test-server');
  });

  it('sends initialized notification after successful initialize', async () => {
    receivedMethods.length = 0;
    await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp-valid`,
    });

    expect(receivedMethods).toContain('initialize');
    expect(receivedMethods).toContain('initialized');
  });

  it('fails for HTTP 2xx without valid MCP initialize result', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/non-mcp`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
    expect((result.response as { message: string }).message).toContain('invalid JSON');
  });

  it('fails for 200 JSON without serverInfo', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp-no-serverinfo`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
  });

  it('fails for non-2xx HTTP response', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/error`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
    expect((result.response as { message: string }).message).toContain('503');
  });

  it('fails for unreachable host', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: 'http://127.0.0.1:1/unreachable',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
    expect((result.response as { message: string }).message).toContain('Connection failed');
  });

  // Env-ref headers must not be resolved for unsaved drafts;
  // the response must not reveal whether the variable exists in the environment.
  it('RG-04-enum: env-ref header on an unsaved draft is NOT resolved and does NOT reveal the var name', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp-valid`,
      headers: { Authorization: '${MISSING_TEST_VAR_HANDLER}' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { success: boolean; message: string };
    expect(resp.success).toBe(false);
    expect(resp.message).not.toContain('MISSING_TEST_VAR_HANDLER');
    expect(resp.message.length).toBeGreaterThan(0);
    expect(resp.message.toLowerCase()).toContain('save');
  });

  // Env-ref headers that are set in env also stay unresolved for unsaved drafts.
  it('RG-04-enum: env-ref header that IS set is also not resolved for an unsaved draft', async () => {
    process.env.TEST_PRESENT_VAR_HANDLER = 'secret-value';
    try {
      const result = await validateExternalMcpConnection({
        transport: 'http',
        url: `http://127.0.0.1:${port}/mcp-valid`,
        headers: { Authorization: '${TEST_PRESENT_VAR_HANDLER}' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const resp = result.response as { success: boolean; message: string };
      expect(resp.success).toBe(false);
      expect(resp.message).not.toContain('TEST_PRESENT_VAR_HANDLER');
      expect(resp.message).not.toContain('secret-value');
    } finally {
      delete process.env.TEST_PRESENT_VAR_HANDLER;
    }
  });

  // Drafts pointing at remote http hosts are rejected before
  // resolveHeaders and before any network probe (SSRF-primitive guard).
  it('RG-04-draft-url: remote http host is rejected before env resolution or network probe', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: 'http://attacker.example.com/mcp',
      headers: { Authorization: '${SOME_SECRET}' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { success: boolean; message: string };
    expect(resp.success).toBe(false);
    expect(resp.message).not.toContain('SOME_SECRET');
    const msg = resp.message.toLowerCase();
    expect(msg.includes('url') || msg.includes('draft')).toBe(true);
  });

  // HTTPS remote hosts are allowed for legitimate MCP scenarios.
  it('RG-04-draft-url: https remote host (no env-ref headers) passes URL validation and probes', async () => {
    // The probe will fail on connection but must NOT be rejected at URL validation.
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { success: boolean; message: string };
    expect(resp.success).toBe(false);
    expect(resp.message).toContain('Connection failed');
  });
});

describe('validateExternalMcpConnection — SSE transport', () => {
  it('probes via SSE: connects to SSE endpoint, discovers message URL, completes handshake', async () => {
    receivedMethods.length = 0;
    const result = await validateExternalMcpConnection({
      transport: 'sse',
      url: `http://127.0.0.1:${port}/sse`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(true);
    expect((result.response as { message: string }).message).toContain('test-server');
    // The SSE probe should have discovered the message URL and POSTed
    // initialize + initialized to it.
    expect(receivedMethods).toContain('initialize');
    expect(receivedMethods).toContain('initialized');
  });

  it('fails when SSE endpoint returns non-2xx', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'sse',
      url: `http://127.0.0.1:${port}/error`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
  });

  it('fails for unreachable SSE host', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'sse',
      url: 'http://127.0.0.1:1/sse',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
    expect((result.response as { message: string }).message).toContain('Connection failed');
  });

  // Cross-origin absolute SSE message endpoints are rejected
  // BEFORE headers are forwarded; no secret must reach the attacker-controlled host.
  it('RG-04-mcp-origin: cross-origin absolute SSE message endpoint is rejected before forwarding headers', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'sse',
      url: `http://127.0.0.1:${port}/sse-cross-origin`,
      // Literal header (not an env-ref) to confirm headers would have been sent.
      headers: { Authorization: 'Bearer literal-token' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { success: boolean; message: string };
    expect(resp.success).toBe(false);
    expect(resp.message.toLowerCase()).toMatch(/cross-origin|origin/);
    expect(resp.message).not.toContain('literal-token');
  });

  // Same-origin absolute SSE message endpoints are allowed.
  it('RG-04-mcp-origin (negative): same-origin absolute SSE endpoint still succeeds', async () => {
    receivedMethods.length = 0;
    const result = await validateExternalMcpConnection({
      transport: 'sse',
      url: `http://127.0.0.1:${port}/sse`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(true);
  });

  // Relative SSE message endpoints, re-based on SSE
  // origin) still succeeds — same-origin by construction.
  it('RG-04-mcp-origin (negative): relative SSE endpoint is re-based and allowed', async () => {
    receivedMethods.length = 0;
    const result = await validateExternalMcpConnection({
      transport: 'sse',
      url: `http://127.0.0.1:${port}/sse-relative`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(true);
  });
});

describe('validateExternalMcpLocalCommand — PATH lookup only', () => {
  it('returns found:true with a resolvedPath for an existing executable, without running it', async () => {
    // process.execPath is the absolute node binary path — an existing
    // executable. A PATH-existence check resolves it WITHOUT executing it
    // (running node with no args would open a REPL and hang this test).
    const result = await validateExternalMcpLocalCommand({ command: process.execPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { action: string; found: boolean; resolvedPath?: string };
    expect(resp.action).toBe('externalMcp.validateLocalCommand');
    expect(resp.found).toBe(true);
    expect(resp.resolvedPath).toBe(path.resolve(process.execPath));
  });

  it('returns found:false for a command not on PATH', async () => {
    const result = await validateExternalMcpLocalCommand({ command: 'tasksail-definitely-not-a-real-command-xyz' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { found: boolean; resolvedPath?: string };
    expect(resp.found).toBe(false);
    expect(resp.resolvedPath).toBeUndefined();
  });

  it('returns found:false for a blank command and never executes anything', async () => {
    const result = await validateExternalMcpLocalCommand({ command: '   ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { found: boolean }).found).toBe(false);
  });

  it('resolves a bare command name found on PATH (no execution)', async () => {
    // Make the lookup deterministic: put the node binary's directory on PATH,
    // then resolve it by bare name. On Windows, PATHEXT supplies the extension,
    // so strip a trailing .exe from the basename.
    const binDir = path.dirname(process.execPath);
    let bareName = path.basename(process.execPath);
    if (process.platform === 'win32' && bareName.toLowerCase().endsWith('.exe')) {
      bareName = bareName.slice(0, -4);
    }
    const originalPath = process.env.PATH;
    process.env.PATH = binDir + path.delimiter + (originalPath ?? '');
    try {
      const result = await validateExternalMcpLocalCommand({ command: bareName });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const resp = result.response as { action: string; found: boolean; resolvedPath?: string };
      expect(resp.action).toBe('externalMcp.validateLocalCommand');
      expect(resp.found).toBe(true);
      expect((resp.resolvedPath ?? '').length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns found:false for an absolute path that does not exist', async () => {
    const missing = path.join(path.dirname(process.execPath), 'tasksail-no-such-binary-xyz');
    const result = await validateExternalMcpLocalCommand({ command: missing });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resp = result.response as { found: boolean; resolvedPath?: string };
    expect(resp.found).toBe(false);
    expect(resp.resolvedPath).toBeUndefined();
  });
});

describe('list + add for local servers', () => {
  beforeEach(() => {
    mockedLoad.mockReset();
    mockedSave.mockReset();
  });

  it('list response includes a localEnabled boolean', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [] });
    const result = await listExternalMcpServers();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof (result.response as { localEnabled: boolean }).localEnabled).toBe('boolean');
  });

  it('persists a valid local server through the real validator', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [] });
    const localServer = {
      id: 'local-fs',
      display_name: 'Local FS',
      purpose: 'Local filesystem tools for tests',
      preferred_for: ['local filesystem inspection'],
      enabled: true,
      transport: 'local' as const,
      command: 'npx',
      args: ['-y', '@scope/fs'],
      tools: ['read_file'],
    };
    const result = await addExternalMcpServer({ server: localServer });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockedSave).toHaveBeenCalledOnce();
    const resp = result.response as { servers: Array<{ id: string; transport: string }> };
    expect(resp.servers.some((s) => s.id === 'local-fs' && s.transport === 'local')).toBe(true);
  });

  it('rejects a local server with a "*" tools wildcard via the real validator', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [] });
    const result = await addExternalMcpServer({
      server: {
        id: 'local-bad',
        display_name: 'Local Bad',
        purpose: 'invalid local',
        enabled: true,
        transport: 'local' as const,
        command: 'npx',
        tools: ['*'],
      },
    });
    expect(result.ok).toBe(false);
    expect(mockedSave).not.toHaveBeenCalled();
  });
});

describe('commandCandidates — PATH lookup candidate names', () => {
  it('returns only the bare command on POSIX', () => {
    expect(commandCandidates('npx', 'linux', '.EXE;.CMD')).toEqual(['npx']);
    expect(commandCandidates('npx', 'darwin', '')).toEqual(['npx']);
  });

  it('includes the bare command FIRST on Windows so a suffixed name (npx.cmd) resolves', () => {
    const c = commandCandidates('npx.cmd', 'win32', '.EXE;.CMD;.BAT');
    expect(c[0]).toBe('npx.cmd');
    // PATHEXT variants are also tried (harmless for an already-suffixed name).
    expect(c).toContain('npx.cmd.CMD');
  });

  it('appends PATHEXT variants for an extension-less Windows command', () => {
    const c = commandCandidates('npx', 'win32', '.EXE;.CMD;.BAT');
    expect(c).toContain('npx');
    expect(c).toContain('npx.EXE');
    expect(c).toContain('npx.CMD');
    expect(c).toContain('npx.BAT');
  });

  it('de-dupes candidates and tolerates whitespace/empties in PATHEXT', () => {
    const c = commandCandidates('node.exe', 'win32', '.EXE; ;.CMD');
    expect(new Set(c).size).toBe(c.length);
    expect(c[0]).toBe('node.exe');
  });
});

const VALID_URL_SERVER = {
  id: 'vendor-docs',
  display_name: 'Vendor Docs',
  purpose: 'Vendor API documentation for billing flows.',
  preferred_for: ['docs'],
  enabled: true,
  transport: 'sse' as const,
  url: 'https://mcp.example.com/sse',
};

describe('cache invalidation + assignment cleanup on server mutations', () => {
  beforeEach(() => {
    mockedLoad.mockReset();
    mockedSave.mockReset();
    mockedClearCache.mockReset();
    mockedRemoveAssignment.mockReset();
    mockedRemoveAssignment.mockResolvedValue({ schema_version: 1, assignments: [] });
  });

  it('invalidates the runtime cache after add', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [] });
    const result = await addExternalMcpServer({ server: VALID_URL_SERVER });
    expect(result.ok).toBe(true);
    expect(mockedClearCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates the runtime cache after update', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [VALID_URL_SERVER] });
    const result = await updateExternalMcpServer({
      server: { ...VALID_URL_SERVER, display_name: 'Renamed' },
    });
    expect(result.ok).toBe(true);
    expect(mockedClearCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates the runtime cache after toggle', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [VALID_URL_SERVER] });
    const result = await toggleExternalMcpServer({ serverId: 'vendor-docs' });
    expect(result.ok).toBe(true);
    expect(mockedClearCache).toHaveBeenCalledTimes(1);
  });

  it('removes the server ID from assignments and invalidates the cache after remove', async () => {
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [VALID_URL_SERVER] });
    const result = await removeExternalMcpServer({ serverId: 'vendor-docs' });
    expect(result.ok).toBe(true);
    expect(mockedRemoveAssignment).toHaveBeenCalledWith(expect.any(String), 'vendor-docs');
    expect(mockedClearCache).toHaveBeenCalledTimes(1);
  });

  it('surfaces a warning (still ok) when assignment cleanup fails with a genuine I/O error', async () => {
    // Cleanup never throws for the benign "unknown removed ID" case, so any
    // throw is a real persistence/registry failure that leaves stale IDs. The
    // removal succeeded, so the response stays ok:true but carries a warning.
    mockedLoad.mockResolvedValue({ schema_version: 1, external_servers: [VALID_URL_SERVER] });
    mockedRemoveAssignment.mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    const result = await removeExternalMcpServer({ serverId: 'vendor-docs' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.response).toMatchObject({
      action: 'externalMcp.remove',
      mode: 'mutated',
      warning: expect.stringContaining('EACCES'),
    });
    expect(mockedClearCache).toHaveBeenCalledTimes(1);
  });
});

describe('external MCP assignment handlers', () => {
  beforeEach(() => {
    mockedClearCache.mockReset();
    mockedLoadAssignments.mockReset();
    mockedSaveAssignments.mockReset();
  });

  it('loads assignments and returns them in the response', async () => {
    mockedLoadAssignments.mockResolvedValue({
      ok: true,
      document: {
        schema_version: 1,
        assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }],
      },
    });
    const result = await loadExternalMcpAssignments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const response = result.response as { assignments: Array<{ agent_id: string }> };
    expect(response.assignments).toHaveLength(1);
    expect(response.assignments[0].agent_id).toBe('software-engineer');
  });

  it('fails the load when the assignment file is invalid', async () => {
    mockedLoadAssignments.mockResolvedValue({ ok: false, errors: ['unknown agent ID "ghost".'] });
    const result = await loadExternalMcpAssignments();
    expect(result.ok).toBe(false);
  });

  it('saves assignments and invalidates the runtime cache', async () => {
    mockedSaveAssignments.mockResolvedValue({
      schema_version: 1,
      assignments: [{ agent_id: 'qa', external_mcp_server_ids: ['vendor-docs'] }],
    });
    const result = await saveExternalMcpAssignments({
      assignments: [{ agent_id: 'qa', external_mcp_server_ids: ['vendor-docs'] }],
    });
    expect(result.ok).toBe(true);
    expect(mockedSaveAssignments).toHaveBeenCalledOnce();
    expect(mockedClearCache).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown agent ID against the descriptor roster before persisting', async () => {
    const result = await saveExternalMcpAssignments({
      assignments: [{ agent_id: 'not-a-real-agent', external_mcp_server_ids: ['vendor-docs'] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.action).toBe('agentConfig.saveExternalMcpAssignments');
    expect(JSON.stringify(result)).toContain('not-a-real-agent');
    // Roster rejection short-circuits before the persistence layer is reached.
    expect(mockedSaveAssignments).not.toHaveBeenCalled();
  });
});
