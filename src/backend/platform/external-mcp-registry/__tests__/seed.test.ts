/**
 * Seed lifecycle tests for the external MCP registry.
 *
 * Tests the seed → load → save → re-seed lifecycle with fail-closed
 * semantics for corrupt or stale runtime state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { seedExternalMcpRegistry } from '../seed.js';
import { loadExternalMcpRegistry, RUNTIME_REGISTRY_PATH, DEFAULT_REGISTRY_PATH } from '../load.js';
import { saveExternalMcpRegistry } from '../save.js';
import { CURRENT_SCHEMA_VERSION } from '../types.js';

const REAL_DEFAULT = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', '..', '..', 'config', 'mcp-registry-external.default.json'),
  'utf-8',
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-mcp-seed-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeDefault(content?: string): void {
  const p = path.join(tmpDir, DEFAULT_REGISTRY_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content ?? REAL_DEFAULT, 'utf-8');
}

function runtimePath(): string {
  return path.join(tmpDir, RUNTIME_REGISTRY_PATH);
}


describe('initial seeding', () => {
  it('creates runtime file from default when missing', async () => {
    writeDefault();
    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('created');
    if (result.action !== 'created') return;
    expect(result.registry.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.registry.external_servers).toEqual([]);
    expect(fs.existsSync(runtimePath())).toBe(true);
  });

  it('returns up-to-date when runtime file already exists and is valid', async () => {
    writeDefault();
    await seedExternalMcpRegistry(tmpDir);
    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('up-to-date');
  });

  it('fails when default registry is missing', async () => {
    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
  });

  it('fails when default registry is invalid', async () => {
    writeDefault('{ "schema_version": "pmd" }');
    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
  });
});


describe('fail-closed semantics', () => {
  it('fails on corrupt runtime file (does not silently re-seed)', async () => {
    writeDefault();
    await seedExternalMcpRegistry(tmpDir);

    fs.writeFileSync(runtimePath(), '{ broken json !!!', 'utf-8');
    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('Invalid JSON');
    }
  });

  it('fails on future schema version in runtime file', async () => {
    writeDefault();
    await seedExternalMcpRegistry(tmpDir);

    // Write a future version — the validator rejects it, seed propagates the error
    const future = JSON.parse(REAL_DEFAULT);
    future.schema_version = 999;
    fs.writeFileSync(runtimePath(), JSON.stringify(future), 'utf-8');

    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('newer');
    }
  });

  it('fails on sub-minimum schema version in runtime file', async () => {
    writeDefault();
    await seedExternalMcpRegistry(tmpDir);

    const old = JSON.parse(REAL_DEFAULT);
    old.schema_version = 0;
    fs.writeFileSync(runtimePath(), JSON.stringify(old), 'utf-8');

    const result = await seedExternalMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('positive integer');
    }
  });
});


describe('round-trip with operator mutations', () => {
  it('preserves operator-added servers on re-seed', async () => {
    writeDefault();
    const seedResult = await seedExternalMcpRegistry(tmpDir);
    expect(seedResult.action).toBe('created');
    if (seedResult.action !== 'created') return;

    // Operator adds a server
    const mutated = {
      ...seedResult.registry,
      external_servers: [{
        id: 'my-mcp',
        display_name: 'My MCP',
        purpose: 'Operator-added MCP server for round-trip tests.',
        preferred_for: ['testing'],
        enabled: true,
        transport: 'sse' as const,
        url: 'https://mcp.example.com/sse',
      }],
    };
    await saveExternalMcpRegistry(runtimePath(), mutated);

    // Re-seed should NOT overwrite the operator's changes
    const reseedResult = await seedExternalMcpRegistry(tmpDir);
    expect(reseedResult.action).toBe('up-to-date');
    if (reseedResult.action !== 'up-to-date') return;
    expect(reseedResult.registry.external_servers).toHaveLength(1);
    expect(reseedResult.registry.external_servers[0].id).toBe('my-mcp');
  });
});


describe('atomic save', () => {
  it('concurrent writes do not corrupt the file', async () => {
    writeDefault();
    const seedResult = await seedExternalMcpRegistry(tmpDir);
    if (seedResult.action !== 'created') return;

    const writes = Array.from({ length: 10 }, (_, i) =>
      saveExternalMcpRegistry(runtimePath(), {
        schema_version: CURRENT_SCHEMA_VERSION,
        external_servers: [{
          id: `svc-${i}`,
          display_name: `Service ${i}`,
          purpose: 'Concurrent write integrity test server.',
          preferred_for: ['testing'],
          enabled: true,
          transport: 'sse' as const,
          url: 'https://mcp.example.com/sse',
        }],
      }),
    );

    await Promise.all(writes);

    // File must be valid JSON after all concurrent writes
    const loadResult = await loadExternalMcpRegistry(runtimePath());
    expect(loadResult.ok).toBe(true);

    // No leftover temp files
    const parent = path.dirname(runtimePath());
    const files = fs.readdirSync(parent);
    const temps = files.filter((f) => f.includes('.tmp-'));
    expect(temps).toHaveLength(0);
  });
});
