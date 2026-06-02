/**
 * Tests for the external MCP agent-assignment store.
 *
 * Covers empty-on-missing, strict validation, atomic stable-sorted save,
 * disabled-server filtering at selection time, deleted-server cleanup, and the
 * runtime-nickname -> provider-ID mapping (including dalton-verify isolation).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadExternalMcpAgentAssignments,
  saveExternalMcpAgentAssignments,
  removeDeletedExternalMcpServerAssignment,
  selectExternalMcpServersForAgent,
  EXTERNAL_MCP_ASSIGNMENTS_PATH,
} from '../assignments.js';

let tmpDir: string;

const PROVIDER_AGENTS = [
  { agent_id: 'planning-agent', role_name: 'Planning Specialist', human_name: 'Lily', workflow_order: 0 },
  { agent_id: 'product-manager', role_name: 'Product Manager', human_name: 'Alice', workflow_order: 1 },
  { agent_id: 'software-engineer', role_name: 'Software Engineer', human_name: 'Dalton', workflow_order: 2 },
  { agent_id: 'qa', role_name: 'QA and Closeout', human_name: 'Ron', workflow_order: 3 },
  { agent_id: 'software-engineer-verify', role_name: 'Verification Engineer', human_name: 'Dalton Verify', workflow_order: 99 },
];

function writeAgentRegistry(): void {
  const p = path.join(tmpDir, '.github', 'agents', 'registry.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ agents: PROVIDER_AGENTS }, null, 2), 'utf-8');
}

function urlServer(id: string, enabled = true): Record<string, unknown> {
  return {
    id,
    display_name: id,
    purpose: 'External server used for assignment selection tests.',
    preferred_for: ['testing'],
    enabled,
    transport: 'sse',
    url: 'https://mcp.example.com/sse',
    agent_scope: { mode: 'allowlist', agent_ids: ['software-engineer'] },
  };
}

function writeServerRegistry(servers: Array<Record<string, unknown>>): void {
  const p = path.join(tmpDir, '.platform-state', 'mcp-registry-external.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ schema_version: 1, external_servers: servers }, null, 2), 'utf-8');
}

function readAssignmentsFile(): { schema_version: number; assignments: Array<{ agent_id: string; external_mcp_server_ids: string[] }> } {
  const raw = fs.readFileSync(path.join(tmpDir, EXTERNAL_MCP_ASSIGNMENTS_PATH), 'utf-8');
  return JSON.parse(raw);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-mcp-assign-'));
  writeAgentRegistry();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadExternalMcpAgentAssignments', () => {
  it('returns empty assignments for every provider agent in workflow order when the file is missing', async () => {
    const result = await loadExternalMcpAgentAssignments(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schema_version).toBe(1);
    expect(result.document.assignments.map((a) => a.agent_id)).toEqual([
      'planning-agent',
      'product-manager',
      'software-engineer',
      'qa',
      'software-engineer-verify',
    ]);
    for (const row of result.document.assignments) {
      expect(row.external_mcp_server_ids).toEqual([]);
    }
  });

  it('fails strict load on malformed JSON instead of silently returning empty assignments', async () => {
    const p = path.join(tmpDir, EXTERNAL_MCP_ASSIGNMENTS_PATH);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{ this is not valid json', 'utf-8');

    const result = await loadExternalMcpAgentAssignments(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('saveExternalMcpAgentAssignments', () => {
  it('writes stable sorted JSON (rows in workflow order, server IDs ascending)', async () => {
    writeServerRegistry([urlServer('a-server'), urlServer('b-server')]);

    await saveExternalMcpAgentAssignments(tmpDir, [
      { agent_id: 'software-engineer', external_mcp_server_ids: ['b-server', 'a-server'] },
    ]);

    const onDisk = readAssignmentsFile();
    expect(onDisk.assignments.map((a) => a.agent_id)).toEqual([
      'planning-agent',
      'product-manager',
      'software-engineer',
      'qa',
      'software-engineer-verify',
    ]);
    const swe = onDisk.assignments.find((a) => a.agent_id === 'software-engineer');
    expect(swe?.external_mcp_server_ids).toEqual(['a-server', 'b-server']);
  });

  it('rejects an unknown agent ID', async () => {
    writeServerRegistry([urlServer('vendor-docs')]);
    await expect(
      saveExternalMcpAgentAssignments(tmpDir, [
        { agent_id: 'not-a-real-agent', external_mcp_server_ids: [] },
      ]),
    ).rejects.toThrow(/unknown agent ID/i);
  });

  it('rejects an unknown external MCP server ID', async () => {
    writeServerRegistry([urlServer('vendor-docs')]);
    await expect(
      saveExternalMcpAgentAssignments(tmpDir, [
        { agent_id: 'software-engineer', external_mcp_server_ids: ['ghost-server'] },
      ]),
    ).rejects.toThrow(/unknown external MCP server ID/i);
  });

  it('allows a disabled server ID in a saved assignment', async () => {
    writeServerRegistry([urlServer('live-server'), urlServer('dead-server', false)]);
    const saved = await saveExternalMcpAgentAssignments(tmpDir, [
      { agent_id: 'software-engineer', external_mcp_server_ids: ['live-server', 'dead-server'] },
    ]);
    const swe = saved.assignments.find((a) => a.agent_id === 'software-engineer');
    expect(swe?.external_mcp_server_ids).toEqual(['dead-server', 'live-server']);
  });
});

describe('selectExternalMcpServersForAgent', () => {
  it('omits disabled servers from runtime selection even when assigned', async () => {
    writeServerRegistry([urlServer('live-server'), urlServer('dead-server', false)]);
    await saveExternalMcpAgentAssignments(tmpDir, [
      { agent_id: 'software-engineer', external_mcp_server_ids: ['live-server', 'dead-server'] },
    ]);

    const selection = await selectExternalMcpServersForAgent(tmpDir, 'dalton');
    expect(selection.servers.map((s) => s.id)).toEqual(['live-server']);
  });

  it('maps dalton -> software-engineer and ron -> qa', async () => {
    writeServerRegistry([urlServer('vendor-docs'), urlServer('qa-tool')]);
    await saveExternalMcpAgentAssignments(tmpDir, [
      { agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] },
      { agent_id: 'qa', external_mcp_server_ids: ['qa-tool'] },
    ]);

    const daltonSel = await selectExternalMcpServersForAgent(tmpDir, 'dalton');
    expect(daltonSel.providerAgentId).toBe('software-engineer');
    expect(daltonSel.servers.map((s) => s.id)).toEqual(['vendor-docs']);

    const ronSel = await selectExternalMcpServersForAgent(tmpDir, 'ron');
    expect(ronSel.providerAgentId).toBe('qa');
    expect(ronSel.servers.map((s) => s.id)).toEqual(['qa-tool']);
  });

  it('maps dalton-verify -> software-engineer-verify and does not inherit software-engineer assignments', async () => {
    writeServerRegistry([urlServer('vendor-docs')]);
    await saveExternalMcpAgentAssignments(tmpDir, [
      { agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] },
    ]);

    const verifySel = await selectExternalMcpServersForAgent(tmpDir, 'dalton-verify');
    expect(verifySel.providerAgentId).toBe('software-engineer-verify');
    expect(verifySel.servers).toEqual([]);
  });
});

describe('removeDeletedExternalMcpServerAssignment', () => {
  it('removes the server ID from every assignment row', async () => {
    writeServerRegistry([urlServer('vendor-docs'), urlServer('keep-me')]);
    await saveExternalMcpAgentAssignments(tmpDir, [
      { agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs', 'keep-me'] },
      { agent_id: 'qa', external_mcp_server_ids: ['vendor-docs'] },
    ]);

    // Simulate the post-remove state: the server is already gone from the registry.
    writeServerRegistry([urlServer('keep-me')]);
    const document = await removeDeletedExternalMcpServerAssignment(tmpDir, 'vendor-docs');

    for (const row of document.assignments) {
      expect(row.external_mcp_server_ids).not.toContain('vendor-docs');
    }
    const swe = document.assignments.find((a) => a.agent_id === 'software-engineer');
    expect(swe?.external_mcp_server_ids).toEqual(['keep-me']);
  });
});
