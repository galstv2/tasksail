import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { seedMcpRegistry } from '../seed.js';
import { RUNTIME_REGISTRY_PATH, DEFAULT_REGISTRY_PATH } from '../load.js';
import { CURRENT_SCHEMA_VERSION } from '../types.js';

const REAL_DEFAULT = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', '..', '..', 'config', 'mcp-registry.default.json'),
  'utf-8',
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-seed-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeDefault(content?: string): void {
  const defaultPath = path.join(tmpDir, DEFAULT_REGISTRY_PATH);
  fs.mkdirSync(path.dirname(defaultPath), { recursive: true });
  fs.writeFileSync(defaultPath, content ?? REAL_DEFAULT, 'utf-8');
}

function runtimePath(): string {
  return path.join(tmpDir, RUNTIME_REGISTRY_PATH);
}

function readRuntime(): string {
  return fs.readFileSync(runtimePath(), 'utf-8');
}

describe('seedMcpRegistry', () => {
  it('creates runtime registry on first run', async () => {
    writeDefault();
    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('created');
    expect(fs.existsSync(runtimePath())).toBe(true);

    const data = JSON.parse(readRuntime());
    expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(data.services).toHaveLength(1);
    expect(data.services[0].id).toBe('repo-context-mcp');
  });

  it('does not overwrite an existing up-to-date runtime registry', async () => {
    writeDefault();

    await seedMcpRegistry(tmpDir);
    const firstContent = readRuntime();

    fs.writeFileSync(runtimePath(), firstContent + '\n');

    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('up-to-date');

    const secondContent = readRuntime();
    expect(secondContent).toBe(firstContent + '\n');
  });

  it('fails when runtime file has corrupt JSON (fail-closed)', async () => {
    writeDefault();
    const corruptPath = runtimePath();
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, '{ not valid json', 'utf-8');

    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('Invalid JSON');
    }
  });

  it('fails when runtime registry has stale schema version', async () => {
    writeDefault();

    const staleRegistry = JSON.parse(REAL_DEFAULT);
    staleRegistry.schema_version = CURRENT_SCHEMA_VERSION + 1;
    const stalePath = runtimePath();
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, JSON.stringify(staleRegistry), 'utf-8');

    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
  });

  it('fails when runtime registry has duplicate service IDs', async () => {
    writeDefault();

    const dupeRegistry = JSON.parse(REAL_DEFAULT);
    dupeRegistry.services.push({ ...dupeRegistry.services[0] });
    const dupePath = runtimePath();
    fs.mkdirSync(path.dirname(dupePath), { recursive: true });
    fs.writeFileSync(dupePath, JSON.stringify(dupeRegistry), 'utf-8');

    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
    }
  });

  it('fails when default registry file is missing', async () => {
    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('not found');
    }
  });

  it('fails when default registry has invalid content', async () => {
    writeDefault('{ "schema_version": 1 }');
    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors.some((e) => e.field === 'services')).toBe(true);
    }
  });
});
