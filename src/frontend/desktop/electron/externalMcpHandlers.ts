/**
 * Electron main-process handlers for external MCP server management.
 *
 * All mutations go through the platform external-mcp-registry validator
 * and use the atomic save helper. The modal cannot persist invalid state.
 */
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

import {
  validateExternalMcpRegistry,
  loadExternalMcpRegistryWithFallback,
  ENV_VAR_REF_PATTERN,
  RUNTIME_REGISTRY_PATH,
} from '../../../backend/platform/external-mcp-registry/load';
import { saveExternalMcpRegistry } from '../../../backend/platform/external-mcp-registry/save';
import type { ExternalMcpRegistry } from '../../../backend/platform/external-mcp-registry/types';

import type {
  DesktopInvokeResult,
  ExternalMcpServerEntry,
  ExternalMcpAddRequest,
  ExternalMcpUpdateRequest,
  ExternalMcpRemoveRequest,
  ExternalMcpToggleEnabledRequest,
  ExternalMcpValidateConnectionRequest,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

// ---------------------------------------------------------------------------
// Registry load/save via platform module
// ---------------------------------------------------------------------------

async function loadRegistry(): Promise<ExternalMcpRegistry> {
  return loadExternalMcpRegistryWithFallback(REPO_ROOT);
}

async function validateAndSave(doc: ExternalMcpRegistry): Promise<string[]> {
  const result = validateExternalMcpRegistry(doc);
  if (!result.ok) {
    return result.errors.map((e) => `${e.field}: ${e.message}`);
  }
  await saveExternalMcpRegistry(
    path.join(REPO_ROOT, RUNTIME_REGISTRY_PATH),
    result.registry,
  );
  return [];
}

// ---------------------------------------------------------------------------
// Env var resolution for headers (main process only)
// ---------------------------------------------------------------------------

function resolveHeaders(
  headers: Record<string, string> | undefined,
): { resolved: Record<string, string>; missing: string[] } {
  if (!headers) return { resolved: {}, missing: [] };
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    const m = ENV_VAR_REF_PATTERN.exec(value);
    if (m) {
      const envVal = process.env[m[1]];
      if (envVal === undefined) {
        missing.push(m[1]);
        continue;
      }
      resolved[key] = envVal;
    } else {
      resolved[key] = value;
    }
  }
  return { resolved, missing };
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export async function listExternalMcpServers(): Promise<DesktopInvokeResult> {
  const registry = await loadRegistry();
  return {
    ok: true,
    response: {
      action: 'externalMcp.list',
      mode: 'read-only',
      message: `${registry.external_servers.length} server(s) configured.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
    },
  };
}

export async function addExternalMcpServer(
  payload: ExternalMcpAddRequest['payload'],
): Promise<DesktopInvokeResult> {
  const registry = await loadRegistry();
  if (registry.external_servers.some((s) => s.id === payload.server.id)) {
    return { ok: false, error: `Server with ID "${payload.server.id}" already exists.`, action: 'externalMcp.add' };
  }
  registry.external_servers.push(payload.server as ExternalMcpRegistry['external_servers'][0]);
  const errors = await validateAndSave(registry);
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), action: 'externalMcp.add', details: errors };
  }
  return {
    ok: true,
    response: {
      action: 'externalMcp.add',
      mode: 'mutated',
      message: `Server "${payload.server.display_name}" added.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
    },
  };
}

export async function updateExternalMcpServer(
  payload: ExternalMcpUpdateRequest['payload'],
): Promise<DesktopInvokeResult> {
  const registry = await loadRegistry();
  const idx = registry.external_servers.findIndex((s) => s.id === payload.server.id);
  if (idx === -1) {
    return { ok: false, error: `Server with ID "${payload.server.id}" not found.`, action: 'externalMcp.update' };
  }
  registry.external_servers[idx] = payload.server as ExternalMcpRegistry['external_servers'][0];
  const errors = await validateAndSave(registry);
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), action: 'externalMcp.update', details: errors };
  }
  return {
    ok: true,
    response: {
      action: 'externalMcp.update',
      mode: 'mutated',
      message: `Server "${payload.server.display_name}" updated.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
    },
  };
}

export async function removeExternalMcpServer(
  payload: ExternalMcpRemoveRequest['payload'],
): Promise<DesktopInvokeResult> {
  const registry = await loadRegistry();
  const before = registry.external_servers.length;
  registry.external_servers = registry.external_servers.filter((s) => s.id !== payload.serverId);
  if (registry.external_servers.length === before) {
    return { ok: false, error: `Server with ID "${payload.serverId}" not found.`, action: 'externalMcp.remove' };
  }
  const errors = await validateAndSave(registry);
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), action: 'externalMcp.remove', details: errors };
  }
  return {
    ok: true,
    response: {
      action: 'externalMcp.remove',
      mode: 'mutated',
      message: `Server "${payload.serverId}" removed.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
    },
  };
}

