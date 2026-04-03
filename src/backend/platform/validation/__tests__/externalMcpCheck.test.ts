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
        purpose: 'Test',
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
// Agent scope warnings
// ---------------------------------------------------------------------------

describe('agent scope advisory warnings', () => {
  it('warns on unknown agent IDs', async () => {
    writeDefaultRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'test-mcp',
        display_name: 'Test MCP',
        purpose: 'Test',
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        agent_scope: { mode: 'allowlist', agent_ids: ['nonexistent-agent'] },
      }],
    });
    writeAgentRegistry(['software-engineer', 'qa']);

    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('nonexistent-agent');
    expect(result.warnings[0]).toContain('unknown agent ID');
  });

  it('does not warn on known agent IDs', async () => {
    writeDefaultRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'test-mcp',
        display_name: 'Test MCP',
        purpose: 'Test',
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        agent_scope: { mode: 'allowlist', agent_ids: ['software-engineer'] },
      }],
    });
    writeAgentRegistry(['software-engineer', 'qa']);

    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('does not fail local-checks on unknown agent IDs', async () => {
    writeDefaultRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'test-mcp',
        display_name: 'Test MCP',
        purpose: 'Test',
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        agent_scope: { mode: 'allowlist', agent_ids: ['unknown-agent'] },
      }],
    });
    writeAgentRegistry(['software-engineer']);

    const result = await checkExternalMcpRegistry(tmpDir);
    // Valid despite unknown agent — warnings only.
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('skips scope check when agent registry is missing', async () => {
    writeDefaultRegistry({
      schema_version: 1,
      external_servers: [{
        id: 'test-mcp',
        display_name: 'Test MCP',
        purpose: 'Test',
        enabled: true,
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        agent_scope: { mode: 'allowlist', agent_ids: ['unknown-agent'] },
      }],
    });
    // No agent registry written — scope check is skipped.

    const result = await checkExternalMcpRegistry(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
