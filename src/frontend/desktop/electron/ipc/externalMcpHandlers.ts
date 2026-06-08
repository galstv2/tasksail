/**
 * Electron main-process handlers for external MCP server management.
 *
 * All mutations go through the platform external-mcp-registry validator
 * and use the atomic save helper. The modal cannot persist invalid state.
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import {
  validateExternalMcpRegistry,
  loadExternalMcpRegistryWithFallback,
  ENV_VAR_REF_PATTERN,
  RUNTIME_REGISTRY_PATH,
} from '../../../../backend/platform/external-mcp-registry/load';
import { saveExternalMcpRegistry } from '../../../../backend/platform/external-mcp-registry/save';
import { removeDeletedExternalMcpServerAssignment } from '../../../../backend/platform/external-mcp-registry/index';
import type { ExternalMcpRegistry } from '../../../../backend/platform/external-mcp-registry/types';
import { clearExternalMcpRegistryCache } from '../../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache';
import { getPlatformConfig } from '../../../../backend/platform/platform-config/get';

import type {
  DesktopInvokeResult,
  ExternalMcpServerEntry,
  ExternalMcpAddRequest,
  ExternalMcpUpdateRequest,
  ExternalMcpRemoveRequest,
  ExternalMcpToggleEnabledRequest,
  ExternalMcpValidateConnectionRequest,
  ExternalMcpValidateLocalCommandRequest,
  ExternalMcpValidateLocalCommandResponse,
} from '../../src/shared/desktopContract';
import { REPO_ROOT } from '../paths';

// Registry load/save via platform module

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

// Env var resolution for headers (main process only)

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

/**
 * Returns true if any header value in the map is an env-var reference
 * (matches the ${IDENTIFIER} syntax). Used to detect unsaved draft headers
 * that must not be resolved or sent to arbitrary URLs.
 */
function hasEnvRefHeaders(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  return Object.values(headers).some((v) => ENV_VAR_REF_PATTERN.test(v));
}

/**
 * Validate the draft URL against the same rules the registry enforces
 * (https everywhere; http only for localhost). This runs BEFORE resolveHeaders
 * and BEFORE any network I/O so that the draft URL cannot act as an SSRF
 * primitive even without secret resolution.
 *
 * Returns a failure DesktopInvokeResult if the URL is invalid, or null if OK.
 */
function validateDraftUrl(url: string, transport: 'http' | 'sse'): DesktopInvokeResult | null {
  // Construct a minimal synthetic registry entry and run it through the
  // canonical validator so the URL rules are always in sync.
  const probe = {
    schema_version: 1,
    external_servers: [{
      id: 'draft-probe',
      display_name: 'draft-probe',
      purpose: 'Draft connection probe (at least 20 chars)',
      preferred_for: ['probe'],
      enabled: true,
      transport,
      url,
    }],
  };
  const result = validateExternalMcpRegistry(probe);
  if (!result.ok) {
    // Surface the first URL-related error; suppress field-path prefix noise.
    const urlErr = result.errors.find((e) => e.field.includes('.url') || e.field.includes('url'));
    const msg = urlErr ? urlErr.message : result.errors[0]?.message ?? 'Invalid URL for MCP connection.';
    return fail(`Draft URL rejected: ${msg}`);
  }
  return null;
}

// IPC handlers

