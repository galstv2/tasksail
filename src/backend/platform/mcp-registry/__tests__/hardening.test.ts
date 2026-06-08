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


describe('schema version round-trip', () => {
  it('seed → load → save → re-seed with wrong version fails closed', async () => {
    writeDefault();

    // Seed initial
    const seedResult = await seedMcpRegistry(tmpDir);
    expect(seedResult.action).toBe('created');

    const loadResult = await loadMcpRegistry(runtimePath());
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    const staleData = JSON.parse(REAL_DEFAULT);
    staleData.schema_version = 999;
    fs.writeFileSync(runtimePath(), JSON.stringify(staleData), 'utf-8');

    const reseedResult = await seedMcpRegistry(tmpDir);
    expect(reseedResult.action).toBe('failed');
  });

  it('seed → corrupt runtime → re-seed fails closed', async () => {
    writeDefault();
    await seedMcpRegistry(tmpDir);

    fs.writeFileSync(runtimePath(), '{ broken }', 'utf-8');

    const result = await seedMcpRegistry(tmpDir);
    expect(result.action).toBe('failed');
    if (result.action === 'failed') {
      expect(result.errors[0].message).toContain('Invalid JSON');
    }
  });
});


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
      const secondEntryErrors = result.errors.filter((e) => e.field.startsWith('services[1]'));
      expect(secondEntryErrors.length).toBeGreaterThan(0);
    }
  });

  it('fix text is actionable (contains a verb)', () => {
    const result = validateRegistry({ schema_version: 999, services: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const error of result.errors) {
        expect(error.fix).toMatch(/Update|Set|Add|Remove|Use|Delete|Ensure|Fix|Run/i);
      }
    }
  });
});


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