export async function toggleExternalMcpServer(
  payload: ExternalMcpToggleEnabledRequest['payload'],
): Promise<DesktopInvokeResult> {
  const registry = await loadRegistry();
  const server = registry.external_servers.find((s) => s.id === payload.serverId);
  if (!server) {
    return { ok: false, error: `Server with ID "${payload.serverId}" not found.`, action: 'externalMcp.toggleEnabled' };
  }
  server.enabled = !server.enabled;
  const errors = await validateAndSave(registry);
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), action: 'externalMcp.toggleEnabled', details: errors };
  }
  return {
    ok: true,
    response: {
      action: 'externalMcp.toggleEnabled',
      mode: 'mutated',
      message: `Server "${payload.serverId}" ${server.enabled ? 'enabled' : 'disabled'}.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
    },
  };
}

// ---------------------------------------------------------------------------
// MCP connection validation (phase-1: initialize → initialized handshake)
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 10_000;

function makeInitializeBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tasksail-probe', version: '1.0.0' },
    },
  });
}

function makeInitializedBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialized',
  });
}

function fail(message: string): DesktopInvokeResult {
  return {
    ok: true,
    response: {
      action: 'externalMcp.validateConnection',
      mode: 'validated',
      success: false,
      message,
    },
  };
}

function succeed(message: string): DesktopInvokeResult {
  return {
    ok: true,
    response: {
      action: 'externalMcp.validateConnection',
      mode: 'validated',
      success: true,
      message,
    },
  };
}

/**
 * POST a JSON-RPC body to the given URL and return the response body.
 * Rejects on network error, non-2xx, or timeout.
 */
function postJsonRpc(
  url: string,
  body: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  const parsed = new URL(url);
  const mod = parsed.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      ...extraHeaders,
    };

    const req = mod.request(url, { method: 'POST', headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Probe via HTTP transport: POST initialize, then POST initialized.
 */
async function probeHttp(
  url: string,
  resolvedHeaders: Record<string, string>,
): Promise<DesktopInvokeResult> {
  const initBody = await postJsonRpc(url, makeInitializeBody(), resolvedHeaders, PROBE_TIMEOUT_MS);

  let serverName = 'server';
  try {
    const parsed = JSON.parse(initBody);
    if (!parsed?.result?.serverInfo) {
      return fail(`Server responded but did not return a valid MCP initialize result.`);
    }
    serverName = parsed.result.serverInfo.name ?? 'server';
  } catch {
    return fail('Server responded with invalid JSON to initialize request.');
  }

  // Send initialized notification (fire-and-forget, but still POST).
  try {
    await postJsonRpc(url, makeInitializedBody(), resolvedHeaders, 5_000);
  } catch {
    // initialized notification failure is non-fatal — the handshake
    // already proved the server speaks MCP.
  }

  return succeed(`MCP handshake successful with ${serverName}.`);
}

/**
 * Probe via SSE transport: GET the SSE endpoint to discover the
 * session message URL, then POST initialize + initialized to it.
 */
async function probeSse(
  url: string,
  resolvedHeaders: Record<string, string>,
): Promise<DesktopInvokeResult> {
  const parsed = new URL(url);
  const mod = parsed.protocol === 'https:' ? https : http;

  // Step 1: GET the SSE endpoint to receive the session endpoint.
  const messageUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('SSE connection timed out'));
    }, PROBE_TIMEOUT_MS);

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      ...resolvedHeaders,
    };

    const req = mod.request(url, { method: 'GET', headers, timeout: PROBE_TIMEOUT_MS }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error(`SSE endpoint returned HTTP ${res.statusCode}`));
        return;
      }

      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        // Parse SSE events looking for the endpoint event.
        const lines = buffer.split('\n');
        for (const line of lines) {
          // MCP SSE servers send an event with the message endpoint URL.
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            // The endpoint URL may be absolute or relative to the SSE URL.
            if (data.startsWith('http://') || data.startsWith('https://') || data.startsWith('/')) {
              clearTimeout(timer);
              req.destroy();
              const resolved = data.startsWith('/') ? `${parsed.protocol}//${parsed.host}${data}` : data;
              resolve(resolved);
              return;
            }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timer);
        reject(new Error('SSE stream ended without providing a message endpoint'));
      });
    });

    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('SSE connection timed out')); });
    req.end();
  });

  // Step 2: POST initialize + initialized to the discovered message URL.
  return probeHttp(messageUrl, resolvedHeaders);
}

export async function validateExternalMcpConnection(
  payload: ExternalMcpValidateConnectionRequest['payload'],
): Promise<DesktopInvokeResult> {
  const { resolved: resolvedHeaders, missing } = resolveHeaders(payload.headers);
  if (missing.length > 0) {
    return fail(`Missing environment variable(s): ${missing.join(', ')}`);
  }

  try {
    if (payload.transport === 'sse') {
      return await probeSse(payload.url, resolvedHeaders);
    }
    return await probeHttp(payload.url, resolvedHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Connection failed: ${message}`);
  }
}
