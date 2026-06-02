/**
 * Tests for the external MCP registry validation check.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { checkExternalMcpRegistry } from '../externalMcpCheck.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-mcp-check-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeDefaultRegistry(data: unknown): void {
  const p = path.join(tmpDir, 'config', 'mcp-registry-external.default.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function writeRuntimeRegistry(data: unknown): void {
  const p = path.join(tmpDir, '.platform-state', 'mcp-registry-external.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function writeAgentRegistry(agentIds: string[]): void {
  const p = path.join(tmpDir, '.github', 'agents', 'registry.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const agents = agentIds.map(id => ({ agent_id: id, role_name: id }));
  fs.writeFileSync(p, JSON.stringify({ agents }, null, 2), 'utf-8');
}

function writeAssignments(content: unknown): void {
  const p = path.join(tmpDir, '.platform-state', 'external-mcp-agent-assignments.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const raw = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(p, raw, 'utf-8');
}

// ---------------------------------------------------------------------------
// No registry exists
// ---------------------------------------------------------------------------

describe('no external MCP registry', () => {
  it('returns valid with no errors or warnings', async () => {
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Valid registry
// ---------------------------------------------------------------------------

describe('valid external MCP registry', () => {
  it('validates empty registry with no warnings', async () => {
    writeDefaultRegistry({ schema_version: 1, external_servers: [] });
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('prefers runtime over default', async () => {
    writeDefaultRegistry({ schema_version: 1, external_servers: [] });
    writeRuntimeRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'runtime-mcp',
        display_name: 'Runtime MCP',
        purpose: 'Runtime registry server preferred over default.',
        preferred_for: ['testing'],
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        agent_scope: { mode: 'allowlist', agent_ids: ['software-engineer'] },
      }],
    });
    writeAgentRegistry(['software-engineer']);

    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid registry
// ---------------------------------------------------------------------------

describe('invalid external MCP registry', () => {
  it('reports validation errors', async () => {
    writeDefaultRegistry({ schema_version: 999, external_servers: [] });
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Stale agent_scope is no longer advisory data
// ---------------------------------------------------------------------------

describe('stale agent_scope', () => {
  it('does not warn when a server carries a stale agent_scope referencing unknown agents', async () => {
    writeRuntimeRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'vendor-docs',
        display_name: 'Vendor Docs MCP',
        purpose: 'Vendor API documentation for billing flows.',
        preferred_for: ['docs'],
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        agent_scope: { mode: 'allowlist', agent_ids: ['nonexistent-agent'] },
      }],
    });
    writeAgentRegistry(['software-engineer']);

    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// External MCP assignment file validation
// ---------------------------------------------------------------------------

describe('external MCP assignment file validation', () => {
  function seedRegistryAndRoster(): void {
    writeRuntimeRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'vendor-docs',
        display_name: 'Vendor Docs MCP',
        purpose: 'Vendor API documentation for billing flows.',
        preferred_for: ['docs'],
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
      }],
    });
    writeAgentRegistry(['software-engineer', 'qa']);
  }

  it('passes when the assignment file is absent', async () => {
    seedRegistryAndRoster();
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a well-formed assignment file', async () => {
    seedRegistryAndRoster();
    writeAssignments({
      schema_version: 1,
      assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }],
    });
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails on an unknown assignment agent ID', async () => {
    seedRegistryAndRoster();
    writeAssignments({
      schema_version: 1,
      assignments: [{ agent_id: 'ghost-agent', external_mcp_server_ids: [] }],
    });
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('ghost-agent');
  });

  it('fails on an unknown assignment server ID', async () => {
    seedRegistryAndRoster();
    writeAssignments({
      schema_version: 1,
      assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['does-not-exist'] }],
    });
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('does-not-exist');
  });

  it('fails on malformed assignment JSON', async () => {
    seedRegistryAndRoster();
    writeAssignments('{ this is not json');
    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