export async function listExternalMcpServers(): Promise<DesktopInvokeResult> {
  const registry = await loadRegistry();
  let localEnabled = false;
  try {
    localEnabled = (await getPlatformConfig(REPO_ROOT)).external_mcp_local_enabled;
  } catch {
    // Platform config may be unreadable (fresh clone, pre-setup); default off
    // so the renderer keeps the local option disabled (fail-closed).
    localEnabled = false;
  }
  return {
    ok: true,
    response: {
      action: 'externalMcp.list',
      mode: 'read-only',
      message: `${registry.external_servers.length} server(s) configured.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
      localEnabled,
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
  clearExternalMcpRegistryCache(REPO_ROOT);
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
  clearExternalMcpRegistryCache(REPO_ROOT);
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
  // Drop the deleted server from every assignment row. Cleanup is lenient about
  // the (now-unknown) removed server ID and never throws for that reason, so any
  // error here is a genuine I/O or registry failure that left the assignment
  // store stale. The removal itself already succeeded, so we keep ok:true but
  // surface a warning — stale IDs make a later launch selection fail closed.
  let assignmentCleanupWarning: string | undefined;
  try {
    await removeDeletedExternalMcpServerAssignment(REPO_ROOT, payload.serverId);
  } catch (err) {
    assignmentCleanupWarning = `Server removed, but clearing it from agent assignments failed: ${
      err instanceof Error ? err.message : String(err)
    }. The assignment store may be stale.`;
  }
  clearExternalMcpRegistryCache(REPO_ROOT);
  return {
    ok: true,
    response: {
      action: 'externalMcp.remove',
      mode: 'mutated',
      message: `Server "${payload.serverId}" removed.`,
      servers: registry.external_servers as ExternalMcpServerEntry[],
      ...(assignmentCleanupWarning ? { warning: assignmentCleanupWarning } : {}),
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
  clearExternalMcpRegistryCache(REPO_ROOT);
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

// MCP connection validation: initialize followed by initialized.

const PROBE_TIMEOUT_MS = 10_000;
const MAX_SSE_PROBE_BYTES = 64 * 1024;

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
      // A mid-stream socket error emits on the response stream; without a
      // handler it becomes an uncaughtException that exits the app.
      res.on('error', (err) => reject(err));
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

  // GET the SSE endpoint to receive the session endpoint.
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
        // Cap the probe buffer so a server that streams without ever sending an
        // endpoint event cannot grow it without bound.
        if (buffer.length > MAX_SSE_PROBE_BYTES) {
          clearTimeout(timer);
          req.destroy();
          reject(new Error('SSE probe exceeded the maximum buffer size without an endpoint event'));
          return;
        }
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
      res.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('timeout', () => { req.destroy(); reject(new Error('SSE connection timed out')); });
    req.end();
  });

  // Same-origin check: reject cross-origin message endpoints before
  // forwarding any headers. Relative endpoints were already re-based onto the
  // SSE origin above, so this catches only absolute endpoints from a different
  // origin (cross-origin SSE forwarding attack).
  const messageOrigin = new URL(messageUrl).origin;
  const sseOrigin = parsed.origin;
  if (messageOrigin !== sseOrigin) {
    return fail(
      `SSE endpoint directed the probe to a cross-origin message URL (${messageOrigin}). ` +
      `Expected the same origin as the SSE endpoint (${sseOrigin}).`,
    );
  }

  // POST initialize + initialized to the discovered message URL.
  return probeHttp(messageUrl, resolvedHeaders);
}

export async function validateExternalMcpConnection(
  payload: ExternalMcpValidateConnectionRequest['payload'],
): Promise<DesktopInvokeResult> {
  // (1) Validate draft URL against registry rules BEFORE any env resolution or
  // network I/O.  This rejects non-localhost http:// and malformed URLs so the
  // connection probe cannot be used as an SSRF primitive.
  const urlError = validateDraftUrl(payload.url, payload.transport);
  if (urlError) return urlError;

  // (2) Env-ref headers must NOT be resolved for an unsaved draft: doing so
  // would (a) fire authenticated requests at an arbitrary, unvalidated URL and
  // (b) leak whether each env variable exists in the process environment.
  // Instead, return a clear operator-visible message without revealing any
  // variable names, so the operator knows to save first.
  const headersObj = payload.headers ?? {};
  if (hasEnvRefHeaders(headersObj)) {
    return fail(
      'Headers use environment-variable references and cannot be validated before the server is saved. ' +
      'Save the server first, then re-open it to validate the live connection.',
    );
  }

  // (3) All headers are literals — resolve (pass-through for literals) and probe.
  const { resolved: resolvedHeaders, missing } = resolveHeaders(headersObj);
  if (missing.length > 0) {
    // Should not occur for literal-only headers, but handle defensively.
    return fail('One or more header values could not be resolved.');
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

// Local command validation — PATH-existence lookup ONLY.
//
// This affordance must never execute the operator-supplied command (no
// --version probe, no spawn/exec): a configured MCP command may have side
// effects, hang, or behave differently under a probe. It resolves the command
// against process.env.PATH (plus PATHEXT on Windows) using fs stat/access and
// never spawns any process. The configured command runs only at agent launch,
// spawned by the active provider CLI.

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * File names to probe for a bare command on PATH. POSIX: the command itself.
 * Windows: the bare command FIRST (so names that already carry an executable
 * suffix like `npx.cmd` / `node.exe` resolve), then each PATHEXT-appended
 * variant (so extension-less names like `npx` resolve). Pure and exported so
 * the platform/PATHEXT branches can be unit-tested without spawning anything.
 */
export function commandCandidates(command: string, platform: NodeJS.Platform, pathext: string): string[] {
  if (platform !== 'win32') {
    return [command];
  }
  const exts = pathext.split(';').map((e) => e.trim()).filter(Boolean);
  return [...new Set([command, ...exts.map((ext) => command + ext)])];
}

function resolveCommandOnPath(command: string): string | undefined {
  // An explicit path (contains a separator) is checked directly, not searched.
  if (command.includes('/') || command.includes('\\')) {
    return isExecutableFile(command) ? path.resolve(command) : undefined;
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const names = commandCandidates(
    command,
    process.platform,
    process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM',
  );
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export async function validateExternalMcpLocalCommand(
  payload: ExternalMcpValidateLocalCommandRequest['payload'],
): Promise<DesktopInvokeResult> {
  const command = payload.command.trim();
  const resolvedPath = command ? resolveCommandOnPath(command) : undefined;
  const response: ExternalMcpValidateLocalCommandResponse = {
    action: 'externalMcp.validateLocalCommand',
    mode: 'validated',
    found: resolvedPath !== undefined,
    message: resolvedPath !== undefined
      ? `Command found at ${resolvedPath}`
      : 'Command not found on PATH.',
    ...(resolvedPath !== undefined ? { resolvedPath } : {}),
  };
  return { ok: true, response };
}
