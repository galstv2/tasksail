/**
 * Hardening tests for the internal MCP registry.
 *
 * These tests verify boundary conditions, error message quality,
 * and round-trip behaviors that catch regressions across the full
 * registry lifecycle (seed → load → validate → save).
 *
 * This registry is for internal platform MCP services ONLY.
 * It does not cover third-party MCP onboarding, agent registration,
 * or remote endpoints.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { validateRegistry, loadMcpRegistry } from '../load.js';
import { seedMcpRegistry } from '../seed.js';
import { toServiceHealthSpecs } from '../healthSpecs.js';
import { getEnabledComposeServices } from '../composeMetadata.js';
import { CURRENT_SCHEMA_VERSION, ALLOWED_ENV_FILE_REFS } from '../types.js';
import type { McpRegistry } from '../types.js';
import { DEFAULT_REGISTRY_PATH, RUNTIME_REGISTRY_PATH } from '../load.js';

const REAL_DEFAULT = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', '..', '..', 'config', 'mcp-registry.default.json'),
  'utf-8',
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-harden-'));
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

// ---------------------------------------------------------------------------
// Default registry alignment
// ---------------------------------------------------------------------------

describe('default registry alignment', () => {
  it('seeded default contains only the current builtin service', () => {
    const data = JSON.parse(REAL_DEFAULT) as McpRegistry;
    expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(data.services).toHaveLength(1);
    expect(data.services[0].id).toBe('repo-context-mcp');
    expect(data.services[0].builtin).toBe(true);
    expect(data.services[0].enabled).toBe(true);
    expect(data.services[0].kind).toBe('container-http');
  });

  it('default registry health spec matches previous DEFAULT_SERVICES contract', () => {
    const data = JSON.parse(REAL_DEFAULT) as McpRegistry;
    const specs = toServiceHealthSpecs(data);
    expect(specs).toEqual([{
      name: 'repo-context-mcp',
      url: 'http://127.0.0.1:8811/health',
      maxRetries: 10,
      retryIntervalMs: 2000,
    }]);
  });

  it('default registry produces compose metadata for repo-context-mcp', () => {
    const data = JSON.parse(REAL_DEFAULT) as McpRegistry;
    const services = getEnabledComposeServices(data);
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe('repo-context-mcp');
    expect(services[0].compose.hostPort).toBe(8811);
    expect(services[0].compose.hostBind).toBe('127.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// Schema version round-trip
// ---------------------------------------------------------------------------

describe('schema version round-trip', () => {
  it('seed → load → save → re-seed with wrong version fails closed', async () => {
    writeDefault();

    // Seed initial
    const seedResult = await seedMcpRegistry(tmpDir);
    expect(seedResult.action).toBe('created');

    // Load the seeded registry
    const loadResult = await loadMcpRegistry(runtimePath());
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    // Write a stale version into the runtime file
    const staleData = JSON.parse(REAL_DEFAULT);
    staleData.schema_version = 999;
    fs.writeFileSync(runtimePath(), JSON.stringify(staleData), 'utf-8');

    // Re-seed should fail — stale version is not silently fixed
    const reseedResult = await seedMcpRegistry(tmpDir);
    expect(reseedResult.action).toBe('failed');
  });

  it('seed → corrupt runtime → re-seed fails closed', async () => {
    writeDefault();
    await seedMcpRegistry(tmpDir);

    // Corrupt the runtime file
    fs.writeFileSync(runtimePath(), '{ broken }', 'utf-8');

    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('Invalid JSON');
    }
  });
});

// ---------------------------------------------------------------------------
// Validation error message quality
// ---------------------------------------------------------------------------

describe('validation error message quality', () => {
  it('every error includes field, message, and fix', () => {
    const pmdRegistry = {
      schema_version: 'not-a-number',
      services: [
        {
          // Missing most fields
          id: '',
          kind: 'unsupported',
        },
      ],
    };
    const result = validateRegistry(pmdRegistry);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const error of result.errors) {
        expect(error.field).toBeTruthy();
        expect(error.message).toBeTruthy();
        expect(error.fix).toBeTruthy();
        // Field should be a recognizable path
        expect(typeof error.field).toBe('string');
      }
    }
  });

  it('field paths reference the correct array index', () => {
    const data = {
      schema_version: 1,
      services: [
        validServiceJson(),
        { id: '', kind: 'pmd' }, // Second entry is broken
      ],
    };
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Errors should reference services[1], not services[0]
      const secondEntryErrors = result.errors.filter((e) => e.field.startsWith('services[1]'));
      expect(secondEntryErrors.length).toBeGreaterThan(0);
    }
  });

  it('fix text is actionable (contains a verb)', () => {
    const result = validateRegistry({ schema_version: 999, services: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const error of result.errors) {
        // Fix should contain an action word
        expect(error.fix).toMatch(/Update|Set|Add|Remove|Use|Delete|Ensure|Fix|Run/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// envFileRefs allowlist exhaustive coverage
// ---------------------------------------------------------------------------

describe('envFileRefs allowlist exhaustive coverage', () => {
  for (const allowed of ALLOWED_ENV_FILE_REFS) {
    it(`accepts "${allowed}" individually`, () => {
      const data = {
        schema_version: 1,
        services: [{
          ...validServiceJson(),
          compose: { ...validServiceJson().compose, envFileRefs: [allowed] },
        }],
      };
      const result = validateRegistry(data);
      expect(result.ok).toBe(true);
    });
  }

  for (const rejected of ['.env.staging', '.env.production', '../.env', '/etc/env', '']) {
    it(`rejects "${rejected}"`, () => {
      const data = {
        schema_version: 1,
        services: [{
          ...validServiceJson(),
          compose: { ...validServiceJson().compose, envFileRefs: [rejected] },
        }],
      };
      const result = validateRegistry(data);
      expect(result.ok).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Variable reference edge cases
// ---------------------------------------------------------------------------

describe('variable reference edge cases', () => {
  const cases: { input: string; shouldFail: boolean; label: string }[] = [
    { input: '${VAR}', shouldFail: true, label: '${VAR} without default' },
    { input: '${A:-${B:-c}}', shouldFail: true, label: 'nested reference' },
    { input: '${VAR:-path', shouldFail: true, label: 'unclosed brace' },
    { input: '${}', shouldFail: true, label: 'empty reference' },
    { input: '${:-default}', shouldFail: true, label: 'missing variable name' },
    { input: '${VAR:-valid/path}', shouldFail: false, label: 'valid reference' },
    { input: 'plain/path', shouldFail: false, label: 'plain path' },
    { input: '.', shouldFail: false, label: 'dot path' },
  ];

  for (const { input, shouldFail, label } of cases) {
    it(`${shouldFail ? 'rejects' : 'accepts'}: ${label}`, () => {
      const data = {
        schema_version: 1,
        services: [{
          ...validServiceJson(),
          compose: {
            ...validServiceJson().compose,
            volumes: [{ host: input, container: '/data', mode: 'rw' }],
          },
        }],
      };
      const result = validateRegistry(data);
      if (shouldFail) {
        expect(result.ok).toBe(false);
      } else {
        expect(result.ok).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Bootstrap integration: corrupt registry
// ---------------------------------------------------------------------------

describe('corrupt registry detection', () => {
  it('loadMcpRegistry returns actionable error for corrupt file', async () => {
    const corruptPath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(corruptPath, '{ broken json !!!', 'utf-8');

    const result = await loadMcpRegistry(corruptPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain('Invalid JSON');
      expect(result.errors[0].fix).toContain('re-run');
    }
  });

  it('loadMcpRegistry returns actionable error for missing file', async () => {
    const result = await loadMcpRegistry(path.join(tmpDir, 'nonexistent.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain('not found');
      expect(result.errors[0].fix).toContain('setup');
    }
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function validServiceJson(): Record<string, unknown> & { compose: Record<string, unknown> } {
  return {
    id: 'test-svc',
    displayName: 'Test Service',
    kind: 'container-http',
    enabled: true,
    builtin: true,
    compose: {
      serviceName: 'test-svc',
      containerName: 'test-svc',
      image: 'test:local',
      dockerfile: 'docker/test/Dockerfile',
      buildContext: '.',
      hostBind: '127.0.0.1',
      hostPort: 9000,
      containerPort: 9000,
      envFileRefs: ['.env'],
      environment: { TEST_HOST: '0.0.0.0' },
      volumes: [{ host: '.', container: '/workspace', mode: 'ro' }],
      memoryLimit: '256M',
      cpuLimit: '0.5',
      stopGracePeriod: '10s',
    },
    health: {
      url: 'http://localhost:9000/health',
      maxRetries: 5,
      retryIntervalMs: 1000,
    },
  };
}
