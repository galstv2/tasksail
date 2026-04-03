import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { saveMcpRegistry } from '../save.js';
import type { McpRegistry } from '../types.js';

function validRegistry(): McpRegistry {
  return {
    schema_version: 1,
    services: [
      {
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
      },
    ],
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-save-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('saveMcpRegistry', () => {
  it('writes a valid registry atomically', async () => {
    const filePath = path.join(tmpDir, 'registry.json');
    const registry = validRegistry();

    await saveMcpRegistry(filePath, registry);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written.schema_version).toBe(1);
    expect(written.services[0].id).toBe('test-svc');

    // Temp file should be cleaned up
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('concurrent writes do not corrupt the file', async () => {
    const filePath = path.join(tmpDir, 'registry.json');
    const reg1 = validRegistry();
    reg1.services[0].id = 'svc-one';
    const reg2 = validRegistry();
    reg2.services[0].id = 'svc-two';

    await Promise.all([
      saveMcpRegistry(filePath, reg1),
      saveMcpRegistry(filePath, reg2),
    ]);

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as McpRegistry;
    expect(written.schema_version).toBe(1);
    expect(['svc-one', 'svc-two']).toContain(written.services[0].id);

    // No leftover temp files
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toHaveLength(0);
  });

  it('creates parent directories if needed', async () => {
    const filePath = path.join(tmpDir, 'nested', 'dir', 'registry.json');
    await saveMcpRegistry(filePath, validRegistry());
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
