import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import http from 'node:http';

import { validateExternalMcpConnection } from './externalMcpHandlers';

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
