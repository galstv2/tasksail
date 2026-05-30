import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';

// Partial-mock the load module: keep the real validateExternalMcpRegistry (so
// add/update exercise real validation) but stub the registry read.
vi.mock('../../../backend/platform/external-mcp-registry/save', () => ({
  saveExternalMcpRegistry: vi.fn(),
}));
vi.mock('../../../backend/platform/external-mcp-registry/load', async (orig) => {
  const actual = await orig<typeof import('../../../backend/platform/external-mcp-registry/load')>();
  return { ...actual, loadExternalMcpRegistryWithFallback: vi.fn() };
});

import {
  validateExternalMcpConnection,
  validateExternalMcpLocalCommand,
  addExternalMcpServer,
  listExternalMcpServers,
  commandCandidates,
} from './externalMcpHandlers';
import { loadExternalMcpRegistryWithFallback } from '../../../backend/platform/external-mcp-registry/load';
import { saveExternalMcpRegistry } from '../../../backend/platform/external-mcp-registry/save';

const mockedLoad = vi.mocked(loadExternalMcpRegistryWithFallback);
const mockedSave = vi.mocked(saveExternalMcpRegistry);

let server: http.Server;
let port: number;

// Track which methods were received, to verify initialized is sent.
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

  it('fails when required env var is missing', async () => {
    const result = await validateExternalMcpConnection({
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp-valid`,
      headers: { Authorization: '${MISSING_TEST_VAR_HANDLER}' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.response as { success: boolean }).success).toBe(false);
    expect((result.response as { message: string }).message).toContain('MISSING_TEST_VAR_HANDLER');
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
      purpose: 'Local filesystem tools',
      enabled: true,
      transport: 'local' as const,
      command: 'npx',
      args: ['-y', '@scope/fs'],
      tools: ['read_file'],
      agent_scope: { mode: 'allowlist' as const, agent_ids: ['software-engineer'] },
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
        agent_scope: { mode: 'allowlist' as const, agent_ids: ['software-engineer'] },
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
